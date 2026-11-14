import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {handleAuditLogApi,auditDescription} from '../worker/audit-log.mjs';
const origin='https://guild.test';
async function fixture(){
 const DB=createD1(await applicationSchema());
 for(const [id,name,role]of[['officer','Officer','admin'],['reviewer','Reviewer','member'],['alpha','Alpha','member'],['beta','Beta','member']])DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@fixture.test',name,'fixture','fixture',role,'2026-10-01T00:00:00.000Z');
 for(const [id,name,owner]of[['hero','Profilehero','beta'],['second','Secondhero','alpha']])DB.raw.prepare('INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES(?,?,?,85,?,?,?, ?,?)').run(id,name.toLowerCase(),name,'Monk','Raider','main',owner,'2026-10-01T00:00:00.000Z');
 DB.raw.prepare("INSERT INTO claims(id,character_id,user_id,status,kind,created_at,approved_at) VALUES('old-claim','hero','alpha','rejected','main','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')").run();
 DB.raw.prepare("INSERT INTO claims(id,character_id,user_id,status,kind,created_at,approved_at) VALUES('new-claim','hero','beta','approved','main','2026-11-12T18:00:01.000Z','2026-11-12T18:00:01.000Z')").run();
 for(const [id,claim,user,action,time,related]of[['assigned-old','old-claim','alpha','approved','2026-10-01T00:00:00.000Z',null],['detached','old-claim','alpha','detached','2026-11-12T18:00:00.000Z','assigned-old'],['assigned-new','new-claim','beta','approved','2026-11-12T18:00:01.000Z',null]])DB.raw.prepare('INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,actor_id,assigned_by,related_assignment_id) VALUES(?,?,\'hero\',?,\'main\',?,?,\'officer\',\'officer\',?)').run(id,claim,user,action,time,related);
 const insert=(id,actor,action,details,time)=>DB.raw.prepare('INSERT INTO audit(id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)').run(id,actor,action,typeof details==='string'?details:JSON.stringify(details),time);
 insert('a-request','alpha','claim_requested',{characterId:'hero'},'2026-11-11T10:00:00.000Z');
 insert('b-approve','officer','claim_approved',{claimId:'old-claim'},'2026-11-11T11:00:00.000Z');
 insert('c-adjust','officer','dkp_adjustment',{characterId:'hero',reason:'Attendance review 100% complete'},'2026-11-12T12:00:00.000Z');
 insert('d-equip','reviewer','character_equipment_changed',{characterId:'hero',itemId:81773},'2026-11-12T13:00:00.000Z');
 insert('e-detach','officer','character_detached',{characterId:'hero',previousOwnerId:'alpha'},'2026-11-12T18:00:00.000Z');
 insert('f-current','officer','dkp_adjustment',{characterId:'hero'},'2026-11-12T19:00:00.000Z');
 insert('g-login','beta','login',{},'2026-11-13T00:00:00.000Z');
 insert('h-legacy','officer','legacy_import','malformed{ evidence','2026-11-13T01:00:00.000Z');
 const user={id:'officer',role:'admin'},auth={user,access:{permissions:{audit:2}}};
 const call=async(query='',context=auth,method='GET',path='/api/audit')=>{const response=await handleAuditLogApi(new Request(origin+path+query,{method}),{DB},context);return response?{status:response.status,body:await response.json(),headers:response.headers}:null;};
 return{DB,call,auth,insert,close(){DB.close();}};
}
test('audit account, actor, character and activity filters remain distinct across ownership changes',async()=>{const h=await fixture();try{
 const affected=await h.call('?subjectUserId=alpha');assert.equal(affected.status,200);assert.deepEqual(affected.body.entries.map(e=>e.id),['e-detach','d-equip','c-adjust','b-approve','a-request']);
 const officer=await h.call('?actorId=officer&subjectUserId=alpha&characterId=hero');assert.deepEqual(officer.body.entries.map(e=>e.id),['e-detach','c-adjust','b-approve']);
 const activity=await h.call('?action=dkp_adjustment');assert.deepEqual(activity.body.entries.map(e=>[e.id,e.subjectUserName]),[['f-current','Beta'],['c-adjust','Alpha']]);
 const self=await h.call('?subjectUserId=beta&action=login');assert.equal(self.body.total,1);assert.equal(self.body.entries[0].actorId,'beta');
 assert.ok(affected.body.entries.every(e=>e.characterId==='hero'));assert.equal(affected.body.entries.find(e=>e.id==='b-approve').characterName,'Profilehero');
}finally{h.close();}});
test('audit date bounds, stable pagination and filter choices use the filtered database count',async()=>{const h=await fixture();try{
 const page=await h.call('?from=2026-11-12&to=2026-11-12&limit=2&offset=1');assert.equal(page.status,200);assert.equal(page.body.total,4);assert.deepEqual(page.body.entries.map(e=>e.id),['e-detach','d-equip']);assert.equal(page.body.limit,2);assert.equal(page.body.offset,1);
 assert.deepEqual(page.body.filters.actors.map(u=>u.id),['alpha','beta','officer','reviewer']);assert.deepEqual(page.body.filters.subjects.map(u=>u.id),['alpha','beta','officer','reviewer']);assert.ok(page.body.filters.characters.some(c=>c.id==='hero'));assert.ok(page.body.filters.actions.includes('claim_approved'));
 assert.ok(page.body.filters.subjects.every(u=>!Object.hasOwn(u,'email')));
 assert.deepEqual((await h.call('?offset=100')).body.entries,[]);
}finally{h.close();}});

