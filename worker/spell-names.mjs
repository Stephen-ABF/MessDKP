// Names only: this module never fetches or changes item statistics.
export const SPELL_NAMES_SOURCE='https://s3.amazonaws.com/raidloot/spells.csv.gz';
export const SPELL_NAMES_LIMITS=Object.freeze({compressedBytes:8*1024*1024,decodedBytes:64*1024*1024,rows:150000,recordBytes:131072,chunkBytes:256*1024,timeoutMs:15000});
const spellEncoder=new TextEncoder();
function spellFailure(message,code='invalid_spell_data',status=400){return Object.assign(new Error(message),{code,status});}

// RFC4180-style records: the verified source quotes every field and may quote
// commas, escaped quotes and line breaks inside its descriptive columns.
export function parseSpellNamesCsv(text){
 if(typeof text!=='string'||spellEncoder.encode(text).byteLength>SPELL_NAMES_LIMITS.decodedBytes)throw spellFailure('The spell reference exceeds 64 MiB.','spell_data_too_large',413);
 const entries=[],seen=new Set();let header=null,record=[],field='',quoted=false,afterQuote=false,recordBytes=0;
 function finishRecord(position){
  record.push(field);field='';afterQuote=false;
  recordBytes=0;
  if(!header){const keys=record.map(v=>v.replace(/^\uFEFF/,'').toLowerCase());if(keys.length<4||keys.length>100||new Set(keys).size!==keys.length||!keys.includes('id')||!keys.includes('name'))throw spellFailure('Use the original headered Raidloot spell CSV.');header={size:keys.length,id:keys.indexOf('id'),name:keys.indexOf('name')};}
  else if(record.length!==1||record[0]!==''){
   if(record.length!==header.size)throw spellFailure('A spell record does not match its header.');const id=record[header.id],name=record[header.name];
   if(!/^[1-9]\d{0,9}$/.test(id)||Number(id)>2147483647||!name||name.trim()!==name||name.length>250||/[\x00-\x1f\x7f]/.test(name))throw spellFailure('A spell ID or name is invalid.');
   const spellId=Number(id);if(seen.has(spellId))throw spellFailure('The spell reference contains a duplicate spell ID.');seen.add(spellId);entries.push({spellId,name});if(entries.length>SPELL_NAMES_LIMITS.rows)throw spellFailure('The spell reference has too many rows.','spell_data_too_large',413);
  }record=[];
 }
 for(let i=0;i<text.length;i++){
  const c=text[i],code=text.charCodeAt(i),previous=text.charCodeAt(i-1),next=text.charCodeAt(i+1);
  recordBytes+=code<128?1:code<2048?2:code>=0xD800&&code<=0xDBFF&&next>=0xDC00&&next<=0xDFFF?4:code>=0xDC00&&code<=0xDFFF&&previous>=0xD800&&previous<=0xDBFF?0:3;
  if(recordBytes>SPELL_NAMES_LIMITS.recordBytes)throw spellFailure('A spell record is too large.');
  if(quoted){if(c==='"'){if(text[i+1]==='"'){if(++recordBytes>SPELL_NAMES_LIMITS.recordBytes)throw spellFailure('A spell record is too large.');field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
  if(c==='"'){if(field||afterQuote)throw spellFailure('A CSV quote is misplaced.');quoted=true;}
  else if(c===','){record.push(field);field='';afterQuote=false;}
  else if(c==='\n'||c==='\r'){finishRecord(i);if(c==='\r'&&text[i+1]==='\n')i++;}
  else{if(afterQuote)throw spellFailure('Unexpected text follows a quoted CSV field.');field+=c;}
 }
 if(quoted)throw spellFailure('A quoted spell record is incomplete.');if(field||record.length||afterQuote)finishRecord(text.length);
 if(!header||!entries.length)throw spellFailure('The spell reference contains no spells.');return{entries,rowCount:entries.length,fieldCount:header.size};
}

export function enrichItemEffectNames(item,reference){
 if(!item?.details?.effectRecords?.length)return item;
 const names=reference instanceof Map?reference:new Map((reference?.entries??[]).map(row=>[row.spellId,row.name]));
 let changed=false;const effectRecords=item.details.effectRecords.map(record=>{
  if(record.name?.trim())return record;const name=names.get(record.spellId);if(!name)return record;changed=true;return{...record,name,nameSource:{provider:'Raidloot spell reference',sourceUrl:SPELL_NAMES_SOURCE,sourceModifiedAt:reference?.sourceModifiedAt??null}};
 });
 if(!changed)return item;
 const effects=effectRecords.map(record=>record.kind[0].toUpperCase()+record.kind.slice(1)+': '+(record.name||'Spell #'+record.spellId));
 return{...item,details:{...item.details,effectRecords,effects}};
}

const spellSql=(db,query,...params)=>db.prepare(query).bind(...params);
const spellDate=value=>{if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;};
const spellJson=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function spellAccess(context,minimum){return context.access?Number.isInteger(context.access.permissions?.items)&&context.access.permissions.items>=minimum:context.user?.role==='admin';}
function hideUnnamedSpellEffects(item){if(!item?.details?.effectRecords?.length)return item;return{...item,details:{...item.details,effects:item.details.effectRecords.filter(record=>record.name?.trim()).map(record=>record.kind[0].toUpperCase()+record.kind.slice(1)+': '+record.name)}};}
function restoreSpellRecords(item){
 if(!item?.details||item.details.effectRecords?.length||!item.details.fields?.length)return item;
 const fields=new Map(item.details.fields.filter(field=>typeof field?.label==='string').map(field=>[field.label.toLowerCase(),field.value]));
 const effectRecords=[];for(const kind of ['click','proc','worn','focus','scroll','bard','mount','blessing','familiar']){const raw=fields.get(kind+'effect'),id=Number(raw);if(!/^\d+$/.test(String(raw))||!Number.isSafeInteger(id)||id<1||id>2147483647)continue;const supplied=fields.get(kind+'name');effectRecords.push({kind,spellId:id,name:typeof supplied==='string'&&supplied.trim()?supplied:null});}
 return effectRecords.length?{...item,details:{...item.details,effectRecords}}:item;
}
async function spellDigest(bytes){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function boundedSpellBytes(stream,maximum,signal){
 if(!stream)throw spellFailure('The spell reference has no body.','spell_source_unavailable',502);const reader=stream.getReader(),parts=[];let size=0;
 const abort=()=>reader.cancel().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)throw spellFailure('The spell download timed out.','spell_source_timeout',504);const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw spellFailure('The spell reference exceeds its size limit.','spell_data_too_large',413);parts.push(part.value);}if(signal.aborted)throw spellFailure('The spell download timed out.','spell_source_timeout',504);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
async function downloadSpellNames(fetchImpl,signal){
 const response=await fetchImpl(SPELL_NAMES_SOURCE,{method:'GET',redirect:'manual',headers:{Accept:'application/gzip,application/octet-stream'},signal});
 if(response.status!==200){await response.body?.cancel().catch(()=>{});throw spellFailure('The fixed spell reference source is unavailable.','spell_source_unavailable',502);}
 if(Number(response.headers.get('content-length')||0)>SPELL_NAMES_LIMITS.compressedBytes){await response.body?.cancel().catch(()=>{});throw spellFailure('The compressed spell reference exceeds 8 MiB.','spell_data_too_large',413);}
 const compressed=await boundedSpellBytes(response.body,SPELL_NAMES_LIMITS.compressedBytes,signal);if(compressed[0]!==31||compressed[1]!==139)throw spellFailure('The spell reference is not the expected gzip CSV.');
 const decoded=await boundedSpellBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),SPELL_NAMES_LIMITS.decodedBytes,signal);
 const text=new TextDecoder('utf-8',{fatal:true}).decode(decoded),parsed=parseSpellNamesCsv(text);
 return{...parsed,sourceUrl:SPELL_NAMES_SOURCE,sourceModifiedAt:spellDate(response.headers.get('last-modified')),fileSha256:await spellDigest(compressed)};
}
export async function getSpellNamesStatus(db){
 const row=await spellSql(db,'SELECT * FROM spell_name_cache WHERE id=1').first();return{available:Boolean(row),sourceUrl:SPELL_NAMES_SOURCE,sourceModifiedAt:row?.source_modified_at??null,fetchedAt:row?.fetched_at??null,fileSha256:row?.file_sha256??null,entryCount:row?.entry_count??0,limits:SPELL_NAMES_LIMITS};
}
async function saveSpellNames(db,reference,clock){
 const statements=[spellSql(db,'DELETE FROM spell_name_entries')];let chunk=[],bytes=2;
 function push(){if(!chunk.length)return;statements.push(spellSql(db,"INSERT INTO spell_name_entries(spell_id,name) SELECT json_extract(value,'$.spellId'),json_extract(value,'$.name') FROM json_each(?)",JSON.stringify(chunk)));chunk=[];bytes=2;}
 for(const entry of reference.entries){const length=spellEncoder.encode(JSON.stringify(entry)).byteLength+1;if(bytes+length>SPELL_NAMES_LIMITS.chunkBytes)push();chunk.push(entry);bytes+=length;}push();
 statements.push(spellSql(db,'INSERT INTO spell_name_cache(id,source_url,source_modified_at,fetched_at,file_sha256,entry_count) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,source_modified_at=excluded.source_modified_at,fetched_at=excluded.fetched_at,file_sha256=excluded.file_sha256,entry_count=excluded.entry_count',SPELL_NAMES_SOURCE,reference.sourceModifiedAt,new Date(clock()).toISOString(),reference.fileSha256,reference.rowCount));
 await db.batch(statements);return getSpellNamesStatus(db);
}
export function createSpellNamesService({fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=SPELL_NAMES_LIMITS.timeoutMs}={}){
 const states=new WeakMap();
 function state(cacheKey){let value=states.get(cacheKey);if(!value){value={inflight:null,retryAfter:0,error:null};states.set(cacheKey,value);}return value;}
 async function refresh(db,{cacheKey=db}={}){
  const memory=state(cacheKey);if(memory.inflight)return memory.inflight;
  memory.inflight=(async()=>{const controller=new AbortController();let timer;
   try{const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(spellFailure('The spell download timed out.','spell_source_timeout',504));},timeoutMs);});const reference=await Promise.race([downloadSpellNames(fetchImpl,controller.signal),timeout]);const result=await saveSpellNames(db,reference,clock);memory.retryAfter=0;memory.error=null;return result;}
   catch(error){memory.retryAfter=clock()+5*60*1000;memory.error=error.code||'spell_source_unavailable';throw error;}
   finally{clearTimeout(timer);controller.abort();memory.inflight=null;}
  })();return memory.inflight;
 }
 async function ensure(db,cacheKey){const status=await getSpellNamesStatus(db);if(status.available)return status;const memory=state(cacheKey);if(memory.retryAfter>clock())return status;try{return await refresh(db,{cacheKey});}catch{return status;}}
 async function enrichItems(db,items,{cacheKey=db}={}){
  items=items.map(restoreSpellRecords);
  const ids=[...new Set(items.flatMap(item=>(item?.details?.effectRecords??[]).filter(record=>!record.name?.trim()&&Number.isSafeInteger(record.spellId)&&record.spellId>0).map(record=>record.spellId)))];
  if(!ids.length)return items.map(hideUnnamedSpellEffects);
  try{const status=await ensure(db,cacheKey);if(!status.available)return items.map(hideUnnamedSpellEffects);const result=await spellSql(db,'SELECT spell_id AS spellId,name FROM spell_name_entries WHERE spell_id IN(SELECT value FROM json_each(?))',JSON.stringify(ids)).all();const reference={entries:result.results,sourceModifiedAt:status.sourceModifiedAt};return items.map(item=>hideUnnamedSpellEffects(enrichItemEffectNames(item,reference)));}
  catch{return items.map(hideUnnamedSpellEffects);}
 }
 async function enrichItem(db,item,options){return(await enrichItems(db,[item],options))[0];}
 async function handleSpellNamesApi(request,env,context={}){
  const path=new URL(request.url).pathname;if(path!=='/api/catalog/spell-names'&&path!=='/api/catalog/spell-names/refresh')return null;
  try{if(!context.user?.id)return spellJson({error:'Sign in to view spell data.',code:'unauthorized'},401);const mutating=path.endsWith('/refresh');if(!spellAccess(context,mutating?3:2))return spellJson({error:'Item reference access is required.',code:'forbidden'},403);if(!env.DB)return spellJson({error:'The spell cache is unavailable.',code:'database_unavailable'},503);
   if(!mutating&&request.method==='GET'){const memory=state(env.SPELL_CACHE_KEY||env.DB);return spellJson({...await getSpellNamesStatus(env.DB),retryAfter:memory.retryAfter>clock()?new Date(memory.retryAfter).toISOString():null,lastError:memory.error});}
   if(!mutating||request.method!=='POST')return spellJson({error:'Use the spell reference refresh action.',code:'method_not_allowed'},405);
   if(request.headers.get('origin')!==new URL(request.url).origin||!context.csrfToken||request.headers.get('x-csrf-token')!==context.csrfToken)return spellJson({error:'Refresh your session before updating spell names.',code:'csrf'},403);
   if(request.body){const reader=request.body.getReader();let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw spellFailure('The spell refresh request is too large.','request_too_large',413);}}}finally{reader.releaseLock();}}
   return spellJson(await refresh(env.DB,{cacheKey:env.SPELL_CACHE_KEY||env.DB}));
  }catch(error){return spellJson({error:error.status?error.message:'The spell names could not be updated. Existing item data is retained.',code:error.code||'spell_source_unavailable'},error.status||502);}
 }
 return{enrichItem,enrichItems,refreshSpellNames:refresh,handleSpellNamesApi};
}
const defaultSpellNamesService=createSpellNamesService();
export const enrichItem=(db,item,options)=>defaultSpellNamesService.enrichItem(db,item,options);
export const enrichItems=(db,items,options)=>defaultSpellNamesService.enrichItems(db,items,options);
export const refreshSpellNames=(db,options)=>defaultSpellNamesService.refreshSpellNames(db,options);
export const handleSpellNamesApi=(request,env,context)=>defaultSpellNamesService.handleSpellNamesApi(request,env,context);
