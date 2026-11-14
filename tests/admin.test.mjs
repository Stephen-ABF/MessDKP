import {activeFixtureWorker,legacyAccountColumns} from './account-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleApi as realHandleApi} from '../worker/api.mjs';
const fixtureApi=activeFixtureWorker({fetch:realHandleApi});const handleApi=(...args)=>{legacyAccountColumns(args[1].DB);return fixtureApi.fetch(...args);};
import {handleAdminApi} from '../worker/admin.mjs';
import {createD1} from './d1-adapter.mjs';
const schema=readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../worker/admin.sql',import.meta.url),'utf8');
function harness(){const DB=createD1(schema);legacyAccountColumns(DB);return {DB,async call(path,method='GET',input,auth,extra={}){const headers={...extra};if(method!=='GET'){headers.origin??='https://guild.test';headers['content-type']='application/json';}if(auth){headers.cookie=auth.cookie;headers['x-csrf-token']??=auth.csrfToken;}const request=new Request('https://guild.test'+path,{method,headers,...(input!==undefined?{body:JSON.stringify(input)}:{})});const adminRoute=/^\/api\/(attendance-requests|settings|adjustments)(\/|$)/.test(path);const response=adminRoute?await handleAdminApi(request,{DB},auth?{user:auth.user,csrfToken:auth.csrfToken}:{}):await handleApi(request,{DB});return {status:response.status,body:await response.json(),headers:response.headers};},close(){DB.close();}};}
async function register(h,email,name){const r=await h.call('/api/register','POST',{email,name,password:'correct horse battery staple'});assert.equal(r.status,201,JSON.stringify(r.body));return {...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};}
const line=name=>[name,'85','Cleric','Raider','','11/11/26','Guild Hall','Main','','on','off','999,999','','Main',''].join('\t');
const file=(time,names)=>({name:`DemoGuild_test-20261111-${time}.txt`,text:names.map(line).join('\n')+'\n'});
async function fixture(h){
 const admin=await register(h,'owner@guild.test','Owner'),one=await register(h,'one@guild.test','One'),two=await register(h,'two@guild.test','Two');
 const raid=(await h.call('/api/raids','POST',{name:'Original raid',date:'2026-11-11',rate:5},admin)).body.raid;
 const imported=await h.call(`/api/raids/${raid.id}/import`,'POST',{files:[file('180515',['Alpha','Bravo','Charlie']),file('182058',['Bravo'])],commit:true},admin);assert.equal(imported.status,200,JSON.stringify(imported.body));
 const chars=(await h.call('/api/characters','GET',undefined,admin)).body.characters,byName=new Map(chars.map(c=>[c.name,c]));
 for(const [name,owner,kind] of [['Alpha',one,'main'],['Bravo',two,'main'],['Charlie',one,'alt']]){const q=await h.call('/api/claims','POST',{characterId:byName.get(name).id},owner);assert.equal(q.status,201);assert.equal((await h.call(`/api/claims/${q.body.claim.id}/approve`,'POST',{kind},admin)).status,200);}
 const detail=(await h.call(`/api/raids/${raid.id}`,'GET',undefined,admin)).body;
 return {admin,one,two,raid,alpha:byName.get('Alpha'),bravo:byName.get('Bravo'),alt:byName.get('Charlie'),first:detail.ticks[0],missing:detail.ticks[1]};
}
async function requestMissing(h,f,reason='My main was present but missing from the export.'){const r=await h.call('/api/attendance-requests','POST',{tickId:f.missing.id,characterId:f.alpha.id,reason},f.one);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.request;}
const adjustment=(characterId,amount=-20,key='adjustment-test-001',reason='Officer correction after review')=>({characterId,amount,reason,idempotencyKey:key});

