import{createServer}from'node:http';import{readFile,mkdir,open,unlink}from'node:fs/promises';import{dirname,join}from'node:path';import{fileURLToPath}from'node:url';import{randomBytes,randomUUID}from'node:crypto';import{execFile,spawn}from'node:child_process';import{promisify}from'node:util';
import{DeviceController}from'./device-runtime.mjs';import{CompanionError}from'./transport.mjs';
const run=promisify(execFile),folder=dirname(fileURLToPath(import.meta.url));
export async function chooseWindowsLog(){if(process.platform!=='win32')throw new CompanionError('chooser','Use Advanced to enter the log path on this platform.');const script="Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title='Choose your EverQuest log'; $dialog.Filter='EverQuest logs (*.txt)|*.txt|All files (*.*)|*.*'; $dialog.CheckFileExists=$true; if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write($dialog.FileName)}";const result=await run('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,timeout:120000,maxBuffer:16384,encoding:'utf8'});return result.stdout.trim()||null;}
export function openCompanionBrowser(origin){if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Invalid companion origin');let child;if(process.platform==='win32')child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process -FilePath '"+origin+"/'"],{windowsHide:true,stdio:'ignore'});else child=spawn(process.platform==='darwin'?'open':'xdg-open',[origin+'/'],{stdio:'ignore'});child.on('error',()=>{});child.unref();}
export async function createCompanionGui({stateDirectory=join(folder,'state'),port=4831,chooseLog=chooseWindowsLog,controller,fetchImpl,pollMs=2000}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');const runtime=controller??new DeviceController({stateDirectory,fetchImpl});const[html,js,css]=await Promise.all(['gui.html','gui.js','gui.css'].map(name=>readFile(join(folder,name),'utf8')));await mkdir(stateDirectory,{recursive:true});let lock;const lockPath=join(stateDirectory,'gui.lock'),instanceId=randomUUID();try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,instanceId}));await lock.sync();}catch(error){try{await lock?.close();}catch{}throw new CompanionError('gui_locked','The companion is already open, or a saved lock needs review. Keep existing queues intact.',{terminal:true});}
 let origin,interval,closed=false,inFlight=false;const csrf=randomBytes(32).toString('hex');
 const send=(response,status,value,type='application/json')=>{response.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});response.end(type==='application/json'?JSON.stringify(value):value);};
 async function body(request){if(!request.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new CompanionError('content_type','Send JSON data.');let raw='',size=0;const decoder=new TextDecoder();for await(const chunk of request){size+=chunk.length;if(size>8192)throw new CompanionError('too_large','The local request is too large.');raw+=decoder.decode(chunk,{stream:true});}raw+=decoder.decode();try{const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw Error();return d;}catch{throw new CompanionError('json','Send valid JSON data.');}}
 const server=createServer(async(request,response)=>{try{
  if(request.headers.host!==new URL(origin).host)return send(response,403,{error:'Use the local companion address.'});
  const url=new URL(request.url,origin);if(url.origin!==origin)return send(response,403,{error:'Use the local companion address.'});
  const fetchSite=request.headers['sec-fetch-site'],navigation=request.method==='GET'&&url.pathname==='/'&&request.headers['sec-fetch-mode']==='navigate'&&request.headers['sec-fetch-dest']==='document';if(fetchSite&&!['same-origin','none'].includes(fetchSite)&&!navigation)return send(response,403,{error:'Open the companion directly.'});
  if(request.method==='GET'){
   if(url.pathname==='/')return send(response,200,html.replace('__CSRF__',csrf),'text/html');
   if(url.pathname==='/gui.js')return send(response,200,js,'text/javascript');if(url.pathname==='/gui.css')return send(response,200,css,'text/css');
   if(url.pathname==='/health')return send(response,200,{application:'guild-desk-companion',version:'0.6.0'});
   if(url.pathname==='/api/state')return send(response,200,runtime.snapshot());return send(response,404,{error:'Not found.'});
  }
  if(request.method!=='POST')return send(response,405,{error:'Use GET or POST.'});
  if(request.headers.origin!==origin||request.headers['x-guild-desk-csrf']!==csrf)return send(response,403,{error:'Open this companion page again before changing settings.'});
  const input=await body(request);let result;
  if(url.pathname==='/api/choose-log'){const path=await chooseLog();result=path?await runtime.setLogPath(path):runtime.snapshot();}
  else if(url.pathname==='/api/log-path')result=await runtime.setLogPath(input.path);
  else if(url.pathname==='/api/connect')result=await runtime.connect(input.pairing,{replace:input.replace===true});
  else if(url.pathname==='/api/retry-connect')result=await runtime.retryConnect();
  else if(url.pathname==='/api/start')result=await runtime.start();
  else if(url.pathname==='/api/pause')result=await runtime.pause();
  else if(url.pathname==='/api/hold-queue')result=await runtime.holdQueue(input.confirm===true);
  else if(url.pathname==='/api/export-queue')result=await runtime.exportQueue(input.queueId);
  else if(url.pathname==='/api/exit'){send(response,200,{closed:true});setTimeout(()=>close(),25).unref();return;}
  else return send(response,404,{error:'Not found.'});return send(response,200,result);
 }catch(error){return send(response,error.code==='too_large'?413:error instanceof CompanionError?400:500,{error:error instanceof CompanionError?error.message:'The local action could not be completed. Saved queues were retained.',code:error.code||'local_error'});}});
 async function close(){if(closed)return;closed=true;clearInterval(interval);await runtime.close();await new Promise(resolve=>server.close(resolve));try{const record=JSON.parse(await readFile(lockPath,'utf8'));await lock.close();if(record.instanceId===instanceId)await unlink(lockPath);}catch{}}
 try{await runtime.load();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;interval=setInterval(()=>{if(inFlight||closed)return;inFlight=true;runtime.tick().catch(()=>{runtime.code='queue_review';runtime.note='Monitoring paused after a local state error. Keep saved queues for review.';if(runtime.config)runtime.config.enabled=false;}).finally(()=>{inFlight=false;});},pollMs);interval.unref();}catch(error){await runtime.close();try{await lock.close();await unlink(lockPath);}catch{}throw error;}
 return{server,origin,controller:runtime,close};
}
