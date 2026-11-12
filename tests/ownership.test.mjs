import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleApi} from '../worker/api.mjs';
import {createAuctionApi} from '../worker/auctions.mjs';
import {ITEM_REFERENCE_SCHEMA_SQL} from '../worker/items.mjs';
import {createD1} from './d1-adapter.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
const origin='https://guild.test';
async function fixture(){
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql'),read('admin.sql'),read('ownership.sql')].join('\n'));
 const call=async(path,method='GET',data,auth,extra={})=>{const response=await handleApi(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB,FEATURE_OWNERSHIP:true,FEATURE_AUCTIONS:true});return {status:response.status,body:await response.json(),headers:response.headers};};
 const register=async(email,name)=>{const r=await call('/api/register','POST',{email,name,password:'Ownership test password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const officer=await register('officer@fixture.test','Officer'),member=await register('member@fixture.test','Member'),other=await register('other@fixture.test','Other');
 const raid=(await call('/api/raids','POST',{name:'Fixture Raid',date:'2026-11-12',rate:5},officer)).body.raid;
 const row=['Mainhero','85','Cleric','Raider','','11/12/26','Guild Hall','','','on','off','0','','',''].join('\t');
 assert.equal((await call('/api/raids/'+raid.id+'/import','POST',{files:[{name:'Demo_test-20261112-180000.txt',text:row}],commit:true},officer)).status,200);
 const character=(await call('/api/characters','GET',undefined,member)).body.characters[0];
 const claim=(await call('/api/claims','POST',{characterId:character.id},member)).body.claim;
 const approved=await call('/api/claims/'+claim.id+'/approve','POST',{kind:'main'},officer);assert.equal(approved.status,200,JSON.stringify(approved.body));
 const assignment=(await call('/api/claims','GET',undefined,officer)).body.assignments.find(e=>e.outcome==='approved');
 const detachData={reason:'Wrong account selected; correcting assignment.',expectedOwnerId:member.user.id,expectedAssignmentId:assignment.id};
 return{DB,call,officer,member,other,character,claim,assignment,detachData,async detach(data=detachData,auth=officer){return call('/api/characters/'+character.id+'/detach','POST',data,auth);},close(){DB.close();}};
}

test('officer assignment history identifies the approver and detach preserves ledger and source attendance',async()=>{const h=await fixture();try{
 assert.equal(h.assignment.assignedBy,'Officer');assert.equal(h.assignment.actorName,'Officer');assert.equal(h.assignment.currentlyAssigned,true);
 const result=await h.detach();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.alreadyDetached,false);assert.equal(result.body.character.ownerId,null);assert.equal(result.body.character.kind,'unclassified');assert.equal(result.body.character.balance,5);
 assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);assert.equal(h.DB.raw.prepare('SELECT status FROM attendance').get().status,'credited');
 const history=(await h.call('/api/claims','GET',undefined,h.officer)).body.assignments;
 assert.equal(history.length,2);assert.ok(history.every(e=>e.currentlyAssigned===false));const detached=history.find(e=>e.outcome==='detached');assert.equal(detached.reason,h.detachData.reason);assert.equal(detached.assignedBy,'Officer');assert.equal(detached.actorName,'Officer');
 const again=await h.detach();assert.equal(again.status,200);assert.equal(again.body.alreadyDetached,true);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='character_detached'").get().n,1);
 assert.throws(()=>h.DB.raw.prepare("DELETE FROM assignment_events WHERE id=?").run(h.assignment.id),/IMMUTABLE/);
}finally{h.close();}});

test('same account may reclaim after detach without duplicated tick credit or erased history; stale retries cannot detach the new assignment',async()=>{const h=await fixture();try{
 assert.equal((await h.detach()).status,200);
 const reopened=await h.call('/api/claims','POST',{characterId:h.character.id},h.member);assert.equal(reopened.status,201);assert.equal(reopened.body.claim.status,'pending');
 const approved=await h.call('/api/claims/'+reopened.body.claim.id+'/approve','POST',{kind:'main'},h.officer);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,0);
 const retry=await h.detach();assert.equal(retry.status,200);assert.equal(retry.body.alreadyDetached,true);assert.equal(retry.body.character.ownerId,h.member.user.id);
 const history=(await h.call('/api/claims','GET',undefined,h.officer)).body.assignments;assert.equal(history.length,3);assert.equal(history.filter(e=>e.currentlyAssigned).length,1);assert.notEqual(history.find(e=>e.currentlyAssigned).id,h.assignment.id);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,1);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);
}finally{h.close();}});

