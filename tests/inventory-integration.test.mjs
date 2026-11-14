import test from 'node:test';
import assert from 'node:assert/strict';
import realWorker from '../dist/server/index.js';
import {activeFixtureWorker} from './account-fixture.mjs';
const worker=activeFixtureWorker(realWorker);
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {uploadTestCatalog} from './catalog-fixture.mjs';
const origin='https://guild.test';
test('bundled inventory upload seeds own equipment and augments, supports overview-only access and blocks revoked writes',async()=>{
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth)=>{const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json(),headers:r.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@inventory.invalid',password:'Inventory integration password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 try{
  const admin=await register('Administrator'),member=await register('Member');await uploadTestCatalog(worker,DB,origin,admin);
  const created=await call('/api/characters','POST',{name:'Inventoryhero',level:100,className:'Bard'},member);assert.equal(created.status,201);assert.equal((await call('/api/claims/'+created.body.claim.id+'/approve','POST',{kind:'main'},admin)).status,200);
  const id=created.body.character.id,path='/api/characters/'+id;
  const locations=['Charm','Ear','Head','Face','Ear','Neck','Shoulders','Arms','Back','Wrist','Wrist','Range','Hands','Primary','Secondary','Fingers','Fingers','Chest','Legs','Feet','Waist','Power Source','Ammo'];
  const text=['Location\tName\tID\tCount\tSlots',...locations.flatMap((location,i)=>[`${location}\tFixture Item ${i}\t${i===0?81773:i+1000}\t1\t6`,...(i===0?['Charm-Slot1\tFixture Augment\t9999\t1\t6']:[])])].join('\n');
  const data={fileName:'Inventoryhero_test-Inventory.txt',text};
  assert.equal((await call(path+'/inventory/preview','POST',data,admin)).status,403);
  assert.equal((await call('/api/catalog','GET',undefined,member)).status,403);
  const preview=await call(path+'/inventory/preview','POST',data,member);assert.equal(preview.status,200);assert.equal(preview.body.slots[0].itemName,'Blood of the Dhampyre');assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM character_equipment').get().n,0);
  const submission={...data,importId:preview.body.importId,selections:preview.body.slots.map(s=>({slotKey:s.slotKey,expectedItemId:s.currentItemId}))};
  const imported=await call(path+'/inventory/import','POST',submission,member);assert.equal(imported.status,200,JSON.stringify(imported.body));assert.equal(imported.body.imported,23);
  const equipment=await call(path+'/equipment','GET',undefined,member);assert.equal(equipment.status,200);assert.equal(equipment.body.slots[0].augments[0].itemId,9999);assert.equal((await call('/api/items/9999','GET',undefined,member)).body.item.name,'Fixture Augment');
  assert.equal((await call(path+'/inventory/import','POST',submission,member)).body.alreadyApplied,true);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM auction_awards').get().n,0);
  const access=(await call('/api/access','GET',undefined,admin)).body,user=access.users.find(u=>u.id===member.user.id);
  assert.equal((await call('/api/access/users/'+member.user.id,'PUT',{profileId:'member',overrides:{characters:0,mains:0,overview:3},expectedRevision:user.revision},admin)).status,200);
  assert.equal((await call(path+'/inventory/preview','POST',data,member)).status,200);
  const next=(await call('/api/access','GET',undefined,admin)).body.users.find(u=>u.id===member.user.id);
  assert.equal((await call('/api/access/users/'+member.user.id,'PUT',{profileId:'member',overrides:{characters:0,mains:0,overview:2},expectedRevision:next.revision},admin)).status,200);
  assert.equal((await call(path+'/inventory/import','POST',submission,member)).status,403);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM inventory_imports').get().n,1);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 }finally{DB.close();}
});
