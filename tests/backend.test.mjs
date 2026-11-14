import {activeFixtureWorker,legacyAccountColumns} from './account-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleApi as realHandleApi} from '../worker/api.mjs';
const fixtureApi=activeFixtureWorker({fetch:realHandleApi});const handleApi=(...args)=>{legacyAccountColumns(args[1].DB);return fixtureApi.fetch(...args);};
import {createD1} from './d1-adapter.mjs';
const schema=readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8');
function harness(){const DB=createD1(schema);legacyAccountColumns(DB);return {DB,env:{DB},async call(path,method='GET',data,auth,extra={}){const headers={...extra};if(method==='POST'){headers.origin??='https://guild.test';headers['content-type']='application/json';}if(auth){headers.cookie=auth.cookie;headers['x-csrf-token']??=auth.csrfToken;}const response=await handleApi(new Request('https://guild.test'+path,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),{DB});const body=await response.json();return {status:response.status,body,headers:response.headers};},close(){DB.close();}};}
async function register(h,email,name='Member'){const r=await h.call('/api/register','POST',{email,name,password:'correct horse battery staple'});assert.equal(r.status,201,JSON.stringify(r.body));return {...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};}
function line(name,className='Cleric',rank='Raider',zone='Guild Hall'){return [name,'85',className,rank,'','11/11/26',zone,'Main - notes are not authority','','on','off','999,999','11/10/26','Main - notes are not authority',''].join('\t');}
function file(time,names=['Alpha','Bravo'],suffix=''){return {name:`DemoGuild_test-20261111-${time}${suffix}.txt`,text:names.map(n=>typeof n==='string'?line(n):line(...n)).join('\n')+'\n'};}
async function raid(h,admin,name='Sample raid'){const r=await h.call('/api/raids','POST',{name,date:'2026-11-11',rate:5},admin);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.raid;}
async function importFiles(h,admin,r,files,commit=true){return await h.call(`/api/raids/${r.id}/import`,'POST',{files,commit},admin);}
async function claim(h,member,charId){const r=await h.call('/api/claims','POST',{characterId:charId},member);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.claim;}
test('real authentication, atomic admin bootstrap, CSRF, logout and unauthorized access',async()=>{const h=harness();try{
 assert.deepEqual((await h.call('/api/me')).body,{user:null});assert.equal((await h.call('/api/dashboard')).status,401);
 const bad=await h.call('/api/register','POST',{email:'owner@guild.test',name:'Owner',password:'correct horse battery staple'},null,{origin:'https://evil.test'});assert.equal(bad.status,403);
 const admin=await register(h,'owner@guild.test','Owner');const member=await register(h,'member@guild.test');assert.equal(admin.user.role,'admin');assert.equal(member.user.role,'member');
 assert.equal((await h.call('/api/me','GET',undefined,admin)).body.user.email,'owner@guild.test');
 assert.equal((await h.call('/api/raids','POST',{name:'No CSRF',date:'2026-11-11',rate:5},admin,{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await h.call('/api/raids','POST',{name:'No authority',date:'2026-11-11',rate:5},member)).status,403);
 assert.equal((await h.call('/api/claims','GET',undefined,member)).status,403);assert.equal((await h.call('/api/audit','GET',undefined,member)).status,403);
 const dup=await h.call('/api/register','POST',{email:'OWNER@guild.test',name:'Duplicate',password:'correct horse battery staple'});assert.equal(dup.status,409);
 const login=await h.call('/api/login','POST',{email:'owner@guild.test',password:'correct horse battery staple'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const invalid=await h.call('/api/login','POST',{email:'owner@guild.test',password:'wrong password long enough'});assert.equal(invalid.status,401);assert.equal(invalid.body.code,'invalid_credentials');
 assert.equal((await h.call('/api/logout','POST',{},admin)).status,200);assert.equal((await h.call('/api/me','GET',undefined,admin)).body.user,null);
 const stored=h.DB.raw.prepare('SELECT password_hash,salt FROM users LIMIT 1').get();assert.match(stored.password_hash,/^[a-f0-9]{64}$/);assert.notEqual(stored.password_hash,'correct horse battery staple');
}finally{h.close();}});
test('simultaneous registrations create exactly one administrator',async()=>{const h=harness();try{
 const result=await Promise.all([register(h,'first@guild.test','First'),register(h,'second@guild.test','Second')]);assert.equal(result.filter(r=>r.user.role==='admin').length,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n,1);
}finally{h.close();}});
test('preview is read-only; unclaimed ticks remain pending; duplicate copies do not earn twice',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),r=await raid(h,admin),files=[file('180515'),file('182058',['Alpha','Bravo','Charlie'])];
 let response=await importFiles(h,admin,r,files,false);assert.equal(response.status,200);assert.equal(response.body.totalRows,5);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,0);
 response=await importFiles(h,admin,r,files);assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.importedTicks,2);assert.equal(response.body.creditedDkp,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,3);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM attendance WHERE status='pending'").get().n,5);
 response=await importFiles(h,admin,r,[file('180515',['Alpha','Bravo'],'(1)'),file('182058',['Alpha','Bravo','Charlie'],'(1)')]);assert.equal(response.body.importedTicks,0);assert.equal(response.body.duplicateTicks,2);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,5);
 const detail=await h.call(`/api/raids/${r.id}`,'GET',undefined,admin);assert.equal(detail.body.ticks[0].sourceTime,'2026-11-11T18:05:15');assert.equal(detail.body.attendance[0].dkp,5);assert.ok(!JSON.stringify(detail.body).includes('999,999'));assert.ok(!JSON.stringify(detail.body).includes('raw_text'));
}finally{h.close();}});
test('officer main approval releases every pending tick once; alt classification earns nothing',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),member=await register(h,'member@guild.test'),r=await raid(h,admin);
 await importFiles(h,admin,r,[file('180515',[['Alpha','Cleric','Officer Alt'],['Bravo','Wizard','Raider']]),file('182058',[['Alpha','Cleric','Officer Alt'],['Bravo','Wizard','Raider']])]);
 const chars=(await h.call('/api/characters','GET',undefined,member)).body.characters;assert.equal(chars.find(c=>c.name==='Alpha').kind,'unclassified');
 const mainClaim=await claim(h,member,chars.find(c=>c.name==='Alpha').id),altClaim=await claim(h,member,chars.find(c=>c.name==='Bravo').id);
 assert.equal((await h.call(`/api/claims/${mainClaim.id}/approve`,'POST',{kind:'main'},member)).status,403);
 let approved=await h.call(`/api/claims/${mainClaim.id}/approve`,'POST',{kind:'main'},admin);assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.creditedDkp,10);
 approved=await h.call(`/api/claims/${mainClaim.id}/approve`,'POST',{kind:'main'},admin);assert.equal(approved.body.creditedDkp,0);
 const alt=await h.call(`/api/claims/${altClaim.id}/approve`,'POST',{kind:'alt'},admin);assert.equal(alt.body.creditedDkp,0);
 const next=await importFiles(h,admin,r,[file('183500',[['Alpha','Cleric','Officer Alt'],['Bravo','Wizard','Raider']])]);assert.equal(next.body.creditedDkp,5);
 const ledger=(await h.call('/api/ledger','GET',undefined,member)).body.entries;assert.equal(ledger.length,3);assert.equal(ledger.reduce((s,x)=>s+x.amount,0),15);assert.ok(ledger.every(x=>x.characterName==='Alpha'));
 const dashboard=(await h.call('/api/dashboard','GET',undefined,member)).body;assert.equal(dashboard.balance,15);assert.equal(dashboard.auctionStatus,'not_implemented');assert.ok(!('reserved' in dashboard));
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM attendance WHERE status='ineligible'").get().n,3);
}finally{h.close();}});
test('same capture conflicts reject complete batch and distinct times with same roster remain distinct',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),r=await raid(h,admin);assert.equal((await importFiles(h,admin,r,[file('180515')])).status,200);
 const conflict=await importFiles(h,admin,r,[file('182058'),file('180515',['Changed'])]);assert.equal(conflict.status,409);assert.equal(conflict.body.code,'snapshot_conflict');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,1);
 assert.equal((await importFiles(h,admin,r,[file('182058')])).body.importedTicks,1);
 const another=await raid(h,admin,'Another raid');assert.equal((await importFiles(h,admin,another,[file('180515')])).status,409);
 const malformed=file('185500');malformed.text=malformed.text.replaceAll('\t',' ');assert.equal((await importFiles(h,admin,r,[malformed])).status,400);
 assert.equal((await importFiles(h,admin,r,[file('250000')])).status,400);
 assert.equal((await importFiles(h,admin,r,[file('185500',['Alpha','Alpha'])])).status,400);
}finally{h.close();}});
test('concurrent retries and ownership claims remain idempotent and ledger private',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two'),r=await raid(h,admin);
 const results=await Promise.all([importFiles(h,admin,r,[file('180515')]),importFiles(h,admin,r,[file('180515')])]);assert.ok(results.every(x=>x.status===200),JSON.stringify(results));assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,1);
 const chars=(await h.call('/api/characters','GET',undefined,one)).body.characters;const a=chars.find(c=>c.name==='Alpha');const q1=await claim(h,one,a.id),q2=await claim(h,two,a.id);
 const approvals=await Promise.all([h.call(`/api/claims/${q1.id}/approve`,'POST',{kind:'main'},admin),h.call(`/api/claims/${q2.id}/approve`,'POST',{kind:'main'},admin)]);assert.equal(approvals.filter(x=>x.status===200).length,1);assert.equal(approvals.filter(x=>x.status===409).length,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,1);
 const resolved=(await h.call('/api/claims','GET',undefined,admin)).body.claims;assert.deepEqual(resolved.map(q=>q.status).sort(),['approved','rejected']);const rejected=resolved.find(q=>q.status==='rejected');assert.equal(rejected.rejectedBy,admin.user.id);assert.ok(rejected.rejectedAt);assert.equal(rejected.rejectionReason,'Another claim for this character was approved.');
 const rejection=(await h.call('/api/audit','GET',undefined,admin)).body.entries.filter(e=>e.action==='claim_rejected');assert.equal(rejection.length,1);assert.equal(rejection[0].actorName,'Owner');const rejectionDetails=JSON.parse(rejection[0].details);assert.equal(rejectionDetails.claimId,rejected.id);assert.equal(rejectionDetails.characterId,a.id);assert.equal(rejectionDetails.reason,rejected.rejectionReason);assert.equal(rejectionDetails.winningClaimId,resolved.find(q=>q.status==='approved').id);
 const owner=h.DB.raw.prepare('SELECT owner_id FROM characters WHERE id=?').get(a.id).owner_id;const loser=owner===one.user.id?two:one;assert.deepEqual((await h.call('/api/ledger','GET',undefined,loser)).body.entries,[]);
 const exposed=(await h.call('/api/characters','GET',undefined,loser)).body.characters.find(c=>c.id===a.id);assert.ok(!('ownerEmail' in exposed));
 const ownerClaim=owner===one.user.id?q1:q2;await Promise.all([h.call(`/api/claims/${ownerClaim.id}/approve`,'POST',{kind:'main'},admin),h.call(`/api/claims/${ownerClaim.id}/approve`,'POST',{kind:'main'},admin)]);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,1);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_rejected'").get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_approved'").get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM claims WHERE status='pending'").get().n,0);
}finally{h.close();}});
test('persona classes produce no warning and never overwrite the approved profile',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),r=await raid(h,admin);await importFiles(h,admin,r,[file('180515',[['Alpha','Bard']])]);const alpha=(await h.call('/api/characters','GET',undefined,admin)).body.characters[0];const q=await claim(h,admin,alpha.id);await h.call(`/api/claims/${q.id}/approve`,'POST',{kind:'main'},admin);
 const preview=await importFiles(h,admin,r,[file('182058',[['Alpha','Enchanter']])],false);assert.deepEqual(preview.body.files[0].warnings,[]);
 await importFiles(h,admin,r,[file('182058',[['Alpha','Enchanter']])]);assert.equal((await h.call('/api/characters','GET',undefined,admin)).body.characters[0].className,'Bard');assert.equal((await h.call('/api/dashboard','GET',undefined,admin)).body.balance,10);
}finally{h.close();}});

