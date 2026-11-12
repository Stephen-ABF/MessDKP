import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {uploadTestCatalog} from './catalog-fixture.mjs';
const origin='https://raid-import.test';
test('manual tracker import keeps custody separate from awards and hands each boss to one reviewed draft through current ACL',async()=>{
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth)=>{const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json(),headers:r.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@fixture.invalid',password:'Disposable raid import test123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 try{
  const admin=await register('Administrator'),member=await register('Member'),manager=await register('Manager');await uploadTestCatalog(worker,DB,origin,admin);
  const raid=(await call('/api/raids','POST',{name:'Fixture raid',date:'2026-11-12',rate:5},admin)).body.raid;
  const access=(await call('/api/access','GET',undefined,admin)).body,entry=access.users.find(u=>u.id===manager.user.id);
  assert.equal((await call('/api/access/users/'+manager.user.id,'PUT',{profileId:'member',overrides:{loot:3},expectedRevision:entry.revision},admin)).status,200);
  const events=[
   {id:'event-fixture-1',itemName:'Blood of the Dhampyre',quantity:1,holder:'Firstholder',source:'Fixture Boss',observedAt:'2026-11-12T18:00:00',timeText:'18:00:00',timeKind:'log-history',rawLine:null},
   {id:'event-fixture-2',itemName:'Blood of the Dhampyre',quantity:1,holder:'Secondholder',source:'Fixture Boss',observedAt:'2026-11-12T18:00:00',timeText:'18:00:00',timeKind:'log-history',rawLine:null},
   {id:'event-fixture-3',itemName:'Ancient Pearlescent Mask',quantity:1,holder:'Firstholder',source:'Another Boss',observedAt:'2026-11-12T19:00:00',timeText:'19:00:00',timeKind:'log-history',rawLine:null}
  ];
  const input={format:'tracker-json',fileName:'synthetic-raid-export.json',raidId:raid.id,raidDate:'2026-11-12',text:JSON.stringify({format:'guild-desk-loot-events',version:1,exportId:'fixture-export-1',raidDate:'2026-11-12',events})};
  assert.equal((await call('/api/loot-imports/preview','POST',input,member)).status,403);
  assert.equal((await call('/api/loot-imports','GET',undefined,member)).status,403);
  const preview=await call('/api/loot-imports/preview','POST',input,manager);assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.preview.eventCount,3);assert.equal(preview.body.preview.newCount,3);assert.equal(preview.body.preview.groups.length,2);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,0);
  const committed=await call('/api/loot-imports','POST',{...input,expectedPreviewHash:preview.body.preview.previewHash},manager);assert.ok([200,201].includes(committed.status),JSON.stringify(committed.body));const imported=committed.body.import;assert.equal(imported.events.length,3);assert.deepEqual(new Set(imported.events.map(e=>e.holder)),new Set(['Firstholder','Secondholder']));
  const group=imported.groups.find(g=>g.bossName==='Fixture Boss');assert.ok(group);
  const prepared=await call('/api/loot-imports/'+imported.id+'/groups/'+group.id+'/prepare','POST',{},manager);assert.equal(prepared.status,200,JSON.stringify(prepared.body));assert.ok(prepared.body.draftId);
  const draft=(await call('/api/loot/drafts/'+prepared.body.draftId,'GET',undefined,manager)).body.draft;assert.equal(draft.bossName,'Fixture Boss');assert.equal(draft.totalPieces,2);assert.equal(draft.status,'draft');assert.equal(draft.items[0].quantity,2);
  const retry=await call('/api/loot-imports/'+imported.id+'/groups/'+group.id+'/prepare','POST',{},manager);assert.equal(retry.status,200);assert.equal(retry.body.draftId,prepared.body.draftId);assert.equal(retry.body.alreadyPrepared,true);
  const repeated=await call('/api/loot-imports','POST',{...input,expectedPreviewHash:preview.body.preview.previewHash},manager);assert.ok([200,201].includes(repeated.status),JSON.stringify(repeated.body));assert.equal(repeated.body.alreadyImported,true);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,1);for(const table of ['ledger','auction_awards','auctions','characters'])assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 }finally{DB.close();}
});
