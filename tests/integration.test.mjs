import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
import { createD1 } from './d1-adapter.mjs';
import { applicationSchema } from './app-schema.mjs';

const origin = 'https://guild-desk.test';
test('bundled Worker serves UTF-8 assets and exact-source item references behind real authentication', async () => {
 const db=createD1(await applicationSchema());
 try {
  for(const [url,type] of [['/','text/html'],['/app.js','text/javascript'],['/app.css','text/css']]) {
   const response=await worker.fetch(new Request(origin+url),{DB:db},{});
   assert.equal(response.status,200);assert.match(response.headers.get('content-type'),new RegExp(type));assert.match(response.headers.get('content-type'),/charset=utf-8/);
   const text=await response.text();assert.ok(text.length>100);assert.equal(/[\uFFFD\u001a]/.test(text),false);
  }
  assert.equal((await worker.fetch(new Request(origin+'/api/items'),{DB:db},{})).status,401);
  const registration=await worker.fetch(new Request(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'integration-owner@example.test',name:'Integration Owner',password:'LocalIntegrationPassword123!'})}),{DB:db},{});
  assert.equal(registration.status,201);const auth=await registration.json();const cookie=registration.headers.get('set-cookie').split(';')[0];
  const list=await worker.fetch(new Request(origin+'/api/items?class=MNK',{headers:{Cookie:cookie}}),{DB:db},{});
  const catalog=await list.json();assert.equal(list.status,200);assert.equal(catalog.catalogComplete,false);assert.ok(catalog.items.some(i=>i.itemId===44354));assert.ok(catalog.items.some(i=>i.itemId===81773));
  const lookup=await worker.fetch(new Request(origin+'/api/items/lookup',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},body:JSON.stringify({itemId:'81773^1557^Blood of the Dhampyre'})}),{DB:db},{});
  assert.equal(lookup.status,200);assert.equal((await lookup.json()).item.sourceUrl,'https://items.eqresource.com/items.php?id=81773');
 } finally {db.close();}
});

