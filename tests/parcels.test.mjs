import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationSchema} from './app-schema.mjs';
import {createD1} from './d1-adapter.mjs';
import {handleParcelApi,resolveAwardHolders} from '../worker/parcels.mjs';
import {handleLootHistoryApi} from '../worker/loot-history.mjs';
import {authorizeRoute,guardedDatabase} from '../worker/authorization.mjs';
async function fixture(events=null) {
 const DB=createD1(await applicationSchema()),raw=DB.raw;
 for(const id of ['admin','officer','a','b','outsider','w1','w2','w3','w4'])raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@fixture.invalid',id==='outsider'?'Holdera':id,'fixture','fixture',id==='admin'?'admin':'member','2026-11-14T12:00:00Z');
 raw.prepare("INSERT INTO access_user_profiles(user_id,profile_id,overrides_json,revision,updated_at,updated_by,operation_id) VALUES('officer','officer','{}',1,'now','admin','officer-profile')").run();
 for(const[id,name,owner,kind]of [['ha','Holdera','a','main'],['hb','Holderb','b','alt'],...Array.from({length:4},(_,n)=>['c'+(n+1),'Winner'+(n+1),'w'+(n+1),'main'])])raw.prepare('INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,name.toLowerCase(),name,85,'Cleric','Raider',kind,owner,'now');
 raw.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(1,'Fixture ring','https://items.eqresource.com/items.php?id=1','now','fixture','verified_reference')").run();
 raw.prepare("INSERT INTO raids(id,name,date,rate,created_by,created_at) VALUES('raid','Fixture raid','2026-11-13',1,'admin','now')").run();
 raw.prepare("INSERT INTO loot_drafts(id,raid_id,boss_name,created_by,status,sources_json,warnings_json,created_at,updated_at) VALUES('draft','raid','Fixture boss','admin','published','[]','[]','now','now')").run();
 raw.prepare("INSERT INTO auctions(id,item_id,item_name,classes_json,slots_json,source_url,metadata_status,quantity,minimum_bid,status,published_at_ms,closes_at_ms,closed_at_ms,created_by) VALUES('auction',1,'Fixture ring','[\"ALL\"]','[\"FINGER\"]','https://items.eqresource.com/items.php?id=1','verified_reference',4,1,'closed',1,2,3,'admin')").run();
 raw.prepare("INSERT INTO loot_draft_items(id,draft_id,ordinal,name,normalized_name,quantity,item_id,match_status,raw_lines_json,auction_id) VALUES('item','draft',0,'Fixture ring','fixture ring',4,1,'matched','[]','auction')").run();
 raw.prepare("INSERT INTO raid_loot_imports(id,request_key,source_hash,file_name,format,raid_id,raid_date,context_json,warnings_json,created_by,created_at) VALUES('import','key','hash','fixture.json','tracker-json','raid','2026-11-13','{}','[]','admin','now')").run();
 raw.prepare("INSERT INTO raid_loot_import_groups(id,import_id,group_key,boss_name,status,draft_id,created_at) VALUES('group','import','group-key','Fixture boss','prepared','draft','now')").run();
 for(const[id,holder,quantity,excluded,ordinal,itemName='Fixture ring']of events||[['ignored','Outsider',2,1,0],['first','Holdera',2,0,1],['second','Holderb',2,0,2]]) {
  raw.prepare("INSERT INTO raid_loot_import_events(id,event_key,evidence_signature,item_name,quantity,holder,source,time_text,provenance_json,excluded,handoff_group_id,created_at) VALUES(?,?,?,?,?,?,'Fixture boss','12:00:00','{}',?,'group','now')").run(id,id,id,itemName,quantity,holder,excluded);
  raw.prepare("INSERT INTO raid_loot_import_links(import_id,event_id,group_id,ordinal) VALUES('import',?,'group',?)").run(id,ordinal);
 }
 for(let n=1;n<=4;n++)raw.prepare("INSERT INTO auction_awards(auction_id,character_id,user_id,winning_bid,award_rank,price,status,ledger_id,confirmed_by,confirmed_at_ms) VALUES('auction',?,?,10,?,1,'confirmed',?,'admin',4)").run('c'+n,'w'+n,n,'award-'+n);
 const context=who=>({user:{id:who,role:who==='admin'||who==='officer'?'admin':'member'},csrfToken:'csrf',access:{permissions:{auctions:3,auctionAdmin:who==='admin'||who==='officer'?3:0}}});
 const request=(n,event,headers={})=>new Request('https://fixture.invalid/api/loot-history/auction/c'+n+'/parcel',{method:'POST',headers:{Origin:'https://fixture.invalid','Content-Type':'application/json','X-CSRF-Token':'csrf',...headers},body:JSON.stringify({parceled:true,holderEventId:event})});
 const parcel=async(who,n,event,db=DB)=>{const r=await handleParcelApi(request(n,event),{DB:db},context(who));return{status:r.status,data:await r.json()};};
 const history=async(who,query='')=>{const r=await handleLootHistoryApi(new Request('https://fixture.invalid/api/loot-history?'+query),{DB},context(who));assert.equal(r.status,200);return r.json();};
 return {DB,raw,parcel,history,context,request};
}
test('export ordinals and quantities assign one physical copy per winner, excluding ignored loot',async()=>{
 const h=await fixture();try{const rows=(await resolveAwardHolders(h.DB)).sort((a,b)=>a.characterId.localeCompare(b.characterId));assert.deepEqual(rows.map(r=>[r.characterId,r.holderEventId,r.holderName]),[['c1','first','Holdera'],['c2','first','Holdera'],['c3','second','Holderb'],['c4','second','Holderb']]);}finally{h.DB.close();}
});
test('approved main or alt looter owners can mark only their assigned copies; account-name impersonation and ordinary officers cannot',async()=>{
 const h=await fixture();try{assert.equal((await h.parcel('a',1,'first')).status,200);assert.equal((await h.parcel('b',3,'second')).status,200);for(const who of ['a','officer','outsider','w4'])assert.equal((await h.parcel(who,4,'second')).status,409,who);assert.equal((await h.parcel('admin',4,'second')).status,200);}finally{h.DB.close();}
});
test('confirmation is required and stale holder identities cannot mark a different copy',async()=>{
 const h=await fixture();try{h.raw.prepare("UPDATE auction_awards SET status='pending' WHERE character_id='c2'").run();assert.equal((await h.parcel('a',2,'first')).status,409);assert.equal((await h.parcel('a',1,'second')).status,409);assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM loot_parcels').get().n,0);}finally{h.DB.close();}
});
test('parcel retry creates one delivery/audit record and never changes DKP or confirmation',async()=>{
 const h=await fixture();try{const before=h.raw.prepare('SELECT * FROM ledger').all();await h.parcel('a',1,'first');await h.parcel('a',1,'first');assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM loot_parcels').get().n,1);assert.equal(h.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='loot_parceled'").get().n,1);assert.deepEqual(h.raw.prepare('SELECT * FROM ledger').all(),before);assert.equal(h.raw.prepare("SELECT status FROM auction_awards WHERE character_id='c1'").get().status,'confirmed');}finally{h.DB.close();}
});
test('the queue omits parceled awards while guild history retains their looter and delivery status',async()=>{
 const h=await fixture();try{let history=await h.history('a','queue=mine');assert.equal(history.total,2);assert.ok(history.rows.every(r=>r.canParcel===1));await h.parcel('a',1,'first');history=await h.history('a','queue=mine');assert.equal(history.total,1);assert.equal(history.rows[0].characterId,'c2');history=await h.history('outsider','status=parceled&looter=Holdera');assert.equal(history.total,1);assert.equal(history.rows[0].looterName,'Holdera');assert.equal(history.rows[0].canParcel,0);assert.ok(history.rows[0].parceledAt);assert.equal((await h.history('officer','queue=mine')).total,0);assert.equal((await h.history('admin','queue=mine')).total,3);}finally{h.DB.close();}
});
test('current ownership and access are checked inside the write batch, not only before it',async()=>{
 for(const revoke of ["UPDATE characters SET owner_id=NULL WHERE id='ha'","INSERT INTO access_user_profiles(user_id,profile_id,overrides_json,revision,updated_at,updated_by,operation_id) VALUES('a','member','{\"auctions\":2}',1,'now','admin','revoke')"]){const h=await fixture();try{const db={prepare:q=>h.DB.prepare(q),batch:statements=>{if(statements.some(s=>s.query.includes('INSERT INTO loot_parcels')))h.raw.exec(revoke);return h.DB.batch(statements);}};assert.equal((await h.parcel('a',1,'first',db)).status,409);assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM loot_parcels').get().n,0);}finally{h.DB.close();}}
});
test('CSRF/origin boundaries and central write permissions apply to parcel requests',async()=>{
 const h=await fixture();try{for(const headers of [{'X-CSRF-Token':'wrong'},{Origin:'https://foreign.invalid'}])assert.equal((await handleParcelApi(h.request(1,'first',headers),{DB:h.DB},h.context('a'))).status,403);await assert.rejects(()=>authorizeRoute(h.request(1,'first'),h.DB,{...h.context('a'),access:{permissions:{auctions:2}}}),/permit/);const policy=await authorizeRoute(h.request(1,'first'),h.DB,h.context('a'));assert.equal(policy.grants[0].level,3);}finally{h.DB.close();}
});
test('deleting an award cascades its delivery marker and preserves audit evidence',async()=>{
 const h=await fixture();try{await h.parcel('a',1,'first');h.raw.prepare("DELETE FROM auction_awards WHERE character_id='c1'").run();assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM loot_parcels').get().n,0);assert.equal(h.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='loot_parceled'").get().n,1);}finally{h.DB.close();}
});
test('middle whitespace and NFKC variants keep their export positions and correct holding owners',async()=>{
 const h=await fixture([['first','Holdera',1,0,0,'Fixture ring'],['middle','Holderb',1,0,1,'Fixture  ring'],['unicode','Holdera',1,0,2,'Ｆｉｘｔｕｒｅ ring'],['last','Holderb',1,0,3,'Fixture ring']]);
 try{const rows=(await resolveAwardHolders(h.DB)).sort((a,b)=>a.rank-b.rank);assert.deepEqual(rows.map(row=>row.holderEventId),['first','middle','unicode','last']);assert.equal((await h.parcel('a',2,'middle')).status,409);assert.equal((await h.parcel('b',2,'middle')).status,200);assert.equal((await h.parcel('a',3,'unicode')).status,200);}finally{h.DB.close();}
});
test('source changes between resolution and INSERT fail the proof fence without a parcel or audit',async()=>{
 const h=await fixture();try{const db={prepare:q=>h.DB.prepare(q),batch:statements=>{if(statements.some(s=>s.query.includes('INSERT INTO loot_parcels')))h.raw.prepare("UPDATE raid_loot_import_events SET excluded=1,revision=revision+1 WHERE id='first'").run();return h.DB.batch(statements);}};assert.equal((await h.parcel('a',1,'first',db)).status,409);assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM loot_parcels').get().n,0);assert.equal(h.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='loot_parceled'").get().n,0);}finally{h.DB.close();}
});