test('administration enforces session, officer role, CSRF, origin, and own-main requests',async()=>{const h=harness();try{
 const f=await fixture(h);assert.equal((await h.call('/api/settings')).status,401);
 assert.equal((await h.call('/api/settings','PUT',{defaultTickRate:10,minimumBid:1,presets:[]},f.one)).status,403);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id),f.one)).status,403);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id),f.admin,{origin:'https://evil.test'})).status,403);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id),f.admin,{'x-csrf-token':'wrong'})).status,403);
 for(const characterId of [f.bravo.id,f.alt.id])assert.equal((await h.call('/api/attendance-requests','POST',{tickId:f.missing.id,characterId,reason:'I was there.'},f.one)).status,403);
 assert.equal((await h.call('/api/attendance-requests','POST',{tickId:'missing',characterId:f.alpha.id,reason:'I was there.'},f.one)).status,404);
 const q=await requestMissing(h,f);assert.equal((await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Verified'},f.one)).status,403);
 await h.call('/api/attendance-requests','POST',{tickId:f.first.id,characterId:f.bravo.id,reason:'Check my record'},f.two);
 assert.equal((await h.call('/api/attendance-requests','GET',undefined,f.one)).body.requests.length,1);assert.equal((await h.call('/api/attendance-requests','GET',undefined,f.two)).body.requests.length,1);assert.equal((await h.call('/api/attendance-requests','GET',undefined,f.admin)).body.requests.length,2);
}finally{h.close();}});

test('missing-attendance requests are unique and approval preserves source and original rate',async()=>{const h=harness();try{
 const f=await fixture(h),reason='Verified main was missing from this tick',q=await requestMissing(h,f,reason),raw=h.DB.raw.prepare('SELECT raw_text FROM ticks WHERE id=?').get(f.missing.id).raw_text;
 const retry=await h.call('/api/attendance-requests','POST',{tickId:f.missing.id,characterId:f.alpha.id,reason},f.one);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.request.id,q.id);
 assert.equal((await h.call('/api/attendance-requests','POST',{tickId:f.missing.id,characterId:f.alpha.id,reason:'Different evidence'},f.one)).status,409);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_correction_requested'").get().n,1);
 const settings=await h.call('/api/settings','PUT',{defaultTickRate:20,minimumBid:2,presets:[{expansion:'Future expansion',raidType:'Progression',rate:25}]},f.admin);assert.equal(settings.status,200,JSON.stringify(settings.body));
 const approved=await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Verified with raid leader'},f.admin);assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.creditedDkp,5);assert.equal(approved.body.request.tickRate,5);assert.equal(approved.body.request.decidedBy,f.admin.user.id);
 assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,10);assert.equal(h.DB.raw.prepare('SELECT raw_text FROM ticks WHERE id=?').get(f.missing.id).raw_text,raw);assert.equal(h.DB.raw.prepare('SELECT rate FROM raids WHERE id=?').get(f.raid.id).rate,5);
 const attendance=h.DB.raw.prepare('SELECT * FROM attendance WHERE tick_id=? AND character_id=?').get(f.missing.id,f.alpha.id);assert.equal(attendance.zone,'Officer correction');assert.equal(attendance.status,'credited');assert.equal(attendance.dkp,5);
 const audit=(await h.call('/api/audit','GET',undefined,f.admin)).body.entries.find(e=>e.action==='attendance_correction_approved');const details=JSON.parse(audit.details);assert.equal(audit.actorName,'Owner');assert.equal(details.requestReason,reason);assert.equal(details.decisionReason,'Verified with raid leader');assert.equal(details.creditedDkp,5);assert.equal(details.originalDumpPreserved,1);
 const again=await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Verified with raid leader'},f.admin);assert.equal(again.body.creditedDkp,0);assert.equal(again.body.duplicate,true);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_correction_approved'").get().n,1);
 assert.equal((await h.call(`/api/attendance-requests/${q.id}/reject`,'POST',{reason:'Now reject'},f.admin)).status,409);
}finally{h.close();}});

