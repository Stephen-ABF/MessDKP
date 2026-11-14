import test from 'node:test';import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';import {applicationSchema} from './app-schema.mjs';import {createAuctionApi} from '../worker/auctions.mjs';import {createLootApi} from '../worker/loot.mjs';
async function fixture(){const DB=createD1(await applicationSchema());let clock=Date.parse('2026-11-12T18:00:00Z');const api=createAuctionApi({clock:()=>clock}),users={};
 for(const name of ['officer','alice','bob','nobid']){users[name]={id:name,role:name==='officer'?'admin':'member'};DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(name,name+'@fixture.invalid',name,'fixture','fixture',users[name].role,'2026-11-12');DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run('char-'+name,name,name,100,'Cleric','Raider','main',name,'2026-11-12');DB.raw.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run('balance-'+name,'char-'+name,null,100,'Existing balance','officer','2026-11-12','balance-'+name);}
 DB.raw.prepare("INSERT INTO item_references(item_id,name,classes_json,slots_json,source_url,retrieved_at,verification_method,metadata_status) VALUES(1,'Fixture multi-slot item','[\"ALL\"]','[\"EAR\",\"FINGER\"]','https://items.eqresource.com/items.php?id=1','now','fixture','verified_reference')").run();
 const call=async(path,method='GET',data,user=users.officer,context={})=>{const r=await api(new Request('https://guild.test'+path,{method,headers:{Origin:'https://guild.test','Content-Type':'application/json','X-CSRF-Token':'csrf'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB},{user,csrfToken:'csrf',...context});return{status:r.status,body:await r.json()};};
 const create=async()=>{const r=await call('/api/auctions','POST',{itemId:1,quantity:1});assert.equal(r.status,201,JSON.stringify(r));return r.body.auction;};
 const bid=(a,name,amount)=>call('/api/auctions/'+a.id+'/bid','PUT',{amount},users[name]);
 const manage=(a,action,key='operation-fixture-1',extra={},user=users.officer)=>call('/api/auctions/'+a.id+'/'+action,'POST',{reason:'Officer testing review',confirm:true,idempotencyKey:key,...extra},user);
 return{DB,users,call,create,bid,manage,setTime:value=>{clock=value;},advance:value=>{clock+=value;},close:()=>DB.close()};}

test('early completion calculates normal sealed results immediately and charges only confirmed awards once',async()=>{const h=await fixture();try{
 const a=await h.create();assert.equal(Date.parse(a.closesAt)-Date.parse(a.publishedAt),86400000);await h.bid(a,'alice',30);await h.bid(a,'bob',10);h.advance(1000);
 assert.equal((await h.call('/api/auctions/'+a.id+'/close','POST',undefined,h.users.alice)).status,409);
 const result=await h.manage(a,'complete-early');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.auction.completedEarly,true);assert.equal(result.body.auction.scheduledClosesAt,a.closesAt);assert.equal(result.body.auction.status,'closed');assert.equal(result.body.awards[0].characterId,'char-alice');assert.equal(result.body.awards[0].price,11);assert.equal(result.body.awards[0].status,'pending');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,4);
 assert.equal((await h.bid(a,'bob',40)).status,409);assert.equal((await h.manage(a,'complete-early')).body.replayed,true);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_awards').get().n,1);
 for(let i=0;i<2;i++)assert.equal((await h.call('/api/auctions/'+a.id+'/awards/char-alice/confirm','POST')).status,200);
 assert.equal(h.DB.raw.prepare("SELECT SUM(amount) n FROM ledger WHERE character_id='char-alice'").get().n,89);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,5);
}finally{h.close();}});

test('auction cancellation retains private evidence, voids all bids and never creates results or charges',async()=>{const h=await fixture();try{
 const a=await h.create();await h.bid(a,'alice',30);await h.bid(a,'bob',10);const result=await h.manage(a,'cancel');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.auction.status,'cancelled');assert.equal(result.body.bids,null);assert.deepEqual(result.body.awards,[]);assert.equal(result.body.auction.resultsReady,false);
 assert.equal((await h.manage(a,'cancel')).body.replayed,true);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_admin_actions').get().n,1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bids WHERE active=1').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n,4);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_awards').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,4);
 h.advance(86400001);const detail=await h.call('/api/auctions/'+a.id,'GET',undefined,h.users.bob);assert.equal(detail.body.bids,null);
 const history=await h.call('/api/auctions/'+a.id+'/audit','GET',undefined,h.users.bob);assert.ok(history.body.entries.every(e=>e.characterId==='char-bob'));
 const loot=createLootApi({clock:()=>Date.parse(a.closesAt)+1});const r=await loot(new Request('https://guild.test/api/loot/items/1/history'),{DB:h.DB},{user:h.users.bob});const item=await r.json();assert.equal(item.auctions[0].status,'cancelled');assert.equal(item.auctions[0].bids,null);assert.deepEqual(item.auctions[0].awards,[]);
 for(const route of ['complete-early','awards/char-alice/confirm'])assert.equal((await h.call('/api/auctions/'+a.id+'/'+route,'POST',{reason:'Cannot revive cancelled auction',confirm:true,idempotencyKey:'new-operation'})).status,409);
}finally{h.close();}});

