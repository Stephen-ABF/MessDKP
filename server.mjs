import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openPersistentD1 } from './local/d1.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
export const MAX_CATALOG_REQUEST_BYTES = 32 * 1024 * 1024 + 65536;
export function configuredPort(value = process.env.PORT ?? '4173') {
 if (!/^\d+$/.test(String(value))) throw new Error('PORT must be a whole number from 1 through 65535.');
 const port = Number(value);
 if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a whole number from 1 through 65535.');
 return port;
}
export function requestOrigin(host, port) {
 if (typeof host !== 'string') return null;
 const suffix = port === 80 ? '(?::80)?' : ':' + port;
 return new RegExp('^(localhost|127\\.0\\.0\\.1)' + suffix + '$', 'i').test(host) ? new URL('http://' + host.toLowerCase()).origin : null;
}
const sendError = (response, status, message) => {
 if (response.headersSent) { response.destroy(); return; }
 response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 response.end(JSON.stringify({error:message}));
};

export async function createLocalServer({ databasePath = process.env.GUILD_DESK_DB || path.join(root,'data','guild-desk.sqlite'), migrationsDirectory = path.join(root,'drizzle'), worker: suppliedWorker, port = configuredPort(), logger = console } = {}) {
 port=configuredPort(port);
 // Import the completed build before creating a new database.
 const worker = suppliedWorker || (await import(pathToFileURL(path.join(root,'dist','server','index.js')).href)).default;
 if (typeof worker?.fetch !== 'function') throw new Error('The server build is missing. Run node build.mjs --local first.');
 const DB = openPersistentD1(path.resolve(root,databasePath), {migrationsDirectory});
 const pending = new Set();
 const server = http.createServer(async (incoming,outgoing) => {
  try {
   const activePort = server.address()?.port ?? port;
   const origin = requestOrigin(incoming.headers.host,activePort);
   if (!origin || !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { sendError(outgoing,400,'Use the local Guild Desk address.'); incoming.resume(); return; }
   const declaredSize = incoming.headers['content-length'];
   const catalogUpload=incoming.method==='POST'&&new URL(incoming.url,origin).pathname==='/api/catalog/import';
   const requestLimit=catalogUpload?MAX_CATALOG_REQUEST_BYTES:MAX_REQUEST_BYTES,limitMessage=catalogUpload?'Catalog upload exceeds the 32 MiB file limit.':'Request exceeds the 6 MiB limit.';
   if (declaredSize !== undefined && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > requestLimit)) { sendError(outgoing,413,limitMessage); incoming.resume(); return; }
   const chunks=[];let size=0;
   for await (const chunk of incoming.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    if(size>requestLimit){sendError(outgoing,413,limitMessage);incoming.resume();return;}
    chunks.push(chunk);
   }
   const headers=new Headers();
   for(const [name,value] of Object.entries(incoming.headers)) {
    if(['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip'].includes(name)||value===undefined)continue;
    if(Array.isArray(value))value.forEach(v=>headers.append(name,v));else headers.set(name,value);
   }
   headers.set('cf-connecting-ip',incoming.socket.remoteAddress || '127.0.0.1');
   const target=new URL(incoming.url,origin);
   if(target.origin!==origin){sendError(outgoing,400,'Use the local Guild Desk address.');return;}
   const method=incoming.method || 'GET';
   const options={method,headers};
   if(!['GET','HEAD'].includes(method))options.body=Buffer.concat(chunks);
   const result=await worker.fetch(new Request(target,options),{DB,LOCAL_STORAGE:{persistent:true,migrationsApplied:DB.migrationState.totalApplied}},{waitUntil(promise){const p=Promise.resolve(promise).catch(()=>logger.error('Guild Desk background task failed.')).finally(()=>pending.delete(p));pending.add(p);}});
   const responseHeaders=Object.fromEntries([...result.headers].filter(([name])=>name!=='set-cookie'));
   const cookies=result.headers.getSetCookie();if(cookies.length)responseHeaders['set-cookie']=cookies;
   outgoing.writeHead(result.status,responseHeaders);
   outgoing.end(method==='HEAD'?undefined:Buffer.from(await result.arrayBuffer()));
  } catch { logger.error('Guild Desk request failed.');sendError(outgoing,500,'The request could not be completed. Please try again.'); }
 });
 server.requestTimeout=30_000;
 server.headersTimeout=15_000;
 let closing;
 const close=()=>closing??=(async()=>{
  if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await Promise.allSettled([...pending]);DB.close();
 })();
 return {server,DB,port,close};
}

export async function startLocalServer(options = {}) {
 const app=await createLocalServer(options);
 try { await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(app.port,'127.0.0.1',()=>{app.server.removeListener('error',reject);resolve();});}); }
 catch(error){await app.close();throw error;}
 return app;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const app=await startLocalServer();
  console.log('Guild Desk: http://localhost:'+app.port);
  console.log('Persistent database: '+app.DB.path);
  console.log('Keep this window open. Press Ctrl+C to stop safely.');
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;app.close().then(()=>{process.exitCode=0;},()=>{console.error('Guild Desk could not finish closing.');process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);if(process.platform==='win32')process.once('SIGBREAK',stop);
 } catch(error) {
  console.error(error?.code==='EADDRINUSE'?'Guild Desk could not start: the selected port is already in use. Stop the other local server or choose another PORT.':'Guild Desk could not start: '+(error?.message || 'check the local build and database.'));
  process.exitCode=1;
 }
}