test('single guild/server scope is bound only on commit and mixed or foreign scopes cannot change credit',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),r=await raid(h,admin);
 const good=file('180515',['Alpha']);
 const foreignGuild={...file('182058',['Alpha']),name:'Different_test-20261111-182058.txt'};
 const foreignServer={...file('182058',['Alpha']),name:'DemoGuild_other-20261111-182058.txt'};
 assert.equal((await importFiles(h,admin,r,[good],false)).status,200);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM import_scope').get().n,0);
 for(const commit of [false,true]) {
  const mixed=await importFiles(h,admin,r,[good,foreignServer],commit);
  assert.equal(mixed.status,409);assert.equal(mixed.body.code,'scope_conflict');
 }
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM import_scope').get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,0);
 assert.equal((await importFiles(h,admin,r,[good])).body.importedTicks,1);
 assert.deepEqual({...h.DB.raw.prepare('SELECT guild_key,server_key FROM import_scope').get()},{guild_key:'demoguild',server_key:'test'});
 const alpha=(await h.call('/api/characters','GET',undefined,admin)).body.characters[0],q=await claim(h,admin,alpha.id);
 await h.call(`/api/claims/${q.id}/approve`,'POST',{kind:'main'},admin);
 for(const wrong of [foreignGuild,foreignServer]) {
  for(const commit of [false,true]) {const rejected=await importFiles(h,admin,r,[wrong],commit);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'scope_conflict');}
 }
 assert.equal((await h.call('/api/dashboard','GET',undefined,admin)).body.balance,5);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,1);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,1);
 assert.equal((await importFiles(h,admin,r,[file('180515',['Alpha'],'(1)')])).body.duplicateTicks,1);
 assert.equal((await h.call('/api/dashboard','GET',undefined,admin)).body.balance,5);
}finally{h.close();}});

