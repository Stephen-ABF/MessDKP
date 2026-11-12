import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createD1} from './d1-adapter.mjs';
import {createLootApi,parseLootSources} from '../worker/loot.mjs';
import {createAuctionApi} from '../worker/auctions.mjs';
import {ITEM_REFERENCE_SCHEMA_SQL} from '../worker/items.mjs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const initial=Date.parse('2026-11-12T18:00:00.000Z');
const candidate=(itemId,name,match='exact')=>({itemId,name,match,sourceUrl:`https://items.eqresource.com/items.php?id=${itemId}`});
function harness(dependencies={}){
 const DB=createD1(read('../worker/schema.sql')+'\n'+read('../worker/admin.sql')+'\n'+ITEM_REFERENCE_SCHEMA_SQL+'\n'+read('../worker/auctions.sql')+'\n'+read('../worker/loot.sql'));
 let time=initial;const users={},errors=[];
 for(const[key,role]of[['officer','admin'],['alice','member'],['bob','member']]){
  const user={id:key,name:key,email:`${key}@test.invalid`,role};users[key]=user;
  DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(key,user.email,key,'test','test',role,new Date(time).toISOString());
  DB.raw.prepare('INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`char-${key}`,key,key,125,'Cleric','Raider','main',key,new Date(time).toISOString());
 }
 DB.raw.prepare('INSERT INTO raids(id,name,date,rate,created_by,created_at) VALUES(?,?,?,?,?,?)').run('raid-1','Fixture raid','2026-11-12',5,'officer',new Date(time).toISOString());
 const ref=(id,name,status='verified_reference')=>DB.raw.prepare('INSERT INTO item_references(item_id,name,classes_json,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET name=excluded.name,metadata_status=excluded.metadata_status').run(id,name,'["ALL"]',`https://items.eqresource.com/items.php?id=${id}`,new Date(time).toISOString(),'test fixture',status);
 ref(1,'Sample Ring');ref(2,'Sample Cloak');
 const cacheItemDetails=async(db,item)=>ref(item.itemId,item.name,item.metadataStatus??'verified_reference');
 const api=createLootApi({clock:()=>time,cacheItemDetails,...dependencies}),auctionApi=createAuctionApi({clock:()=>time});
 const batch=DB.batch.bind(DB);DB.batch=async statements=>{try{return await batch(statements);}catch(error){errors.push(String(error));throw error;}};
 return{DB,users,ref,errors,auctionApi,setTime(value){time=value;},get time(){return time;},async call(path,method='GET',data,user=users.officer,extra={},handler=api){
  const headers={...extra};if(method!=='GET'){headers.origin??='https://guild.test';headers['x-csrf-token']??='test-csrf';if(data!==undefined)headers['content-type']='application/json';}
  const response=await handler(new Request('https://guild.test'+path,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),{DB},{user,csrfToken:'test-csrf'});
  return response?{status:response.status,body:await response.json(),errors:[...errors]}:null;
 },close(){DB.close();}};
}
async function create(h,text='Sample Ring\nSample Cloak',extra={}){const r=await h.call('/api/loot/drafts','POST',{bossName:'Fixture Boss',text,...extra});assert.equal(r.status,201,JSON.stringify(r));return r.body.draft;}
async function publish(h,draft){return h.call(`/api/loot/drafts/${draft.id}/publish`,'POST',{expectedRevision:draft.revision});}
const count=(h,table)=>h.DB.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

test('plain name import aggregates explicit quantities while retaining every source line',()=>{
 const text='  2 x Sample Ring  \r\nSample Ring (x3)\n\nSAMPLE   RING\nSample Cloak';
 const parsed=parseLootSources({text});assert.equal(parsed.totalPieces,7);assert.equal(parsed.rows.length,2);assert.equal(parsed.rows[0].quantity,6);assert.equal(parsed.rows[0].normalizedName,'sample ring');assert.deepEqual(parsed.rows[0].rawLines.map(r=>r.lineNumber),[1,2,4]);assert.equal(parsed.rows[0].rawLines[0].text,'  2 x Sample Ring  ');assert.equal(parsed.sources[0].text,text);
 const many=parseLootSources({text:Array.from({length:60},(_,n)=>`Fixture Item ${n}`).join('\n')});assert.equal(many.totalPieces,60);
});
test('direct Advanced Loot IDs and source URLs preserve evidence and do not infer game chat loot',()=>{
 const parsed=parseLootSources({files:[{name:'loot.txt',text:'81773^1349^Blood of Dhampyre\nhttps://items.eqresource.com/items.php?id=44354\n81773^1349^Blood of Dhampyre',format:'log'}]});
 assert.equal(parsed.rows[0].itemId,81773);assert.equal(parsed.rows[0].name,'Blood of Dhampyre');assert.equal(parsed.rows[0].quantity,2);assert.equal(parsed.rows[1].name,'EQ Item 44354');
 const chat=parseLootSources({format:'log',text:'[Wed Nov 11 20:00:00 2026] Alice says, hello\nSample Ring'});assert.ok(chat.rows.every(r=>r.matchStatus==='needs_review'));assert.equal(chat.rows[0].rawLines[0].lineNumber,1);
 assert.equal(parseLootSources({text:'[Wed Nov 11 20:00:00 2026] Alice has looted a Sample Ring'}).rows[0].matchStatus,'needs_review');
 const longLine='[Wed Nov 11 20:00:00 2026] '+('long chat text '.repeat(100));const long=parseLootSources({format:'log',text:longLine});assert.equal(long.rows[0].name.length,250);assert.equal(long.rows[0].rawLines[0].text,longLine);
 assert.throws(()=>parseLootSources({text:'https://evil.test/items.php?id=1'}),/exact HTTPS/);
 assert.throws(()=>parseLootSources({text:'https://items.eqresource.com/items.php?id=1&extra=2'}),/exact HTTPS/);
});
test('import limits are explicit and larger boss batches are accepted without truncation',()=>{
 assert.throws(()=>parseLootSources({text:'51 x Ring'}),/quantity/);
 assert.throws(()=>parseLootSources({text:'50 x Ring\nRing'}),/50 identical/);
 assert.throws(()=>parseLootSources({text:Array.from({length:201},(_,n)=>`Item ${n}`).join('\n')}),/200 nonempty/);
 assert.throws(()=>parseLootSources({text:Array.from({length:21},(_,n)=>`50 x Item ${n}`).join('\n')}),/1000 total/);
 assert.equal(parseLootSources({text:Array.from({length:20},(_,n)=>`50 x Item ${n}`).join('\n')}).totalPieces,1000);
});
test('officer-only drafts require origin and CSRF, retain sources, and have no publication side effects',async()=>{const h=harness();try{
 assert.equal((await h.call('/api/loot/drafts','POST',{bossName:'Boss',text:'Ring'},h.users.alice)).status,403);
 assert.equal((await h.call('/api/loot/drafts','POST',{bossName:'Boss',text:'Ring'},h.users.officer,{origin:'https://evil.test'})).status,403);
 assert.equal((await h.call('/api/loot/drafts','POST',{bossName:'Boss',text:'Ring'},h.users.officer,{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await h.call('/api/loot/drafts','GET',undefined,null)).status,401);
 const d=await create(h,'2 x Sample Ring\nSample Cloak',{raidId:'raid-1'});assert.equal(d.totalPieces,3);assert.equal(d.readyToPublish,true);assert.equal(d.items[0].matchStatus,'matched');assert.equal(d.sources[0].text,'2 x Sample Ring\nSample Cloak');assert.equal(count(h,'auctions'),0);assert.equal(count(h,'ledger'),0);
 assert.equal((await h.call(`/api/loot/drafts/${d.id}`,'GET',undefined,h.users.alice)).status,403);
 const history=await h.call('/api/loot/items/1/history','GET',undefined,h.users.alice);assert.equal(history.body.appearanceCount,0);
 const list=await h.call('/api/loot/drafts');assert.equal(list.body.drafts[0].totalPieces,3);assert.equal(list.body.drafts[0].unresolvedCount,0);assert.equal(list.body.drafts[0].sources,undefined);
}finally{h.close();}});
test('creation key retries preserve one draft and conflict on different original input',async()=>{const h=harness();try{
 const input={bossName:'Boss',text:'Sample Ring',idempotencyKey:'fixture-create-key'};const results=await Promise.all([h.call('/api/loot/drafts','POST',input),h.call('/api/loot/drafts','POST',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].body.draft.id,results[1].body.draft.id);assert.equal(count(h,'loot_drafts'),1);assert.equal(count(h,'loot_draft_items'),1);
 assert.equal((await h.call('/api/loot/drafts','POST',{...input,text:'Sample Cloak'})).status,409);assert.equal(count(h,'loot_drafts'),1);
}finally{h.close();}});
test('known source seeds preserve richer verified cache metadata and fill only absent or unresolved references',async()=>{
 const calls=[];const h=harness({knownItems:[{itemId:1,name:'Bundled older title'},{itemId:3,name:'Known third item'},{itemId:4,name:'Known fourth item'}],cacheItemDetails:async(db,item)=>{calls.push(item.itemId);await db.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,'known source','verified_reference') ON CONFLICT(item_id) DO UPDATE SET name=excluded.name,stats_json=NULL,metadata_status='verified_reference'").bind(item.itemId,item.name,`https://items.eqresource.com/items.php?id=${item.itemId}`,new Date(initial).toISOString()).run();}});try{
  h.ref(3,'Unverified third item','unresolved');h.DB.raw.prepare('UPDATE item_references SET stats_json=? WHERE item_id=1').run('{"ac":100}');
  const d=await create(h,'Sample Ring\nKnown third item\nKnown fourth item');assert.equal(d.readyToPublish,true);assert.deepEqual(calls,[3,4]);assert.equal(h.DB.raw.prepare('SELECT name,stats_json FROM item_references WHERE item_id=1').get().stats_json,'{"ac":100}');assert.equal(d.items[0].displayName,'Sample Ring');
  await create(h,'Sample Ring');assert.deepEqual(calls,[3,4]);
 }finally{h.close();}
});
test('same final item IDs across input forms or manual matches require explicit consolidation',async()=>{const h=harness();try{
 let d=await create(h,'2 x Sample Ring\n1^1^Sample Ring');assert.equal(d.readyToPublish,false);assert.equal(d.unresolvedCount,2);assert.match(d.warnings.join(' '),/same item ID/);assert.equal((await h.call('/api/loot/drafts')).body.drafts[0].unresolvedCount,2);
 const blocked=await publish(h,d);assert.equal(blocked.status,409);assert.equal(blocked.body.code,'duplicate_item_rows');assert.equal(count(h,'auctions'),0);
 d=(await h.call(`/api/loot/drafts/${d.id}/items/${d.items[0].id}`,'PUT',{expectedRevision:d.revision,quantity:3})).body.draft;
 d=(await h.call(`/api/loot/drafts/${d.id}/items/${d.items[1].id}`,'PUT',{expectedRevision:d.revision,ignore:true})).body.draft;assert.equal(d.readyToPublish,true);const r=await publish(h,d);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.auctions.length,1);assert.equal(r.body.auctions[0].quantity,3);assert.equal(r.body.draft.items[1].rawLines[0].text,'1^1^Sample Ring');
 let manual=await create(h,'Sample Ring\nUnknown Name');manual=(await h.call(`/api/loot/drafts/${manual.id}/items/${manual.items[1].id}`,'PUT',{expectedRevision:manual.revision,itemId:1,confirm:true})).body.draft;assert.equal(manual.readyToPublish,false);assert.equal((await publish(h,manual)).body.code,'duplicate_item_rows');
 assert.equal((await h.call(`/api/loot/drafts/${manual.id}/items/${manual.items[0].id}`,'PUT',{expectedRevision:manual.revision,quantity:51})).status,400);
}finally{h.close();}});
test('unverified cache titles do not auto-match and manager selection requires confirmation',async()=>{const h=harness();try{
 h.ref(3,'Manual Ring','unresolved');let d=await create(h,'Manual Ring\nhttps://items.eqresource.com/items.php?id=99');assert.equal(d.items[0].matchStatus,'unmatched');assert.equal(d.readyToPublish,false);assert.equal((await publish(h,d)).status,409);
 assert.equal((await h.call(`/api/loot/drafts/${d.id}/items/${d.items[0].id}`,'PUT',{expectedRevision:d.revision,itemId:3})).status,400);
 d=(await h.call(`/api/loot/drafts/${d.id}/items/${d.items[0].id}`,'PUT',{expectedRevision:d.revision,itemId:3,confirm:true})).body.draft;
 assert.equal(d.items[0].matchStatus,'manual_verified');assert.equal(d.items[0].metadataStatus,'unresolved');assert.equal(d.readyToPublish,false);
 d=(await h.call(`/api/loot/drafts/${d.id}/items/${d.items[1].id}`,'PUT',{expectedRevision:d.revision,itemId:99,name:'Manager named item',confirm:true})).body.draft;assert.equal(d.readyToPublish,true);
 const result=await publish(h,d);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.auctions[1].itemName,'Manager named item');assert.equal(h.DB.raw.prepare('SELECT metadata_status FROM auctions WHERE item_id=99').get().metadata_status,'unresolved');
}finally{h.close();}});
test('unique verified source names match, ambiguous/fuzzy/paginated names stay reviewable',async()=>{
 const searchItemsByName=async name=>name==='Unique Ring'?{status:'matched',candidates:[candidate(10,name)]}:name==='Paged Ring'?{status:'ambiguous',additionalPages:true,candidates:[candidate(11,name)]}:{status:'ambiguous',candidates:[candidate(12,name),candidate(13,name)]};
 const h=harness({searchItemsByName,fetchItemDetails:async id=>({itemId:id,name:'Unique Ring',metadataStatus:'verified_reference',metadataComplete:false})});try{
 let d=await create(h,'Unique Ring\nDuplicate Ring\nPaged Ring');const result=await h.call(`/api/loot/drafts/${d.id}/match`,'POST',{expectedRevision:d.revision});assert.equal(result.status,200,JSON.stringify(result));d=result.body.draft;
 assert.deepEqual(d.items.map(i=>i.matchStatus),['matched','ambiguous','ambiguous']);assert.equal(d.items[0].itemId,10);assert.equal(d.items[1].itemId,null);assert.equal(d.items[2].itemId,null);assert.equal(d.readyToPublish,false);assert.equal(result.body.remaining,2);
 d=(await h.call(`/api/loot/drafts/${d.id}/items/${d.items[1].id}`,'PUT',{expectedRevision:d.revision,itemId:13,confirm:true})).body.draft;assert.equal(d.items[1].itemId,13);assert.equal(d.items[1].matchStatus,'manual_verified');
}finally{h.close();}});
test('source failures retain the draft, exact reference metadata survives unavailable detail pages',async()=>{
 const h=harness({searchItemsByName:async name=>name==='Exact Ring'?{status:'matched',candidates:[candidate(14,name)]}:{status:'unavailable',reason:'Host blocked',candidates:[]},fetchItemDetails:async()=>{throw Error('Host blocked');}});try{
 let d=await create(h,'Unknown Ring\nExact Ring');const result=await h.call(`/api/loot/drafts/${d.id}/match`,'POST',{expectedRevision:d.revision});assert.equal(result.status,200,JSON.stringify(result));d=result.body.draft;assert.equal(d.items[0].matchStatus,'unmatched');assert.equal(d.items[0].note,'Host blocked');assert.equal(d.items[1].matchStatus,'matched');assert.equal(d.items[1].displayName,'Exact Ring');assert.equal(d.sources[0].text,'Unknown Ring\nExact Ring');assert.equal(count(h,'auctions'),0);
}finally{h.close();}});
test('competing edits use revision guards and ignored unknown log lines can be explicitly excluded',async()=>{const h=harness();try{
 let d=await create(h,'Sample Ring\n[Wed Nov 11 20:00:00 2026] Alice says hello');assert.equal(d.readyToPublish,false);
 const edits=await Promise.all([h.call(`/api/loot/drafts/${d.id}/items/${d.items[1].id}`,'PUT',{expectedRevision:d.revision,ignore:true}),h.call(`/api/loot/drafts/${d.id}/items/${d.items[0].id}`,'PUT',{expectedRevision:d.revision,quantity:3})]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
 d=(await h.call(`/api/loot/drafts/${d.id}`)).body.draft;assert.equal(d.revision,2);assert.equal(d.items[0].quantity,1);assert.equal(d.items[1].matchStatus,'ignored');assert.equal(d.readyToPublish,true);assert.equal((await publish(h,d)).body.auctions.length,1);
 assert.equal((await h.call(`/api/loot/drafts/${d.id}/items/${d.items[0].id}`,'PUT',{expectedRevision:d.revision,quantity:5})).status,409);
}finally{h.close();}});
test('boss publication is atomic, exactly once on retry/concurrency, and shares one 24-hour deadline',async()=>{const h=harness();try{
 h.DB.raw.prepare('INSERT INTO guild_settings(id,settings_json,updated_by,updated_at,operation_id) VALUES(1,?,?,?,?)').run('{"minimumBid":25}','officer',new Date(h.time).toISOString(),'settings');
 const d=await create(h,'4 x Sample Ring\nSample Cloak',{raidId:'raid-1'});const results=await Promise.all([publish(h,d),publish(h,d)]);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.filter(r=>r.body.alreadyPublished===false).length,1);assert.deepEqual(results[0].body.auctions,results[1].body.auctions);
 const auctions=results[0].body.auctions;assert.equal(auctions.length,2);assert.equal(auctions[0].quantity,4);assert.ok(auctions.every(a=>a.minimumBid===25&&a.publishedAt===auctions[0].publishedAt&&a.closesAt===auctions[0].closesAt));assert.equal(Date.parse(auctions[0].closesAt)-Date.parse(auctions[0].publishedAt),86400000);assert.equal(count(h,'auctions'),2);assert.equal(count(h,'ledger'),0);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='auction_published'").get().n,2);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='boss_loot_published'").get().n,1);
 h.setTime(h.time+20000);assert.equal((await publish(h,d)).body.alreadyPublished,true);assert.equal(count(h,'auctions'),2);
}finally{h.close();}});
test('any auction insertion failure rolls back the entire publish including status and audit',async()=>{const h=harness();try{
 const d=await create(h);h.DB.raw.exec("CREATE TRIGGER fixture_publish_failure BEFORE INSERT ON auctions WHEN NEW.item_id=2 BEGIN SELECT RAISE(ABORT,'test forced failure'); END;");
 const result=await publish(h,d);assert.equal(result.status,500);assert.equal(count(h,'auctions'),0);assert.equal(count(h,'ledger'),0);assert.equal(h.DB.raw.prepare('SELECT status,revision,publish_op FROM loot_drafts WHERE id=?').get(d.id).status,'draft');assert.ok(h.DB.raw.prepare('SELECT auction_id FROM loot_draft_items').all().every(r=>r.auction_id===null));assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='auction_published'").get().n,0);
 h.DB.raw.exec('DROP TRIGGER fixture_publish_failure');assert.equal((await publish(h,d)).status,200);
}finally{h.close();}});
test('more than 50 pieces publish as a single boss batch and source lookups stay bounded',async()=>{
 let searches=0;const h=harness({searchItemsByName:async()=>{searches++;return{status:'unavailable',candidates:[]};}});try{
  const d=await create(h,Array.from({length:60},(_,n)=>`${1000+n}^1^Fixture Item ${n}`).join('\n'));assert.equal(d.totalPieces,60);const r=await publish(h,d);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.auctions.length,60);assert.equal(new Set(r.body.auctions.map(a=>a.closesAt)).size,1);assert.equal(count(h,'auctions'),60);
  const unknown=await create(h,Array.from({length:25},(_,n)=>`Unknown ${n}`).join('\n'));const match=await h.call(`/api/loot/drafts/${unknown.id}/match`,'POST',{expectedRevision:unknown.revision});assert.equal(match.status,200);assert.equal(match.body.searched,10);assert.equal(match.body.remaining,25);assert.equal(searches,10);
 }finally{h.close();}
});

