import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createD1} from './d1-adapter.mjs';
import {createSpellNamesService,parseSpellNamesCsv,SPELL_NAMES_SOURCE,SPELL_NAMES_LIMITS,getSpellNamesStatus} from '../worker/spell-names.mjs';
const schema=readFileSync(new URL('../worker/spell-names.sql',import.meta.url),'utf8');
// Constructed miniature CSV. The three names/IDs were verified against the
// maintainer-linked Raidloot export; this is not the complete downloaded file.
const csv='"id","group","icon","name","slots"\r\n"3660","0","19","Faerune","1: See Invisible|2: Ultravision|3: Enduring Breath"\r\n"9612","0","2","Improved Dodge V","1: Increase Chance to Dodge by 50%"\r\n"23395","0","89","Prismatic Ward VIII","fixture"\r\n"33156","0","161","Corruption Damage 40-70 L100","fixture"\r\n';
const response=(text=csv)=>new Response(gzipSync(text),{headers:{'last-modified':'Wed, 12 Jul 2023 06:15:07 GMT'}});
const item=(id=3660,name=null)=>({itemId:105313,stats:{ac:42},details:{effects:['Worn: Spell #'+id],effectRecords:[{kind:'worn',spellId:id,name}]}});
function db(t){const DB=createD1(schema);t.after(()=>DB.close());return DB;}
const count=DB=>DB.raw.prepare('SELECT COUNT(*) n FROM spell_name_entries').get().n;
const ctx={user:{id:'admin',role:'admin'},csrfToken:'csrf'};
const request=(method='GET',headers={},body)=>new Request('https://guild.test/api/catalog/spell-names'+(method==='POST'?'/refresh':''),{method,headers:{origin:'https://guild.test','x-csrf-token':'csrf',...headers},...(body?{body}:{})});

test('strict CSV parser handles commas, escaped quotes and multiline descriptions but rejects ambiguous identities',()=>{
 const parsed=parseSpellNamesCsv('id,group,icon,name,slots\r\n1,0,2,"Name, ""Quoted""","line1\nline2"\r\n');assert.equal(parsed.entries[0].name,'Name, "Quoted"');
 for(const bad of ['<html>blocked</html>','id,name,group,icon\n1,Name,0\n','id,name,group,icon\n1,Name,0,2\n1,Other,0,2\n','id,name,group,icon\n1,"Name,0,2\n','id,name,group,icon\n1,"Name"x,0,2\n','id,name,group,icon\n0,Name,0,2\n'])assert.throws(()=>parseSpellNamesCsv(bad));
 assert.equal(parseSpellNamesCsv(csv).rowCount,4);
});

test('quoted records enforce incremental UTF8 byte bounds before EOF or a closing quote',()=>{
 const prefix='"id","name","desc","x"\n"1","A","';
 for(const suffix of ['', '","x"\n'])assert.throws(()=>parseSpellNamesCsv(prefix+'x'.repeat(8*1024*1024)+suffix),/record is too large/);
 assert.throws(()=>parseSpellNamesCsv(prefix+'😀'.repeat(40000)),/record is too large/);
 assert.throws(()=>parseSpellNamesCsv(prefix+'""'.repeat(70000)),/record is too large/);
});

