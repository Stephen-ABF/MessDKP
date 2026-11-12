import{createCompanionGui,openCompanionBrowser}from'./gui.mjs';
import{CompanionError}from'./transport.mjs';
import{execFile}from'node:child_process';
let app;
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw new CompanionError('node_version','Install Node.js 24 or later before opening the companion.',{terminal:true});
 if(process.argv.length>2)throw new CompanionError('arguments','Open the companion launcher without extra arguments.',{terminal:true});
 app=await createCompanionGui();openCompanionBrowser(app.origin);
 const stop=async()=>{await app.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
main().catch(async error=>{
 try{const r=await fetch('http://127.0.0.1:4831/health',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).application==='guild-desk-companion'){openCompanionBrowser('http://127.0.0.1:4831');return;}}catch{}
 const message=error instanceof CompanionError?error.message:'The local companion could not start. Saved queues were retained.';process.stderr.write(message+'\\n');
 if(process.platform==='win32')execFile('powershell.exe',['-NoProfile','-STA','-Command',"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('"+message.replaceAll("'","''")+"','Guild Desk companion')"],{windowsHide:true},()=>{});process.exitCode=1;
});