test('bundled settings, sealed bids, negative awards and attendance corrections share one exact ledger',async()=>{
 const db=createD1(await applicationSchema());
 const call=async(path,method='GET',body,auth={})=>{
  const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth.cookie?{Cookie:auth.cookie}:{}),...(auth.csrf?{'X-CSRF-Token':auth.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db},{});
  return {status:response.status,body:await response.json(),headers:response.headers};
 };
 const register=async(email,name)=>{
  const r=await call('/api/register','POST',{email,name,password:'LocalWorkflowPassword123!'});assert.equal(r.status,201);
  return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.body.csrfToken};
 };
 try {
  const officer=await register('workflow-officer@example.test','Workflow Officer');
  const member=await register('workflow-member@example.test','Workflow Member');
  const files=await Promise.all(['DemoGuild_test-20261111-180515(1).txt','DemoGuild_test-20261111-182058(1).txt'].map(async name=>({name,text:await readFile(new URL('./fixtures/'+name,import.meta.url),'utf8')})));
  const original=(await call('/api/raids','POST',{name:'Workflow original raid',date:'2026-11-11',rate:5},officer)).body.raid;
  assert.equal((await call('/api/raids/'+original.id+'/import','POST',{files,commit:true},officer)).status,200);
  const registry=(await call('/api/characters','GET',undefined,officer)).body.characters;
  const mainhero=registry.find(c=>c.name==='Mainhero'),secondhero=registry.find(c=>c.name==='Secondhero');
  for(const [auth,character]of[[officer,mainhero],[member,secondhero]]){
   const claim=await call('/api/claims','POST',{characterId:character.id},auth);assert.equal(claim.status,201);
   assert.equal((await call('/api/claims/'+claim.body.claim.id+'/approve','POST',{kind:'main'},officer)).status,200);
  }
  const settings=await call('/api/settings','PUT',{defaultTickRate:9,minimumBid:25,presets:[{expansion:'Test Expansion',raidType:'Standard',rate:15}]},officer);assert.equal(settings.status,200);
  const nextRaid=await call('/api/raids','POST',{name:'New default raid',date:'2026-11-12'},officer);assert.equal(nextRaid.status,201);assert.equal(nextRaid.body.raid.rate,9);
  const presetRaid=await call('/api/raids','POST',{name:'New preset raid',date:'2026-11-12',expansion:'Test Expansion',raidType:'Standard'},officer);assert.equal(presetRaid.status,201);assert.equal(presetRaid.body.raid.rate,15);
  assert.equal((await call('/api/raids/'+original.id,'GET',undefined,officer)).body.raid.rate,5);
  assert.equal((await call('/api/dashboard','GET',undefined,officer)).body.tickRate,9);
  assert.equal((await call('/api/items/lookup','POST',{itemId:81773},officer)).status,200);
  const create={itemId:81773,quantity:4,idempotencyKey:'workflow-creation-stable-key'};
  const auction=await call('/api/auctions','POST',create,officer);assert.equal(auction.status,201);assert.equal(auction.body.auction.minimumBid,25);const auctionId=auction.body.auction.id;
  assert.equal(new Date(auction.body.auction.closesAt)-new Date(auction.body.auction.publishedAt),24*60*60*1000);
  const retry=await call('/api/auctions','POST',create,officer);assert.equal(retry.status,200);assert.equal(retry.body.auction.id,auctionId);
  const bid=await call('/api/auctions/'+auctionId+'/bid','PUT',{amount:100},officer);assert.equal(bid.status,200);assert.equal(bid.body.ownBid.amount,100);
  assert.equal((await call('/api/dashboard','GET',undefined,officer)).body.balance,10);
  const sealed=await call('/api/auctions/'+auctionId,'GET',undefined,member);assert.equal(sealed.status,200);assert.equal(sealed.body.bids,null);assert.equal(sealed.body.auction.ownBid,null);assert.deepEqual(sealed.body.awards,[]);
  assert.equal((await call('/api/auctions/'+auctionId+'/close','POST',undefined,officer)).status,409);
  // Advance only this disposable fixture's deadline; the production API exposes no such operation.
  db.raw.prepare('UPDATE auctions SET closes_at_ms=? WHERE id=?').run(Date.now()-1000,auctionId);
  const closed=await call('/api/auctions/'+auctionId,'GET',undefined,member);assert.equal(closed.status,200);assert.equal(closed.body.bids[0].amount,100);assert.equal(closed.body.awards[0].price,25);
  assert.equal((await call('/api/dashboard','GET',undefined,officer)).body.balance,10);
  const confirmations=await Promise.all([1,2].map(()=>call('/api/auctions/'+auctionId+'/awards/'+mainhero.id+'/confirm','POST',undefined,officer)));
  assert.ok(confirmations.every(r=>r.status===200));assert.equal(confirmations.filter(r=>r.body.alreadyConfirmed).length,1);
  assert.equal((await call('/api/dashboard','GET',undefined,officer)).body.balance,-15);
  const originalDetails=(await call('/api/raids/'+original.id,'GET',undefined,officer)).body;
  const firstTick=originalDetails.ticks.find(t=>t.sourceTime.endsWith('18:05:15'));
  const correction=await call('/api/attendance-requests','POST',{tickId:firstTick.id,characterId:secondhero.id,reason:'Main attended the first tick but was missing from the dump.'},member);assert.equal(correction.status,201);
  const decision={reason:'Confirmed the missing main attendance.'};
  const approved=await call('/api/attendance-requests/'+correction.body.request.id+'/approve','POST',decision,officer);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,5);
  const correctionRetry=await call('/api/attendance-requests/'+correction.body.request.id+'/approve','POST',decision,officer);assert.equal(correctionRetry.status,200);assert.equal(correctionRetry.body.creditedDkp,0);
  assert.equal((await call('/api/dashboard','GET',undefined,member)).body.balance,10);
  assert.equal(db.raw.prepare('SELECT raw_text FROM ticks WHERE id=?').get(firstTick.id).raw_text,files[0].text);
  const adjustment={characterId:mainhero.id,amount:5,reason:'Officer-reviewed correction.',idempotencyKey:'workflow-adjustment-stable-key'};
  assert.equal((await call('/api/adjustments','POST',adjustment,officer)).status,201);
  assert.equal((await call('/api/adjustments','POST',adjustment,officer)).status,200);
  assert.equal((await call('/api/dashboard','GET',undefined,officer)).body.balance,-10);
  const ledger=(await call('/api/ledger','GET',undefined,officer)).body.entries;
  assert.equal(ledger.filter(e=>e.characterId===mainhero.id&&e.amount===-25).length,1);
 }finally{db.close();}
});