test('detach requires officer session, Origin, CSRF, reason and exact assignment identity',async()=>{const k=await fixture();try{
  const path='/api/characters/'+k.character.id+'/detach';
  assert.equal((await k.call(path,'POST',k.detachData)).status,401);
  assert.equal((await k.detach(k.detachData,k.member)).status,403);
  assert.equal((await k.call(path,'POST',k.detachData,k.officer,{Origin:'https://evil.test'})).status,403);
  assert.equal((await k.call(path,'POST',k.detachData,k.officer,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await k.detach({...k.detachData,reason:''})).status,400);
  assert.equal((await k.detach({...k.detachData,expectedAssignmentId:'stale'})).status,409);
  assert.equal((await k.detach({...k.detachData,expectedOwnerId:k.other.user.id})).status,409);
  assert.equal(k.DB.raw.prepare('SELECT owner_id FROM characters').get().owner_id,k.member.user.id);
 }finally{k.close();}});

test('concurrent detach requests make one event and cannot detach a later different owner',async()=>{const h=await fixture();try{
 const results=await Promise.all([h.detach(),h.detach()]);assert.ok(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.body.alreadyDetached).length,1);
 const next=await h.call('/api/claims','POST',{characterId:h.character.id},h.other);assert.equal(next.status,201);
 assert.equal((await h.call('/api/claims/'+next.body.claim.id+'/approve','POST',{kind:'main'},h.officer)).status,200);
 assert.equal((await h.detach()).body.character.ownerId,h.other.user.id);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM assignment_events WHERE action='detached'").get().n,1);
}finally{h.close();}});

test('new ticks stay pending while detached and only newly pending attendance is released on main approval',async()=>{const h=await fixture();try{
 assert.equal((await h.detach()).status,200);
 const tick=h.DB.raw.prepare('SELECT raid_id,raw_text FROM ticks').get();
 const imported=await h.call('/api/raids/'+tick.raid_id+'/import','POST',{files:[{name:'Demo_test-20261112-181500.txt',text:tick.raw_text}],commit:true},h.officer);assert.equal(imported.status,200);assert.equal(imported.body.creditedDkp,0);
 const reopened=await h.call('/api/claims','POST',{characterId:h.character.id},h.member);
 const approved=await h.call('/api/claims/'+reopened.body.claim.id+'/approve','POST',{kind:'main'},h.officer);assert.equal(approved.status,200);assert.equal(approved.body.creditedDkp,5);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,2);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,10);
}finally{h.close();}});

test('active bids and pending item awards block detach without changing ownership, balance or history',async()=>{const h=await fixture();try{
 h.DB.raw.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(1,'Fixture Ring','https://items.eqresource.com/items.php?id=1','2026-11-12','fixture','unresolved')").run();
 h.DB.raw.prepare("INSERT INTO auctions(id,item_id,item_name,source_url,metadata_status,quantity,minimum_bid,published_at_ms,closes_at_ms,created_by) VALUES('auction',1,'Fixture Ring','https://items.eqresource.com/items.php?id=1','unresolved',1,1,1,9999999999999,?)").run(h.officer.user.id);
 h.DB.raw.prepare("INSERT INTO auction_bid_events(operation_id,auction_id,character_id,user_id,action,amount,accepted_at_ms) VALUES('bid','auction',?,?,'place',999,2)").run(h.character.id,h.member.user.id);
 h.DB.raw.prepare("INSERT INTO auction_bids(auction_id,character_id,user_id,amount,active,priority_at_ms,priority_sequence,updated_at_ms) VALUES('auction',?,?,999,1,2,1,2)").run(h.character.id,h.member.user.id);
 const blocked=await h.detach();assert.equal(blocked.status,409);assert.equal(blocked.body.code,'assignment_in_use');
 h.DB.raw.prepare("UPDATE auction_bids SET active=0").run();h.DB.raw.prepare("UPDATE auctions SET status='closed',closed_at_ms=3").run();
 h.DB.raw.prepare("INSERT INTO auction_awards(auction_id,character_id,user_id,winning_bid,award_rank,price,ledger_id) VALUES('auction',?,?,999,1,1,'award-ledger')").run(h.character.id,h.member.user.id);
 assert.equal((await h.detach()).body.code,'assignment_in_use');
 assert.equal(h.DB.raw.prepare('SELECT owner_id FROM characters').get().owner_id,h.member.user.id);assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM assignment_events').get().n,1);
}finally{h.close();}});

