import test from 'node:test';
import assert from 'node:assert/strict';
import realWorker from '../dist/server/index.js';
import {activeFixtureWorker} from './account-fixture.mjs';
const worker=activeFixtureWorker(realWorker);
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
const origin='https://catalog-upload.test';
async function fixture(){
 const DB=createD1(await applicationSchema());
 const registered=await worker.fetch(new Request(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Upload Tester',email:'upload@fixture.invalid',password:'Disposable catalog upload test123!'})}),{DB},{});assert.equal(registered.status,201);
 const identity=await registered.json(),cookie=registered.headers.get('set-cookie').split(';')[0];
 const me=async()=>{const r=await worker.fetch(new Request(origin+'/api/me',{headers:{Cookie:cookie}}),{DB},{});return{status:r.status,body:await r.json()};};
 const upload=async(file,revision=0,{authenticated=true}={})=>{
  const form=new FormData();form.set('file',file);form.set('expectedRevision',String(revision));
  // Serialize the real multipart body, as the HTTP bridge does, with its actual
  // Content-Length. Small fixtures without that header missed this regression.
  const serialized=new Request(origin+'/api/catalog/import',{method:'POST',body:form}),body=await serialized.arrayBuffer();
  const headers={Origin:origin,'Content-Type':serialized.headers.get('content-type'),'Content-Length':String(body.byteLength),'X-CSRF-Token':identity.csrfToken,...(authenticated?{Cookie:cookie}:{})};
  const r=await worker.fetch(new Request(serialized.url,{method:'POST',headers,body}),{DB},{});return{status:r.status,body:await r.json(),bytes:body.byteLength};
 };
 return{DB,identity,me,upload,close(){DB.close();}};
}
function largeFile(){
 const rows=['itemclass|id|name|classes|races|slots|ac|hp|mana|endurance|lore'],padding='x'.repeat(1024);
 for(let i=1;i<=5500;i++)rows.push(`0|${i}|Synthetic Gear ${i}|65535|65535|4|1|2|3|4|${padding}`);
 return new File([rows.join('\n')+'\n'],'synthetic-large-items.txt');
}
test('authenticated actual multipart over 5 MiB imports without false expiry and retains its session',async()=>{const h=await fixture();try{
 assert.equal((await h.me()).body.user.id,h.identity.user.id);
 const result=await h.upload(largeFile());assert.ok(result.bytes>5*1024*1024);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.itemCount,5500);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM catalog_items').get().n,5500);
 assert.equal((await h.me()).body.user.id,h.identity.user.id);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});
test('large malformed catalog returns validation error while existing catalog and session remain intact',async()=>{const h=await fixture();try{
 const first=await h.upload(largeFile());assert.equal(first.status,200);
 const invalid=await h.upload(new File([new Uint8Array(6*1024*1024)],'malformed-items.txt.gz'),1);assert.equal(invalid.status,400,JSON.stringify(invalid.body));assert.notEqual(invalid.body.code,'unauthorized');
 assert.equal((await h.me()).body.user.id,h.identity.user.id);assert.equal(h.DB.raw.prepare('SELECT active_import_id FROM catalog_state').get().active_import_id,first.body.active.id);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM catalog_items').get().n,5500);
}finally{h.close();}});
test('large catalog upload still requires a genuine unexpired session',async()=>{const h=await fixture();try{
 assert.equal((await h.upload(largeFile(),0,{authenticated:false})).status,401);
 h.DB.raw.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await h.upload(largeFile())).status,401);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM catalog_items').get().n,0);
}finally{h.close();}});
test('identity lookup failure preserves server error instead of falsely claiming session expiry',async()=>{const h=await fixture();try{
 const prepare=h.DB.prepare.bind(h.DB);h.DB.prepare=q=>{if(q.includes('FROM sessions s JOIN users'))throw new Error('Synthetic identity storage failure');return prepare(q);};
 const r=await h.upload(largeFile());assert.equal(r.status,500);assert.notEqual(r.body.code,'unauthorized');
 h.DB.prepare=prepare;assert.equal((await h.me()).body.user.id,h.identity.user.id);
}finally{h.close();}});
