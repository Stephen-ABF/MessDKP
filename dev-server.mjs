// Loopback-only browser QA. This temporary database resets when the process stops.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {requestOrigin} from './server.mjs';
import { createD1 } from './tests/d1-adapter.mjs';
import { applicationSchema } from './tests/app-schema.mjs';
import worker from './dist/server/index.js';

export async function createDevServer(){
const database = createD1(await applicationSchema());
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const origin=requestOrigin(incoming.headers.host,server.address().port);
    if(!origin||!incoming.url?.startsWith('/')||incoming.url.startsWith('//')){outgoing.writeHead(400);outgoing.end('Use the local Guild Desk address.');incoming.resume();return;}
    const chunks = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 6 * 1024 * 1024) {
        outgoing.writeHead(413); outgoing.end('Request too large.'); return;
      }
      chunks.push(chunk);
    }
    const headers=new Headers(incoming.headers);for(const key of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip'])headers.delete(key);headers.set('cf-connecting-ip',incoming.socket.remoteAddress||'127.0.0.1');
    const options = { method: incoming.method, headers };
    if (!['GET','HEAD'].includes(incoming.method)) options.body = Buffer.concat(chunks);
    const target=new URL(incoming.url,origin);if(target.origin!==origin){outgoing.writeHead(400);outgoing.end('Use the local Guild Desk address.');return;}
    const result = await worker.fetch(new Request(target, options), { DB: database }, {});
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    outgoing.writeHead(500); outgoing.end('Local preview error.');
  }
});
return{server,DB:database,async close(){if(server.listening)await new Promise((r,j)=>server.close(e=>e?j(e):r()));database.close();}};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const app=await createDevServer();app.server.listen(4173,'127.0.0.1',()=>console.log('Local browser QA: http://localhost:4173 (temporary database)'));process.on('SIGINT',async()=>{await app.close();process.exit(0);});
}
