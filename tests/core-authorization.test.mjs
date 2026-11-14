import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleApi as realHandleApi} from '../worker/api.mjs';
import {activeFixtureWorker,legacyAccountColumns} from './account-fixture.mjs';
const fixtureApi=activeFixtureWorker({fetch:realHandleApi});const handleApi=(...args)=>{legacyAccountColumns(args[1].DB);return fixtureApi.fetch(...args);};
import {ITEM_REFERENCE_SCHEMA_SQL} from '../worker/items.mjs';
import {createD1} from './d1-adapter.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
const origin='https://guild.test';
async function fixture(){
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql'),read('admin.sql'),read('ownership.sql')].join('\n'));
 const call=async(path,method='GET',data,auth,authorization,extra={})=>{const response=await handleApi(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB,FEATURE_OWNERSHIP:true,FEATURE_AUCTIONS:true},authorization);return{status:response.status,body:await response.json(),headers:response.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@core.test',password:'Core authorization fixture123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 return{DB,call,officer:await register('Officer'),member:await register('Member'),other:await register('Other'),close(){DB.close();}};
}

test('trusted core authorization projection is bound to the real session and never changes account identity',async()=>{const h=await fixture();try{
 const raid={name:'Delegated raid',date:'2026-11-12',rate:5};
 assert.equal((await h.call('/api/raids','POST',raid,h.member)).status,403);
 assert.equal((await h.call('/api/raids','POST',raid,h.member,{userId:h.officer.user.id,role:'admin'})).status,403);
 assert.equal((await h.call('/api/raids','POST',raid,h.member,{userId:h.member.user.id,role:'officer'})).status,403);
 const projected={userId:h.member.user.id,role:'admin'};
 const delegated=await h.call('/api/raids','POST',raid,h.member,projected);assert.equal(delegated.status,201,JSON.stringify(delegated.body));
 assert.equal(h.DB.raw.prepare('SELECT role FROM users WHERE id=?').get(h.member.user.id).role,'member');
 const me=await h.call('/api/me','GET',undefined,h.member,projected);assert.equal(me.body.user.id,h.member.user.id);assert.equal(me.body.user.role,'member');assert.equal(me.body.csrfToken,h.member.csrfToken);
 const dashboard=await h.call('/api/dashboard','GET',undefined,h.member,projected);assert.equal(dashboard.body.user.role,'member');
 assert.equal((await h.call('/api/raids','POST',raid,h.officer,{userId:h.officer.user.id,role:'member'})).status,403);
 assert.equal((await h.call('/api/raids','POST',raid,h.member,projected,{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await h.call('/api/raids','POST',raid,undefined,projected)).status,401);
}finally{h.close();}});

test('client-supplied authorization fields and headers cannot grant the core legacy adapter',async()=>{const h=await fixture();try{
 const raid={name:'Forbidden raid',date:'2026-11-12',rate:5,authorization:{userId:h.member.user.id,role:'admin'},role:'admin',userId:h.officer.user.id};
 assert.equal((await h.call('/api/raids','POST',raid,h.member,undefined,{'X-Role':'admin','X-Authorization-User':h.member.user.id})).status,403);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM raids').get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT role FROM users WHERE id=?').get(h.member.user.id).role,'member');
}finally{h.close();}});

test('future claim audit records snapshot the affected account before approval, rejection and detach',async()=>{const h=await fixture();try{
 const requested=await h.call('/api/characters','POST',{name:'Correcthero',level:85,className:'Cleric'},h.member);assert.equal(requested.status,201);
 const {character,claim}=requested.body;
 assert.equal((await h.call('/api/claims','POST',{characterId:character.id},h.other)).status,201);
 assert.equal((await h.call('/api/claims/'+claim.id+'/approve','POST',{kind:'main'},h.officer)).status,200);
 const assignment=h.DB.raw.prepare("SELECT id FROM assignment_events WHERE character_id=? AND action='approved'").get(character.id);
 assert.equal((await h.call('/api/characters/'+character.id+'/detach','POST',{reason:'Correct mistaken account.',expectedOwnerId:h.member.user.id,expectedAssignmentId:assignment.id},h.officer)).status,200);
 assert.equal((await h.call('/api/claims','POST',{characterId:character.id},h.member)).status,201);
 const audit=h.DB.raw.prepare("SELECT action,details FROM audit WHERE action IN ('character_requested','claim_requested','claim_approved','claim_rejected','character_detached') ORDER BY rowid").all().map(row=>({...row,details:JSON.parse(row.details)}));
 for(const action of ['character_requested','claim_approved','character_detached'])assert.equal(audit.find(row=>row.action===action).details.subjectUserId,h.member.user.id);
 assert.equal(audit.find(row=>row.action==='claim_rejected').details.subjectUserId,h.other.user.id);
 assert.equal(audit.filter(row=>row.action==='claim_requested').at(-1).details.subjectUserId,h.member.user.id);
 assert.ok(audit.every(row=>row.details.characterId===character.id));assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});