test('concurrent first commits with different guild/server scopes allow exactly one complete import',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),r=await raid(h,admin);
 const a=file('180515',['Alpha']);
 const b={...file('180515',['Bravo']),name:'Different_other-20261111-180515.txt'};
 const responses=await Promise.all([importFiles(h,admin,r,[a]),importFiles(h,admin,r,[b])]);
 assert.equal(responses.filter(x=>x.status===200).length,1,JSON.stringify(responses));
 assert.equal(responses.filter(x=>x.status===409&&x.body.code==='scope_conflict').length,1,JSON.stringify(responses));
 const winning=responses[0].status===200?{guild:'demoguild',server:'test',name:'Alpha'}:{guild:'different',server:'other',name:'Bravo'};
 const scope=h.DB.raw.prepare('SELECT guild_key,server_key FROM import_scope').get();assert.equal(scope.guild_key,winning.guild);assert.equal(scope.server_key,winning.server);
 const chars=(await h.call('/api/characters','GET',undefined,admin)).body.characters;assert.equal(chars.length,1);assert.equal(chars[0].name,winning.name);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ticks').get().n,1);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,1);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_import'").get().n,1);
 const q=await claim(h,admin,chars[0].id);await h.call(`/api/claims/${q.id}/approve`,'POST',{kind:'main'},admin);
 assert.equal((await h.call('/api/dashboard','GET',undefined,admin)).body.balance,5);
 const retry=await importFiles(h,admin,r,[responses[0].status===200?a:b]);assert.equal(retry.status,200);assert.equal(retry.body.duplicateTicks,1);assert.equal(retry.body.creditedDkp,0);
}finally{h.close();}});

