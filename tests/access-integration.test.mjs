import test from 'node:test';
import assert from 'node:assert/strict';
import realWorker from '../dist/server/index.js';
import {activeFixtureWorker} from './account-fixture.mjs';
const worker=activeFixtureWorker(realWorker);
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {uploadTestCatalog} from './catalog-fixture.mjs';
const origin='https://guild.test';
async function fixture(){
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth,extra={})=>{const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:response.status,body:await response.json(),headers:response.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@access.test',password:'Integration access password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const admin=await register('Administrator'),member=await register('Member'),other=await register('Other');
 await uploadTestCatalog(worker,DB,origin,admin);
 const assign=async(user,profileId,overrides={},actor=admin)=>{const r=await call('/api/access','GET',undefined,actor);assert.equal(r.status,200,JSON.stringify(r.body));const u=r.body.users.find(u=>u.id===user.user.id);return call('/api/access/users/'+u.id,'PUT',{profileId,overrides,expectedRevision:u.revision},actor);};
 const character=async(auth,name)=>{const r=await call('/api/characters','POST',{name,level:85,className:'Monk'},auth);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal((await call('/api/claims/'+r.body.claim.id+'/approve','POST',{kind:'main'},admin)).status,200);return r.body.character.id;};
 const native=async(token,path='/api/companion/session',body)=>{const r=await worker.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB},{});return{status:r.status,body:await r.json()};};
 return{DB,call,register,admin,member,other,assign,character,native,close(){DB.close();}};
}
test('default member sees own overview and bid/request areas but cannot read or mutate officer records',async()=>{const h=await fixture();try{
 assert.equal(h.member.access.profileId,'member');
 for(const path of ['/api/dashboard','/api/characters','/api/reports/mains','/api/attendance-requests','/api/auctions'])assert.equal((await h.call(path,'GET',undefined,h.member)).status,200,path);
 for(const path of ['/api/raids','/api/ledger','/api/items','/api/audit','/api/access','/api/claims','/api/settings','/api/captures','/api/loot/drafts'])assert.equal((await h.call(path,'GET',undefined,h.member)).status,403,path);
 for(const[path,data]of[['/api/raids',{name:'Blocked',date:'2026-11-12'}],['/api/auctions',{itemId:81773,quantity:1}],['/api/adjustments',{characterId:'x',amount:1,reason:'Blocked',idempotencyKey:'blocked-op'}]])assert.equal((await h.call(path,'POST',data,h.member)).status,403,path);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
}finally{h.close();}});

test('own overview dependencies and strict gear ownership survive area overrides and legacy administrator role',async()=>{const h=await fixture();try{
 const id=await h.character(h.member,'Profilehero');
 assert.equal((await h.call('/api/characters/'+id+'/equipment','GET',undefined,h.admin)).body.canEdit,false);
 assert.equal((await h.call('/api/characters/'+id+'/equipment/head','PUT',{itemId:44354,expectedItemId:null},h.admin)).status,403);
 assert.equal((await h.assign(h.member,'member',{mains:0,characters:0,overview:3})).status,200);
 for(const path of ['/api/dashboard','/api/reports/mains/'+id+'/attendance','/api/reports/mains/'+id+'/loot','/api/characters/'+id+'/equipment','/api/characters/'+id+'/equipment/references'])assert.equal((await h.call(path,'GET',undefined,h.member)).status,200,path);
 assert.equal((await h.call('/api/reports/mains','GET',undefined,h.member)).status,403);
 assert.equal((await h.call('/api/characters/'+id+'/equipment/head','PUT',{itemId:44354,expectedItemId:null},h.member)).status,200);
 assert.equal((await h.assign(h.member,'member',{overview:2,mains:0,characters:0})).status,200);
 assert.equal((await h.call('/api/characters/'+id+'/equipment','GET',undefined,h.member)).body.canEdit,false);
 assert.equal((await h.call('/api/characters/'+id+'/equipment/head','PUT',{itemId:null,expectedItemId:44354},h.member)).status,403);
 assert.equal((await h.call('/api/items','GET',undefined,h.member)).status,403);
}finally{h.close();}});

