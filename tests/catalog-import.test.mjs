import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import * as catalog from '../worker/catalog-import.mjs';
import {createItemApi} from '../worker/items.mjs';
import {createLootApi} from '../worker/loot.mjs';

// Small constructed fixture using the provider's real header names. This is not
// a copy of the complete private downloaded catalog.
const columns=['itemclass','id','name','classes','races','slots','ac','hp','mana','endurance','icon','weight','magic','nodrop','norent','loregroup','astr','heroic_str','focuseffect','focusname','worneffect','wornname','augslot1type','augslot1visible','updated','verified','UNK217'];
const row=(id,name,extra={})=>columns.map(key=>String(({itemclass:0,id,name,classes:15360,races:65535,slots:131072,ac:10,hp:0,mana:40,endurance:0,icon:929,weight:35,magic:1,nodrop:1,norent:1,loregroup:-1,astr:8,heroic_str:0,focuseffect:-1,focusname:'',worneffect:-1,wornname:'',augslot1type:7,augslot1visible:1,updated:'2021-09-18 12:55:45',verified:'2026-10-22 03:34:45',UNK217:'unknown retained',...extra})[key]).replaceAll('|','\\|')).join('|');
const text=(rows)=>columns.join('|')+'\n'+rows.join('\n')+'\n';
const file=(rows,name='items.txt',gzip=false)=>new File([gzip?gzipSync(text(rows)):text(rows)],name);
const context={user:{id:'admin',role:'admin'},csrfToken:'csrf'};
async function harness(t){const DB=createD1(await applicationSchema());t.after(()=>DB.close());DB.raw.prepare("INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('admin','a@test.invalid','Admin','x','x','admin','2026-11-12T00:00:00Z')").run();return DB;}
const upload=(DB,f,revision=0)=>catalog.importCatalogFile(DB,f,{userId:'admin',expectedRevision:revision,sourceDate:'2026-11-08'});
const count=(DB,table)=>DB.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n;
function post(path,body){return new Request('https://guild.test'+path,{method:'POST',headers:{origin:'https://guild.test','x-csrf-token':'csrf','content-type':'application/json'},body:JSON.stringify(body)});}

test('headered escaped pipes preserve names, backslashes, empty and unknown fields',()=>{
 const header=catalog.parseCatalogHeader(columns.join('|'));
 const parsed=catalog.parseCatalogRow(row(12797,"Iksar Right Hand '=|-'",{UNK217:'literal\\x'}),header);
 assert.equal(parsed.name,"Iksar Right Hand '=|-'");
 assert.deepEqual(catalog.splitCatalogRecord('a\\|b||literal\\x'),['a|b','','literal\\x']);
 assert.throws(()=>catalog.parseCatalogHeader(columns.join('|')+'|NAME'),/headered/);
 assert.throws(()=>catalog.parseCatalogRow(row(1,'Ring')+'|extra',header),/field count/);
 assert.throws(()=>catalog.parseCatalogRow(row(-1,'Ring'),header),/Item ID/);
});

test('plain and gzip imports activate complete catalogs, retain all values and hydrate only selected IDs',async t=>{
 const DB=await harness(t);const source=file([row(1608,"Froglok Bonecaster's Robe"),row(81773,'Blood of the Dhampyre',{classes:65535,slots:2048,hp:2006,mana:1984,endurance:1984,ac:104,focuseffect:33156,focusname:"Corrupted Sylvan's Rot II",worneffect:9612,icon:1557})],'items.txt.gz',true);
 const result=await upload(DB,source);assert.equal(result.itemCount,2);assert.equal(result.active.fieldCount,columns.length);assert.equal(result.revision,1);assert.equal(count(DB,'item_references'),0);
 const robe=await catalog.getCatalogItem(DB,1608);assert.deepEqual(robe.classes,['NEC','WIZ','MAG','ENC']);assert.deepEqual(robe.slots,['CHEST']);assert.equal(robe.stats.weight,3.5);assert.equal(robe.details.fields.find(f=>f.label==='UNK217').value,'unknown retained');assert.equal(robe.iconUrl,null);assert.equal(robe.iconId,929);assert.equal(robe.sourceStatus.status,'uploaded');
 const blood=await catalog.hydrateCatalogItem(DB,81773);assert.deepEqual(blood.details.effects,['Worn: Spell #9612',"Focus: Corrupted Sylvan's Rot II"]);assert.equal(blood.details.effectRecords[1].spellId,33156);assert.equal(blood.details.augmentSlots[0].type,7);assert.equal(count(DB,'item_references'),1);
 const repeat=await upload(DB,source,0);assert.equal(repeat.alreadyImported,true);assert.equal(repeat.revision,1);assert.equal(count(DB,'audit'),1);
 const replacement=await upload(DB,file([row(1608,"Froglok Bonecaster's Robe",{mana:45})]),1);assert.equal(replacement.revision,2);assert.equal((await catalog.getCatalogItem(DB,1608)).stats.mana,45);assert.equal(await catalog.getCatalogItem(DB,81773),null);assert.equal(count(DB,'item_references'),1);assert.equal(count(DB,'ledger'),0);
});

