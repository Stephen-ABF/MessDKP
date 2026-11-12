import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {handleDetailsApi} from '../worker/details.mjs';
import {getCachedItemDetails,seedVerifiedItemReferences} from '../worker/items.mjs';
async function setup(){
 const DB=createD1(await applicationSchema());
 DB.raw.exec("INSERT INTO users VALUES('owner','owner@test.invalid','Owner','fixture','fixture','admin','2026-11-12'); INSERT INTO characters VALUES('main','mainhero','Mainhero',85,'Monk','Member','main','owner','2026-11-12'); INSERT INTO characters VALUES('alt','althero','Althero',85,'Cleric','Member','alt','owner','2026-11-12'); INSERT INTO raids VALUES('raid','Raid','2026-11-12',5,'owner','2026-11-12'); INSERT INTO raids VALUES('other','Other Raid','2026-11-12',5,'owner','2026-11-12');");
 for(const id of ['a','b'])DB.raw.prepare('INSERT INTO ticks VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'raid',id,id+'.txt','2026-11-12T20:00:00',id,'Private original source',1,'2026-11-12',id);
 DB.raw.exec("INSERT INTO attendance VALUES('aa','a','main','Monk','Zone','credited',5); INSERT INTO attendance VALUES('ab','b','alt','Cleric','Zone','ineligible',5)");
 return{DB,call:async(path,auth={user:{id:'owner',role:'admin'}},method='GET')=>{const r=await handleDetailsApi(new Request('https://guild.test'+path,{method}),{DB},auth);return r?{status:r.status,body:await r.json()}:null;}};
}
test('a source capture exposes only its tick attendance and enforces the raid/tick relationship without raw source leakage',async()=>{
 const h=await setup();try{
  const r=await h.call('/api/raids/raid/ticks/a');assert.equal(r.status,200);assert.equal(r.body.tick.id,'a');assert.equal(r.body.attendance.length,1);assert.equal(r.body.attendance[0].characterName,'Mainhero');assert.equal(r.body.attendance[0].status,'credited');
  assert.doesNotMatch(JSON.stringify(r.body),/Private original|raw_text|content_hash/);
  assert.equal((await h.call('/api/raids/other/ticks/a')).status,404);
  assert.equal((await h.call('/api/raids/raid/ticks/a',{})).status,401);
  assert.equal((await h.call('/api/raids/raid/ticks/a',{user:{id:'owner'}},'POST')).status,405);
 }finally{h.DB.close();}
});
test('main loot distinguishes winning bid from charge and withholds every open or future result',async()=>{
 const h=await setup();try{
  await seedVerifiedItemReferences(h.DB);
  const insert=h.DB.raw.prepare('INSERT INTO auctions(id,item_id,item_name,source_url,metadata_status,quantity,minimum_bid,status,published_at_ms,closes_at_ms,closed_at_ms,created_by) VALUES(?,?,?,?,?,1,1,?,1,?,?,?)');
  const award=h.DB.raw.prepare('INSERT INTO auction_awards(auction_id,character_id,user_id,winning_bid,award_rank,price,status,ledger_id,confirmed_at_ms) VALUES(?,?,?,100,1,81,?,?,?)');
  for(const [id,status,closeTime,awardStatus]of[['closed','closed',2,'confirmed'],['pending','closed',2,'pending'],['open','open',2,'pending'],['future','closed',Date.now()+86400000,'pending']]){
   insert.run(id,81773,'Blood of the Dhampyre','https://items.eqresource.com/items.php?id=81773','verified_reference',status,closeTime,status==='closed'?3:null,'owner');award.run(id,'main','owner',awardStatus,'fixture-'+id,awardStatus==='confirmed'?4:null);
  }
  const r=await h.call('/api/reports/mains/main/loot');assert.equal(r.status,200);assert.equal(r.body.loot.length,2);assert.equal(r.body.loot[0].winningBid,100);assert.equal(r.body.loot[0].price,81);assert.equal(r.body.loot[0].status,'confirmed');assert.ok(r.body.loot.every(i=>!['open','future'].includes(i.auctionId)));
  assert.equal((await h.call('/api/reports/mains/alt/loot')).status,404);
  assert.equal((await h.call('/api/reports/mains/main/loot',{})).status,401);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 }finally{h.DB.close();}
});
test('verified starter effects survive legacy cache reads without live fetches or invented completeness',async()=>{
 const h=await setup();try{
  await seedVerifiedItemReferences(h.DB);
  const item=await getCachedItemDetails(h.DB,81773);
  assert.equal(item.metadataComplete,false);assert.deepEqual(item.details.effects,['Effect: Prismatic Ward VIII - Casting Time: 0.5s','Effect: Improved Dodge V - Worn',"Focus: Corrupted Sylvan's Rot II"]);
  const mask=await getCachedItemDetails(h.DB,44354);assert.ok(mask.details.effects.includes('Effect: Serpent Sight - Worn'));
 }finally{h.DB.close();}
});