test('first missing name fills from one allowlisted download; later service instances use persistent cache',async t=>{
 const DB=db(t);let calls=0;const service=createSpellNamesService({fetchImpl:async(url,options)=>{calls++;assert.equal(url,SPELL_NAMES_SOURCE);assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');return response();}});
 const result=await service.enrichItem(DB,item());assert.equal(result.details.effects[0],'Worn: Faerune');assert.deepEqual(result.stats,{ac:42});assert.equal(result.details.effectRecords[0].nameSource.sourceModifiedAt,'2023-07-12T06:15:07.000Z');assert.equal(count(DB),4);assert.equal(calls,1);
 const second=createSpellNamesService({fetchImpl:()=>{throw Error('Must use persisted cache');}});assert.equal((await second.enrichItem(DB,item(9612))).details.effects[0],'Worn: Improved Dodge V');assert.equal(calls,1);
 const status=await getSpellNamesStatus(DB);assert.equal(status.entryCount,4);assert.match(status.fileSha256,/^[a-f0-9]{64}$/);assert.equal(status.sourceUrl,SPELL_NAMES_SOURCE);
});

test('supplied current item names take precedence and unknown numeric labels stay out of effects display',async t=>{
 const DB=db(t),service=createSpellNamesService({fetchImpl:async()=>response()});const provided=item(33156,"Corrupted Sylvan's Rot II");provided.details.effects=["Worn: Corrupted Sylvan's Rot II"];
 const [known,current,unknown]=await service.enrichItems(DB,[item(23395),provided,item(999999)]);assert.deepEqual(known.details.effects,['Worn: Prismatic Ward VIII']);assert.deepEqual(current.details.effects,["Worn: Corrupted Sylvan's Rot II"]);assert.equal(current.details.effectRecords[0].name,"Corrupted Sylvan's Rot II");assert.deepEqual(unknown.details.effects,[]);assert.equal(unknown.details.effectRecords[0].spellId,999999);assert.equal(unknown.stats.ac,42);
});

test('parallel first reads coalesce and independent databases do not share persisted names',async t=>{
 const a=db(t),b=db(t);let calls=0,release;const gate=new Promise(resolve=>release=resolve);const service=createSpellNamesService({fetchImpl:async()=>{calls++;await gate;return response();}});
 const first=service.enrichItem(a,item()),second=service.enrichItem(a,item(9612));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal(count(a),4);assert.equal(count(b),0);await service.enrichItem(b,item());assert.equal(calls,2);
});

test('new guarded wrappers share stable cache key for coalescing and failed-download backoff',async t=>{
 const DB=db(t),wrap=()=>({prepare:DB.prepare.bind(DB),batch:DB.batch.bind(DB)});let calls=0,release;const gate=new Promise(resolve=>release=resolve);const service=createSpellNamesService({fetchImpl:async()=>{calls++;await gate;return response();}});
 const a=service.enrichItem(wrap(),item(),{cacheKey:DB}),b=service.enrichItem(wrap(),item(9612),{cacheKey:DB});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);release();await Promise.all([a,b]);
 DB.raw.exec('DELETE FROM spell_name_entries;DELETE FROM spell_name_cache;');let failures=0;const offline=createSpellNamesService({fetchImpl:()=>{failures++;throw Error('offline');}});await offline.enrichItem(wrap(),item(),{cacheKey:DB});await offline.enrichItem(wrap(),item(),{cacheKey:DB});assert.equal(failures,1);const status=await offline.handleSpellNamesApi(request(),{DB:wrap(),SPELL_CACHE_KEY:DB},ctx);assert.ok((await status.json()).retryAfter);
});

test('legacy cached DTOs reconstruct exact effect IDs and preserve supplied names from retained raw fields',async t=>{
 const DB=db(t),service=createSpellNamesService({fetchImpl:async()=>response()});const cached={stats:{hp:123},details:{fields:[{label:'worneffect',value:'3660'},{label:'wornname',value:''},{label:'focuseffect',value:'33156'},{label:'focusname',value:"Corrupted Sylvan's Rot II"}],effects:['Worn: Spell #3660']}};
 const result=await service.enrichItem(DB,cached);assert.deepEqual(result.details.effects,['Worn: Faerune',"Focus: Corrupted Sylvan's Rot II"]);assert.equal(result.stats.hp,123);assert.equal(result.details.effectRecords[0].spellId,3660);
});

test('network failure renders original stats, hides unnamed labels, backs off and officer retry bypasses backoff',async t=>{
 const DB=db(t);let calls=0,time=10000,working=false;const service=createSpellNamesService({clock:()=>time,fetchImpl:async()=>{calls++;if(!working)throw Error('offline');return response();}});
 for(let n=0;n<3;n++){const result=await service.enrichItem(DB,item());assert.deepEqual(result.stats,{ac:42});assert.deepEqual(result.details.effects,[]);}assert.equal(calls,1);assert.equal(count(DB),0);
 working=true;const r=await service.handleSpellNamesApi(request('POST'),{DB},ctx);assert.equal(r.status,200);assert.equal(calls,2);assert.equal((await service.enrichItem(DB,item())).details.effects[0],'Worn: Faerune');
 time+=300001;assert.equal((await service.handleSpellNamesApi(request(),{DB},ctx)).status,200);
});

test('timeouts, redirects, malformed gzip and actual byte bounds fail softly without following other sources',async t=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.invalid/data'}}),async()=>new Response('not gzip'),async()=>new Response(gzipSync('not CSV')),async()=>new Response(new Uint8Array(SPELL_NAMES_LIMITS.compressedBytes+1))]){
  const DB=db(t),service=createSpellNamesService({fetchImpl,timeoutMs:10});const start=Date.now(),result=await service.enrichItem(DB,item());assert.ok(Date.now()-start<500);assert.deepEqual(result.details.effects,[]);assert.equal(count(DB),0);
 }
});