test('exact name matching preserves prefixes and exposes duplicate exact names',async t=>{
 const DB=await harness(t);await upload(DB,file([row(1608,"Froglok Bonecaster's Robe"),row(82707,"Fabled Froglok Bonecaster's Robe"),row(146278,"Darkened Froglok Bonecaster's Robe"),row(12798,"Iksar Left Hand '=|-'"),row(12799,"Iksar Left Hand '=|-'")]));
 const found=await catalog.searchCatalogItems(DB,{q:"froglok bonecaster's robe",exact:true});assert.deepEqual(found.items.map(i=>i.itemId),[1608]);
 assert.equal((await catalog.searchCatalogItems(DB,{q:"Iksar Left Hand '=|-'",exact:true})).total,2);
 assert.equal((await catalog.searchCatalogItems(DB,{q:'Robe',classCode:'WAR'})).total,0);
});

test('malformed, duplicate, invalid UTF8 and invalid gzip uploads leave the active catalog intact',async t=>{
 const DB=await harness(t);await upload(DB,file([row(1,'Original')]));
 for(const bad of [new File([text([row(2,'Good'),'bad'])],'bad.txt'),file([row(2,'Duplicate'),row(2,'Duplicate')]),new File([new Uint8Array([255,254])],'bad.txt'),new File(['not gzip'],'bad.gz')]){
  await assert.rejects(upload(DB,bad,1));assert.equal((await catalog.getCatalogStatus(DB)).revision,1);assert.equal((await catalog.getCatalogItem(DB,1)).name,'Original');assert.equal(count(DB,'catalog_items'),1);
 }
 await assert.rejects(upload(DB,file([row(4,'Later')]),0),e=>e.code==='catalog_conflict');assert.equal(count(DB,'audit'),1);
});

test('archived same-file activation is immutable and cannot delete active rows during another activation',async t=>{
 const DB=await harness(t),a=file([row(1,'A')]),b=file([row(2,'B')]);await upload(DB,b);await upload(DB,a,1);
 const batch=DB.batch.bind(DB);let raced=false;DB.batch=async statements=>{if(!raced&&statements.some(s=>s.query.startsWith('UPDATE catalog_state'))){raced=true;await upload(DB,b,2);}return batch(statements);};
 await assert.rejects(upload(DB,b,2),e=>e.code==='catalog_conflict');assert.equal((await catalog.getCatalogStatus(DB)).revision,3);assert.equal((await catalog.getCatalogItem(DB,2)).name,'B');assert.equal(count(DB,'catalog_items'),2);
});

test('failed same-file retries require attempt ownership and stale import failure never deletes active rows',async t=>{
 const DB=await harness(t),b=file([row(2,'B')]);await upload(DB,b);await upload(DB,file([row(1,'A')]),1);
 DB.raw.prepare("UPDATE catalog_imports SET status='failed' WHERE status='archived'").run();
 const batch=DB.batch.bind(DB);let raced=false;DB.batch=async statements=>{if(!raced&&statements.some(s=>s.query.startsWith('UPDATE catalog_imports SET header_json'))){raced=true;await upload(DB,b,2);}return batch(statements);};
 await assert.rejects(upload(DB,b,2),e=>e.code==='catalog_conflict');assert.equal((await catalog.getCatalogItem(DB,2)).name,'B');assert.equal((await catalog.getCatalogStatus(DB)).revision,3);
});

