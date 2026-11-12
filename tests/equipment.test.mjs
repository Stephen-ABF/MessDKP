import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleEquipmentApi,createEquipmentApi,EQUIPMENT_SLOTS} from '../worker/equipment.mjs';
import {ITEM_REFERENCE_SCHEMA_SQL,VERIFIED_ITEM_REFERENCES} from '../worker/items.mjs';
import {createD1} from './d1-adapter.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
const origin='https://guild.test';
function fixture({knownItems}={}){
 const handler=knownItems?createEquipmentApi({knownItems}):handleEquipmentApi;
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql'),read('auction-management.sql'),read('equipment.sql')].join('\n'));
 for(const [id,role]of[['officer','admin'],['owner','member'],['other','member']])DB.raw.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,id+'@fixture.test',id,'fixture','fixture',role,'2026-11-12');
 for(const[id,kind,owner,approved]of[['hero','main','owner','2026-11-12'],['alt','alt','owner','2026-11-12'],['unapproved','unclassified','owner',null]])DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run(id,id,id,85,'Cleric','Raider',kind,owner,approved);
 for(const id of[1,2,3])DB.raw.prepare('INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?,?)').run(id,'Fixture Item '+id,'https://items.eqresource.com/items.php?id='+id,'2026-11-12','fixture','unresolved');
 DB.raw.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run('old-ledger','hero',null,-17,'Preserve old balance','officer','2026-11-12','old-operation');
 const auth=id=>id?{user:{id},csrfToken:'token'}:{};
 const call=async({id='hero',slot,method=slot?'PUT':'GET',data,user='owner',headers={},body,context={}}={})=>{const response=await handler(new Request(origin+'/api/characters/'+id+'/equipment'+(slot?'/'+slot:''),{method,headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'token',...headers},...(['GET','HEAD'].includes(method)?{}:{body:body??JSON.stringify(data)})}),{DB},{...auth(user),...context});return{status:response.status,body:await response.json()};};
 const select=(itemId,expectedItemId=null,extra={})=>call({slot:'head',data:{itemId,expectedItemId},...extra});
 const award=(id,itemId,characterId,status)=>{DB.raw.prepare('INSERT INTO auctions(id,item_id,item_name,source_url,metadata_status,quantity,minimum_bid,published_at_ms,closes_at_ms,created_by) VALUES(?,?,?,?,?,1,1,1,2,?)').run(id,itemId,'Fixture Item','https://items.eqresource.com/items.php?id='+itemId,'unresolved','officer');DB.raw.prepare('INSERT INTO auction_awards(auction_id,character_id,user_id,winning_bid,award_rank,price,status,ledger_id) VALUES(?,?,?,10,1,7,?,?)').run(id,characterId,'owner',status,'award-ledger-'+id);};
 const count=table=>DB.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return{DB,call,select,award,count,close(){DB.close();}};
}

test('equipment reads are authenticated and return 23 stable slots with current-owner permissions',async()=>{const h=fixture();try{
 assert.equal((await h.call({user:null})).status,401);
 const result=await h.call({user:'other'});assert.equal(result.status,200);assert.equal(result.body.canEdit,false);assert.deepEqual(result.body.slots.map(s=>s.key),EQUIPMENT_SLOTS.map(s=>s.key));assert.equal(result.body.slots.length,23);assert.ok(result.body.slots.every(s=>s.itemId===null&&s.source===null));
 assert.equal((await h.call()).body.canEdit,true);assert.equal((await h.call({id:'alt'})).body.canEdit,true);assert.equal((await h.call({id:'unapproved'})).body.canEdit,false);assert.equal((await h.call({id:'unapproved',user:'officer'})).body.canEdit,false);assert.equal((await h.call({user:'officer'})).body.canEdit,false);assert.equal(h.count('audit'),0);
 assert.equal((await h.call({id:'missing'})).status,404);
}finally{h.close();}});

test('reference set, matching retry, stale change and clear preserve audit and financial history',async()=>{const h=fixture();try{
 const before=h.DB.raw.prepare('SELECT * FROM ledger').all();const set=await h.select(1);assert.equal(set.status,200,JSON.stringify(set.body));assert.equal(set.body.alreadyApplied,false);assert.equal(set.body.slot.itemName,'Fixture Item 1');assert.equal(set.body.slot.source,'reference');
 assert.equal((await h.select(1)).body.alreadyApplied,true);assert.equal(h.count('audit'),1);
 const stale=await h.select(2);assert.equal(stale.status,409);assert.equal(stale.body.code,'equipment_conflict');
 const clear=await h.select(null,1);assert.equal(clear.status,200);assert.equal(clear.body.slot.itemId,null);assert.equal(clear.body.slot.source,null);assert.ok(clear.body.slot.updatedAt);assert.equal((await h.select(null,1)).body.alreadyApplied,true);assert.equal(h.count('character_equipment'),1);assert.equal(h.count('audit'),2);
 const details=h.DB.raw.prepare('SELECT details FROM audit ORDER BY rowid').all().map(r=>JSON.parse(r.details));assert.deepEqual(details.map(x=>[x.previousItemId,x.itemId]),[[null,1],[1,null]]);assert.deepEqual(h.DB.raw.prepare('SELECT * FROM ledger').all(),before);assert.equal(h.count('attendance'),0);assert.equal(h.count('auction_awards'),0);
}finally{h.close();}});

