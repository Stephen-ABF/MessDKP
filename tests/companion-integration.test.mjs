import test from 'node:test';import assert from 'node:assert/strict';
import realWorker from '../dist/server/index.js';
import {activeFixtureWorker} from './account-fixture.mjs';
const worker=activeFixtureWorker(realWorker);import{createD1}from'./d1-adapter.mjs';import{applicationSchema}from'./app-schema.mjs';
const origin='https://guild.test';
async function fixture(){const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth)=>{const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json(),headers:r.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@device.test',password:'Device integration password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const admin=await register('Admin'),member=await register('Member');
 const native=async(action,body,token,headers={})=>{const r=await worker.fetch(new Request(origin+'/api/companion-device/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json()};};
 return{DB,call,native,admin,member,close(){DB.close();}};
}
test('bundled one-time companion connection switches bosses without browser sessions or cross-boss events',async()=>{const h=await fixture();try{
 const pair=await h.call('/api/companion-devices','POST',{label:'Raid computer'},h.admin);assert.equal(pair.status,201,JSON.stringify(pair.body));const id=pair.body.device.id,token='gddev_'+'e'.repeat(64);
 const connected=await h.native('claim',{code:pair.body.pairing.code,deviceToken:token});assert.equal(connected.status,200,JSON.stringify(connected.body));
 assert.equal((await h.native('session',undefined,token)).body.capture,null);
 const create=async boss=>{const r=await h.call('/api/captures','POST',{bossName:boss},h.admin);assert.equal(r.status,201);return r.body.session.id;};
 const first=await create('First boss'),second=await create('Second boss');
 assert.equal((await h.call('/api/companion-devices/'+id+'/activate','POST',{captureId:first},h.admin)).status,200);
 assert.equal((await h.native('ready',{captureId:first,watcherId:'integration-watcher'},token)).status,200);
 assert.equal((await h.call('/api/companion-devices','GET',undefined,h.admin)).body.devices[0].readyCaptureId,first);
 const event={captureId:first,watcherId:'integration-watcher',events:[{eventId:'3'.repeat(64),offset:0,fileName:'eqlog_Fixture_test.txt',line:"[Thu Nov 12 00:28:33 2026] You tell abfloot:4, 'Spell: Thrall of Bones'"}]};
 assert.equal((await h.native('events',event,token)).status,200);assert.equal((await h.native('events',event,token)).body.duplicates,1);
 await h.call('/api/companion-devices/'+id+'/activate','POST',{captureId:second},h.admin);
 assert.equal((await h.call('/api/companion-devices','GET',undefined,h.admin)).body.devices[0].readyCaptureId,null);
 assert.equal((await h.native('events',event,token)).status,409);
 assert.equal((await h.native('session',undefined,token)).body.capture.id,second);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM capture_events WHERE capture_id=?').get(second).n,0);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM companion_device_guards').get().n,0);
}finally{h.close();}});

test('bundled companion management requires current capture permission and native requests reject browser Origin',async()=>{const h=await fixture();try{
 assert.equal((await h.call('/api/companion-devices','GET',undefined,h.member)).status,403);
 assert.equal((await h.call('/api/companion-devices','POST',{label:'Blocked'},h.member)).status,403);
 const pair=await h.call('/api/companion-devices','POST',{label:'Test computer'},h.admin),token='gddev_'+'f'.repeat(64);
 assert.equal((await h.native('claim',{code:pair.body.pairing.code,deviceToken:token},undefined,{Origin:origin})).status,403);
 assert.equal((await h.native('claim',{code:pair.body.pairing.code,deviceToken:token})).status,200);
 assert.equal((await h.native('session',undefined,token,{Origin:'https://other.test'})).status,403);
 assert.equal((await h.native('session',undefined,token)).status,200);
 await h.call('/api/companion-devices/'+pair.body.device.id+'/revoke','POST',{},h.admin);
 assert.equal((await h.native('session',undefined,token)).status,401);
}finally{h.close();}});