test('synthetic two demo dumps import 26 and 29 rows and release exactly 10 DKP to an approved main',async()=>{
 const db=createD1(await applicationSchema());
 let cookie='',csrf='';
 const request=async(path,method='GET',body)=>{
  const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db},{});
  const result=await response.json();return {response,result};
 };
 try {
  const registration=await request('/api/register','POST',{email:'attendance-owner@example.test',name:'Attendance Owner',password:'LocalAttendancePassword123!'});
  assert.equal(registration.response.status,201);cookie=registration.response.headers.get('set-cookie').split(';')[0];csrf=registration.result.csrfToken;
  const raid=await request('/api/raids','POST',{name:'Real sample test raid',date:'2026-11-11',rate:5});assert.equal(raid.response.status,201);const raidId=raid.result.raid.id;
  const names=['DemoGuild_test-20261111-180515(1).txt','DemoGuild_test-20261111-182058(1).txt'];
  const files=await Promise.all(names.map(async name=>({name,text:await readFile(new URL('./fixtures/'+name,import.meta.url),'utf8')})));
  const preview=await request('/api/raids/'+raidId+'/import','POST',{files});assert.equal(preview.response.status,200);assert.deepEqual(preview.result.files.map(f=>f.rowCount),[26,29]);assert.equal(preview.result.totalRows,55);
  const imported=await request('/api/raids/'+raidId+'/import','POST',{files,commit:true});assert.equal(imported.response.status,200);assert.equal(imported.result.importedTicks,2);assert.equal(imported.result.creditedDkp,0);
  const roster=await request('/api/characters');assert.equal(roster.result.characters.length,29);const main=roster.result.characters.find(c=>c.name==='Mainhero');assert.equal(main.pendingTicks,2);
  const claim=await request('/api/claims','POST',{characterId:main.id});assert.equal(claim.response.status,201);
  const approved=await request('/api/claims/'+claim.result.claim.id+'/approve','POST',{kind:'main'});assert.equal(approved.response.status,200);assert.equal(approved.result.creditedDkp,10);
  const duplicate=await request('/api/raids/'+raidId+'/import','POST',{files,commit:true});assert.equal(duplicate.response.status,200);assert.equal(duplicate.result.importedTicks,0);assert.equal(duplicate.result.duplicateTicks,2);assert.equal(duplicate.result.creditedDkp,0);
  const dashboard=await request('/api/dashboard');assert.equal(dashboard.result.balance,10);
  const report=await request('/api/reports/mains?asOf=2026-11-12');assert.equal(report.response.status,200);assert.equal(report.result.mains.length,1);
  assert.equal(report.result.mains[0].balance,10);assert.deepEqual(report.result.mains[0].windows.days30,{attendedTicks:2,totalTicks:2,percentage:100});
  const attendance=await request('/api/reports/mains/'+main.id+'/attendance?asOf=2026-11-12');assert.equal(attendance.response.status,200);assert.equal(attendance.result.raids[0].attendedTicks,2);
  const ledger=await request('/api/ledger');assert.equal(ledger.result.entries.length,2);assert.deepEqual(ledger.result.entries.map(e=>e.amount),[5,5]);
 } finally {db.close();}
});