test('alt approval supersedes competing claims without releasing pending DKP',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two'),r=await raid(h,admin);
 await importFiles(h,admin,r,[file('180515',['Bravo'])]);const bravo=(await h.call('/api/characters','GET',undefined,one)).body.characters[0];
 const winner=await claim(h,one,bravo.id),loser=await claim(h,two,bravo.id);
 const approved=await h.call(`/api/claims/${winner.id}/approve`,'POST',{kind:'alt'},admin);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,0);
 const claims=(await h.call('/api/claims','GET',undefined,admin)).body.claims;assert.equal(claims.find(q=>q.id===loser.id).status,'rejected');assert.equal(claims.find(q=>q.id===loser.id).rejectedBy,admin.user.id);
 const loserApproval=await h.call(`/api/claims/${loser.id}/approve`,'POST',{kind:'main'},admin);assert.equal(loserApproval.status,409);assert.equal(loserApproval.body.code,'claim_rejected');
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM attendance WHERE status='ineligible'").get().n,1);
 assert.equal((await h.call('/api/characters','GET',undefined,two)).body.characters[0].claimStatus,'rejected');
 const retry=await h.call(`/api/claims/${winner.id}/approve`,'POST',{kind:'alt'},admin);assert.equal(retry.status,200);assert.equal(retry.body.creditedDkp,0);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_rejected'").get().n,1);
}finally{h.close();}});

