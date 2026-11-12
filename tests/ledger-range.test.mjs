import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createD1 } from './d1-adapter.mjs';

async function database() {
 const db=createD1(await readFile(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 db.raw.exec("INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('u','range@example.test','Range','test','test','admin','2026-11-11'); INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id) VALUES('c','range','Range',85,'Cleric','Officer','main','u');");
 return db;
}
const post=(db,id,amount)=>db.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?)').bind(id,'c',amount,'Range test','u','2026-11-11',id);
test('ledger accepts negative totals while preventing loss of exact whole-point precision',async()=>{
 const db=await database();try {
  await post(db,'a',50).run();await post(db,'b',-81).run();assert.equal(db.raw.prepare('SELECT SUM(amount) AS amount FROM ledger').get().amount,-31);
  await post(db,'c',Number.MAX_SAFE_INTEGER).run();
  await assert.rejects(post(db,'d',32).run(),/DKP_RANGE/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,3);
 }finally{db.close();}
});
test('range rejection rolls back a complete posting batch and preserves its original balance',async()=>{
 const db=await database();try {
  const original=Number.MAX_SAFE_INTEGER-5;await post(db,'initial',original).run();
  await assert.rejects(db.batch([post(db,'first',4),post(db,'second',2)]),/DKP_RANGE/);
  assert.equal(db.raw.prepare('SELECT SUM(amount) AS amount FROM ledger').get().amount,original);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,1);
 }finally{db.close();}
});
test('negative precision boundary rejects a further debit without imposing a zero-balance floor',async()=>{
 const db=await database();try {
  await post(db,'initial',-Number.MAX_SAFE_INTEGER).run();
  await assert.rejects(post(db,'extra',-1).run(),/DKP_RANGE/);
  assert.equal(db.raw.prepare('SELECT SUM(amount) AS amount FROM ledger').get().amount,-Number.MAX_SAFE_INTEGER);
 }finally{db.close();}
});
test('an idempotent retry at the precision boundary does not become a new charge',async()=>{
 const db=await database();try {
  await post(db,'initial',Number.MAX_SAFE_INTEGER).run();
  await db.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind('initial','c',Number.MAX_SAFE_INTEGER,'Retry','u','2026-11-11','retry').run();
  assert.equal(db.raw.prepare('SELECT SUM(amount) AS amount FROM ledger').get().amount,Number.MAX_SAFE_INTEGER);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,1);
 }finally{db.close();}
});
