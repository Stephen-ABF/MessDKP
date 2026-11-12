// Loopback-only browser QA. This temporary database resets when the process stops.
import http from 'node:http';
import { createD1 } from './tests/d1-adapter.mjs';
import { applicationSchema } from './tests/app-schema.mjs';
import worker from './dist/server/index.js';

const database = createD1(await applicationSchema());
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 6 * 1024 * 1024) {
        outgoing.writeHead(413); outgoing.end('Request too large.'); return;
      }
      chunks.push(chunk);
    }
    const origin = 'http://localhost:' + server.address().port;
    const options = { method: incoming.method, headers: incoming.headers };
    if (!['GET','HEAD'].includes(incoming.method)) options.body = Buffer.concat(chunks);
    const result = await worker.fetch(new Request(new URL(incoming.url, origin), options), { DB: database }, {});
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    outgoing.writeHead(500); outgoing.end('Local preview error.');
  }
});
server.listen(4173, '127.0.0.1', () => console.log('Local browser QA: http://localhost:4173 (temporary database)'));
process.on('SIGINT', () => server.close(() => { database.close(); process.exit(0); }));