test('a claim request racing after ownership approval cannot leave a new pending claim', {timeout:3000},async()=>{const h=harness();let release;try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two'),r=await raid(h,admin);
 await importFiles(h,admin,r,[file('180515',['Alpha'])]);const alpha=(await h.call('/api/characters','GET',undefined,one)).body.characters[0],winner=await claim(h,one,alpha.id);
 let started;const gated=new Promise(resolve=>{started=resolve;});const paused=new Promise(resolve=>{release=resolve;});const originalBatch=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('INSERT INTO claims(')){started();await paused;}return originalBatch(statements);};
 const lateClaim=h.call('/api/claims','POST',{characterId:alpha.id},two);await gated;
 assert.equal((await h.call(`/api/claims/${winner.id}/approve`,'POST',{kind:'main'},admin)).status,200);release();
 const rejected=await lateClaim;assert.equal(rejected.status,409);assert.equal(rejected.body.code,'already_claimed');
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM claims').get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM claims WHERE status='pending'").get().n,0);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_requested'").get().n,1);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);
}finally{release?.();h.close();}});

test('each account has one main and any number of alts; rejected second-main approval has no effects',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two'),r=await raid(h,admin);
 await importFiles(h,admin,r,[file('180515',['Alpha','Bravo','Charlie','Delta']),file('182058',['Alpha','Bravo','Charlie','Delta'])]);
 const chars=(await h.call('/api/characters','GET',undefined,one)).body.characters,byName=new Map(chars.map(c=>[c.name,c]));
 const claims=new Map();for(const c of chars)claims.set(c.name,await claim(h,one,c.id));const competitor=await claim(h,two,byName.get('Bravo').id);
 const first=await h.call(`/api/claims/${claims.get('Alpha').id}/approve`,'POST',{kind:'main'},admin);assert.equal(first.status,200);assert.equal(first.body.creditedDkp,10);
 const rejected=await h.call(`/api/claims/${claims.get('Bravo').id}/approve`,'POST',{kind:'main'},admin);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'main_exists');assert.match(rejected.body.error,/already has an approved main/);
 const unchanged=(await h.call('/api/claims','GET',undefined,admin)).body.claims;assert.equal(unchanged.find(q=>q.id===claims.get('Bravo').id).status,'pending');assert.equal(unchanged.find(q=>q.id===competitor.id).status,'pending');assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_rejected'").get().n,0);
 const bravo=h.DB.raw.prepare('SELECT owner_id,kind FROM characters WHERE id=?').get(byName.get('Bravo').id);assert.equal(bravo.owner_id,null);assert.equal(bravo.kind,'unclassified');assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,10);
 for(const name of ['Bravo','Charlie','Delta']){const alt=await h.call(`/api/claims/${claims.get(name).id}/approve`,'POST',{kind:'alt'},admin);assert.equal(alt.status,200);assert.equal(alt.body.creditedDkp,0);}
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM characters WHERE owner_id=? AND kind='main'").get(one.user.id).n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM characters WHERE owner_id=? AND kind='alt'").get(one.user.id).n,3);assert.equal((await h.call('/api/dashboard','GET',undefined,one)).body.balance,10);
 assert.throws(()=>h.DB.raw.prepare("UPDATE characters SET kind='main' WHERE id=?").run(byName.get('Charlie').id),/UNIQUE constraint failed: characters.owner_id/);
}finally{h.close();}});

