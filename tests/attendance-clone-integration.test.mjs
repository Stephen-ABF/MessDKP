import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
const origin='https://attendance-clone.test';

test('bundled attendance clone respects delegated access, provenance, explicit preview, retries and current revocation',async()=>{
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth,csrf=true)=>{
  const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});
  return{status:r.status,body:await r.json(),headers:r.headers};
 };
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@fixture.invalid',password:'Disposable attendance clone test123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body;};
 try{
  const admin=await register('Administrator'),member=await register('Member'),taker=await register('Taker');
  const main=ok(await call('/api/characters','POST',{name:'Clonehero',level:100,className:'Beastlord'},admin));
  ok(await call('/api/claims/'+main.claim.id+'/approve','POST',{kind:'main'},admin));
  const raid=ok(await call('/api/raids','POST',{name:'Synthetic clone raid',date:'2026-11-12',rate:5},admin)).raid;
  const raw=['Clonehero','Newrecruit'].map(name=>[name,'100','Beastlord','Raider','','','Synthetic raid zone','','','','','','','',''].join('\t')).join('\n');
  ok(await call('/api/raids/'+raid.id+'/import','POST',{commit:true,files:[{name:'DemoGuild_test-20261112-180000.txt',text:raw}]},admin));
  const source=ok(await call('/api/raids/'+raid.id,'GET',undefined,admin)).ticks[0],path='/api/raids/'+raid.id+'/ticks/'+source.id+'/clone';
  const access=ok(await call('/api/access','GET',undefined,admin)),entry=access.users.find(u=>u.id===taker.user.id);
  ok(await call('/api/access/users/'+taker.user.id,'PUT',{profileId:'member',overrides:{attendance:3,overview:0,corrections:0},expectedRevision:entry.revision},admin));
  assert.equal((await call('/api/dashboard','GET',undefined,taker)).status,403);
  assert.equal((await call('/api/raids/'+raid.id,'GET',undefined,taker)).status,200);
  const input={targetTime:'18:30:00',reason:'Officer reconstructed the missed second attendance capture'};
  assert.equal((await call(path+'/preview','POST',input,member)).status,403);
  assert.equal((await call(path+'/preview','POST',input,taker,false)).status,403);
  const preview=ok(await call(path+'/preview','POST',input,taker));
  assert.equal(preview.counts.rows,2);assert.equal(preview.counts.projectedDkp,5);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,1);
  const commit={...input,previewToken:preview.previewToken,idempotencyKey:'integration-clone-operation-1'};
  const saved=await call(path,'POST',commit,taker);assert.equal(saved.status,201,JSON.stringify(saved));
  assert.equal(saved.body.tick.origin.sourceTickId,source.id);assert.equal(saved.body.tick.origin.actorId,taker.user.id);
  const retry=ok(await call(path,'POST',commit,taker));assert.equal(retry.replayed,true);assert.equal(retry.tick.id,saved.body.tick.id);
  const raidDetails=ok(await call('/api/raids/'+raid.id,'GET',undefined,taker));assert.equal(raidDetails.ticks.length,2);
  const cloned=raidDetails.ticks.find(t=>t.id===saved.body.tick.id);assert.equal(cloned.origin.kind,'officer_clone');assert.equal(cloned.origin.reason,input.reason);
  const tickDetails=ok(await call('/api/raids/'+raid.id+'/ticks/'+cloned.id,'GET',undefined,taker));assert.equal(tickDetails.tick.origin.actorId,taker.user.id);assert.equal(tickDetails.attendance.length,2);
  assert.equal(DB.raw.prepare('SELECT raw_text FROM ticks WHERE id=?').get(source.id).raw_text,raw);
  assert.equal(DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,10);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM attendance WHERE status='pending'").get().n,2);
  const later={...input,targetTime:'19:00:00'},laterPreview=ok(await call(path+'/preview','POST',later,taker));
  const latest=ok(await call('/api/access','GET',undefined,admin)).users.find(u=>u.id===taker.user.id);
  ok(await call('/api/access/users/'+taker.user.id,'PUT',{profileId:'member',overrides:{attendance:0},expectedRevision:latest.revision},admin));
  assert.equal((await call(path,'POST',{...later,previewToken:laterPreview.previewToken,idempotencyKey:'integration-clone-operation-2'},taker)).status,403);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,2);
  for(const table of ['auctions','auction_awards','access_operation_guards'])assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
 }finally{DB.close();}
});