test('already-credited attendance resolves without another ledger entry or source rewrite',async()=>{const h=harness();try{
 const f=await fixture(h),before=h.DB.raw.prepare('SELECT * FROM attendance WHERE tick_id=? AND character_id=?').get(f.first.id,f.alpha.id);
 const q=(await h.call('/api/attendance-requests','POST',{tickId:f.first.id,characterId:f.alpha.id,reason:'Please check this attendance'},f.one)).body.request;
 const result=await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Attendance already credited'},f.admin);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.creditedDkp,0);assert.equal(result.body.request.status,'approved');
 const after=h.DB.raw.prepare('SELECT * FROM attendance WHERE tick_id=? AND character_id=?').get(f.first.id,f.alpha.id);assert.equal(after.id,before.id);assert.equal(after.zone,before.zone);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger WHERE attendance_id=?').get(before.id).n,1);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,5);
}finally{h.close();}});

test('officer rejection is audited, idempotent, and does not post attendance or DKP',async()=>{const h=harness();try{
 const f=await fixture(h),q=await requestMissing(h,f);
 assert.equal((await h.call(`/api/attendance-requests/${q.id}/reject`,'POST',{reason:''},f.admin)).status,400);
 const rejection=await h.call(`/api/attendance-requests/${q.id}/reject`,'POST',{reason:'No supporting attendance evidence'},f.admin);assert.equal(rejection.status,200);assert.equal(rejection.body.request.status,'rejected');assert.equal(rejection.body.creditedDkp,0);
 const retry=await h.call(`/api/attendance-requests/${q.id}/reject`,'POST',{reason:'No supporting attendance evidence'},f.admin);assert.equal(retry.body.duplicate,true);
 assert.equal((await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'A different decision'},f.admin)).status,409);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance WHERE tick_id=? AND character_id=?').get(f.missing.id,f.alpha.id).n,0);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,5);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_correction_rejected'").get().n,1);
}finally{h.close();}});

test('concurrent correction approvals post one credit and one decision', {timeout:3000},async()=>{const h=harness();let release;try{
 const f=await fixture(h),q=await requestMissing(h,f);let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),pause=new Promise(resolve=>{release=resolve;});let arrivals=0;const original=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('UPDATE correction_requests SET status=')){if(++arrivals===2)arrived();await pause;}return original(statements);};
 const calls=[1,2].map(()=>h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Confirmed by raid leader'},f.admin));await ready;release();const results=await Promise.all(calls);assert.ok(results.every(x=>x.status===200),JSON.stringify(results));assert.equal(results.reduce((s,x)=>s+x.body.creditedDkp,0),5);assert.equal(results.filter(x=>x.body.duplicate).length,1);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_correction_approved'").get().n,1);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,10);
}finally{release?.();h.close();}});

test('settings are user-defined, validated, audited, and never rewrite historical rates',async()=>{const h=harness();try{
 const f=await fixture(h),defaults=(await h.call('/api/settings','GET',undefined,f.one)).body;assert.equal(defaults.settings.defaultTickRate,5);assert.equal(defaults.settings.minimumBid,1);assert.deepEqual(defaults.settings.presets,[]);
 const input={defaultTickRate:15,minimumBid:3,presets:[{expansion:'User named expansion',raidType:'Progression',rate:20},{expansion:'User named expansion',raidType:'Farm',rate:8}]};
 const saved=await h.call('/api/settings','PUT',input,f.admin);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.changed,true);assert.equal(saved.body.settings.updatedBy,f.admin.user.id);assert.equal(saved.body.appliesTo,'new_raids_and_auctions_only');
 assert.equal((await h.call('/api/settings','PUT',input,f.admin)).body.changed,false);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='settings_changed'").get().n,1);
 const invalid={...input,presets:[input.presets[0],{...input.presets[0],expansion:'USER NAMED EXPANSION',raidType:'progression'}]};assert.equal((await h.call('/api/settings','PUT',invalid,f.admin)).status,400);
 assert.equal(h.DB.raw.prepare('SELECT rate FROM raids WHERE id=?').get(f.raid.id).rate,5);assert.deepEqual(h.DB.raw.prepare('SELECT DISTINCT dkp FROM attendance').all().map(x=>x.dkp),[5]);
 const configured=(await h.call('/api/settings','GET',undefined,f.admin)).body.settings;const next=await h.call('/api/raids','POST',{name:'New settings raid',date:'2026-11-12',rate:configured.defaultTickRate},f.admin);assert.equal(next.body.raid.rate,15);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,5);
}finally{h.close();}});