test('optional blank audit dates behave as no filter, including an empty audit history',async()=>{const h=await fixture();try{
 const blank=await h.call('?actorId=&subjectUserId=&characterId=&action=&q=&from=&to=&limit=50&offset=0');assert.equal(blank.status,200);assert.equal(blank.body.total,8);
 const spaces=await h.call('?from=%20&to=%20');assert.equal(spaces.status,200);assert.equal(spaces.body.total,8);
 h.DB.raw.prepare('DELETE FROM audit').run();const empty=await h.call('?from=&to=');assert.equal(empty.status,200);assert.equal(empty.body.total,0);assert.deepEqual(empty.body.entries,[]);
 assert.equal((await h.call('?from=2026-02-30')).status,400);
 assert.equal((await h.call('?from=&from=')).status,400);
}finally{h.close();}});
test('audit literal search, SQL-looking IDs and malformed legacy JSON are safe and leave evidence untouched',async()=>{const h=await fixture();try{
 const before=h.DB.raw.prepare('SELECT * FROM audit ORDER BY id').all();
 const percent=await h.call('?q=%25');assert.equal(percent.status,200);assert.deepEqual(percent.body.entries.map(e=>e.id),['c-adjust']);
 assert.equal((await h.call('?q=_')).body.total,7); // The login action has no underscore.
 assert.equal((await h.call('?actorId='+encodeURIComponent("officer' OR 1=1 --"))).body.total,0);
 const bad=await h.call('?action=legacy_import');assert.equal(bad.body.entries[0].details,'malformed{ evidence');assert.equal(bad.body.entries[0].subjectUserId,null);
 assert.equal((await h.call('?q='+encodeURIComponent('Profilehero'))).body.total,6);
 assert.deepEqual(h.DB.raw.prepare('SELECT * FROM audit ORDER BY id').all(),before);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});
test('audit access fails closed for missing or view-only ACL while allowing a delegated reader',async()=>{const h=await fixture();try{
 assert.equal((await h.call('',{})).status,401);
 for(const permissions of[{}, {audit:0},{audit:1},{audit:4},{audit:'2'}])assert.equal((await h.call('',{user:{id:'officer',role:'admin'},access:{permissions}})).status,403);
 assert.equal((await h.call('',{user:{id:'reviewer',role:'member'},access:{permissions:{audit:2}}})).status,200);
 assert.equal((await h.call('',{user:{id:'reviewer',role:'member'}})).status,403);
 assert.equal((await h.call('',{user:{id:'officer',role:'admin'}})).status,200);
 assert.equal((await h.call('',h.auth,'POST')).status,405);assert.equal(await h.call('',h.auth,'GET','/api/elsewhere'),null);
 assert.equal((await h.call()).headers.get('cache-control'),'no-store');
}finally{h.close();}});
test('audit validates dates, duplicate parameters, bounded search and pagination',async()=>{const h=await fixture();try{
 for(const query of['?from=2026-02-30','?from=2026-11-13&to=2026-11-12','?to=not-a-date','?from=0000-01-01','?limit=0','?limit=101','?limit=1.5','?offset=-1','?offset=1000001','?action=a&action=b','?q=a&q=b','?unknown=1','?q='+encodeURIComponent('x'.repeat(121))]){const r=await h.call(query);assert.equal(r.status,400,query);assert.equal(r.body.code,'invalid_filter');}
 assert.equal((await h.call('?from=0001-01-01&to=9999-12-31')).status,200);
}finally{h.close();}});

test('audit filters reach older evidence beyond the former 500-row display limit without guessing historical owners',async()=>{const h=await fixture();try{
 for(let i=0;i<520;i++)h.insert('noise-'+String(i).padStart(4,'0'),'officer','raid_created',{raidId:'raid-'+i},'2026-11-14T00:00:00.000Z');
 h.insert('unknown-owner','officer','dkp_adjustment',{characterId:'second'},'2026-11-15T00:00:00.000Z');
 const result=await h.call('?subjectUserId=alpha&action=claim_approved');assert.equal(result.status,200);assert.equal(result.body.total,1);assert.equal(result.body.entries[0].id,'b-approve');
 const unknown=await h.call('?characterId=second');assert.equal(unknown.body.entries[0].subjectUserId,null);assert.equal(unknown.body.entries[0].characterName,'Secondhero');
 assert.equal((await h.call('?action=raid_created&offset=500&limit=20')).body.entries.length,20);
}finally{h.close();}});

test('same-timestamp ownership transitions never use random IDs to attribute a historical event',async()=>{const h=await fixture();try{
 const boundary='2026-11-16T18:00:00.000Z';
 h.DB.raw.prepare("INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,actor_id,assigned_by) VALUES('a-boundary','old-claim','hero','alpha','main','approved',?,'officer','officer')").run(boundary);
 h.insert('same-ms-adjust','officer','dkp_adjustment',{characterId:'hero',reason:'Before detachment in operation order'},boundary);
 h.DB.raw.prepare("INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,actor_id,assigned_by,related_assignment_id) VALUES('m-boundary','old-claim','hero','alpha','main','detached',?,'officer','officer','a-boundary')").run(boundary);
 h.DB.raw.prepare("INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,actor_id,assigned_by) VALUES('z-boundary','new-claim','hero','beta','main','approved',?,'officer','officer')").run(boundary);
 h.insert('later-ambiguous','officer','character_equipment_changed',{characterId:'hero'},'2026-11-16T18:00:01.000Z');
 h.insert('explicit-same-ms','officer','dkp_adjustment',{characterId:'hero',subjectUserId:'alpha'},boundary);
 const same=(await h.call('?q='+encodeURIComponent('Before detachment'))).body.entries[0];assert.equal(same.subjectUserId,null);
 const alpha=(await h.call('?subjectUserId=alpha&from=2026-11-16')).body.entries;assert.deepEqual(alpha.map(e=>e.id),['explicit-same-ms']);
 assert.equal((await h.call('?subjectUserId=beta&from=2026-11-16')).body.total,0);
 assert.equal((await h.call('?action=character_equipment_changed&from=2026-11-16')).body.entries[0].subjectUserId,null);
 // Differing textual ISO precision still represents the same timestamp.
 h.insert('precision-ambiguous','officer','legacy_equipment',{characterId:'hero'},'2026-11-16T18:00:00Z');
 assert.equal((await h.call('?action=legacy_equipment')).body.entries[0].subjectUserId,null);
}finally{h.close();}});


test('readable audit descriptions resolve known names and reasons without raw JSON, IDs or sealed bid fields',async()=>{const h=await fixture();try{
 const adjustment=(await h.call('?action=dkp_adjustment&q='+encodeURIComponent('100% complete'))).body.entries[0];assert.match(adjustment.description,/Profilehero/);assert.match(adjustment.description,/Attendance review 100% complete/);assert.doesNotMatch(adjustment.description,/characterId|subjectUserId|\{|\}/);
 const summary=auditDescription({action:'auction_award_confirmed',characterName:'Profilehero',itemName:'Synthetic raid helm',details:JSON.stringify({auctionId:'private-internal-id',price:25,amount:999,characterId:'private-character-id'})});assert.equal(summary,'Confirmed Synthetic raid helm for Profilehero at 25 DKP.');assert.doesNotMatch(summary,/999|private/);
 assert.equal(auditDescription({action:'legacy_import',details:'malformed{ evidence'}),'Legacy import.');
 const unknown=auditDescription({action:'unknown_event',details:{secret:'sensitive',reason:'Officer explanation'}});assert.equal(unknown,'Unknown event. Reason: Officer explanation');
}finally{h.close();}});


test('auction publication grammar distinguishes one copy from multiple copies',()=>{assert.equal(auditDescription({action:'auction_published',itemName:'Synthetic ring',details:{quantity:1}}),'Published 1 copy of Synthetic ring.');assert.equal(auditDescription({action:'auction_published',itemName:'Synthetic ring',details:{quantity:4}}),'Published 4 copies of Synthetic ring.');});
