import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {uploadTestCatalog} from './catalog-fixture.mjs';
const origin='https://guild.test';
test('bundled character profile shares authentication, equipment references, award history and audited ownership',async()=>{
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth)=>{const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:response.status,body:await response.json(),headers:response.headers};};
 const register=async(name)=>{const r=await call('/api/register','POST',{name,email:name+'@profile.test',password:'Profile integration password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 try{
  const officer=await register('Officer'),member=await register('Member');
  await uploadTestCatalog(worker,DB,origin,officer);
  const requested=await call('/api/characters','POST',{name:'Profilehero',level:85,className:'Monk'},member);assert.equal(requested.status,201);
  const claim=requested.body.claim;assert.ok(claim?.id,JSON.stringify(requested.body));
  assert.equal((await call('/api/claims/'+claim.id+'/approve','POST',{kind:'main'},officer)).status,200);
  const history=await call('/api/claims','GET',undefined,officer),assignment=history.body.assignments.find(e=>e.currentlyAssigned);assert.equal(assignment.assignedBy,'Officer');
  const id=assignment.characterId,path='/api/characters/'+id+'/equipment';
  assert.equal((await call(path)).status,401);
  assert.equal((await call('/api/items','GET',undefined,member)).status,403);
  assert.equal((await call(path+'/references','GET',undefined,member)).status,200);
  const profile=await call(path,'GET',undefined,member);assert.equal(profile.status,200);assert.equal(profile.body.slots.length,23);assert.equal(profile.body.canEdit,true);
  const selected=await call(path+'/ranged','PUT',{itemId:81773,expectedItemId:null},member);assert.equal(selected.status,200,JSON.stringify(selected.body));
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
  const pane=await call('/api/items/81773','GET',undefined,member);assert.ok(pane.body.item.details.effects.some(e=>e.includes('Prismatic Ward')));
  const emptyLoot=await call('/api/reports/mains/'+id+'/loot','GET',undefined,member);assert.deepEqual(emptyLoot.body.loot,[]);
  const detach=await call('/api/characters/'+id+'/detach','POST',{reason:'Wrong account; officer correction.',expectedOwnerId:member.user.id,expectedAssignmentId:assignment.id},officer);assert.equal(detach.status,200);
  const retained=await call(path,'GET',undefined,member);assert.equal(retained.status,200);assert.equal(retained.body.canEdit,false);assert.equal(retained.body.slots.find(s=>s.key==='ranged').itemId,81773);
  assert.equal((await call(path+'/ranged','PUT',{itemId:null,expectedItemId:81773},member)).status,403);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 }finally{DB.close();}
});