test('officer adjustments allow negative balances, preserve source credits, and reject conflicting retries',async()=>{const h=harness();try{
 const f=await fixture(h),input=adjustment(f.alpha.id),before=h.DB.raw.prepare('SELECT * FROM ledger WHERE character_id=?').get(f.alpha.id);
 const result=await h.call('/api/adjustments','POST',input,f.admin);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.balance,-15);assert.equal(result.body.adjustment.amount,-20);
 const retry=await h.call('/api/adjustments','POST',input,f.admin);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.balance,-15);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger WHERE character_id=?').get(f.alpha.id).n,2);
 const source=h.DB.raw.prepare('SELECT * FROM ledger WHERE id=?').get(before.id);assert.equal(source.amount,before.amount);assert.equal(source.reason,before.reason);assert.equal(source.attendance_id,before.attendance_id);
 for(const changed of [{...input,amount:-21},{...input,reason:'Changed reason'},{...input,characterId:f.bravo.id}]){const conflict=await h.call('/api/adjustments','POST',changed,f.admin);assert.equal(conflict.status,409);assert.equal(conflict.body.code,'idempotency_conflict');}
 for(const amount of [0,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal((await h.call('/api/adjustments','POST',{...input,amount,idempotencyKey:'invalid-amount-key'},f.admin)).status,400);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alt.id,-5,'invalid-alt-key'),f.admin)).status,400);
 const entries=(await h.call('/api/audit','GET',undefined,f.admin)).body.entries.filter(x=>x.action==='dkp_adjustment');assert.equal(entries.length,1);assert.equal(entries[0].actorName,'Owner');assert.equal(JSON.parse(entries[0].details).balanceAfter,-15);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger WHERE character_id=? AND attendance_id IS NULL').get(f.alpha.id).n,1);
}finally{h.close();}});

test('concurrent matching adjustment retries charge once and conflicting requests roll back', {timeout:3000},async()=>{const h=harness();let release;try{
 const f=await fixture(h),input=adjustment(f.alpha.id,-7,'same-concurrent-key');
 const identical=await Promise.all([h.call('/api/adjustments','POST',input,f.admin),h.call('/api/adjustments','POST',input,f.admin)]);assert.deepEqual(identical.map(x=>x.status).sort(),[200,201]);assert.equal(identical.filter(x=>x.body.duplicate).length,1);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,-2);
 let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),pause=new Promise(resolve=>{release=resolve;});let arrivals=0;const original=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('INSERT INTO dkp_adjustments(')){if(++arrivals===2)arrived();await pause;}return original(statements);};
 const inputs=[adjustment(f.alpha.id,-3,'conflicting-concurrent-key'),adjustment(f.alpha.id,-9,'conflicting-concurrent-key')];const calls=inputs.map(value=>h.call('/api/adjustments','POST',value,f.admin));await ready;release();const result=await Promise.all(calls);assert.equal(result.filter(x=>x.status===201).length,1,JSON.stringify(result));assert.equal(result.filter(x=>x.status===409&&x.body.code==='idempotency_conflict').length,1,JSON.stringify(result));
 const charged=result.find(x=>x.status===201).body.adjustment.amount;assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,-2+charged);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='dkp_adjustment'").get().n,2);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM dkp_adjustments').get().n,2);
}finally{release?.();h.close();}});

test('adjustments keep exact safe-integer balances without blocking negative DKP',async()=>{const h=harness();try{
 const f=await fixture(h),maximum=Number.MAX_SAFE_INTEGER;
 const first=adjustment(f.alpha.id,maximum-5,'precision-upper-key');assert.equal((await h.call('/api/adjustments','POST',first,f.admin)).body.balance,maximum);
 assert.equal((await h.call('/api/adjustments','POST',first,f.admin)).body.duplicate,true);
 const overflow=await h.call('/api/adjustments','POST',adjustment(f.alpha.id,1,'precision-overflow-key'),f.admin);assert.equal(overflow.status,400);assert.equal(overflow.body.code,'balance_range');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM dkp_adjustments').get().n,1);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id,-maximum,'precision-zero-key'),f.admin)).body.balance,0);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id,-maximum,'precision-lower-key'),f.admin)).body.balance,-maximum);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id,-1,'precision-underflow-key'),f.admin)).status,400);
}finally{h.close();}});