test('officer cancellation targets one bid privately, and an uncertain retry never cancels a later rebid',async()=>{const h=await fixture();try{
 const a=await h.create();await h.bid(a,'alice',30);await h.bid(a,'bob',10);
 const before=(await h.call('/api/auctions/'+a.id)).body;assert.equal(before.bids,null);assert.deepEqual(before.management.characters.map(c=>c.characterId).sort(),['char-alice','char-bob','char-nobid','char-officer']);assert.ok(before.management.characters.every(c=>!('amount'in c)&&!('active'in c)));
 const cancelled=await h.manage(a,'bids/char-alice/cancel');assert.equal(cancelled.status,200);assert.equal(cancelled.body.bids,null);assert.equal(h.DB.raw.prepare("SELECT active FROM auction_bids WHERE character_id='char-alice'").get().active,0);assert.equal(h.DB.raw.prepare("SELECT active FROM auction_bids WHERE character_id='char-bob'").get().active,1);
 await h.bid(a,'alice',25);const retry=await h.manage(a,'bids/char-alice/cancel');assert.equal(retry.body.replayed,true);assert.equal(h.DB.raw.prepare("SELECT active FROM auction_bids WHERE character_id='char-alice'").get().active,1);
 const absent=await h.manage(a,'bids/char-nobid/cancel','absent-bid-operation');assert.equal(absent.status,200);assert.deepEqual(Object.keys(absent.body).sort(),Object.keys(cancelled.body).sort());assert.equal(absent.body.bids,null);
 assert.equal((await h.manage(a,'bids/char-bob/cancel','operation-fixture-1')).status,409);
}finally{h.close();}});

test('management requires write authority, a reason and explicit confirmation',async()=>{const h=await fixture();try{
 const a=await h.create();for(const action of ['cancel','complete-early','bids/char-alice/cancel'])assert.equal((await h.manage(a,action,'member-operation',{},h.users.alice)).status,403);
 for(const extra of [{confirm:false},{reason:'x'},{idempotencyKey:''}])assert.equal((await h.manage(a,'cancel','operation-fixture-1',extra)).status,400);
 assert.equal((await h.call('/api/auctions/'+a.id+'/cancel','POST',{reason:'Read only officer',confirm:true,idempotencyKey:'read-only-operation'},h.users.officer,{access:{permissions:{auctionAdmin:2}}})).status,403);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_admin_actions').get().n,0);
}finally{h.close();}});

test('concurrent cancellation and early completion choose one terminal outcome without phantom awards',async()=>{const h=await fixture();try{
 const a=await h.create();await h.bid(a,'alice',30);await h.bid(a,'bob',10);
 const results=await Promise.all([h.manage(a,'cancel','cancel-race-key'),h.manage(a,'complete-early','complete-race-key')]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const end=(await h.call('/api/auctions/'+a.id)).body;assert.ok(['cancelled','closed'].includes(end.auction.status));assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_awards').get().n,end.auction.status==='cancelled'?0:1);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,4);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_admin_actions').get().n,1);
}finally{h.close();}});

test('slot filters use immutable publication metadata and match each slot of a multi-slot item',async()=>{const h=await fixture();try{
 const a=await h.create();assert.deepEqual(a.slots,['EAR','FINGER']);h.DB.raw.prepare("UPDATE item_references SET slots_json='[\"HEAD\"]' WHERE item_id=1").run();
 for(const slot of ['EAR','FINGER']){const result=await h.call('/api/auctions?includeSlots=1&slot='+slot+'&class=CLR&status=open');assert.equal(result.body.auctions.length,1);assert.deepEqual(result.body.slots,['EAR','FINGER']);}
 assert.equal((await h.call('/api/auctions?includeSlots=1&slot=HEAD')).body.auctions.length,0);assert.equal((await h.call('/api/auctions?includeSlots=1&slot=%3Cbad%3E')).status,400);
 await h.manage(a,'cancel');assert.equal((await h.call('/api/auctions?includeSlots=1&status=open')).body.auctions.length,0);assert.equal((await h.call('/api/auctions?includeSlots=1&status=closed')).body.auctions.length,0);assert.equal((await h.call('/api/auctions?includeSlots=1&status=cancelled')).body.auctions.length,1);
 assert.throws(()=>h.DB.raw.exec("UPDATE auction_admin_actions SET reason='rewrite'"),/IMMUTABLE/);
}finally{h.close();}});