test('basic source matching preserves full base, Darkened and Fabled names as three separate loot items',async()=>{
 const requested=[];const h=harness({searchItemsByName:async(name,options)=>{requested.push(name);assert.equal(options.timeoutMs,5000);const id=name.startsWith('Darkened ')?71:72;return{status:'matched',candidates:[candidate(id,name),candidate(70,'Fixture Helm','candidate')]};},fetchItemDetails:async(id,options)=>{assert.equal(options.timeoutMs,3000);return{itemId:id,name:'Fixture Helm',metadataStatus:'verified_reference'};}});try{
  h.ref(70,'Fixture Helm');let d=await create(h,'Fixture Helm\nDarkened Fixture Helm\nFabled Fixture Helm');assert.equal(d.items.length,3);assert.equal(d.items[0].itemId,70);
  const r=await h.call(`/api/loot/drafts/${d.id}/match`,'POST',{expectedRevision:d.revision});assert.equal(r.status,200,JSON.stringify(r.body));d=r.body.draft;
  assert.deepEqual(requested.sort(),['Darkened Fixture Helm','Fabled Fixture Helm']);assert.deepEqual(d.items.map(i=>i.displayName),['Fixture Helm','Darkened Fixture Helm','Fabled Fixture Helm']);assert.deepEqual(d.items.map(i=>i.itemId),[70,71,72]);assert.ok(d.items.every(i=>i.matchStatus==='matched'));assert.equal(d.sources[0].text,'Fixture Helm\nDarkened Fixture Helm\nFabled Fixture Helm');
 }finally{h.close();}
});
test('source item IDs conflicting with a cached prefixed identity remain unresolved instead of renaming cached gear',async()=>{
 const h=harness({searchItemsByName:async name=>({status:'matched',candidates:[candidate(73,name)]}),fetchItemDetails:async()=>{throw Error('Detail source unavailable');}});try{
  h.ref(73,'Fabled Fixture Helm');let d=await create(h,'Darkened Fixture Helm');const r=await h.call(`/api/loot/drafts/${d.id}/match`,'POST',{expectedRevision:d.revision});assert.equal(r.status,200);d=r.body.draft;assert.equal(d.items[0].matchStatus,'ambiguous');assert.equal(d.items[0].itemId,null);assert.equal(h.DB.raw.prepare('SELECT name FROM item_references WHERE item_id=73').get().name,'Fabled Fixture Helm');assert.equal(count(h,'auctions'),0);
 }finally{h.close();}
});
test('item history includes legacy auctions plus boss quantities once and never leaks active sealed bids',async()=>{const h=harness();try{
 for(const[who,balance]of[['alice',1234567],['bob',7654321]])h.DB.raw.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?)').run('opening-'+who,'char-'+who,balance,'Explicit fixture starting DKP','officer',new Date(h.time).toISOString(),'opening-'+who);
 const openingLedger=count(h,'ledger');
 const manual=await h.call('/api/auctions','POST',{itemId:1,quantity:2},h.users.officer,{},h.auctionApi);assert.equal(manual.status,201,JSON.stringify(manual));const a=manual.body.auction;
 for(const[who,amount]of[['alice',1234567],['bob',7654321]])assert.equal((await h.call(`/api/auctions/${a.id}/bid`,'PUT',{amount},h.users[who],{},h.auctionApi)).status,200);
 const d=await create(h,'4 x Sample Ring',{raidId:'raid-1'});await publish(h,d);await create(h,'Sample Ring');
 for(const viewer of[h.users.officer,h.users.alice]){const history=await h.call('/api/loot/items/1/history','GET',undefined,viewer);assert.equal(history.body.appearanceCount,2);assert.equal(history.body.totalQuantity,6);assert.ok(history.body.auctions.every(a=>a.bids===null&&a.awards.length===0));assert.ok(!JSON.stringify(history.body).includes('1234567'));assert.ok(!JSON.stringify(history.body).includes('7654321'));assert.equal(history.body.appearances.filter(a=>a.draftId===d.id).length,1);assert.equal(history.body.appearances.find(x=>x.auctionId===a.id).bossName,null);}
 h.setTime(Date.parse(a.closesAt));const unsettled=await h.call('/api/loot/items/1/history');assert.ok(unsettled.body.auctions.every(a=>!a.resultsReady&&a.bids===null));
 assert.equal((await h.call(`/api/auctions/${a.id}/close`,'POST',undefined,h.users.alice,{},h.auctionApi)).status,200);
 const history=await h.call('/api/loot/items/1/history?limit=1','GET',undefined,h.users.alice);assert.equal(history.body.appearanceCount,2);assert.equal(history.body.auctions.length,1);
 const full=await h.call('/api/loot/items/1/history','GET',undefined,h.users.alice);const previous=full.body.auctions.find(x=>x.id===a.id);assert.deepEqual(previous.bids.map(b=>b.amount),[7654321,1234567]);assert.equal(previous.awards.length,2);assert.equal(previous.awards[0].price,1234568);assert.equal(previous.awards[0].status,'pending');assert.equal(count(h,'ledger'),openingLedger);
 assert.equal(await h.call('/api/other'),null);
}finally{h.close();}});
