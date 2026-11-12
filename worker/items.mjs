// EQResource reference records. No live scraper or complete game catalog is implied.
export const ITEM_REFERENCE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS item_references (
  item_id INTEGER PRIMARY KEY CHECK (item_id > 0),
  name TEXT,
  classes_json TEXT,
  races_json TEXT,
  slots_json TEXT,
  stats_json TEXT,
  flags_json TEXT,
  advanced_loot TEXT,
  source_url TEXT NOT NULL,
  source_checked_at TEXT,
  source_updated_at TEXT,
  retrieved_at TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  metadata_status TEXT NOT NULL CHECK (metadata_status IN ('verified_reference', 'unresolved'))
);`;

const SOURCE_ORIGIN = 'https://items.eqresource.com';
const CLASS_NAMES = {
  WAR: 'Warrior', CLR: 'Cleric', PAL: 'Paladin', RNG: 'Ranger', SHD: 'Shadow Knight',
  DRU: 'Druid', MNK: 'Monk', BRD: 'Bard', ROG: 'Rogue', SHM: 'Shaman',
  NEC: 'Necromancer', WIZ: 'Wizard', MAG: 'Magician', ENC: 'Enchanter', BST: 'Beastlord', BER: 'Berserker',
};
const SLOT_NAMES = new Set(['AMMO', 'ARMS', 'BACK', 'CHARM', 'CHEST', 'EAR', 'FACE', 'FEET', 'FINGER', 'HANDS', 'HEAD', 'LEGS', 'NECK', 'PRIMARY', 'RANGE', 'SECONDARY', 'SHOULDERS', 'WAIST', 'WRIST']);
const SOURCE_NOTICE = 'This is a local EQResource reference cache, not the complete EverQuest item database. Live metadata synchronization is unavailable. Source pages may differ from progression-server rules.';

// These factual fields were retrieved from EQResource page/indexed-page text.
// retrievedAt records retrieval, not the game version or the source's last update.
export const VERIFIED_ITEM_REFERENCES = Object.freeze([
  Object.freeze({
    itemId: 81773, name: 'Blood of the Dhampyre', classes: ['ALL'], races: ['ALL'], slots: ['RANGE'],
    stats: { ac:104,hp:2006,mana:1984,endurance:1984,requiredLevel:90,recommendedLevel:95,weight:1.3,tribute:6759,strength:21,heroicStrength:7,stamina:23,heroicStamina:7,intelligence:21,heroicIntelligence:7,wisdom:21,heroicWisdom:7,agility:21,heroicAgility:7,dexterity:21,heroicDexterity:8,charisma:23,heroicCharisma:7,magicResist:45,fireResist:45,coldResist:45,diseaseResist:45,poisonResist:45,attack:18,hpRegen:20,manaRegen:2,healAmount:13,spellDamage:13,clairvoyance:20 },
    details: {fields:[{label:'Size',value:'SMALL'}],effects:['Effect: Prismatic Ward VIII - Casting Time: 0.5s','Effect: Improved Dodge V - Worn',"Focus: Corrupted Sylvan's Rot II"],augments:['Type 7 (General: Group)','Type 3 (General: Spell Effect)'],lore:'Blood of the Dhampyre',sourceText:null},
    flags: ['Magic', 'Lore', 'No Trade', 'Placeable'], advancedLoot: '81773^1557^Blood of the Dhampyre',
    sourceUrl: 'https://items.eqresource.com/items.php?id=81773',
    sourceCheckedAt: 'Feb 18, 2025, 01:26 AM', sourceUpdatedAt: 'Jul 3, 2022, 12:07 AM',
    retrievedAt: '2026-11-12T02:49:54.785Z', verificationMethod: 'EQResource public item page text', metadataStatus: 'verified_reference',
  }),
  Object.freeze({
    itemId: 44354, name: 'Ancient Pearlescent Mask', classes: ['MNK'],
    races: ['Drakkin', 'Froglok', 'Human', 'Iksar'], slots: ['FACE'],
    stats: { ac: 5, agility: 5, magicResist: 10 }, flags: ['Magic', 'No Trade'],
    details: {fields:[{label:'Size',value:'SMALL'},{label:'Weight',value:'0.1'}],effects:['Effect: Serpent Sight - Worn'],augments:[],lore:'Ancient Pearlescent Mask',sourceText:null},
    advancedLoot: '44354^772^Ancient Pearlescent Mask', sourceUrl: 'https://items.eqresource.com/items.php?id=44354',
    sourceCheckedAt: 'Nov 2, 2016, 03:37 AM', sourceUpdatedAt: 'Sep 3, 2014, 06:26 AM',
    retrievedAt: '2026-11-12T02:49:54.785Z', verificationMethod: 'EQResource indexed item page text', metadataStatus: 'verified_reference',
  }),
]);

function fail(message, code, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}

export function parseEqItemReference(input) {
  let value = input;
  let suppliedName = null;
  let iconId = null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) fail('Enter a positive whole-number EQ item ID.', 'invalid_item_id');
  } else if (typeof value === 'string') {
    value = value.trim();
    if (!value || value.length > 1024) fail('Enter an EQ item ID, item link, or Advanced Loot reference.', 'invalid_item_reference');
    if (value.includes('^')) {
      const match = /^(\d+)\^(\d+)\^([^\r\n]+)$/.exec(value);
      if (!match) fail('The Advanced Loot reference must be itemID^iconID^name.', 'invalid_advanced_loot');
      value = match[1]; iconId = Number(match[2]); suppliedName = match[3].trim();
      if (!Number.isSafeInteger(iconId) || !suppliedName) fail('Invalid Advanced Loot reference.', 'invalid_advanced_loot');
    } else if (/^https?:\/\//i.test(value)) {
      let url;
      try { url = new URL(value); } catch { fail('Invalid EQResource URL.', 'invalid_item_url'); }
      if (url.origin !== SOURCE_ORIGIN || url.pathname !== '/items.php' || url.username || url.password || url.hash || url.searchParams.size !== 1 || !url.searchParams.has('id')) {
        fail('Use an HTTPS items.eqresource.com/items.php?id= item link.', 'invalid_item_url');
      }
      value = url.searchParams.get('id');
    }
    if (!/^\d+$/.test(value)) fail('Enter a positive whole-number EQ item ID.', 'invalid_item_id');
    value = Number(value);
  } else fail('Enter an EQ item ID or source link.', 'invalid_item_reference');
  if (!Number.isSafeInteger(value) || value <= 0) fail('Enter a valid EQ item ID.', 'invalid_item_id');
  return { itemId: value, sourceUrl: `${SOURCE_ORIGIN}/items.php?id=${value}`, suppliedName, iconId };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function decodeJson(text) {
  if (text === null || text === undefined) return null;
  return JSON.parse(text);
}

function itemFromRow(row) {
  if (!row) return null;
  return {
    itemId: row.item_id, name: row.name, classes: decodeJson(row.classes_json), races: decodeJson(row.races_json),
    slots: decodeJson(row.slots_json), stats: sourceStatsForRow(row), flags: decodeJson(row.flags_json),
    advancedLoot: row.advanced_loot, sourceUrl: row.source_url, sourceCheckedAt: row.source_checked_at,
    sourceUpdatedAt: row.source_updated_at, retrievedAt: row.retrieved_at,
    verificationMethod: row.verification_method, metadataStatus: row.metadata_status,
    iconUrl: row.icon_url || null, metadataComplete: row.metadata_complete === 1,
    details: sourceDetailsForRow(row),
    sourceStatus: decodeJson(row.source_status_json),
  };
}

function sourceDetailsForRow(row){
 const details=decodeJson(row.full_details_json);
 const starter=VERIFIED_ITEM_REFERENCES.find(item=>item.itemId===row.item_id);
 const isStarter=['EQResource public item page text','EQResource indexed item page text'].includes(row.verification_method);
 if(starter&&isStarter&&(!details||(!details.fields?.length&&!details.effects?.length)))return cleanDetails(starter.details);
 return details||{fields:[],effects:[],augments:[],lore:null,sourceText:null};
}

function sourceStatsForRow(row){
 const stats=decodeJson(row.stats_json);
 const starter=VERIFIED_ITEM_REFERENCES.find(item=>item.itemId===row.item_id);
 if(starter&&['EQResource public item page text','EQResource indexed item page text'].includes(row.verification_method))return {...starter.stats,...(stats||{})};
 return stats;
}

export async function seedVerifiedItemReferences(db) {
  const sql = `INSERT INTO item_references (item_id,name,classes_json,races_json,slots_json,stats_json,flags_json,advanced_loot,source_url,source_checked_at,source_updated_at,retrieved_at,verification_method,metadata_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(item_id) DO UPDATE SET name=excluded.name,classes_json=excluded.classes_json,races_json=excluded.races_json,slots_json=excluded.slots_json,stats_json=excluded.stats_json,flags_json=excluded.flags_json,advanced_loot=excluded.advanced_loot,source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,source_updated_at=excluded.source_updated_at,retrieved_at=excluded.retrieved_at,verification_method=excluded.verification_method,metadata_status=excluded.metadata_status
    WHERE item_references.metadata_status='unresolved'`;
  await db.batch(VERIFIED_ITEM_REFERENCES.map(item => db.prepare(sql).bind(
    item.itemId, item.name, JSON.stringify(item.classes), JSON.stringify(item.races), JSON.stringify(item.slots), JSON.stringify(item.stats), JSON.stringify(item.flags), item.advancedLoot,
    item.sourceUrl, item.sourceCheckedAt, item.sourceUpdatedAt, item.retrievedAt, item.verificationMethod, item.metadataStatus,
  )));
}

function normalizeClass(value) {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (CLASS_NAMES[upper]) return upper;
  const match = Object.entries(CLASS_NAMES).find(([, name]) => name.toUpperCase() === upper);
  if (match) return match[0];
  fail('Choose a valid EverQuest class.', 'invalid_class_filter');
}

function requireMutationAccess(request, context) {
  if (!['admin', 'officer'].includes(context.user?.role)) fail('Only an officer can add item references.', 'forbidden', 403);
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) fail('A same-origin request is required.', 'invalid_origin', 403);
  if (typeof context.csrfToken !== 'string' || !context.csrfToken || request.headers.get('X-CSRF-Token') !== context.csrfToken) {
    fail('Refresh the page and retry.', 'invalid_csrf', 403);
  }
}

async function legacyItemApi(request, env, context = {}) {
  const url = new URL(request.url);
  if (!['/api/items', '/api/items/lookup'].includes(url.pathname)) return null;
  try {
    if (!context.user?.id) return json({ error: 'Sign in to view item references.', code: 'unauthorized' }, 401);
    if (!env?.DB) return json({ error: 'The item reference database is unavailable.', code: 'database_unavailable' }, 503);
    if (url.pathname === '/api/items' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length > 120) fail('Keep item searches under 121 characters.', 'search_too_long');
      const classCode = normalizeClass(url.searchParams.get('class'));
      const slot = (url.searchParams.get('slot') || '').trim().toUpperCase();
      if (slot && !SLOT_NAMES.has(slot)) fail('Choose a valid equipment slot.', 'invalid_slot_filter');
      const rawLimit = url.searchParams.get('limit') || '50';
      if (!/^\d+$/.test(rawLimit)) fail('Choose a result limit from 1 to 100.', 'invalid_limit');
      const limit = Number(rawLimit);
      if (limit < 1 || limit > 100) fail('Choose a result limit from 1 to 100.', 'invalid_limit');
      const result = await env.DB.prepare('SELECT * FROM item_references WHERE instr(lower(COALESCE(name,\'\')),?)>0 OR CAST(item_id AS TEXT)=? ORDER BY COALESCE(name,\'\'),item_id').bind(q.toLowerCase(), q).all();
      const references = new Map(VERIFIED_ITEM_REFERENCES.map(item => [item.itemId, item]));
      for (const row of result.results) {
        const item = itemFromRow(row);
        if (!references.has(item.itemId) || item.metadataStatus === 'verified_reference') references.set(item.itemId, item);
      }
      const matches = [...references.values()].filter(item => (
        (!q || (item.name || '').toLowerCase().includes(q.toLowerCase()) || String(item.itemId) === q) &&
        (!classCode || (Array.isArray(item.classes) && (item.classes.includes('ALL') || item.classes.includes(classCode)))) &&
        (!slot || (Array.isArray(item.slots) && item.slots.includes(slot)))
      )).sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.itemId - b.itemId);
      return json({ items: matches.slice(0, limit), total: matches.length, scope: 'local_reference_cache', catalogComplete: false, liveSyncAvailable: false, sourceNotice: SOURCE_NOTICE });
    }
    if (url.pathname === '/api/items/lookup' && request.method === 'POST') {
      requireMutationAccess(request, context);
      if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail('Send JSON containing itemId.', 'invalid_content_type', 415);
      const text = await request.text();
      if (text.length > 2048) fail('The item lookup request is too large.', 'request_too_large', 413);
      let body;
      try { body = JSON.parse(text); } catch { fail('Send valid JSON containing itemId.', 'invalid_json'); }
      const reference = parseEqItemReference(body?.itemId);
      await seedVerifiedItemReferences(env.DB);
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT OR IGNORE INTO item_references (item_id,source_url,retrieved_at,verification_method,metadata_status) VALUES (?,?,?,?,?)`).bind(reference.itemId, reference.sourceUrl, now, 'Reference ID only; metadata not retrieved', 'unresolved').run();
      const item = itemFromRow(await env.DB.prepare('SELECT * FROM item_references WHERE item_id=?').bind(reference.itemId).first());
      const verified = item.metadataStatus === 'verified_reference';
      return json({ item, mode: verified ? 'verified_reference' : 'reference_only', catalogComplete: false, liveSyncAvailable: false, sourceNotice: SOURCE_NOTICE }, verified ? 200 : 202);
    }
    return new Response(JSON.stringify({ error: 'Method not allowed.', code: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: url.pathname === '/api/items' ? 'GET' : 'POST' } });
  } catch (error) {
    if (error.status && error.code) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: 'The item reference request could not be completed.', code: 'item_reference_error' }, 500);
  }
}

