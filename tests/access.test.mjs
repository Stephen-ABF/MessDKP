import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACCESS_AREAS,canAccess,resolveAccess,handleAccessApi} from '../worker/access.mjs';
import {createD1} from './d1-adapter.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
const origin='https://guild.test',matrix=level=>Object.fromEntries(ACCESS_AREAS.map(({key})=>[key,level]));
function fixture(){
 const DB=createD1(read('schema.sql')+'\n'+read('access.sql')+'\n'+read('account-safety.sql'));
 for(const[id,role]of[['admin','admin'],['member','member'],['other','member']])DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@fixture.test',id,'private-hash','private-salt',role,'2026-11-12');
 DB.raw.prepare('UPDATE access_profiles SET revision=1').run();
 const call=async(path='/api/access',{method='GET',data,user='admin',headers={},body}={})=>{const response=await handleAccessApi(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'token',...headers},...(['GET','HEAD'].includes(method)?{}:{body:body??JSON.stringify(data)})}),{DB},{user:user?{id:user,role:'admin'}:null,csrfToken:'token',access:{permissions:matrix(3)}});return{status:response.status,body:await response.json()};};
 const assign=(id,profileId,overrides={},expectedRevision=0,extra={})=>call('/api/access/users/'+id,{method:'PUT',data:{profileId,overrides,expectedRevision},...extra});
 const edit=(id,permissions,name=id,expectedRevision=1,extra={})=>call('/api/access/profiles/'+id,{method:'PUT',data:{name,permissions,expectedRevision},...extra});
 const create=(name,permissions,extra={})=>call('/api/access/profiles',{method:'POST',data:{name,permissions},...extra});
 const audits=()=>DB.raw.prepare('SELECT action,details FROM audit ORDER BY rowid').all().map(r=>({...r,details:JSON.parse(r.details)}));
 return{DB,call,assign,edit,create,audits,close(){DB.close();}};
}

test('default member and administrator permissions come from current database role, not caller role',async()=>{const h=fixture();try{
 const member=await resolveAccess(h.DB,{id:'member',role:'admin'}),admin=await resolveAccess(h.DB,{id:'admin',role:'member'});
 assert.equal(member.profileId,'member');assert.equal(member.revision,0);assert.equal(member.usesDefault,true);assert.equal(admin.profileId,'admin');assert.ok(Object.values(admin.permissions).every(n=>n===3));
 assert.deepEqual(Object.entries(member.permissions).filter(([,n])=>n).map(([k,n])=>[k,n]),[['overview',3],['characters',3],['mains',2],['corrections',3],['auctions',3]]);
 assert.equal(canAccess(member,'characters','write'),true);assert.equal(canAccess(member,'mains','read'),true);assert.equal(canAccess(member,'mains','write'),false);assert.equal(canAccess(member,'ledger',1),false);assert.equal(canAccess(admin,'unknown',1),false);assert.equal(canAccess(admin,'access',0),false);assert.equal(await resolveAccess(h.DB,{id:'missing'}),null);
 assert.equal((await h.call(undefined,{user:'member'})).status,403);assert.equal((await h.call(undefined,{user:null})).status,401);
}finally{h.close();}});

test('access GET returns safe editor DTOs, all templates and current resolved permissions',async()=>{const h=fixture();try{
 const r=await h.call();assert.equal(r.status,200);assert.deepEqual(r.body.profiles.map(p=>p.id),['admin','officer','member']);assert.equal(r.body.areas.length,17);assert.deepEqual(r.body.levels.map(l=>l.value),[0,1,2,3]);assert.equal(r.body.users.length,3);assert.equal(r.body.users.find(u=>u.id==='member').revision,0);
 assert.equal(JSON.stringify(r.body).includes('private-hash'),false);assert.equal(JSON.stringify(r.body).includes('private-salt'),false);assert.equal(h.audits().length,0);
 assert.equal(r.body.profiles.find(p=>p.id==='officer').permissions.access,0);assert.ok(Object.entries(r.body.profiles.find(p=>p.id==='officer').permissions).filter(([k])=>k!=='access').every(([,v])=>v===3));
}finally{h.close();}});

test('custom profiles and per-user explicit denies resolve hierarchically and audit before/after',async()=>{const h=fixture();try{
 const permissions={...matrix(0),overview:1,characters:2,ledger:3};const created=await h.create('Attendance reviewer',permissions);assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.profile.id;assert.match(id,/^[a-f0-9-]{36}$/);assert.equal(created.body.profile.templateKey,null);
 const assigned=await h.assign('member',id,{ledger:0,items:1});assert.equal(assigned.status,200);assert.equal(assigned.body.user.revision,1);assert.equal(assigned.body.user.usesDefault,false);assert.equal(assigned.body.user.permissions.ledger,0);assert.equal(assigned.body.user.permissions.items,1);assert.equal(canAccess(assigned.body.user,'items','view'),true);assert.equal(canAccess(assigned.body.user,'items','read'),false);
 const changed=await h.edit(id,{...permissions,overview:3},'Updated reviewer');assert.equal(changed.status,200);assert.equal(changed.body.profile.revision,2);assert.equal((await resolveAccess(h.DB,{id:'member'})).permissions.overview,3);
 assert.deepEqual(h.audits().map(a=>a.action),['access_profile_created','access_assignment_changed','access_profile_changed']);assert.equal(h.audits()[1].details.before.profileId,'member');assert.equal(h.audits()[1].details.after.overrides.ledger,0);assert.equal(h.audits()[1].details.before.permissions.characters,3);assert.equal(h.audits()[1].details.after.permissions.characters,2);assert.equal(h.audits()[2].details.before.permissions.overview,1);assert.equal(h.audits()[2].details.after.permissions.overview,3);
}finally{h.close();}});