test('refresh is atomic, rolls back rows and provenance together and retains cached names on source failure',async t=>{
 const DB=db(t);let source=csv;const service=createSpellNamesService({fetchImpl:async()=>response(source)});await service.refreshSpellNames(DB);const before=await getSpellNamesStatus(DB),batch=DB.batch.bind(DB);
 DB.batch=statements=>batch([...statements,DB.prepare('INSERT INTO table_that_does_not_exist VALUES(1)')]);source=csv.replaceAll('Faerune','Changed name');await assert.rejects(service.refreshSpellNames(DB));assert.deepEqual(await getSpellNamesStatus(DB),before);assert.equal(DB.raw.prepare('SELECT name FROM spell_name_entries WHERE spell_id=3660').get().name,'Faerune');
 assert.equal((await service.enrichItem(DB,item())).details.effects[0],'Worn: Faerune');
});

test('officer API enforces permissions, origin, CSRF, body size and has no arbitrary source parameter',async t=>{
 const DB=db(t);let source;const service=createSpellNamesService({fetchImpl:async url=>{source=url;return response();}});
 assert.equal((await service.handleSpellNamesApi(request(),{DB},{})).status,401);assert.equal((await service.handleSpellNamesApi(request(),{DB},{user:{id:'member',role:'member'}})).status,403);
 assert.equal((await service.handleSpellNamesApi(request('POST',{'x-csrf-token':'wrong'}),{DB},ctx)).status,403);assert.equal((await service.handleSpellNamesApi(request('POST',{origin:'https://evil.invalid'}),{DB},ctx)).status,403);
 assert.equal((await service.handleSpellNamesApi(request('POST',{},'x'.repeat(4097)),{DB},ctx)).status,413);
 const r=await service.handleSpellNamesApi(request('POST',{},JSON.stringify({url:'http://localhost:9999/private'})),{DB},ctx);assert.equal(r.status,200);assert.equal(source,SPELL_NAMES_SOURCE);assert.equal(count(DB),4);
});

test('large reference cache uses bounded JSON batches instead of individual insert statements',async t=>{
 const DB=db(t);let statements=0;const batch=DB.batch.bind(DB);DB.batch=rows=>{statements+=rows.length;for(const row of rows)for(const param of row.params)if(typeof param==='string')assert.ok(Buffer.byteLength(param)<=SPELL_NAMES_LIMITS.chunkBytes);return batch(rows);};
 const large='id,group,icon,name\n'+Array.from({length:10000},(_,i)=>(i+1)+',0,1,Fixture '+i).join('\n');const service=createSpellNamesService({fetchImpl:async()=>response(large)});await service.refreshSpellNames(DB);assert.equal(count(DB),10000);assert.ok(statements<10);
});