function plain(value, max=5000) { return typeof value==='string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,max) : null; }
function cleanDetails(input={}) {
 return {
  fields:Array.isArray(input.fields)?input.fields.slice(0,400).filter(f=>f&&typeof f.label==='string').map(f=>({label:plain(f.label,200),value:plain(typeof f.value==='string'?f.value:JSON.stringify(f.value),10000)})):[],
  effects:Array.isArray(input.effects)?input.effects.slice(0,100).map(v=>plain(typeof v==='string'?v:JSON.stringify(v),10000)).filter(Boolean):[],
  augments:Array.isArray(input.augments)?input.augments.slice(0,100).map(v=>plain(typeof v==='string'?v:JSON.stringify(v),10000)).filter(Boolean):[],
  lore:plain(input.lore,10000),sourceText:plain(input.sourceText,60000)
 };
}
function safeIcon(value) {
 if(!value)return null;
 try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['items.eqresource.com','eqresource.com','www.eqresource.com'].includes(url.hostname)&&!url.port&&/\.(?:png|gif|webp|jpe?g)$/i.test(url.pathname)?url.href:null;}catch{return null;}
}
export async function getCachedItemDetails(db, itemId) {
 const reference=parseEqItemReference(itemId);
 const row=await db.prepare('SELECT * FROM item_references WHERE item_id=?').bind(reference.itemId).first();
 if(row)return itemFromRow(row);
 const seed=VERIFIED_ITEM_REFERENCES.find(i=>i.itemId===reference.itemId);
 return seed?{...seed,iconUrl:null,metadataComplete:false,details:cleanDetails(seed.details),sourceStatus:null}:null;
}
export async function cacheItemDetails(db, incoming) {
 const reference=parseEqItemReference(incoming?.itemId);
 if(incoming.sourceUrl&&incoming.sourceUrl!==reference.sourceUrl)fail('Item metadata has a different source ID.','source_id_mismatch');
 const existing=await getCachedItemDetails(db,reference.itemId);
 const verified=incoming.metadataStatus==='verified_reference';
 if(existing?.metadataStatus==='verified_reference'&&!verified)return existing;
 const details=cleanDetails(incoming.details);
 const complete=verified&&incoming.metadataComplete===true&&details.fields.length>0;
 // An incomplete refresh must not erase an earlier complete, verified record.
 if(existing?.metadataComplete&&!complete){
  await db.prepare('UPDATE item_references SET source_status_json=? WHERE item_id=?').bind(JSON.stringify({status:'incomplete',message:'The latest source response was incomplete; the earlier cached record is retained.'}),reference.itemId).run();
  return getCachedItemDetails(db,reference.itemId);
 }
 // Explicit unknown values from a successful snapshot clear older normalized
 // facts. Only omitted fields (for example an identity-only search result)
 // retain cached values. A failed fetch never calls this function.
 const has=(key)=>Object.prototype.hasOwnProperty.call(incoming,key);
 const pick=(key)=>has(key)?incoming[key]:existing?.[key]??null;
 const item={itemId:reference.itemId,name:plain(pick('name'),500),classes:pick('classes'),races:pick('races'),slots:pick('slots'),stats:{...(pick('stats')||{})},flags:pick('flags'),advancedLoot:plain(pick('advancedLoot'),1000),sourceUrl:reference.sourceUrl,sourceCheckedAt:plain(pick('sourceCheckedAt'),200),sourceUpdatedAt:plain(pick('sourceUpdatedAt'),200),retrievedAt:plain(incoming.retrievedAt,100)||new Date().toISOString(),verificationMethod:plain(incoming.verificationMethod,1000)||'Manager-provided item identity; source metadata incomplete',metadataStatus:verified||existing?.metadataStatus==='verified_reference'?'verified_reference':'unresolved',iconUrl:has('iconUrl')?safeIcon(incoming.iconUrl):existing?.iconUrl||null,metadataComplete:complete,details};
 if(!Object.keys(item.stats).length)item.stats=null;
 for(const key of ['classes','races','slots','flags'])if(item[key]!==null&&(!Array.isArray(item[key])||item[key].some(v=>typeof v!=='string')))fail('Invalid item metadata list.','invalid_metadata');
 if(!has('details')&&existing?.details)item.details=existing.details;
 await db.prepare(`INSERT INTO item_references(item_id,name,classes_json,races_json,slots_json,stats_json,flags_json,advanced_loot,source_url,source_checked_at,source_updated_at,retrieved_at,verification_method,metadata_status,full_details_json,icon_url,metadata_complete,source_status_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET name=excluded.name,classes_json=excluded.classes_json,races_json=excluded.races_json,slots_json=excluded.slots_json,stats_json=excluded.stats_json,flags_json=excluded.flags_json,advanced_loot=excluded.advanced_loot,source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,source_updated_at=excluded.source_updated_at,retrieved_at=excluded.retrieved_at,verification_method=excluded.verification_method,metadata_status=excluded.metadata_status,full_details_json=excluded.full_details_json,icon_url=excluded.icon_url,metadata_complete=excluded.metadata_complete,source_status_json=excluded.source_status_json`).bind(item.itemId,item.name,...['classes','races','slots','stats','flags'].map(k=>item[k]===null?null:JSON.stringify(item[k])),item.advancedLoot,item.sourceUrl,item.sourceCheckedAt,item.sourceUpdatedAt,item.retrievedAt,item.verificationMethod,item.metadataStatus,JSON.stringify(item.details),item.iconUrl,item.metadataComplete?1:0,JSON.stringify({status:complete?'complete':'partial',message:complete?'Full item metadata is cached.':'Available item data is cached; missing fields are not inferred.'})).run();
 return getCachedItemDetails(db,item.itemId);
}
async function sourceSearchName(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('Send JSON containing the full item name.','invalid_content_type',415);
 const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
 if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel().catch(()=>{});fail('Keep item search requests under 2 KiB.','request_too_large',413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 let data;try{data=JSON.parse(raw);}catch{fail('Send a valid item name search.','invalid_json');}
 if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.name!=='string')fail('Enter the full item name.','invalid_item_name');
 const name=data.name.trim();if(!name||name.length>250||/[\u0000-\u001f\u007f]/.test(name))fail('Use a complete item name from 1 to 250 printable characters.','invalid_item_name');return name;
}
const sourceNameKey=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';
function sourceCandidate(value,query){
 if(!value||!Number.isSafeInteger(value.itemId)||value.itemId<1||typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>250||value.nameConflict)return null;
 return{itemId:value.itemId,name:value.name.trim(),sourceUrl:SOURCE_ORIGIN+'/items.php?id='+value.itemId,match:sourceNameKey(value.name)===sourceNameKey(query)?'exact':'candidate'};
}
async function localItemBody(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('Send JSON item data.','invalid_content_type',415);
 const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel().catch(()=>{});fail('The item request is too large.','request_too_large',413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 let data;try{data=JSON.parse(raw);}catch{fail('Send valid JSON item data.','invalid_json');}if(!data||typeof data!=='object'||Array.isArray(data))fail('Send a JSON object.','invalid_json');return data;
}
async function fileCatalogItemApi(request,env,context,catalog){
 const url=new URL(request.url),path=url.pathname,match=/^\/api\/items\/(\d+)(\/refresh)?$/.exec(path);
 if(path!=='/api/items'&&path!=='/api/items/search'&&path!=='/api/items/lookup'&&!match)return null;
 try{
  if(!context.user?.id)return json({error:'Sign in to view item data.',code:'unauthorized'},401);if(!env?.DB)return json({error:'The item database is unavailable.',code:'database_unavailable'},503);
  const stored=async id=>{const row=await env.DB.prepare('SELECT * FROM item_references WHERE item_id=?').bind(id).first();if(!row)return null;const item=itemFromRow(row);return{...item,iconUrl:null,sourceStatus:{status:'retained',message:'Previously stored item data; this ID is not in the active upload.'}};};
  if(path==='/api/items'&&request.method==='GET'){
   const q=(url.searchParams.get('q')||'').trim(),classCode=normalizeClass(url.searchParams.get('class'))||'',slot=(url.searchParams.get('slot')||'').trim().toUpperCase(),rawLimit=url.searchParams.get('limit')||'50';
   if(!/^\d+$/.test(rawLimit))fail('Choose a result limit from 1 to 100.','invalid_limit');return json(await catalog.searchCatalogItems(env.DB,{q,classCode,slot,limit:Number(rawLimit)}));
  }
  if(match&&request.method==='GET'&&!match[2]){const id=parseEqItemReference(match[1]).itemId,item=await catalog.getCatalogItem(env.DB,id)||await stored(id);return item?json({item,sourceStatus:item.sourceStatus}):json({error:'This item is not in the uploaded catalog.',code:'not_found',sourceUrl:SOURCE_ORIGIN+'/items.php?id='+id},404);}
  if(request.method!=='POST')return json({error:'Method not allowed.',code:'method_not_allowed'},405);requireMutationAccess(request,context);
  if(path==='/api/items/search'){
   const query=await sourceSearchName(request),found=await catalog.searchCatalogItems(env.DB,{q:query,exact:true,limit:100}),candidates=found.items.map(item=>({itemId:item.itemId,name:item.name,sourceUrl:item.sourceUrl,match:'exact'}));
   const exactMatch=found.total===1?candidates[0]:null,item=exactMatch?await catalog.hydrateCatalogItem(env.DB,exactMatch.itemId):null,status=exactMatch?'matched':found.total?'ambiguous':found.catalog?'not_found':'unavailable';
   return json({query,status,candidates,exactMatch,item,sourceStatus:item?.sourceStatus??{status:found.catalog?'uploaded':'catalog_required',message:found.catalog?'Search uses only the uploaded item file.':'Upload item data before searching.'},sourceUrl:null});
  }
  if(path==='/api/items/lookup'){
   const input=await localItemBody(request),reference=parseEqItemReference(input.itemId),item=await catalog.hydrateCatalogItem(env.DB,reference.itemId);
   if(item)return json({item,mode:'uploaded_catalog',sourceStatus:item.sourceStatus});
   await env.DB.prepare("INSERT OR IGNORE INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?,'unresolved')").bind(reference.itemId,reference.suppliedName,reference.sourceUrl,new Date().toISOString(),'Item ID supplied locally; absent from uploaded catalog').run();
   const retained=await stored(reference.itemId);return json({item:retained,mode:'reference_only',sourceStatus:{status:'not_in_catalog',message:'This item ID is not present in the uploaded file.'}},202);
  }
  if(match&&match[2]){const id=parseEqItemReference(match[1]).itemId,item=await catalog.hydrateCatalogItem(env.DB,id)||await stored(id);return item?json({item,sourceStatus:item.sourceStatus}):json({error:'Upload an item file containing this ID to refresh it.',code:'not_in_catalog'},404);}
  return json({error:'Method not allowed.',code:'method_not_allowed'},405);
 }catch(error){return json({error:error.status?error.message:'The uploaded item data could not be loaded.',code:error.code||'item_catalog_error'},error.status||500);}
}
export function createItemApi({fetchItemDetails,searchItemsByName,catalog,fileOnly=false}={}) {
 return async function(request,env,context={}) {
  if(fileOnly){
   if(catalog)return fileCatalogItemApi(request,env,context,catalog);
   const path=new URL(request.url).pathname;
   return path==='/api/items'||path.startsWith('/api/items/')?json({error:'The uploaded item catalog is unavailable.',code:'catalog_unavailable'},503):null;
  }
  const url=new URL(request.url),match=/^\/api\/items\/(\d+)(\/refresh)?$/.exec(url.pathname);
  if(url.pathname==='/api/items/search'){
   try{
    if(!context.user?.id)return json({error:'Sign in to search item references.',code:'unauthorized'},401);
    requireMutationAccess(request,context);
    if(request.method!=='POST')return json({error:'Use POST to search the EQResource item database.','code':'method_not_allowed'},405);
    if(!env?.DB)return json({error:'The item reference database is unavailable.',code:'database_unavailable'},503);
    const query=await sourceSearchName(request),sourceUrl=SOURCE_ORIGIN+'/itemsearch.php';
    let result;
    try{result=typeof searchItemsByName==='function'?await searchItemsByName(query,{timeoutMs:8000}):{status:'unavailable',code:'source_unavailable',message:'EQResource item search is unavailable.'};}catch(error){result={status:'unavailable',code:error.code||'source_unavailable',message:error.message||'EQResource item search could not be reached.'};}
    const unique=new Map(),conflicts=new Set();for(const value of(Array.isArray(result?.candidates)?result.candidates:[]).slice(0,500).map(value=>sourceCandidate(value,query)).filter(Boolean)){const previous=unique.get(value.itemId);if(previous&&sourceNameKey(previous.name)!==sourceNameKey(value.name))conflicts.add(value.itemId);else unique.set(value.itemId,value);}
    const candidates=[...unique.values()].filter(value=>!conflicts.has(value.itemId));
    const exact=candidates.filter(value=>value.match==='exact');
    const exactMatch=result?.status==='matched'&&!result.additionalPages&&exact.length===1?exact[0]:null;
    let status=exactMatch?'matched':result?.status==='unavailable'?'unavailable':candidates.length?'ambiguous':result?.status==='not_found'?'not_found':'unavailable',item=null;
    let sourceStatus={status,code:plain(result?.code,100),message:plain(result?.message||result?.reason,1000)|| (status==='matched'?'Exact item name found in EQResource.':status==='ambiguous'?'Review the source names before selecting an item.':status==='not_found'?'No item matched this complete name.':'EQResource item search is unavailable.')};
    if(exactMatch){
     let details=null;
     try{details=typeof fetchItemDetails==='function'?await fetchItemDetails(exactMatch.itemId,{timeoutMs:4000}):null;if(details&&(details.itemId!==exactMatch.itemId||sourceNameKey(details.name)!==sourceNameKey(query)||details.metadataStatus!=='verified_reference'))throw Object.assign(new Error('The detail page no longer identifies this exact item name.'),{code:'source_identity_changed'});}
     catch(error){details=null;sourceStatus={status:'identity_only',code:plain(error.code,100)||'source_unavailable',message:'The exact item was found, but its detail page could not be verified. '+(plain(error.message,700)||'Cached details are retained.')};}
     if(!details&&sourceStatus.status==='matched')sourceStatus={status:'identity_only',message:'The exact source identity was found; full item details are not available.'};
     const previous=await getCachedItemDetails(env.DB,exactMatch.itemId);
     if(!details&&previous?.name&&sourceNameKey(previous.name)!==sourceNameKey(query)){status='ambiguous';sourceStatus={status:'identity_conflict',code:'cached_identity_conflict',message:'The saved item has a different complete name. Keep the source variants separate and review the item ID.'};}
     else{
      item=await cacheItemDetails(env.DB,details||{...exactMatch,metadataStatus:'verified_reference',metadataComplete:false,verificationMethod:'EQResource basic item search: unique exact complete name',retrievedAt:new Date().toISOString()});
      if(sourceNameKey(item.name)!==sourceNameKey(query)){item=null;status='ambiguous';sourceStatus={status:'identity_conflict',code:'cached_identity_conflict',message:'An earlier verified snapshot has a different complete name. Review the source before changing this item.'};}
     }
    }
    return json({query,status,candidates:status==='unavailable'?[]:candidates,exactMatch:status==='matched'?exactMatch:null,item,sourceStatus,sourceUrl});
   }catch(error){return json({error:error.status?error.message:'The item-name search could not be completed.',code:error.code||'item_search_error'},error.status||500);}
  }
  if(!match)return legacyItemApi(request,env,context);
  try {
   if(!context.user?.id)return json({error:'Sign in to view item details.',code:'unauthorized'},401);
   const reference=parseEqItemReference(match[1]);
   if(!match[2]&&request.method==='GET'){
    const item=await getCachedItemDetails(env.DB,reference.itemId);if(!item)return json({error:'This item has not been added to the guild catalog.',code:'not_found',sourceUrl:reference.sourceUrl},404);
    return json({item,sourceStatus:item.sourceStatus});
   }
   if(match[2]&&request.method==='POST'){
    requireMutationAccess(request,context);
    if(typeof fetchItemDetails!=='function')return json({error:'Source refresh is unavailable.',code:'source_unavailable'},503);
    await seedVerifiedItemReferences(env.DB);
    await env.DB.prepare('INSERT OR IGNORE INTO item_references(item_id,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?)').bind(reference.itemId,reference.sourceUrl,new Date().toISOString(),'Reference ID only; metadata not retrieved','unresolved').run();
    try {
     const details=await fetchItemDetails(reference.itemId);
     if(details?.itemId!==reference.itemId)fail('Source item ID does not match.','source_id_mismatch',502);
     const item=await cacheItemDetails(env.DB,details);return json({item,sourceStatus:item.sourceStatus});
    }catch(error){
     const status={status:'unavailable',code:plain(error.code,100)||'source_unavailable',message:plain(error.message,1000)||'The source could not be reached. Cached metadata is retained.'};
     await env.DB.prepare('UPDATE item_references SET source_status_json=? WHERE item_id=?').bind(JSON.stringify(status),reference.itemId).run();
     return json({item:await getCachedItemDetails(env.DB,reference.itemId),sourceStatus:status});
    }
   }
   return json({error:'Method not allowed.',code:'method_not_allowed'},405);
  }catch(error){return json({error:error.status?error.message:'The item detail request could not be completed.',code:error.code||'item_detail_error'},error.status||500);}
 };
}
export const handleItemApi=createItemApi();