test('racing first-main approvals use the database constraint and roll back the losing claim completely', {timeout:3000},async()=>{const h=harness();let release;try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two'),r=await raid(h,admin);
 await importFiles(h,admin,r,[file('180515',['Alpha','Bravo'])]);const chars=(await h.call('/api/characters','GET',undefined,one)).body.characters;
 const requests=[];for(const c of chars){const primary=await claim(h,one,c.id),competitor=await claim(h,two,c.id);requests.push({character:c,primary,competitor});}
 let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),paused=new Promise(resolve=>{release=resolve;});let arrivals=0;const originalBatch=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('UPDATE claims SET status=')){arrivals++;if(arrivals===2)arrived();await paused;}return originalBatch(statements);};
 const pending=requests.map(q=>h.call(`/api/claims/${q.primary.id}/approve`,'POST',{kind:'main'},admin));await ready;release();const results=await Promise.all(pending);
 assert.equal(results.filter(x=>x.status===200).length,1,JSON.stringify(results));assert.equal(results.filter(x=>x.status===409&&x.body.code==='main_exists').length,1,JSON.stringify(results));
 const winner=requests[results[0].status===200?0:1],loser=requests[results[0].status===200?1:0],resolved=(await h.call('/api/claims','GET',undefined,admin)).body.claims;
 assert.equal(resolved.find(q=>q.id===winner.primary.id).status,'approved');assert.equal(resolved.find(q=>q.id===winner.competitor.id).status,'rejected');assert.equal(resolved.find(q=>q.id===loser.primary.id).status,'pending');assert.equal(resolved.find(q=>q.id===loser.competitor.id).status,'pending');
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM characters WHERE owner_id=? AND kind='main'").get(one.user.id).n,1);const untouched=h.DB.raw.prepare('SELECT owner_id,kind FROM characters WHERE id=?').get(loser.character.id);assert.equal(untouched.owner_id,null);assert.equal(untouched.kind,'unclassified');
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,1);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_approved'").get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_rejected'").get().n,1);
 const losingRetry=await h.call(`/api/claims/${loser.primary.id}/approve`,'POST',{kind:'main'},admin);assert.equal(losingRetry.status,409);assert.equal(losingRetry.body.code,'main_exists');assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='claim_rejected'").get().n,1);
 const winningRetry=await h.call(`/api/claims/${winner.primary.id}/approve`,'POST',{kind:'main'},admin);assert.equal(winningRetry.status,200);assert.equal(winningRetry.body.creditedDkp,0);
}finally{release?.();h.close();}});

test('character creation requires authentication and creates only an unclassified pending assignment',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),member=await register(h,'member@guild.test','Member'),input={name:'Newhero',level:85,className:'Cleric',kind:'main',ownerId:member.user.id,balance:99999};
 assert.equal((await h.call('/api/characters','POST',input)).status,401);
 assert.equal((await h.call('/api/characters','POST',input,member,{origin:'https://evil.test'})).status,403);
 assert.equal((await h.call('/api/characters','POST',input,member,{'x-csrf-token':'wrong'})).status,403);
 const created=await h.call('/api/characters','POST',input,member);assert.equal(created.status,201,JSON.stringify(created.body));const {character,claim:pending}=created.body;assert.equal(character.name,'Newhero');assert.equal(character.level,85);assert.equal(character.className,'Cleric');assert.equal(character.rank,'Website request');assert.equal(character.kind,'unclassified');assert.equal(character.ownerId,null);assert.equal(character.balance,0);assert.equal(character.pendingTicks,0);assert.equal(character.claimStatus,'pending');assert.equal(pending.userId,member.user.id);assert.equal(pending.status,'pending');assert.equal(pending.kind,null);assert.ok(!('ownerEmail' in character));
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,0);assert.equal((await h.call('/api/dashboard','GET',undefined,member)).body.characters.length,0);
 const audit=(await h.call('/api/audit','GET',undefined,admin)).body.entries.find(e=>e.action==='character_requested');assert.equal(audit.actorName,'Member');const details=JSON.parse(audit.details);assert.equal(details.characterId,character.id);assert.equal(details.claimId,pending.id);assert.equal(details.name,'Newhero');
 assert.equal((await h.call(`/api/claims/${pending.id}/approve`,'POST',{kind:'main'},member)).status,403);
 const approved=await h.call(`/api/claims/${pending.id}/approve`,'POST',{kind:'main'},admin);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 const r=await raid(h,admin);assert.equal((await importFiles(h,admin,r,[file('180515',['Newhero'])])).body.creditedDkp,5);assert.equal((await h.call('/api/dashboard','GET',undefined,member)).body.balance,5);
}finally{h.close();}});