test('only the approved owner may edit; origin, CSRF and input validation fail closed',async()=>{const h=fixture();try{
 assert.equal((await h.select(1,null,{user:'other'})).status,403);assert.equal((await h.select(1,null,{id:'unapproved'})).status,403);
 assert.equal((await h.select(1,null,{headers:{Origin:'https://evil.test'}})).status,403);assert.equal((await h.select(1,null,{headers:{'X-CSRF-Token':'wrong'}})).status,403);
 assert.equal((await h.select(1,null,{headers:{'Content-Type':'text/plain'}})).status,415);
 for(const data of[{itemId:1},{itemId:0,expectedItemId:null},{itemId:'1',expectedItemId:null},{itemId:Number.MAX_SAFE_INTEGER+1,expectedItemId:null},[]])assert.equal((await h.call({slot:'head',data})).status,400);
 assert.equal((await h.call({slot:'invalid',data:{itemId:1,expectedItemId:null}})).body.code,'invalid_slot');assert.equal((await h.select(999)).body.code,'unknown_item');assert.equal((await h.call({slot:'head',body:'{'})).status,400);assert.equal((await h.call({slot:'head',body:JSON.stringify({padding:'x'.repeat(9000)})})).status,413);assert.equal(h.count('audit'),0);
 assert.equal((await h.select(1,null,{id:'unapproved',user:'officer'})).status,403);assert.equal((await h.select(1,null,{user:'officer'})).status,403);
}finally{h.close();}});

test('selection provenance requires confirmed award for the exact character and item; partial metadata imposes no restriction',async()=>{const h=fixture();try{
 h.award('pending',1,'hero','pending');h.award('other-character',2,'alt','confirmed');h.award('confirmed',3,'hero','confirmed');
 assert.equal((await h.select(1)).body.slot.source,'reference');assert.equal((await h.select(2,1)).body.slot.source,'reference');assert.equal((await h.select(3,2)).body.slot.source,'award');
 const ammo=await h.call({slot:'ammo',data:{itemId:3,expectedItemId:null}});assert.equal(ammo.status,200);assert.equal(ammo.body.slot.sourceSlot,'AMMO');assert.equal(h.count('auction_awards'),3);assert.equal(h.count('ledger'),1);
}finally{h.close();}});

test('concurrent conflicting selections cannot overwrite an accepted selection',async()=>{const h=fixture();try{
 const results=await Promise.all([h.select(1),h.select(2)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.count('audit'),1);const winner=results.find(r=>r.status===200).body.slot.itemId;assert.equal((await h.call()).body.slots.find(s=>s.key==='head').itemId,winner);
}finally{h.close();}});

test('concurrent identical selection converges without duplicate audit',async()=>{const h=fixture();try{
 const results=await Promise.all([h.select(1),h.select(1)]);assert.ok(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.body.alreadyApplied).length,1);assert.equal(h.count('audit'),1);
}finally{h.close();}});

test('ownership loss between initial read and atomic write denies former owner and preserves equipment',async()=>{const h=fixture();try{
 const batch=h.DB.batch.bind(h.DB);let moved=false;h.DB.batch=async statements=>{if(!moved&&statements[0].query.startsWith('INSERT INTO character_equipment')){moved=true;h.DB.raw.prepare("UPDATE characters SET owner_id=NULL,kind='unclassified',approved_at=NULL WHERE id='hero'").run();}return batch(statements);};
 const result=await h.select(1);assert.equal(result.status,403);assert.equal(h.count('character_equipment'),0);assert.equal(h.count('audit'),0);
}finally{h.close();}});

test('stale clear is rechecked inside the mutation transaction and officer role cannot bypass ownership',async()=>{const h=fixture();try{
 assert.equal((await h.select(1)).status,200);const batch=h.DB.batch.bind(h.DB);let changed=false;h.DB.batch=async statements=>{if(!changed&&statements[0].query.startsWith('INSERT INTO character_equipment')){changed=true;h.DB.raw.prepare("UPDATE character_equipment SET item_id=2 WHERE character_id='hero' AND slot_key='head'").run();}return batch(statements);};
 assert.equal((await h.select(null,1)).status,409);assert.equal(h.DB.raw.prepare('SELECT item_id FROM character_equipment').get().item_id,2);assert.equal(h.count('audit'),1);
 h.DB.raw.prepare("UPDATE users SET role='member' WHERE id='officer'").run();assert.equal((await h.select(3,2,{user:'officer'})).status,403);
}finally{h.close();}});

