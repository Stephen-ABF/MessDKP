import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { openPersistentD1 } from '../local/d1.mjs';
import { LOCAL_MIGRATIONS_TABLE } from '../local/migrations.mjs';
import { configuredPort, requestOrigin, createLocalServer, MAX_REQUEST_BYTES } from '../server.mjs';
import { handleApi } from '../worker/api.mjs';
import { handleAuctionApi } from '../worker/auctions.mjs';

const projectMigrations=fileURLToPath(new URL('../drizzle',import.meta.url));
function temporary(t) {
 const parent=path.resolve(tmpdir()),directory=mkdtempSync(path.join(parent,'guild-desk-persistence-'));
 t.after(()=>{const resolved=path.resolve(directory),relative=path.relative(parent,resolved);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('guild-desk-persistence-'));rmSync(resolved,{recursive:true,force:true});});
 return directory;
}
function fixtures(directory,sql=['CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT NOT NULL);']) {
 const migrationsDirectory=path.join(directory,'migrations');mkdirSync(path.join(migrationsDirectory,'meta'),{recursive:true});
 const entries=sql.map((text,index)=>{const tag=String(index).padStart(4,'0')+'_test';writeFileSync(path.join(migrationsDirectory,tag+'.sql'),text);return {idx:index,version:'6',when:index+1,tag,breakpoints:true};});
 writeFileSync(path.join(migrationsDirectory,'meta','_journal.json'),JSON.stringify({version:'7',dialect:'sqlite',entries}));
 return {filename:path.join(directory,'data','guild.sqlite'),migrationsDirectory};
}
function appendMigration(config,sql) {
 const journalPath=path.join(config.migrationsDirectory,'meta','_journal.json'),journal=JSON.parse(readFileSync(journalPath,'utf8')),index=journal.entries.length,tag=String(index).padStart(4,'0')+'_test';
 journal.entries.push({idx:index,version:'6',when:index+1,tag,breakpoints:true});writeFileSync(path.join(config.migrationsDirectory,tag+'.sql'),sql);writeFileSync(journalPath,JSON.stringify(journal));
}
const open=config=>openPersistentD1(config.filename,config);