test('character creation validates inputs without partial rows and cannot hijack imported names',async()=>{const h=harness();try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two');
 for(const input of [{name:'1hero',level:85,className:'Cleric'},{name:'H',level:85,className:'Cleric'},{name:'Name With Space',level:85,className:'Cleric'},{name:'Newhero',level:0,className:'Cleric'},{name:'Newhero',level:256,className:'Cleric'},{name:'Newhero',level:1.5,className:'Cleric'},{name:'Newhero',level:'85',className:'Cleric'},{name:'Newhero',level:85,className:''},{name:'Newhero',level:85,className:'X'.repeat(81)}])assert.equal((await h.call('/api/characters','POST',input,one)).status,400);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM claims').get().n,0);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='character_requested'").get().n,0);
 const r=await raid(h,admin);await importFiles(h,admin,r,[file('180515',['Alpha','Bravo'])]);const chars=(await h.call('/api/characters','GET',undefined,one)).body.characters,alpha=chars.find(c=>c.name==='Alpha'),bravo=chars.find(c=>c.name==='Bravo');const q=await claim(h,one,alpha.id);await h.call(`/api/claims/${q.id}/approve`,'POST',{kind:'main'},admin);
 for(const name of ['ALPHA','bravo']){const duplicate=await h.call('/api/characters','POST',{name,level:1,className:'Wizard'},two);assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'character_exists');assert.match(duplicate.body.error,/existing character claim flow/);}
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,2);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM claims WHERE user_id=?').get(two.user.id).n,0);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='character_requested'").get().n,0);
 const unchanged=h.DB.raw.prepare('SELECT owner_id,kind,level,class_name FROM characters WHERE id=?').get(alpha.id);assert.equal(unchanged.owner_id,one.user.id);assert.equal(unchanged.kind,'main');assert.equal(unchanged.level,85);assert.equal(unchanged.class_name,'Cleric');assert.equal((await h.call('/api/dashboard','GET',undefined,one)).body.balance,5);
 assert.equal((await h.call('/api/claims','POST',{characterId:bravo.id},two)).status,201);
}finally{h.close();}});

test('concurrent duplicate character creation has exactly one row, pending claim, and audit', {timeout:3000},async()=>{const h=harness();let release;try{
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two');let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),pause=new Promise(resolve=>{release=resolve;});let arrivals=0;const original=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('INSERT INTO characters(id,name_key,name,level,class_name,guild_rank) VALUES')){if(++arrivals===2)arrived();await pause;}return original(statements);};
 const calls=[h.call('/api/characters','POST',{name:'Newhero',level:85,className:'Cleric'},one),h.call('/api/characters','POST',{name:'NEWHERO',level:80,className:'Wizard'},two)];await ready;release();const results=await Promise.all(calls);assert.equal(results.filter(x=>x.status===201).length,1,JSON.stringify(results));assert.equal(results.filter(x=>x.status===409&&x.body.code==='character_exists').length,1,JSON.stringify(results));
 const winner=results.find(x=>x.status===201).body;assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM claims').get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='character_requested'").get().n,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,0);
 const stored=h.DB.raw.prepare('SELECT kind,owner_id FROM characters WHERE id=?').get(winner.character.id);assert.equal(stored.kind,'unclassified');assert.equal(stored.owner_id,null);const q=h.DB.raw.prepare('SELECT user_id,status FROM claims').get();assert.equal(q.user_id,winner.claim.userId);assert.equal(q.status,'pending');assert.equal(winner.character.claimStatus,'pending');
 const audit=(await h.call('/api/audit','GET',undefined,admin)).body.entries.find(e=>e.action==='character_requested');assert.equal(JSON.parse(audit.details).claimId,winner.claim.id);
}finally{release?.();h.close();}});
