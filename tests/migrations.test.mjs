import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
test('packaged migration applies as complete individual D1 statements with every integrated table and no seeded users',async()=>{
 const db=new DatabaseSync(':memory:');
 try {
  const migration=await readFile(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8');
  const statements=migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  for(const sql of statements)db.prepare(sql).run();
  const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  for(const name of ['users','sessions','characters','claims','raids','ticks','attendance','ledger','audit','import_scope','item_references','auctions','auction_bid_events','auction_bids','auction_awards','correction_requests','guild_settings','dkp_adjustments'])assert.ok(names.has(name),'Missing migration table '+name);
  const columns=new Set(db.prepare('PRAGMA table_info(auctions)').all().map(r=>r.name));assert.ok(columns.has('creation_key'));assert.ok(columns.has('creation_signature'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='ledger_exact_total'").get());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,0);
 }finally{db.close();}
});

test('additive catalog and boss-loot migration preserves an existing account, item and exact ledger',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of ['0000_initial.sql'])for(const sql of (await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(sql).run();
  db.prepare("INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('owner','owner@test.invalid','Owner','fixture','fixture','admin','2026-11-11')").run();
  db.prepare("INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES('main','main','Main',125,'Cleric','Raider','main','owner','2026-11-11')").run();
  db.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(901,'Fixture Ring','https://items.eqresource.com/items.php?id=901','2026-11-11','fixture','unresolved')").run();
  db.prepare("INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES('prior','main',-15,'Fixture prior award','owner','2026-11-11','prior')").run();
  const next=await readFile(new URL('../drizzle/0001_item_catalog_boss_loot.sql',import.meta.url),'utf8');
  db.exec('BEGIN');for(const sql of next.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(sql).run();db.exec('COMMIT');
  assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get('owner').name,'Owner');
  assert.equal(db.prepare('SELECT owner_id FROM characters WHERE id=?').get('main').owner_id,'owner');
  assert.equal(db.prepare('SELECT name,metadata_complete FROM item_references WHERE item_id=?').get(901).name,'Fixture Ring');
  assert.equal(db.prepare('SELECT metadata_complete FROM item_references WHERE item_id=?').get(901).metadata_complete,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,0);
  assert.equal(db.prepare('SELECT SUM(amount) balance FROM ledger WHERE character_id=?').get('main').balance,-15);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='ledger_exact_total'").get());
 }finally{db.close();}
});

test('v0.3 database upgrades to assignment history and equipment without changing owned characters or DKP',async()=>{
 const db=new DatabaseSync(':memory:');
 const apply=async name=>{for(const statement of (await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(statement).run();};
 try{
  for(const name of ['0000_initial.sql','0001_item_catalog_boss_loot.sql','0002_live_loot_capture.sql'])await apply(name);
  db.exec("INSERT INTO users VALUES('owner','owner@fixture.test','Owner','x','x','admin','then'); INSERT INTO characters VALUES('main','mainhero','Mainhero',85,'Monk','Raider','main','owner','then'); INSERT INTO claims(id,character_id,user_id,status,kind,created_at,approved_at) VALUES('claim','main','owner','approved','main','before','then'); INSERT INTO ledger VALUES('previous','main',NULL,-75,'Existing award','owner','then','previous');");
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('approved','owner','claim_approved',JSON.stringify({claimId:'claim'}),'then');
  for(const name of ['0003_assignment_history.sql','0004_character_equipment.sql'])await apply(name);
  assert.equal(db.prepare('SELECT SUM(amount) balance FROM ledger').get().balance,-75);
  assert.equal(db.prepare('SELECT owner_id FROM characters').get().owner_id,'owner');
  const assignment=db.prepare('SELECT * FROM assignment_events').get();assert.equal(assignment.assigned_by,'owner');assert.equal(assignment.character_id,'main');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM character_equipment').get().n,0);
  assert.throws(()=>db.prepare('DELETE FROM assignment_events').run(),/IMMUTABLE/);
 }finally{db.close();}
});

test('v0.4 upgrade backfills evidenced eligibility and access templates without moving credits or assignments',async()=>{
 const db=new DatabaseSync(':memory:');
 const apply=async name=>{for(const statement of (await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(statement).run();};
 try{
  for(const name of ['0000_initial.sql','0001_item_catalog_boss_loot.sql','0002_live_loot_capture.sql','0003_assignment_history.sql','0004_character_equipment.sql'])await apply(name);
  db.exec("INSERT INTO users VALUES('owner','owner@fixture.test','Owner','x','x','admin','2026-11-12'); INSERT INTO characters VALUES('hero','hero','Hero',85,'Monk','Raider','main','owner','2026-11-12'); INSERT INTO raids VALUES('r','Old raid','2026-11-10',5,'owner','2026-11-12'); INSERT INTO ticks VALUES('t','r','fixture','Demo_test-20261110-180000.txt','2026-11-10T18:00:00','x','raw retained',1,'2026-11-12','fixture'); INSERT INTO attendance VALUES('a','t','hero','Monk','Raid','credited',5); INSERT INTO ledger VALUES('credit','hero','a',5,'Original tick','owner','2026-11-12','fixture');");
  await apply('0005_attendance_eligibility.sql');await apply('0006_access_profiles.sql');
  assert.equal(db.prepare('SELECT start_at FROM character_attendance_eligibility').get().start_at,'2026-11-10T18:00:00');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM access_profiles').get().n,3);
  assert.equal(JSON.parse(db.prepare('SELECT permissions_json FROM access_effective_permissions WHERE user_id=?').get('owner').permissions_json).access,3);
  assert.equal(db.prepare('SELECT owner_id FROM characters').get().owner_id,'owner');assert.equal(db.prepare('SELECT SUM(amount) n FROM ledger').get().n,5);
  assert.equal(db.prepare('SELECT raw_text FROM ticks').get().raw_text,'raw retained');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM character_equipment').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 }finally{db.close();}
});

test('saved companion device migration preserves an existing manual capture and adds no device credentials',async()=>{
 const db=new DatabaseSync(':memory:');
 const apply=async name=>{for(const statement of (await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(statement).run();};
 try{
  for(const name of ['0000_initial.sql','0001_item_catalog_boss_loot.sql','0002_live_loot_capture.sql','0003_assignment_history.sql','0004_character_equipment.sql','0005_attendance_eligibility.sql','0006_access_profiles.sql'])await apply(name);
  db.exec("INSERT INTO users VALUES('owner','owner@fixture.test','Owner','x','x','admin','2026-11-12'); INSERT INTO capture_sessions(id,boss_name,created_by,channel_name,senders_json,token_hash,created_at,expires_at_ms,watcher_id) VALUES('old','Existing boss','owner','abfloot','[]','fixture-old-hash','2026-11-12',9999999999999,'fixture-watcher');");
  const before=db.prepare('SELECT * FROM capture_sessions').get();await apply('0007_companion_devices.sql');
  assert.deepEqual(db.prepare('SELECT * FROM capture_sessions').get(),before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM companion_devices').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM companion_device_guards').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 }finally{db.close();}
});

test('catalog and inventory migrations preserve existing gear, accounts and exact DKP without importing any dataset',async()=>{
 const db=new DatabaseSync(':memory:');
 const apply=async name=>{for(const statement of(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.prepare(statement).run();};
 try{
  for(const name of ['0000_initial','0001_item_catalog_boss_loot','0002_live_loot_capture','0003_assignment_history','0004_character_equipment','0005_attendance_eligibility','0006_access_profiles','0007_companion_devices'])await apply(name+'.sql');
  db.exec("INSERT INTO users VALUES('owner','owner@fixture.invalid','Owner','fixture','fixture','admin','2026-11-12'); INSERT INTO characters VALUES('hero','hero','Hero',100,'Bard','Raider','main','owner','2026-11-12'); INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(1,'Existing gear','https://items.eqresource.com/items.php?id=1','now','fixture','unresolved'); INSERT INTO character_equipment VALUES('hero','head',1,'reference','now','owner','old-gear'); INSERT INTO ledger VALUES('credit','hero',NULL,-7,'Existing balance','owner','now','credit-key');");
  const gear=db.prepare('SELECT * FROM character_equipment').all(),ledger=db.prepare('SELECT * FROM ledger').all();
  await apply('0008_uploaded_item_catalog.sql');await apply('0009_inventory_imports.sql');
  assert.deepEqual(db.prepare('SELECT * FROM character_equipment').all(),gear);assert.deepEqual(db.prepare('SELECT * FROM ledger').all(),ledger);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  for(const table of ['catalog_imports','catalog_items','inventory_imports','inventory_equipment_augments'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  assert.deepEqual({...db.prepare('SELECT active_import_id,revision FROM catalog_state').get()},{active_import_id:null,revision:0});
 }finally{db.close();}
});