test('catalog upload enforces role, CSRF and actual multipart stream byte limits without trusting headers',async t=>{
 const DB=await harness(t),api=catalog.createCatalogApi();
 assert.equal((await api(new Request('https://guild.test/api/catalog'),{DB},{user:{id:'admin',role:'member'}})).status,403);
 assert.equal((await api(post('/api/catalog/import',{}),{DB},{...context,csrfToken:'other'})).status,403);
 for(const contentLength of [null,'1']){let canceled=false,sent=0;const chunk=new Uint8Array(1024*1024);const body=new ReadableStream({pull(c){sent++;c.enqueue(chunk);},cancel(){canceled=true;}});const headers={origin:'https://guild.test','x-csrf-token':'csrf','content-type':'multipart/form-data; boundary=test'};if(contentLength)headers['content-length']=contentLength;
  const response=await api(new Request('https://guild.test/api/catalog/import',{method:'POST',headers,body,duplex:'half'}),{DB},context);assert.equal(response.status,413);assert.equal((await response.json()).code,'catalog_too_large');assert.equal(canceled,true);assert.ok(sent<40);
 }
 const form=new FormData();form.set('file',file([row(1,'Uploaded')]));form.set('expectedRevision','0');const r=await api(new Request('https://guild.test/api/catalog/import',{method:'POST',headers:{origin:'https://guild.test','x-csrf-token':'csrf'},body:form}),{DB},context);assert.equal(r.status,200);assert.equal((await r.json()).itemCount,1);
});

test('file-only item and loot APIs ignore all remote callbacks and use active uploaded IDs',async t=>{
 const DB=await harness(t);await upload(DB,file([row(1608,"Froglok Bonecaster's Robe"),row(82707,"Fabled Froglok Bonecaster's Robe"),row(12798,'Twin Ring'),row(12799,'Twin Ring')]));let calls=0;const remote=()=>{calls++;throw Error('Remote callbacks must be unreachable');};
 const items=createItemApi({fileOnly:true,catalog,fetchItemDetails:remote,searchItemsByName:remote});
 let r=await items(post('/api/items/search',{name:"Froglok Bonecaster's Robe"}),{DB},context);assert.equal(r.status,200);assert.equal((await r.json()).item.itemId,1608);
 const loot=createLootApi({fileOnly:true,catalog,fetchItemDetails:remote,searchItemsByName:remote,cacheItemDetails:remote,knownItems:[{itemId:99,name:'Fake seed'}]});
 r=await loot(post('/api/loot/drafts',{bossName:'Boss',text:"Froglok Bonecaster's Robe\nTwin Ring\nUnknown Ring"}),{DB},context);assert.equal(r.status,201);let draft=(await r.json()).draft;assert.equal(draft.items[0].itemId,1608);assert.equal(draft.items[1].matchStatus,'ambiguous');assert.equal(draft.items[2].matchStatus,'unmatched');
 r=await loot(post('/api/loot/drafts/'+draft.id+'/match',{expectedRevision:draft.revision}),{DB},context);assert.equal(r.status,200);draft=(await r.json()).draft;assert.equal(draft.items[1].matchStatus,'ambiguous');assert.equal(calls,0);assert.equal(await catalog.getCatalogItem(DB,99),null);assert.equal(count(DB,'auctions'),0);assert.equal(count(DB,'ledger'),0);
 const missing=createItemApi({fileOnly:true,fetchItemDetails:remote,searchItemsByName:remote});assert.equal((await missing(post('/api/items/search',{name:'Ring'}),{DB},context)).status,503);assert.equal(calls,0);
});



test('HTTP catalog search finds loot beyond the first 100 with compact DTOs while detail reads retain every field',async t=>{
 const DB=await harness(t),rows=[];for(let n=0;n<140;n++)rows.push(row(10000+n,'A junk '+n,{UNK217:'x'.repeat(1000)}));rows.push(row(99999,'Zulu Raid Reward',{UNK217:'x'.repeat(1000),hp:500}));await upload(DB,file(rows));
 const api=createItemApi({catalog,fileOnly:true});let response=await api(new Request('https://guild.test/api/items?q=Zulu&limit=20'),{DB},context);assert.equal(response.status,200);let data=await response.json();assert.equal(data.total,1);assert.equal(data.items[0].itemId,99999);assert.equal(data.items[0].details,undefined);assert.equal(data.items[0].stats,undefined);assert.ok(JSON.stringify(data).length<2500);
 response=await api(new Request('https://guild.test/api/items?q=A+junk&limit=20'),{DB},context);data=await response.json();assert.equal(data.items.length,20);assert.equal(data.total,140);assert.ok(JSON.stringify(data).length<16000,JSON.stringify(data).length);assert.ok(data.items.every(item=>item.advancedLoot&&item.slots.includes('CHEST')));
 response=await api(new Request('https://guild.test/api/items/99999'),{DB},context);data=await response.json();assert.equal(data.item.stats.hp,500);assert.equal(data.item.details.fields.find(field=>field.label==='UNK217').value.length,1000);
 assert.equal(count(DB,'item_references'),0);assert.equal(count(DB,'ledger'),0);
});