test('officer template delegates actual server actions and revocation stops scoped native capture credentials',async()=>{const h=await fixture();try{
 assert.equal((await h.assign(h.other,'officer')).status,200);
 assert.equal(h.other.user.role,'member');
 const raid=await h.call('/api/raids','POST',{name:'Delegated raid',date:'2026-11-12',rate:5},h.other);assert.equal(raid.status,201,JSON.stringify(raid.body));
 assert.equal((await h.call('/api/items/lookup','POST',{itemId:81773},h.other)).status,200);
 const capture=await h.call('/api/captures','POST',{bossName:'Delegated boss'},h.other);assert.equal(capture.status,201,JSON.stringify(capture.body));
 const token=capture.body.pairing.token;assert.equal((await h.native(token)).status,200);
 const event={watcherId:'fixture-watcher',events:[{eventId:'1'.repeat(64),fileName:'eqlog_Fixture_test.txt',offset:0,line:"[Thu Nov 12 00:28:33 2026] You tell abfloot:4, 'Spell: Thrall of Bones'"}]};
 assert.equal((await h.native(token,'/api/companion/events',event)).status,200);
 assert.equal((await h.assign(h.other,'member')).status,200);
 assert.equal((await h.call('/api/raids','GET',undefined,h.other)).status,403);
 assert.equal((await h.native(token)).status,401);
 assert.equal((await h.native(token,'/api/companion/events',event)).status,401);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM capture_events').get().n,1);
}finally{h.close();}});

test('auction manager and ledger writer dependencies do not require unrelated registry or catalog permissions',async()=>{const h=await fixture();try{
 assert.equal((await h.assign(h.other,'member',{auctions:0,auctionAdmin:3,characters:0,ledger:3})).status,200);
 assert.equal((await h.call('/api/auctions','GET',undefined,h.other)).status,200);
 assert.equal((await h.call('/api/items','GET',undefined,h.other)).status,200);
 assert.equal((await h.call('/api/characters','GET',undefined,h.other)).status,403);
 assert.equal((await h.call('/api/ledger/characters','GET',undefined,h.other)).status,200);
 assert.equal((await h.call('/api/settings','GET',undefined,h.other)).status,200);
 assert.equal((await h.call('/api/items/lookup','POST',{itemId:81773},h.other)).status,200);
 await h.call('/api/items/lookup','POST',{itemId:81773},h.admin);
 const a=await h.call('/api/auctions','POST',{itemId:81773,quantity:1},h.other);assert.equal(a.status,201,JSON.stringify(a.body));
 assert.equal((await h.call('/api/auctions/'+a.body.auction.id,'GET',undefined,h.other)).status,200);
 assert.equal((await h.call('/api/auctions/'+a.body.auction.id+'/bid','PUT',{amount:100},h.other)).status,403);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});

test('access self-demotion responds successfully while last-manager lockout remains blocked',async()=>{const h=await fixture();try{
 assert.equal((await h.assign(h.other,'admin')).status,200);
 const changed=await h.assign(h.admin,'member');assert.equal(changed.status,200,JSON.stringify(changed.body));assert.equal(changed.body.access.profileId,'member');
 assert.equal((await h.call('/api/access','GET',undefined,h.admin)).status,403);
 const last=await h.assign(h.other,'member',{},h.other);assert.equal(last.status,409,JSON.stringify(last.body));assert.equal(last.body.code,'last_access_writer');
 assert.equal((await h.call('/api/access','GET',undefined,h.other)).status,200);
}finally{h.close();}});

test('revoking permission immediately before the guarded write rejects the request without partial mutation',async()=>{const h=await fixture();try{
 await h.assign(h.other,'officer');const original=h.DB.batch.bind(h.DB);let revoked=false;
 h.DB.batch=async statements=>{if(!revoked&&statements.some(s=>s.query?.includes('INSERT INTO raids'))){revoked=true;h.DB.raw.prepare("UPDATE access_user_profiles SET overrides_json=? WHERE user_id=?").run('{"attendance":0}',h.other.user.id);}return original(statements);};
 const r=await h.call('/api/raids','POST',{name:'Must roll back',date:'2026-11-12',rate:5},h.other);assert.equal(r.status,403,JSON.stringify(r.body));assert.equal(revoked,true);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM raids').get().n,0);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='raid_created'").get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
}finally{h.close();}});