test('file-backed SQLite survives close/reopen, applies ordered migrations once, and shares committed data',async t=>{
 const config=fixtures(temporary(t));let DB=open(config);
 assert.deepEqual(DB.migrationState,{appliedNow:['0000_test'],totalApplied:1});
 await DB.prepare('INSERT INTO records(value) VALUES(?)').bind('first').run();
 const firstJournal=DB.raw.prepare('SELECT * FROM '+LOCAL_MIGRATIONS_TABLE).all();DB.close();
 DB=open(config);
 try {
  assert.deepEqual(DB.migrationState,{appliedNow:[],totalApplied:1});assert.deepEqual(DB.raw.prepare('SELECT * FROM '+LOCAL_MIGRATIONS_TABLE).all(),firstJournal);
  assert.equal((await DB.prepare('SELECT value FROM records').first()).value,'first');
  assert.equal(DB.raw.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(DB.raw.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  const second=open(config);try{assert.equal((await second.prepare('SELECT value FROM records').first('value')),'first');await second.prepare('INSERT INTO records(value) VALUES(?)').bind('second').run();assert.equal((await DB.prepare('SELECT COUNT(*) n FROM records').first('n')),2);}finally{second.close();}
 }finally{DB.close();}
 appendMigration(config,'ALTER TABLE records ADD COLUMN extra TEXT;');DB=open(config);assert.deepEqual(DB.migrationState.appliedNow,['0001_test']);DB.close();DB=open(config);assert.deepEqual(DB.migrationState.appliedNow,[]);DB.close();
});

test('D1 batches retain SELECT results and atomically roll back all writes on failure',async t=>{
 const config=fixtures(temporary(t),['CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT NOT NULL UNIQUE);\n--> statement-breakpoint\nCREATE TABLE children(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES records(id));']);const DB=open(config);
 try {
  const result=await DB.batch([DB.prepare('INSERT INTO records(value) VALUES(?) RETURNING id').bind('kept'),DB.prepare('SELECT value FROM records')]);assert.equal(result[0].results[0].id,1);assert.equal(result[1].results[0].value,'kept');
  await assert.rejects(DB.batch([DB.prepare('INSERT INTO records(value) VALUES(?)').bind('rolled back'),DB.prepare('INSERT INTO children(record_id) VALUES(999)')]));
  assert.equal(await DB.prepare('SELECT COUNT(*) n FROM records').first('n'),1);assert.equal(await DB.prepare('SELECT COUNT(*) n FROM children').first('n'),0);
 }finally{DB.close();}
});

test('changed applied SQL or journal entry fails closed and preserves existing rows',async t=>{
 const config=fixtures(temporary(t));let DB=open(config);await DB.prepare('INSERT INTO records(value) VALUES(?)').bind('owner data').run();DB.close();
 const sqlPath=path.join(config.migrationsDirectory,'0000_test.sql'),original=readFileSync(sqlPath);writeFileSync(sqlPath,Buffer.concat([original,Buffer.from('\n-- changed history')]));assert.throws(()=>open(config),/changed or was reordered/);
 writeFileSync(sqlPath,original);const journalPath=path.join(config.migrationsDirectory,'meta','_journal.json'),journal=JSON.parse(readFileSync(journalPath));journal.entries[0].when++;writeFileSync(journalPath,JSON.stringify(journal));assert.throws(()=>open(config),/changed or was reordered/);
 const raw=new DatabaseSync(config.filename);try{assert.equal(raw.prepare('SELECT value FROM records').get().value,'owner data');assert.equal(raw.prepare('SELECT COUNT(*) n FROM '+LOCAL_MIGRATIONS_TABLE).get().n,1);}finally{raw.close();}
});

test('failed pending migrations roll back schema and journal together without touching older data',async t=>{
 const config=fixtures(temporary(t));let DB=open(config);await DB.prepare('INSERT INTO records(value) VALUES(?)').bind('retained').run();DB.close();
 appendMigration(config,'CREATE TABLE pending_first(id TEXT);');appendMigration(config,'CREATE TABLE pending_second(id TEXT);\n--> statement-breakpoint\nINSERT INTO missing_table VALUES(1);');assert.throws(()=>open(config),/missing_table/);
 const raw=new DatabaseSync(config.filename);try{assert.equal(raw.prepare('SELECT value FROM records').get().value,'retained');assert.equal(raw.prepare('SELECT COUNT(*) n FROM '+LOCAL_MIGRATIONS_TABLE).get().n,1);assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'pending_%'").get().n,0);}finally{raw.close();}
});

test('migration statements cannot escape the transaction or silently skip trailing SQL',async t=>{
 for(const sql of ['CREATE TABLE escaped(id TEXT); COMMIT;','COMMIT;','BEGIN;','ATTACH DATABASE \'other.sqlite\' AS other;']) {
  const directory=path.join(temporary(t),'case');mkdirSync(directory);const config=fixtures(directory,[sql]);assert.throws(()=>open(config));
  const raw=new DatabaseSync(config.filename);try{assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,0);}finally{raw.close();}
 }
});

test('unknown existing database and missing migration files are rejected without adopting auth data',t=>{
 const directory=temporary(t),config=fixtures(directory);mkdirSync(path.dirname(config.filename),{recursive:true});const raw=new DatabaseSync(config.filename);raw.exec("CREATE TABLE users(email TEXT); INSERT INTO users VALUES('existing-owner@example.test');");raw.close();const before=readFileSync(config.filename);
 assert.throws(()=>open(config),/not a migration-managed/);assert.deepEqual(readFileSync(config.filename),before);
 const fresh=fixtures(path.join(directory,'fresh'));rmSync(path.join(fresh.migrationsDirectory,'0000_test.sql'));assert.throws(()=>open(fresh));assert.equal(existsSync(fresh.filename),false);
});

test('actual accounts, authenticated sessions, imported attendance, ledger, auctions and bids survive restart',async t=>{
 const directory=temporary(t),migrationsDirectory=path.join(directory,'migrations');cpSync(projectMigrations,migrationsDirectory,{recursive:true});const config={filename:path.join(directory,'guild.sqlite'),migrationsDirectory};let DB=open(config);
 const call=async(route,method='GET',body,auth)=>{
  const headers={};if(method!=='GET'){headers.origin='https://guild.test';headers['content-type']='application/json';}if(auth){headers.cookie=auth.cookie;headers['x-csrf-token']=auth.csrfToken;}
  const response=await handleApi(new Request('https://guild.test'+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB});return {status:response.status,body:await response.json(),headers:response.headers};
 };
 const register=await call('/api/register','POST',{email:'owner@guild.test',name:'Owner',password:'correct horse battery staple'});assert.equal(register.status,201,JSON.stringify(register.body));const auth={...register.body,cookie:register.headers.get('set-cookie').split(';')[0]};assert.equal(auth.user.role,'admin');
 const raid=await call('/api/raids','POST',{name:'Persistent raid',date:'2026-11-11',rate:5},auth);assert.equal(raid.status,201);
 const text=['Alpha','85','Cleric','Raider','','11/11/26','Guild Hall','','','on','off','','','',''].join('\t')+'\n';
 const imported=await call('/api/raids/'+raid.body.raid.id+'/import','POST',{files:[{name:'DemoGuild_test-20261111-180515.txt',text}],commit:true},auth);assert.equal(imported.status,200,JSON.stringify(imported.body));
 const character=(await call('/api/characters','GET',undefined,auth)).body.characters.find(c=>c.name==='Alpha');const claim=await call('/api/claims','POST',{characterId:character.id},auth);assert.equal(claim.status,201);assert.equal((await call('/api/claims/'+claim.body.claim.id+'/approve','POST',{kind:'main'},auth)).status,200);
 DB.raw.prepare('INSERT INTO item_references(item_id,name,classes_json,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?,?,?)').run(1,'Persistence Test Ring','["ALL"]','https://items.eqresource.com/items.php?id=1',new Date().toISOString(),'test fixture','verified_reference');
 const auctionCall=async(route,method='GET',body)=>{const response=await handleAuctionApi(new Request('https://guild.test'+route,{method,headers:{origin:'https://guild.test','content-type':'application/json','x-csrf-token':auth.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},auth);return {status:response.status,body:await response.json()};};
 const auction=await auctionCall('/api/auctions','POST',{itemId:1,quantity:1});assert.equal(auction.status,201,JSON.stringify(auction.body));assert.equal((await auctionCall('/api/auctions/'+auction.body.auction.id+'/bid','PUT',{amount:5})).status,200);
 const snapshot=()=>Object.fromEntries(['users','sessions','ticks','attendance','ledger','auctions','auction_bids','audit'].map(table=>[table,DB.raw.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));const before=snapshot();DB.close();DB=open(config);
 try {
  assert.deepEqual(snapshot(),before);assert.equal((await call('/api/me','GET',undefined,auth)).body.user.id,auth.user.id);
  const login=await call('/api/login','POST',{email:'owner@guild.test',password:'correct horse battery staple'});assert.equal(login.status,200);assert.equal(login.body.user.role,'admin');
  assert.equal((await call('/api/dashboard','GET',undefined,auth)).body.balance,5);const saved=await auctionCall('/api/auctions/'+auction.body.auction.id);assert.equal(saved.body.auction.ownBid.amount,5);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n,1);
 }finally{DB.close();}
});

test('local server validates binding inputs and fails before listening if migrations fail',async t=>{
 assert.equal(configuredPort(),Number(process.env.PORT??4173));assert.equal(configuredPort('4400'),4400);for(const value of ['0','65536','NaN','1.5','-1',' 4173'])assert.throws(()=>configuredPort(value));
 assert.equal(requestOrigin('localhost:4173',4173),'http://localhost:4173');assert.equal(requestOrigin('127.0.0.1:4173',4173),'http://127.0.0.1:4173');assert.equal(requestOrigin('localhost',80),'http://localhost');assert.equal(requestOrigin('localhost:80',80),'http://localhost');for(const value of ['evil.test:4173','localhost.evil.test:4173','localhost:9999','user@localhost:4173','[::1]:4173','localhost'])assert.equal(requestOrigin(value,4173),null);
 const config=fixtures(temporary(t),['NOT VALID SQL;']);await assert.rejects(createLocalServer({databasePath:config.filename,migrationsDirectory:config.migrationsDirectory,worker:{fetch:()=>new Response('ok')}}));
});

test('HTTP bridge bounds uploads, rejects rebinding targets, strips spoofed proxy addresses and preserves cookies',async t=>{
 const config=fixtures(temporary(t));let seen;
 const app=await createLocalServer({databasePath:config.filename,migrationsDirectory:config.migrationsDirectory,port:4173,worker:{async fetch(request,env){seen={request,env};return new Response('ok',{headers:[['Set-Cookie','a=one'],['Set-Cookie','b=two']]});}},logger:{error(){}}});
 const dispatch=async(url='/',headers={},chunks=[])=>{const incoming=Readable.from(chunks);Object.assign(incoming,{url,method:chunks.length?'POST':'GET',headers:{host:'localhost:4173',...headers},socket:{remoteAddress:'127.0.0.1'}});let status,responseHeaders,body;const outgoing={headersSent:false,writeHead(code,values){status=code;responseHeaders=values;this.headersSent=true;},end(value){body=value;},destroy(){}};await app.server.listeners('request')[0](incoming,outgoing);return {status,headers:responseHeaders,body};};
 try {
  let response=await dispatch('/api/test',{'x-forwarded-host':'evil.test','x-forwarded-proto':'https','x-forwarded-for':'9.9.9.9','cf-connecting-ip':'8.8.8.8'});assert.equal(response.status,200);assert.equal(seen.request.url,'http://localhost:4173/api/test');assert.equal(seen.request.headers.get('cf-connecting-ip'),'127.0.0.1');assert.equal(seen.request.headers.get('x-forwarded-for'),null);assert.deepEqual(response.headers['set-cookie'],['a=one','b=two']);assert.equal(seen.env.LOCAL_STORAGE.persistent,true);
  for(const [url,headers]of [['/',{host:'evil.test:4173'}],['//evil.test/',{}],['/\\evil.test/',{}],['http://evil.test/',{}]])assert.equal((await dispatch(url,headers)).status,400);
  assert.equal((await dispatch('/',{'content-length':String(MAX_REQUEST_BYTES+1)})).status,413);assert.equal((await dispatch('/',{},[Buffer.alloc(MAX_REQUEST_BYTES),Buffer.from('x')])).status,413);
  assert.equal((await dispatch('/api/catalog/import',{},[Buffer.alloc(MAX_REQUEST_BYTES+1)])).status,200);
  assert.equal((await dispatch('/api/items/lookup',{},[Buffer.alloc(MAX_REQUEST_BYTES+1)])).status,413);
  assert.equal((await dispatch('/api/catalog/import',{'content-length':String(32*1024*1024+65537)},[Buffer.from('x')])).status,413);
 }finally{await app.close();}
});