test('audit failure rolls back the equipment selection',async()=>{const h=fixture();try{
 h.DB.raw.exec("CREATE TRIGGER fail_equipment_audit BEFORE INSERT ON audit WHEN NEW.action='character_equipment_changed' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
 assert.equal((await h.select(1)).status,500);assert.equal(h.count('character_equipment'),0);assert.equal(h.count('audit'),0);assert.equal(h.count('ledger'),1);
}finally{h.close();}});

test('known starter references visible in the catalog are cached only with an authorized successful selection',async()=>{const h=fixture({knownItems:VERIFIED_ITEM_REFERENCES});try{
 const item=VERIFIED_ITEM_REFERENCES[0];assert.equal((await h.call()).status,200);assert.equal(h.count('item_references'),3);
 assert.equal((await h.select(item.itemId,null,{user:'other'})).status,403);assert.equal(h.count('item_references'),3);
 const result=await h.select(item.itemId);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.slot.itemName,item.name);assert.equal(result.body.slot.source,'reference');assert.equal(h.count('item_references'),4);assert.equal(h.count('audit'),1);
 const cached=h.DB.raw.prepare('SELECT name,stats_json,verification_method FROM item_references WHERE item_id=?').get(item.itemId);assert.equal(cached.name,item.name);assert.deepEqual(JSON.parse(cached.stats_json),item.stats);assert.equal(cached.verification_method,item.verificationMethod);
 assert.equal((await h.select(999999,item.itemId)).body.code,'unknown_item');assert.equal(h.count('item_references'),4);
}finally{h.close();}});

test('starter cache insertion and selection both fail closed on raced ownership loss or audit failure',async()=>{for(const mode of['ownership','audit']){const h=fixture({knownItems:VERIFIED_ITEM_REFERENCES});try{
 if(mode==='audit')h.DB.raw.exec("CREATE TRIGGER fail_equipment_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 else{const batch=h.DB.batch.bind(h.DB);h.DB.batch=async statements=>{if(statements[0].query.startsWith('INSERT INTO item_references'))h.DB.raw.prepare("UPDATE characters SET owner_id=NULL,kind='unclassified',approved_at=NULL WHERE id='hero'").run();return batch(statements);};}
 assert.equal((await h.select(VERIFIED_ITEM_REFERENCES[0].itemId)).status,mode==='ownership'?403:500);assert.equal(h.count('item_references'),3);assert.equal(h.count('character_equipment'),0);assert.equal(h.count('audit'),0);
}finally{h.close();}}});

test('officers can edit their own approved character but cannot use a claimed role to edit somebody else',async()=>{const h=fixture();try{
 const forged={user:{id:'officer',role:'admin'},access:{permissions:{overview:3,mains:3}}};
 assert.equal((await h.select(1,null,{user:'officer',context:forged})).status,403);assert.equal((await h.call({user:'officer',context:forged})).body.canEdit,false);
 h.DB.raw.prepare("UPDATE characters SET owner_id='officer' WHERE id='hero'").run();
 assert.equal((await h.select(1,null,{user:'officer',context:forged})).status,200);
 h.DB.raw.prepare("UPDATE users SET role='member' WHERE id='officer'").run();
 assert.equal((await h.select(2,1,{user:'officer',context:forged})).status,200);assert.equal(h.count('audit'),2);
}finally{h.close();}});

test('saved uploaded icon identity is exposed with equipment without changing ledger or ownership',async()=>{const h=fixture();try{
 assert.equal((await h.select(1)).status,200);
 h.DB.raw.prepare('UPDATE item_references SET advanced_loot=? WHERE item_id=1').run('1^2753^Fixture Item 1');
 const before=h.DB.raw.prepare('SELECT * FROM ledger').all(),audit=h.count('audit');
 const result=await h.call();assert.equal(result.status,200);assert.equal(result.body.slots.find(s=>s.key==='head').advancedLoot,'1^2753^Fixture Item 1');
 assert.deepEqual(h.DB.raw.prepare('SELECT * FROM ledger').all(),before);assert.equal(h.count('audit'),audit);assert.equal(result.body.canEdit,true);
}finally{h.close();}});

test('profile write access is required as well as current approved ownership',async()=>{const h=fixture();try{
 for(const access of[{permissions:{overview:2,mains:2}},{permissions:{characters:3,claims:3}},null]){
  const context={access};assert.equal((await h.call({context})).body.canEdit,false);assert.equal((await h.select(1,null,{context})).status,403);
 }
 assert.equal(h.count('audit'),0);
 assert.equal((await h.select(1,null,{context:{access:{permissions:{overview:3}}}})).status,200);
 assert.equal((await h.select(2,1,{context:{access:{permissions:{mains:3}}}})).status,200);
 assert.equal((await h.select(3,null,{id:'alt',context:{access:{permissions:{overview:3}}}})).status,200);
 assert.equal(h.count('audit'),3);
}finally{h.close();}});