test('read-only access reviewer can inspect but cannot edit; officer template has no access management',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','officer')).status,200);assert.equal((await h.call(undefined,{user:'member'})).status,403);
 assert.equal((await h.assign('member','officer',{access:2},1)).status,200);assert.equal((await h.call(undefined,{user:'member'})).status,200);assert.equal((await h.create('Denied',matrix(3),{user:'member'})).status,403);
}finally{h.close();}});

test('last effective access writer cannot remove its access through profile or override edits',async()=>{const h=fixture();try{
 const removed=await h.edit('admin',{...matrix(3),access:2});assert.equal(removed.status,409,JSON.stringify(removed.body));assert.equal(removed.body.code,'last_access_writer');assert.equal((await resolveAccess(h.DB,{id:'admin'})).permissions.access,3);assert.equal(h.audits().length,0);
 assert.equal((await h.assign('admin','member')).body.code,'last_access_writer');assert.equal((await h.assign('admin','admin',{access:0})).body.code,'last_access_writer');assert.equal((await resolveAccess(h.DB,{id:'admin'})).usesDefault,true);assert.equal(h.audits().length,0);
 assert.throws(()=>h.DB.raw.prepare("DELETE FROM access_profiles WHERE id='admin'").run(),/ACCESS_BUILTIN_PROFILE/);
}finally{h.close();}});

test('access management can be delegated before removing legacy administrator privilege',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','officer',{access:3})).status,200);assert.equal((await h.assign('admin','member')).status,200);const former=await resolveAccess(h.DB,{id:'admin',role:'admin'});assert.equal(former.permissions.access,0);assert.equal((await h.call()).status,403);
 const changed=await h.edit('member',{...matrix(0),overview:2},'Limited member',1,{user:'member'});assert.equal(changed.status,200);assert.equal((await h.assign('member','member',{},1,{user:'member'})).body.code,'last_access_writer');
}finally{h.close();}});

test('optimistic profile and assignment revisions reject stale or concurrent changes',async()=>{const h=fixture();try{
 const profiles=await Promise.all([h.edit('officer',matrix(1),'First'),h.edit('officer',matrix(2),'Second')]);assert.deepEqual(profiles.map(r=>r.status).sort(),[200,409]);assert.equal(profiles.find(r=>r.status===409).body.code,'revision_conflict');
 const assignments=await Promise.all([h.assign('member','officer'),h.assign('member','admin')]);assert.deepEqual(assignments.map(r=>r.status).sort(),[200,409]);assert.equal((await resolveAccess(h.DB,{id:'member'})).revision,1);assert.equal(h.audits().length,2);
}finally{h.close();}});

test('concurrent attempts to remove two remaining managers retain one writer',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','admin')).status,200);
 const outcomes=await Promise.all([h.assign('admin','member'),h.assign('member','member',{},1,{user:'member'})]);assert.equal(outcomes.filter(r=>r.status===200).length,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_effective_managers WHERE access_level=3').get().n,1);assert.equal(h.audits().length,2);
}finally{h.close();}});

test('mutations recheck access in their atomic transaction after concurrent revocation',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','admin')).status,200);const batch=h.DB.batch.bind(h.DB);let revoked=false;
 h.DB.batch=async statements=>{if(!revoked&&statements[0].query.startsWith('UPDATE access_profiles')){revoked=true;h.DB.raw.prepare("INSERT INTO access_user_profiles VALUES('admin','member','{}',1,'member','2026-11-12','revoke-op')").run();}return batch(statements);};
 assert.equal((await h.edit('officer',matrix(1))).status,403);assert.equal(h.DB.raw.prepare("SELECT revision FROM access_profiles WHERE id='officer'").get().revision,1);assert.equal(h.audits().length,1);
}finally{h.close();}});

test('access read snapshot also rechecks a concurrently revoked permission',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','admin')).status,200);const batch=h.DB.batch.bind(h.DB);let revoked=false;h.DB.batch=async statements=>{if(!revoked&&statements[0].query.startsWith('SELECT * FROM access_profiles')){revoked=true;h.DB.raw.prepare("INSERT INTO access_user_profiles VALUES('admin','member','{}',1,'member','2026-11-12','revoke-read')").run();}return batch(statements);};
 const result=await h.call();assert.equal(result.status,403);assert.equal(result.body.users,undefined);
}finally{h.close();}});