test('bundled boss draft matches the local catalog without source access and publishes all reviewed auctions once',async()=>{
 const db=createD1(await applicationSchema());let cookie='',csrf='';
 const call=async(path,method='GET',body)=>{
  const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db},{});
  return{status:response.status,body:await response.json(),headers:response.headers};
 };
 try{
  assert.equal((await call('/api/loot/drafts')).status,401);
  const owner=await call('/api/register','POST',{email:'loot-owner@test.invalid',name:'Loot Owner',password:'LocalBossWorkflow123!'});
  assert.equal(owner.status,201);cookie=owner.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrfToken;
  const created=await call('/api/loot/drafts','POST',{bossName:'Fixture Boss',text:'2 x Blood of the Dhampyre\nAncient Pearlescent Mask',idempotencyKey:'bundled-boss-creation'});
  assert.equal(created.status,201,JSON.stringify(created.body));const draft=created.body.draft;
  assert.equal(draft.readyToPublish,true);assert.equal(draft.totalPieces,3);
  const details=await call('/api/items/81773');assert.equal(details.status,200);assert.equal(details.body.item.stats.hp,2006);assert.equal(details.body.item.metadataComplete,false);
  const published=await call('/api/loot/drafts/'+draft.id+'/publish','POST',{expectedRevision:draft.revision});assert.equal(published.status,200,JSON.stringify(published.body));assert.equal(published.body.auctions.length,2);
  const retry=await call('/api/loot/drafts/'+draft.id+'/publish','POST',{expectedRevision:draft.revision});assert.equal(retry.status,200);assert.equal(retry.body.alreadyPublished,true);
  const history=await call('/api/loot/items/81773/history');assert.equal(history.status,200);assert.equal(history.body.appearanceCount,1);assert.equal(history.body.totalQuantity,2);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 }finally{db.close();}
});

test('bundled companion token feeds only abfloot into one officer-reviewed draft without granting an account session',async()=>{
 const db=createD1(await applicationSchema());let cookie='',csrf='';
 const call=async(path,method='GET',body,token)=>{
  const headers=token?{Authorization:'Bearer '+token,'Content-Type':'application/json'}:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})};
  const response=await worker.fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db},{});
  return{status:response.status,body:await response.json(),headers:response.headers};
 };
 try{
  const owner=await call('/api/register','POST',{email:'capture-owner@test.invalid',name:'Capture Owner',password:'LocalCaptureWorkflow123!'});assert.equal(owner.status,201);cookie=owner.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrfToken;
  const capture=await call('/api/captures','POST',{bossName:'Fixture Boss',channelName:'abfloot',allowedSenders:[]});assert.equal(capture.status,201,JSON.stringify(capture.body));
  const {token}=capture.body.pairing;
  assert.equal((await call('/api/companion/session','GET',undefined,token)).status,200);
  const raw="[Thu Nov 12 00:28:33 2026] You tell abfloot:4, 'Blood of the Dhampyre | Blood of the Dhampyre | Ancient Pearlescent Mask | '";
  const events={watcherId:'bundled-watcher',events:[{eventId:'a'.repeat(64),offset:100,fileName:'eqlog_Fixture_test.txt',line:raw}]};
  assert.equal((await call('/api/companion/events','POST',events,token)).body.accepted,1);
  assert.equal((await call('/api/companion/events','POST',events,token)).body.duplicates,1);
  assert.equal((await call('/api/captures','GET',undefined,token)).status,401);
  const prepared=await call('/api/captures/'+capture.body.session.id+'/prepare','POST',{});assert.equal(prepared.status,200,JSON.stringify(prepared.body));
  const draft=await call('/api/loot/drafts/'+prepared.body.draftId);assert.equal(draft.body.draft.totalPieces,3);assert.equal(draft.body.draft.items.length,2);assert.equal(draft.body.draft.sources[0].text,raw);
  assert.equal((await call('/api/companion/session','GET',undefined,token)).status,410);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM auctions').get().n,0);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 }finally{db.close();}
});