test('correction approvals cannot overflow exact balances or leave phantom decisions',async()=>{const h=harness();try{
 const f=await fixture(h),q=await requestMissing(h,f),maximum=Number.MAX_SAFE_INTEGER;
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id,maximum-5,'correction-range-key'),f.admin)).body.balance,maximum);
 const already=(await h.call('/api/attendance-requests','POST',{tickId:f.first.id,characterId:f.alpha.id,reason:'Review already credited tick'},f.one)).body.request;
 const zero=await h.call(`/api/attendance-requests/${already.id}/approve`,'POST',{reason:'Already credited'},f.admin);assert.equal(zero.status,200);assert.equal(zero.body.creditedDkp,0);
 const overflow=await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Confirmed missing tick'},f.admin);assert.equal(overflow.status,400,JSON.stringify(overflow.body));assert.equal(overflow.body.code,'balance_range');
 const pending=(await h.call('/api/attendance-requests','GET',undefined,f.one)).body.requests.find(x=>x.id===q.id);assert.equal(pending.status,'pending');assert.equal(pending.decidedAt,null);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance WHERE tick_id=? AND character_id=?').get(f.missing.id,f.alpha.id).n,0);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,maximum);
 assert.equal((await h.call('/api/adjustments','POST',adjustment(f.alpha.id,-10,'correction-range-room-key'),f.admin)).status,201);
 const approved=await h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Confirmed missing tick'},f.admin);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,5);assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,maximum-5);
}finally{h.close();}});

test('concurrent request retries create one request and one audit entry', {timeout:3000},async()=>{const h=harness();let release;try{
 const f=await fixture(h),input={tickId:f.missing.id,characterId:f.alpha.id,reason:'My main was present.'};let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),pause=new Promise(resolve=>{release=resolve;});let arrivals=0;const original=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('INSERT INTO correction_requests(')){if(++arrivals===2)arrived();await pause;}return original(statements);};
 const calls=[1,2].map(()=>h.call('/api/attendance-requests','POST',input,f.one));await ready;release();const results=await Promise.all(calls);assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);assert.equal(results[0].body.request.id,results[1].body.request.id);assert.equal(results.filter(x=>x.body.duplicate).length,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM correction_requests').get().n,1);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance_correction_requested'").get().n,1);
}finally{release?.();h.close();}});

test('conflicting concurrent correction decisions leave only the winning decision effects', {timeout:3000},async()=>{const h=harness();let release;try{
 const f=await fixture(h),q=await requestMissing(h,f);let arrived;const ready=new Promise(resolve=>{arrived=resolve;}),pause=new Promise(resolve=>{release=resolve;});let arrivals=0;const original=h.DB.batch;
 h.DB.batch=async statements=>{if(statements[0]?.query.startsWith('UPDATE correction_requests SET status=')){if(++arrivals===2)arrived();await pause;}return original(statements);};
 const calls=[h.call(`/api/attendance-requests/${q.id}/approve`,'POST',{reason:'Approved evidence'},f.admin),h.call(`/api/attendance-requests/${q.id}/reject`,'POST',{reason:'Rejected evidence'},f.admin)];await ready;release();const result=await Promise.all(calls);assert.equal(result.filter(x=>x.status===200).length,1);assert.equal(result.filter(x=>x.status===409&&x.body.code==='decision_conflict').length,1);
 const winner=result.find(x=>x.status===200).body.request.status,expected=winner==='approved'?5:0;assert.equal((await h.call('/api/dashboard','GET',undefined,f.one)).body.balance,5+expected);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('attendance_correction_approved','attendance_correction_rejected')").get().n,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance WHERE tick_id=? AND character_id=?').get(f.missing.id,f.alpha.id).n,winner==='approved'?1:0);
}finally{release?.();h.close();}});