test('assignment audit cannot record outdated profile permissions during a concurrent profile edit',async()=>{const h=fixture();try{
 const batch=h.DB.batch.bind(h.DB);let changed=false;h.DB.batch=async statements=>{if(!changed&&statements[0].query.startsWith('INSERT INTO access_user_profiles')){changed=true;h.DB.raw.prepare("UPDATE access_profiles SET revision=revision+1,permissions_json=? WHERE id='officer'").run(JSON.stringify(matrix(1)));}return batch(statements);};
 const result=await h.assign('member','officer');assert.equal(result.status,409);assert.equal(result.body.code,'revision_conflict');assert.equal((await resolveAccess(h.DB,{id:'member'})).revision,0);assert.equal(h.audits().length,0);
}finally{h.close();}});

test('Origin, CSRF, strict matrices, safe revisions and bounded bodies are enforced',async()=>{const h=fixture();try{
 assert.equal((await h.create('Bad',matrix(0),{headers:{Origin:'https://evil.test'}})).status,403);assert.equal((await h.create('Bad',matrix(0),{headers:{'X-CSRF-Token':'wrong'}})).status,403);
 for(const permissions of[{...matrix(0),unknown:1},{...matrix(0),overview:4},{...matrix(0),overview:'1'},{},null])assert.equal((await h.create('Bad',permissions)).status,400);
 assert.equal((await h.create('bad\nname',matrix(0))).status,400);assert.equal((await h.assign('member','officer',{unknown:0})).status,400);assert.equal((await h.assign('member','officer',{overview:null})).status,400);assert.equal((await h.assign('member','missing')).status,404);assert.equal((await h.assign('missing','officer')).status,404);assert.equal((await h.edit('officer',matrix(0),'Bad',0)).status,400);
 assert.equal((await h.call('/api/access/profiles',{method:'POST',body:'{'})).status,400);assert.equal((await h.call('/api/access/profiles',{method:'POST',body:'x'.repeat(8193)})).status,413);assert.equal((await h.create('Bad',matrix(0),{headers:{'Content-Type':'text/plain'}})).status,415);assert.equal(h.audits().length,0);
}finally{h.close();}});

test('audit failure rolls profile and assignment changes back without financial side effects',async()=>{const h=fixture();try{
 h.DB.raw.exec("CREATE TRIGGER fail_access_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
 assert.equal((await h.edit('officer',matrix(1))).status,500);assert.equal((await h.assign('member','officer')).status,500);assert.equal((await h.create('Rollback',matrix(0))).status,500);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_profiles').get().n,3);assert.equal((await resolveAccess(h.DB,{id:'member'})).revision,0);assert.equal(h.audits().length,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,0);
}finally{h.close();}});

test('transaction guard resolves current profile plus overrides and denies revoked permissions',async()=>{const h=fixture();try{
 assert.equal((await h.assign('member','officer',{ledger:3})).status,200);assert.equal(canAccess(await resolveAccess(h.DB,{id:'member'}),'ledger','write'),true);
 assert.equal((await h.assign('member','officer',{ledger:0},1)).status,200);
 const guard=h.DB.prepare('INSERT INTO access_operation_guards(operation_id,user_id,area,minimum_level) VALUES(?,?,?,?)').bind('revoked-write','member','ledger',3);
 await assert.rejects(h.DB.batch([guard]),/ACCESS_DENIED/);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 const current=JSON.parse(h.DB.raw.prepare("SELECT permissions_json FROM access_effective_permissions WHERE user_id='member'").get().permissions_json);assert.equal(current.ledger,0);assert.equal(current.claims,3);
 await h.DB.batch([h.DB.prepare('INSERT INTO access_operation_guards(operation_id,user_id,area,minimum_level) VALUES(?,?,?,?)').bind('valid-write','member','claims',3),h.DB.prepare('DELETE FROM access_operation_guards WHERE operation_id=?').bind('valid-write')]);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
}finally{h.close();}});

test('denied operation guard atomically rolls back financial and audit mutations',async()=>{const h=fixture();try{
 h.DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run('hero','hero','Hero',85,'Cleric','Raider','main','member','2026-11-12');
 const ledger=h.DB.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').bind('blocked-charge','hero',null,-20,'Fixture charge','member','2026-11-12','blocked-op');
 const denied=h.DB.prepare('INSERT INTO access_operation_guards(operation_id,user_id,area,minimum_level) VALUES(?,?,?,?)').bind('blocked-op','member','auctionAdmin',3);
 const audit=h.DB.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').bind('blocked-audit','member','fixture_charge','{}','2026-11-12');
 await assert.rejects(h.DB.batch([ledger,audit,denied]),/ACCESS_DENIED/);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.audits().length,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 const allowed=h.DB.prepare('INSERT INTO access_operation_guards(operation_id,user_id,area,minimum_level) VALUES(?,?,?,?)').bind('permitted-op','admin','auctionAdmin',3),charge=h.DB.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').bind('charge','hero',null,-20,'Fixture charge','admin','2026-11-12','permitted-op'),cleanup=h.DB.prepare('DELETE FROM access_operation_guards WHERE operation_id=?').bind('permitted-op');
 await h.DB.batch([allowed,charge,cleanup]);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,-20);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
}finally{h.close();}});
