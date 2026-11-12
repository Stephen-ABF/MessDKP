const LOOT_DAY_MS=86400000;
const DB_CLOCK="(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const SOURCE='https://items.eqresource.com';
const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const normalize=value=>String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
class LootError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new LootError(status,code,message);};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql=(db,query,...values)=>db.prepare(query).bind(...values);
const all=async statement=>(await statement.all()).results;
function text(value,label,max=250){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(400,'validation',`${label} must contain 1-${max} printable characters.`);return value.trim();}
function integer(value,label,min=1,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'validation',`${label} must be a whole number from ${min} to ${max}.`);return value;}
function parseJson(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
function safeToken(a,b){if(typeof a!=='string'||typeof b!=='string'||!b||a.length!==b.length)return false;let different=0;for(let n=0;n<a.length;n++)different|=a.charCodeAt(n)^b.charCodeAt(n);return different===0;}
async function body(request){if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'content_type','Send JSON data.');const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel().catch(()=>{});fail(413,'too_large','Loot preparation text exceeds 2 MiB.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}try{const result=JSON.parse(raw);if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}catch{fail(400,'invalid_json','Send valid JSON data.');}}
function reference(value){
 let input=value.trim(),suppliedName=null;
 const advanced=/^(\d+)\^(\d+)\^([^\r\n]+)$/.exec(input);
 if(advanced){input=advanced[1];suppliedName=text(advanced[3],'Item name');}
 else if(/^https?:\/\//i.test(input)){
  let url;try{url=new URL(input);}catch{fail(400,'invalid_reference','Invalid item link.');}
  if(url.origin!==SOURCE||url.pathname!=='/items.php'||url.username||url.password||url.hash||url.searchParams.size!==1||!url.searchParams.has('id'))fail(400,'invalid_reference','Use an exact HTTPS EQResource item link.');input=url.searchParams.get('id');
 }
 if(!/^\d+$/.test(input))return null;const itemId=integer(Number(input),'Item ID');return{itemId,name:suppliedName,sourceUrl:`${SOURCE}/items.php?id=${itemId}`};
}
export function parseLootSources(input){
 const format=input.format??'names';if(!['names','log'].includes(format))fail(400,'validation','Choose names or log format.');
 const sources=[];if(input.text!==undefined){if(typeof input.text!=='string')fail(400,'validation','Loot text must be text.');sources.push({name:'Pasted loot text',text:input.text,format});}
 if(input.files!==undefined){if(!Array.isArray(input.files)||input.files.length>20)fail(400,'validation','Choose at most 20 text files.');for(const file of input.files){if(!file||typeof file.text!=='string')fail(400,'validation','Each source file needs its original text.');const sourceFormat=file.format??format;if(!['names','log'].includes(sourceFormat))fail(400,'validation','Choose names or log format.');sources.push({name:text(file.name,'Source filename',250),text:file.text,format:sourceFormat});}}
 if(!sources.length)fail(400,'validation','Paste loot names or choose a text file.');
 const rows=[],warnings=[],byKey=new Map();let count=0,total=0;
 for(const source of sources){if(source.text.length>1024*1024)fail(413,'too_large','Each source must be at most 1 MiB of text.');for(const [index,original]of source.text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  let line=original.trim();if(!line)continue;if(++count>200)fail(400,'too_many_lines','Use at most 200 nonempty loot lines per batch.');
  let quantity=1;const leading=/^(\d+)\s+[xX]\s+(.+)$/.exec(line),trailing=/^(.+?)\s+\([xX](\d+)\)$/.exec(line);
  if(leading){quantity=integer(Number(leading[1]),'Item quantity',1,50);line=leading[2].trim();}else if(trailing){quantity=integer(Number(trailing[2]),'Item quantity',1,50);line=trailing[1].trim();}
  const ref=reference(line);let review=false;
  if(source.format==='log'&&!ref)review=true;
  if(!ref&&(/^\[[^\]]{4,}\]/.test(line)||/\t|^--|\b(?:says|tells you|has looted|You have looted)\b/i.test(line)))review=true;
  let name=ref?.name??(ref?`EQ Item ${ref.itemId}`:review?line.slice(0,250):text(line,'Item name'));
  const key=review?`review:${source.name}:${index}`:ref?`id:${ref.itemId}`:`name:${normalize(name)}`;
  const raw={sourceName:source.name,lineNumber:index+1,text:original};
  total+=quantity;if(total>1000)fail(400,'too_many_pieces','Use at most 1000 total pieces per boss batch.');
  if(byKey.has(key)){const existing=byKey.get(key);existing.quantity+=quantity;if(existing.quantity>50)fail(400,'too_many_copies','One item auction supports at most 50 identical copies. Split or review this source explicitly.');existing.rawLines.push(raw);continue;}
  const row={id:uuid(),ordinal:rows.length,name,normalizedName:normalize(name),quantity,itemId:ref?.itemId??null,matchStatus:review?'needs_review':ref?'matched':'unmatched',candidates:[],rawLines:[raw],note:review?'This log/chat-looking line needs manager review; no loot format has been inferred.':ref?'Item ID supplied directly; detailed source metadata may still be unknown.':null};rows.push(row);byKey.set(key,row);
 }}
 if(!rows.length)fail(400,'empty_loot','No nonempty loot lines were supplied.');if(rows.some(row=>row.matchStatus==='needs_review'))warnings.push('Some lines require review. Unrecognized game log or chat text is never automatically treated as loot.');
 return{sources,rows,warnings,totalPieces:total};
}
function candidate(value){if(!value||value.nameConflict||!Number.isSafeInteger(value.itemId)||value.itemId<1||typeof value.name!=='string'||!value.name.trim())return null;return{itemId:value.itemId,name:value.name.trim().slice(0,250),sourceUrl:`${SOURCE}/items.php?id=${value.itemId}`,match:value.match==='exact'?'exact':'candidate'};}
const rowSelect=`SELECT i.*,r.name AS reference_name,r.source_url,r.metadata_status FROM loot_draft_items i LEFT JOIN item_references r ON r.item_id=i.item_id`;
function itemShape(row){return{id:row.id,ordinal:row.ordinal,name:row.name,normalizedName:row.normalized_name,quantity:row.quantity,itemId:row.item_id,matchStatus:row.match_status,candidates:parseJson(row.candidates_json,[]),rawLines:parseJson(row.raw_lines_json,[]),note:row.note,sourceUrl:row.source_url??null,displayName:row.reference_name||row.name,metadataStatus:row.metadata_status??null,auctionId:row.auction_id};}
function validTitle(item){return Boolean(item.displayName?.trim())&&!/^EQ Item \d+$/.test(item.displayName);}
function duplicateItemIds(items){const counts=new Map();for(const item of items)if(item.matchStatus!=='ignored'&&item.itemId)counts.set(item.itemId,(counts.get(item.itemId)||0)+1);return new Set([...counts].filter(([,count])=>count>1).map(([id])=>id));}
const duplicateMessage='The same item ID appears on multiple included rows. Combine its quantity on one row (up to 50 copies) and ignore the other rows before publishing. Original source lines remain preserved.';
async function draft(db,draftId){const row=await sql(db,'SELECT * FROM loot_drafts WHERE id=?',draftId).first();if(!row)fail(404,'not_found','Loot draft not found.');const items=(await all(sql(db,rowSelect+' WHERE i.draft_id=? ORDER BY i.ordinal',draftId))).map(itemShape);const active=items.filter(i=>i.matchStatus!=='ignored'),duplicates=duplicateItemIds(active);const unresolved=active.filter(i=>duplicates.has(i.itemId)||!['matched','manual_verified'].includes(i.matchStatus)||!i.itemId||!i.sourceUrl||!validTitle(i));const warnings=parseJson(row.warnings_json,[]);if(duplicates.size)warnings.push(duplicateMessage);return{id:row.id,bossName:row.boss_name,raidId:row.raid_id,status:row.status,revision:row.revision,totalPieces:active.reduce((n,i)=>n+i.quantity,0),itemCount:active.length,unresolvedCount:unresolved.length,createdAt:row.created_at,updatedAt:row.updated_at,publishedAt:row.published_at_ms===null?null:new Date(row.published_at_ms).toISOString(),sources:parseJson(row.sources_json,[]),warnings,readyToPublish:row.status==='draft'&&active.length>0&&!unresolved.length,items};}
const ensureRef=(db,itemId,at)=>sql(db,"INSERT INTO item_references(item_id,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,'Item ID provided in boss loot preparation','unresolved') ON CONFLICT(item_id) DO NOTHING",itemId,`${SOURCE}/items.php?id=${itemId}`,at);
function revision(input,value){integer(input.expectedRevision,'Draft revision');if(value.status!=='draft')fail(409,'already_published','A published boss batch cannot be edited.');if(input.expectedRevision!==value.revision)fail(409,'stale_draft','This draft changed. Refresh before continuing.');}
async function cachedMatches(db,rows){const refs=await all(sql(db,"SELECT item_id,name,source_url FROM item_references WHERE name IS NOT NULL AND metadata_status='verified_reference' ORDER BY item_id LIMIT 10000"));const names=new Map();for(const ref of refs){const key=normalize(ref.name);if(!names.has(key))names.set(key,[]);names.get(key).push({itemId:ref.item_id,name:ref.name,sourceUrl:ref.source_url,match:'exact'});}for(const row of rows){if(row.itemId||row.matchStatus==='needs_review')continue;const matches=names.get(row.normalizedName)||[];if(matches.length===1){row.itemId=matches[0].itemId;row.matchStatus='matched';row.candidates=matches;row.note='Unique exact name match in the sourced item cache.';}else if(matches.length>1){row.matchStatus='ambiguous';row.candidates=matches;row.note='Multiple exact source names require manager selection.';}}}

export function createLootApi({searchItemsByName,fetchItemDetails,cacheItemDetails,knownItems=[],parseChatLootSources,clock,catalog,fileOnly=false}={}){
 const timeExpression=()=>clock?String(integer(clock(),'Clock',0)):DB_CLOCK;
 async function cacheKnown(db){if(fileOnly)return;if(typeof cacheItemDetails==='function')for(const item of knownItems){const existing=await sql(db,'SELECT metadata_status FROM item_references WHERE item_id=?',item.itemId).first();if(existing?.metadata_status!=='verified_reference')await cacheItemDetails(db,item);}}
 async function localMatches(db,rows){
  for(const row of rows){
   if(row.itemId){await catalog?.hydrateCatalogItem(db,row.itemId);continue;}
   if(row.matchStatus==='needs_review')continue;
   const found=catalog?await catalog.searchCatalogItems(db,{q:row.name,exact:true,limit:100}):{items:[],total:0};
   row.candidates=found.items.map(item=>({itemId:item.itemId,name:item.name,sourceUrl:item.sourceUrl,match:'exact'}));
   if(found.total===1){row.itemId=found.items[0].itemId;row.matchStatus='matched';row.note='Unique exact complete name in the uploaded item file.';await catalog.hydrateCatalogItem(db,row.itemId);}
   else if(found.total>1){row.matchStatus='ambiguous';row.note='Multiple uploaded item IDs have this exact name. Select the correct ID.';}
   else{row.matchStatus='unmatched';row.note='No exact complete item name exists in the uploaded file.';}
  }
 }
 async function cacheResolved(db,itemId,item=null){
  if(item&&typeof cacheItemDetails==='function'){await cacheItemDetails(db,item);return;}
  await ensureRef(db,itemId,now()).run();
 }
 async function create(db,user,input){
  const bossName=text(input.bossName,'Boss name',150),raidId=input.raidId===undefined||input.raidId===null||input.raidId===''?null:text(input.raidId,'Raid ID',100);
  if(raidId&&!await sql(db,'SELECT id FROM raids WHERE id=?',raidId).first())fail(404,'raid_not_found','Choose an existing raid.');
  if(input.chatCapture&&typeof parseChatLootSources!=='function')fail(503,'chat_capture_unavailable','Dedicated loot chat parsing is unavailable in this build.');
  const parsed=input.chatCapture?parseChatLootSources(input):parseLootSources(input),key=input.idempotencyKey===undefined?null:text(input.idempotencyKey,'Creation key',128);if(key&&key.length<8)fail(400,'validation','Creation keys need at least 8 characters.');
  const signature=JSON.stringify({bossName,raidId,sources:parsed.sources});
  if(key){const old=await sql(db,'SELECT id,creation_signature FROM loot_drafts WHERE created_by=? AND creation_key=?',user.id,key).first();if(old){if(old.creation_signature!==signature)fail(409,'idempotency_conflict','That key was used for different boss loot.');return json({draft:await draft(db,old.id)},200);}}
  await cacheKnown(db);if(fileOnly)await localMatches(db,parsed.rows);else await cachedMatches(db,parsed.rows);const draftId=uuid(),at=now(),op=uuid();
  const statements=[sql(db,"INSERT INTO loot_drafts(id,raid_id,boss_name,created_by,sources_json,warnings_json,created_at,updated_at,creation_key,creation_signature) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(created_by,creation_key) DO NOTHING",draftId,raidId,bossName,user.id,JSON.stringify(parsed.sources),JSON.stringify(parsed.warnings),at,at,key,signature)];
  const encoded=JSON.stringify(parsed.rows);
  statements.push(sql(db,"INSERT INTO item_references(item_id,source_url,retrieved_at,verification_method,metadata_status) SELECT DISTINCT json_extract(value,'$.itemId'),?||'/items.php?id='||json_extract(value,'$.itemId'),?,'Item ID supplied in boss loot preparation','unresolved' FROM json_each(?) WHERE json_extract(value,'$.itemId') IS NOT NULL AND EXISTS(SELECT 1 FROM loot_drafts WHERE id=?) ON CONFLICT(item_id) DO NOTHING",SOURCE,at,encoded,draftId));
  statements.push(sql(db,"INSERT INTO loot_draft_items(id,draft_id,ordinal,name,normalized_name,quantity,item_id,match_status,candidates_json,raw_lines_json,note) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.ordinal'),json_extract(value,'$.name'),json_extract(value,'$.normalizedName'),json_extract(value,'$.quantity'),json_extract(value,'$.itemId'),json_extract(value,'$.matchStatus'),json_extract(value,'$.candidates'),json_extract(value,'$.rawLines'),json_extract(value,'$.note') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM loot_drafts WHERE id=?)",draftId,encoded,draftId));
  statements.push(sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'boss_loot_imported',?,? WHERE EXISTS(SELECT 1 FROM loot_drafts WHERE id=?)",op,user.id,JSON.stringify({draftId,bossName,sourceCount:parsed.sources.length,itemCount:parsed.rows.length,totalPieces:parsed.totalPieces}),at,draftId));
  await db.batch(statements);const created=key?await sql(db,'SELECT id,creation_signature FROM loot_drafts WHERE created_by=? AND creation_key=?',user.id,key).first():{id:draftId,creation_signature:signature};if(created.creation_signature!==signature)fail(409,'idempotency_conflict','Another request used this creation key with different loot.');return json({draft:await draft(db,created.id)},created.id===draftId?201:200);
 }
 async function update(db,user,draftId,rowId,input){
  const value=await draft(db,draftId);revision(input,value);const row=value.items.find(i=>i.id===rowId);if(!row)fail(404,'not_found','Draft item not found.');
  let itemId=row.itemId,name=row.name,quantity=row.quantity,status=row.matchStatus,note=row.note;
  if(input.ignore!==undefined&&typeof input.ignore!=='boolean')fail(400,'validation','ignore must be true or false.');
  if(input.quantity!==undefined)quantity=integer(input.quantity,'Item quantity',1,50);
  if(input.name!==undefined)name=text(input.name,'Item name');
  if(input.itemId!==undefined){itemId=integer(input.itemId,'Item ID');if(input.confirm!==true)fail(400,'confirmation_required','Confirm the item ID against its source before selecting it.');status='manual_verified';note='Item ID explicitly selected by the manager; unknown source fields remain unknown.';}
  if(input.ignore===true){status='ignored';note='Manager excluded this source line from the boss auction batch.';}else if(input.ignore===false&&status==='ignored'){status=itemId?'manual_verified':'unmatched';note='Manager restored this row for review.';}
  if(name!==row.name&&input.itemId===undefined&&status!=='ignored'){itemId=null;status='unmatched';note='The item name changed and needs a new match.';}
  const total=value.items.filter(i=>i.id!==rowId&&i.matchStatus!=='ignored').reduce((n,i)=>n+i.quantity,0)+(status==='ignored'?0:quantity);if(total>1000)fail(400,'too_many_pieces','Use at most 1000 pieces per batch.');
  if(fileOnly&&itemId)await catalog?.hydrateCatalogItem(db,itemId);
  const operation=uuid(),at=now(),statements=[sql(db,"UPDATE loot_drafts SET revision=revision+1,updated_at=? WHERE id=? AND status='draft' AND revision=?",operation,draftId,input.expectedRevision)];
  if(itemId)statements.push(sql(db,"INSERT INTO item_references(item_id,source_url,retrieved_at,verification_method,metadata_status) SELECT ?,?,?,'Manager-selected item reference','unresolved' WHERE EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND updated_at=?) ON CONFLICT(item_id) DO NOTHING",itemId,`${SOURCE}/items.php?id=${itemId}`,at,draftId,operation));
  statements.push(sql(db,'UPDATE loot_draft_items SET name=?,normalized_name=?,quantity=?,item_id=?,match_status=?,note=? WHERE id=? AND draft_id=? AND EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND updated_at=?)',name,normalize(name),quantity,itemId,status,note,rowId,draftId,draftId,operation));
  statements.push(sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'boss_loot_row_reviewed',?,? WHERE EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND updated_at=?)",operation,user.id,JSON.stringify({draftId,rowId,itemId,quantity,status,name}),at,draftId,operation));
  statements.push(sql(db,'UPDATE loot_drafts SET updated_at=? WHERE id=? AND updated_at=?',at,draftId,operation));await db.batch(statements);
  const changed=await draft(db,draftId);if(!await sql(db,'SELECT id FROM audit WHERE id=?',operation).first())fail(409,'stale_draft','Another manager changed this draft. Refresh.');return json({draft:changed});
 }
 async function match(db,user,draftId,input){
  const value=await draft(db,draftId);revision(input,value);let rows=value.items.filter(i=>['unmatched','ambiguous'].includes(i.matchStatus));
  if(input.rowIds!==undefined){if(!Array.isArray(input.rowIds)||input.rowIds.some(x=>typeof x!=='string'))fail(400,'validation','rowIds must be draft item IDs.');const selected=new Set(input.rowIds);if(value.items.filter(i=>selected.has(i.id)).length!==selected.size)fail(400,'validation','Choose item rows from this draft.');rows=rows.filter(i=>selected.has(i.id));}
  rows=rows.slice(0,10);if(!rows.length)return json({draft:value,searched:0,remaining:value.items.filter(i=>['unmatched','ambiguous'].includes(i.matchStatus)).length});
  await cacheKnown(db);const outcomes=[];const queue=[...rows];
  async function worker(){while(queue.length){const row=queue.shift();
   if(fileOnly){const copy={...row,itemId:null,candidates:[]};await localMatches(db,[copy]);outcomes.push({row,itemId:copy.itemId,status:copy.matchStatus,note:copy.itemId||copy.matchStatus==='ambiguous'?copy.note:'No exact complete item name exists in the uploaded file. Upload newer item data or select an ID.',candidates:copy.candidates});continue;}
   let result;try{result=typeof searchItemsByName==='function'?await searchItemsByName(row.name,{timeoutMs:5000}):{status:'unavailable',candidates:[],reason:'Live source search is unavailable.'};}catch{result={status:'unavailable',candidates:[],reason:'EQResource could not be reached.'};}
   const candidates=(Array.isArray(result?.candidates)?result.candidates:[]).map(candidate).filter(Boolean);const exact=result?.status==='matched'&&!result.additionalPages?candidates.filter(c=>c.match==='exact'&&normalize(c.name)===normalize(row.name)):[];let itemId=null,status=exact.length>1?'ambiguous':'unmatched',note=result?.reason||'No unique exact match was verified.';
   if(exact.length===1){
    itemId=exact[0].itemId;status='matched';note='Unique exact complete item name from the EQResource item search.';
    let details;try{details=typeof fetchItemDetails==='function'?await fetchItemDetails(itemId,{timeoutMs:3000}):null;}catch{}
    const verified=details?.itemId===itemId&&details.metadataStatus==='verified_reference'&&normalize(details.name)===normalize(row.name);
    const previous=await sql(db,'SELECT name,metadata_status FROM item_references WHERE item_id=?',itemId).first();
    if(!verified&&previous?.metadata_status==='verified_reference'&&previous.name&&normalize(previous.name)!==normalize(row.name)){itemId=null;status='ambiguous';note='The saved item ID has a different complete name. Review the source variant before selecting it.';}
    else{
     await cacheResolved(db,itemId,verified?details:{itemId,name:exact[0].name,sourceUrl:exact[0].sourceUrl,metadataStatus:'verified_reference',metadataComplete:false,verificationMethod:'EQResource basic item search: unique exact complete name',retrievedAt:now()});
     const saved=await sql(db,'SELECT name FROM item_references WHERE item_id=?',itemId).first();if(saved?.name&&normalize(saved.name)!==normalize(row.name)){itemId=null;status='ambiguous';note='The retained verified snapshot has a different complete name; source review is required.';}
    }
   }
   else if(candidates.length){status='ambiguous';note='Source candidates require explicit manager selection.';}
   outcomes.push({row,itemId,status,note,candidates});
  }}await Promise.all([worker(),worker(),worker()]);
  const operation=uuid(),at=now(),statements=[sql(db,"UPDATE loot_drafts SET revision=revision+1,updated_at=? WHERE id=? AND status='draft' AND revision=?",operation,draftId,input.expectedRevision)];
  for(const o of outcomes)statements.push(sql(db,'UPDATE loot_draft_items SET item_id=?,match_status=?,note=?,candidates_json=? WHERE id=? AND draft_id=? AND EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND updated_at=?)',o.itemId,o.status,o.note,JSON.stringify(o.candidates),o.row.id,draftId,draftId,operation));
  statements.push(sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'boss_loot_match_review',?,? WHERE EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND updated_at=?)",operation,user.id,JSON.stringify({draftId,searched:outcomes.length,matched:outcomes.filter(o=>o.status==='matched').length}),at,draftId,operation));
  statements.push(sql(db,'UPDATE loot_drafts SET updated_at=? WHERE id=? AND updated_at=?',at,draftId,operation));await db.batch(statements);const changed=await draft(db,draftId);if(!await sql(db,'SELECT id FROM audit WHERE id=?',operation).first())fail(409,'stale_draft','This draft changed while matching. Refresh it.');return json({draft:changed,searched:outcomes.length,remaining:changed.items.filter(i=>['unmatched','ambiguous'].includes(i.matchStatus)).length});
 }
 async function publishedAuctions(db,draftId){return await all(sql(db,'SELECT a.id,a.item_id AS itemId,a.item_name AS itemName,a.quantity,a.minimum_bid AS minimumBid,a.published_at_ms AS publishedMs,a.closes_at_ms AS closesMs FROM loot_draft_items i JOIN auctions a ON a.id=i.auction_id WHERE i.draft_id=? ORDER BY i.ordinal',draftId));}
 const auctionShape=a=>{const{publishedMs,closesMs,...rest}=a;return{...rest,publishedAt:new Date(publishedMs).toISOString(),closesAt:new Date(closesMs).toISOString()};};
 async function publish(db,user,draftId,input){
  const value=await draft(db,draftId);if(value.status==='published')return json({draft:value,auctions:(await publishedAuctions(db,draftId)).map(auctionShape),alreadyPublished:true});revision(input,value);if(duplicateItemIds(value.items).size)fail(409,'duplicate_item_rows',duplicateMessage);if(!value.readyToPublish)fail(409,'unresolved_loot','Resolve, name, or explicitly ignore every item before publishing.');
  const settings=await sql(db,'SELECT settings_json FROM guild_settings WHERE id=1').first();const minimum=settings?parseJson(settings.settings_json,null)?.minimumBid:1;integer(minimum,'Configured minimum bid',1,1000000);
  const plans=value.items.filter(i=>i.matchStatus!=='ignored').map(i=>({rowId:i.id,auctionId:uuid(),auditId:uuid(),signature:JSON.stringify({lootDraftId:draftId,rowId:i.id,itemId:i.itemId,quantity:i.quantity})}));
  const encoded=JSON.stringify(plans),operation=uuid(),clockSql=timeExpression();
  const statements=[sql(db,`UPDATE loot_drafts SET status='published',publish_op=?,published_at_ms=${clockSql},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',${clockSql}/1000.0,'unixepoch'),revision=revision+1 WHERE id=? AND status='draft' AND revision=? AND EXISTS(SELECT 1 FROM loot_draft_items WHERE draft_id=loot_drafts.id AND match_status<>'ignored') AND NOT EXISTS(SELECT item_id FROM loot_draft_items WHERE draft_id=loot_drafts.id AND match_status<>'ignored' AND item_id IS NOT NULL GROUP BY item_id HAVING COUNT(*)>1) AND NOT EXISTS(SELECT 1 FROM loot_draft_items i LEFT JOIN item_references r ON r.item_id=i.item_id WHERE i.draft_id=loot_drafts.id AND i.match_status<>'ignored' AND (i.match_status NOT IN('matched','manual_verified') OR r.item_id IS NULL OR length(trim(COALESCE(NULLIF(r.name,''),i.name)))=0 OR COALESCE(NULLIF(r.name,''),i.name)='EQ Item '||i.item_id))`,operation,draftId,input.expectedRevision),
   sql(db,`INSERT INTO auctions(id,item_id,item_name,classes_json,source_url,metadata_status,quantity,minimum_bid,published_at_ms,closes_at_ms,created_by,creation_key,creation_signature) SELECT json_extract(j.value,'$.auctionId'),i.item_id,COALESCE(NULLIF(trim(r.name),''),i.name),r.classes_json,r.source_url,r.metadata_status,i.quantity,?,d.published_at_ms,d.published_at_ms+?,?,'loot:'||d.id||':'||i.id,json_extract(j.value,'$.signature') FROM json_each(?) j JOIN loot_draft_items i ON i.id=json_extract(j.value,'$.rowId') JOIN loot_drafts d ON d.id=i.draft_id JOIN item_references r ON r.item_id=i.item_id WHERE d.id=? AND d.publish_op=? AND d.status='published' AND i.match_status IN('matched','manual_verified')`,minimum,LOOT_DAY_MS,user.id,encoded,draftId,operation),
   sql(db,`UPDATE loot_draft_items SET auction_id=(SELECT json_extract(value,'$.auctionId') FROM json_each(?) WHERE json_extract(value,'$.rowId')=loot_draft_items.id) WHERE draft_id=? AND match_status<>'ignored' AND EXISTS(SELECT 1 FROM loot_drafts WHERE id=? AND publish_op=?)`,encoded,draftId,draftId,operation),
   sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT json_extract(j.value,'$.auditId'),?,'auction_published',json_object('auctionId',a.id,'itemId',a.item_id,'itemName',a.item_name,'quantity',a.quantity,'minimumBid',a.minimum_bid,'lootDraftId',d.id,'bossName',d.boss_name),d.updated_at FROM json_each(?) j JOIN auctions a ON a.id=json_extract(j.value,'$.auctionId') JOIN loot_drafts d ON d.id=? WHERE d.publish_op=?`,user.id,encoded,draftId,operation),
   sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'boss_loot_published',json_object('draftId',id,'bossName',boss_name,'auctionCount',?,'minimumBid',?),updated_at FROM loot_drafts WHERE id=? AND publish_op=?`,uuid(),user.id,plans.length,minimum,draftId,operation)
  ];await db.batch(statements);const changed=await draft(db,draftId);if(changed.status!=='published')fail(409,'stale_draft','This draft changed or needs review before publication.');return json({draft:changed,auctions:(await publishedAuctions(db,draftId)).map(auctionShape),alreadyPublished:(await sql(db,'SELECT publish_op FROM loot_drafts WHERE id=?',draftId).first()).publish_op!==operation});
 }
 async function history(db,itemId,limit){
  const totals=await sql(db,'SELECT COUNT(*) AS n,COALESCE(SUM(quantity),0) AS quantity FROM auctions WHERE item_id=?',itemId).first();
  const rows=await all(sql(db,'SELECT a.*,d.id AS draft_id,d.boss_name,d.raid_id,r.name AS raid_name FROM auctions a LEFT JOIN loot_draft_items i ON i.auction_id=a.id LEFT JOIN loot_drafts d ON d.id=i.draft_id AND d.status=\'published\' LEFT JOIN raids r ON r.id=d.raid_id WHERE a.item_id=? ORDER BY a.published_at_ms DESC,a.id LIMIT ?',itemId,limit));
  const closedIds=JSON.stringify(rows.filter(a=>a.status==='closed'&&a.cancelled_at_ms==null).map(a=>a.id));
  const [allBids,allAwards]=await Promise.all([
   all(sql(db,"SELECT b.auction_id,c.name AS characterName,u.name AS userName,b.amount,b.eligible_at_close AS eligible FROM auction_bids b JOIN auctions a ON a.id=b.auction_id AND a.status='closed' JOIN characters c ON c.id=b.character_id JOIN users u ON u.id=b.user_id WHERE b.auction_id IN(SELECT value FROM json_each(?)) AND b.active=1 ORDER BY b.amount DESC,b.priority_at_ms,b.priority_sequence",closedIds)),
   all(sql(db,"SELECT w.auction_id,c.name AS characterName,u.name AS userName,w.price,w.status FROM auction_awards w JOIN auctions a ON a.id=w.auction_id AND a.status='closed' JOIN characters c ON c.id=w.character_id JOIN users u ON u.id=w.user_id WHERE w.auction_id IN(SELECT value FROM json_each(?)) ORDER BY w.award_rank",closedIds))
  ]);
  const auctions=[];for(const a of rows){const closed=a.status==='closed'&&a.cancelled_at_ms==null;const bids=closed?allBids.filter(b=>b.auction_id===a.id).map(({auction_id,...b})=>({...b,eligible:Boolean(b.eligible)})):null,awards=closed?allAwards.filter(w=>w.auction_id===a.id).map(({auction_id,...w})=>w):[];
   auctions.push({id:a.id,itemName:a.item_name,quantity:a.quantity,publishedAt:new Date(a.published_at_ms).toISOString(),closesAt:new Date(a.closes_at_ms).toISOString(),status:a.cancelled_at_ms!=null?'cancelled':closed||((clock?clock():Date.now())>=a.closes_at_ms)?'closed':'open',resultsReady:closed,bids,awards});
  }
  return json({itemId,appearanceCount:totals.n,totalQuantity:totals.quantity,appearances:rows.map(a=>({draftId:a.draft_id??null,bossName:a.boss_name??null,raidId:a.raid_id??null,raidName:a.raid_name??null,quantity:a.quantity,publishedAt:new Date(a.published_at_ms).toISOString(),auctionId:a.id})),auctions});
 }
 return async function handleLootApi(request,env,context={}){
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');if(!path.startsWith('/api/loot/'))return null;
  try{
   const user=context.user;if(!user?.id)fail(401,'authentication_required','Sign in to Guild Desk.');if(!env.DB)fail(503,'database_unavailable','The database is unavailable.');const db=env.DB;
   const historyRoute=/^\/api\/loot\/items\/(\d+)\/history$/.exec(path);if(historyRoute&&request.method==='GET'){const itemId=integer(Number(historyRoute[1]),'Item ID');const raw=url.searchParams.get('limit')??'50';if(!/^\d+$/.test(raw))fail(400,'validation','Choose a history limit from 1 to 100.');return await history(db,itemId,integer(Number(raw),'History limit',1,100));}
   if(user.role!=='admin')fail(403,'forbidden','Officer access is required for loot preparation.');
   if(request.method!=='GET'){if(request.headers.get('origin')!==url.origin)fail(403,'origin','A same-origin request is required.');if(!safeToken(request.headers.get('x-csrf-token'),context.csrfToken))fail(403,'csrf','Refresh your session before changing loot.');}
   if(path==='/api/loot/drafts'&&request.method==='GET'){
    const rows=await all(sql(db,"SELECT d.id,d.boss_name AS bossName,d.raid_id AS raidId,d.status,d.revision,d.created_at AS createdAt,d.updated_at AS updatedAt,d.published_at_ms,SUM(CASE WHEN i.match_status<>'ignored' THEN i.quantity ELSE 0 END) AS totalPieces,SUM(CASE WHEN i.match_status<>'ignored' THEN 1 ELSE 0 END) AS itemCount,SUM(CASE WHEN i.match_status<>'ignored' AND (i.match_status NOT IN('matched','manual_verified') OR r.item_id IS NULL OR (SELECT COUNT(*) FROM loot_draft_items dup WHERE dup.draft_id=d.id AND dup.item_id=i.item_id AND dup.match_status<>'ignored')>1 OR length(trim(COALESCE(NULLIF(r.name,''),i.name)))=0 OR COALESCE(NULLIF(r.name,''),i.name)='EQ Item '||i.item_id) THEN 1 ELSE 0 END) AS unresolvedCount FROM loot_drafts d LEFT JOIN loot_draft_items i ON i.draft_id=d.id LEFT JOIN item_references r ON r.item_id=i.item_id GROUP BY d.id ORDER BY d.created_at DESC,d.id LIMIT 100"));
    return json({drafts:rows.map(({published_at_ms,...r})=>({...r,publishedAt:published_at_ms===null?null:new Date(published_at_ms).toISOString()}))});
   }
   if(path==='/api/loot/drafts'&&request.method==='POST')return await create(db,user,await body(request));
   const route=/^\/api\/loot\/drafts\/([^/]+)(?:\/(match|publish|items)(?:\/([^/]+))?)?$/.exec(path);if(!route)fail(404,'not_found','Loot endpoint not found.');
   if(!route[2]&&request.method==='GET')return json({draft:await draft(db,route[1])});
   if(route[2]==='items'&&route[3]&&request.method==='PUT')return await update(db,user,route[1],route[3],await body(request));
   if(route[2]==='match'&&request.method==='POST')return await match(db,user,route[1],await body(request));
   if(route[2]==='publish'&&request.method==='POST')return await publish(db,user,route[1],await body(request));
   fail(405,'method_not_allowed','Method not allowed.');
  }catch(error){if(error instanceof LootError||error?.name==='ChatLootError')return json({error:error.message,code:error.code},error.status);return json({error:'The boss loot request could not be completed. Refresh before retrying.',code:'loot_error'},500);}
 };
}
export const handleLootApi=createLootApi();