test('migration backfills only evidenced assigners and never fabricates unknown approval actors',()=>{
 const schema=[read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql')].join('\n'),DB=createD1(schema);
 try{
  DB.raw.exec("INSERT INTO users VALUES('owner','owner@fixture.test','Owner','x','x','admin','now'); INSERT INTO characters VALUES('c','mainhero','Mainhero',85,'Cleric','Raider','main','owner','then'); INSERT INTO claims(id,character_id,user_id,status,kind,created_at,approved_at) VALUES('q','c','owner','approved','main','before','then');");
  DB.raw.exec(read('ownership.sql'));const e=DB.raw.prepare('SELECT * FROM assignment_events').get();assert.equal(e.actor_id,null);assert.equal(e.assigned_by,null);assert.equal(e.action,'approved');assert.equal(DB.raw.prepare('SELECT owner_id FROM characters').get().owner_id,'owner');
 }finally{DB.close();}
});

test('legacy approver backfill uses matching audit timestamp rather than character owner or unrelated approval',()=>{
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql')].join('\n'));try{
  DB.raw.exec("INSERT INTO users VALUES('member','member@fixture.test','Member','x','x','member','now'); INSERT INTO users VALUES('officer','officer@fixture.test','Officer','x','x','admin','now'); INSERT INTO characters VALUES('c','mainhero','Mainhero',85,'Cleric','Raider','main','member','then'); INSERT INTO claims(id,character_id,user_id,status,kind,created_at,approved_at) VALUES('q','c','member','approved','main','before','then');");
  DB.raw.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('earlier','member','claim_approved',JSON.stringify({claimId:'q'}),'before');
  DB.raw.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('actual','officer','claim_approved',JSON.stringify({claimId:'q'}),'then');
  DB.raw.exec(read('ownership.sql'));assert.equal(DB.raw.prepare('SELECT approved_by FROM claims').get().approved_by,'officer');assert.equal(DB.raw.prepare('SELECT assigned_by FROM assignment_events').get().assigned_by,'officer');
 }finally{DB.close();}
});

test('withdrawn bids permit a corrected owner and a replacement main while retaining bid evidence',async()=>{const h=await fixture();try{
 const auctionApi=createAuctionApi({clock:()=>10000});
 const call=async(path,method,data,auth)=>{const r=await auctionApi(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:h.DB},{user:auth.user,csrfToken:auth.csrfToken});return{status:r.status,body:await r.json()};};
 h.DB.raw.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(1,'Fixture Ring','https://items.eqresource.com/items.php?id=1','2026-11-12','fixture','unresolved')").run();
 const a=await call('/api/auctions','POST',{itemId:1,quantity:1},h.officer);assert.equal(a.status,201);const path='/api/auctions/'+a.body.auction.id+'/bid';
 assert.equal((await call(path,'PUT',{amount:100},h.member)).status,200);
 assert.equal((await call(path,'DELETE',undefined,h.member)).status,200);
 assert.equal((await h.detach()).status,200);
 const q=await h.call('/api/claims','POST',{characterId:h.character.id},h.other);assert.equal(q.status,201);
 assert.equal((await h.call('/api/claims/'+q.body.claim.id+'/approve','POST',{kind:'main'},h.officer)).status,200);
 assert.equal((await call(path,'PUT',{amount:80},h.other)).status,200);
 assert.equal((await call(path,'PUT',{amount:200},h.member)).status,403);
 const oldEvents=h.DB.raw.prepare('SELECT user_id,action FROM auction_bid_events ORDER BY sequence').all();assert.deepEqual(oldEvents.map(e=>[e.user_id,e.action]),[[h.member.user.id,'place'],[h.member.user.id,'withdraw'],[h.other.user.id,'place']]);
 // A separately approved replacement main must not inherit an inactive account projection.
 assert.equal((await call(path,'DELETE',undefined,h.other)).status,200);
 const current=(await h.call('/api/claims','GET',undefined,h.officer)).body.assignments.find(e=>e.currentlyAssigned);
 assert.equal((await h.detach({reason:'Correct the main character assignment.',expectedOwnerId:h.other.user.id,expectedAssignmentId:current.id})).status,200);
 h.DB.raw.prepare("INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES('replacement','replacement','Replacement',85,'Cleric','Raider','main',?,'2026-11-12')").run(h.other.user.id);
 assert.equal((await call(path,'PUT',{amount:70},h.other)).status,200);
 const projection=h.DB.raw.prepare('SELECT character_id,user_id,amount FROM auction_bids').all();assert.deepEqual(projection.map(row=>({...row})),[{character_id:'replacement',user_id:h.other.user.id,amount:70}]);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n,5);
 assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);
 const concealed=await call('/api/auctions/'+a.body.auction.id,'GET',undefined,h.officer);assert.equal(concealed.body.bids,null);
}finally{h.close();}});
