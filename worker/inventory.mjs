import {HttpError as InventoryError,readJson,readText,requireCsrf,constantTimeEqual} from './http.mjs';
// Parses the verified EQ /outputfile inventory TSV. Bags and key rings are not equipment.
export const INVENTORY_MAX_BYTES=2*1024*1024;
const definitions=[['Charm','charm','Charm'],['Ear','ear1','Left ear'],['Head','head','Head'],['Face','face','Face'],['Ear','ear2','Right ear'],['Neck','neck','Neck'],['Shoulders','shoulders','Shoulders'],['Arms','arms','Arms'],['Back','back','Back'],['Wrist','wrist1','Left wrist'],['Wrist','wrist2','Right wrist'],['Range','ranged','Ranged'],['Hands','hands','Hands'],['Primary','primary','Primary'],['Secondary','secondary','Secondary'],['Fingers','finger1','Left finger'],['Fingers','finger2','Right finger'],['Chest','chest','Chest'],['Legs','legs','Legs'],['Feet','feet','Feet'],['Waist','waist','Waist'],['Power Source','powerSource','Power source'],['Ammo','ammo','Ammo']];
const fail=(status,code,message)=>{throw new InventoryError(status,code,message);};
const statement=(db,q,...values)=>db.prepare(q).bind(...values);
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const isItemId=value=>Number.isSafeInteger(value)&&value>0;
const cleanName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500&&!/[\x00-\x1f\x7f]/.test(value);
function number(value,line){if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))fail(400,'invalid_inventory',`Line ${line}: expected a nonnegative whole number.`);return Number(value);}
export function parseInventoryExport(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>INVENTORY_MAX_BYTES)fail(413,'inventory_too_large','Choose an inventory text file under 2 MiB.');
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))fail(400,'invalid_inventory','The inventory file contains unsupported control characters.');
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
 if(lines.length>20000)fail(413,'inventory_too_large','Inventory files may contain at most 20,000 lines.');
 if(lines[0]!== 'Location\tName\tID\tCount\tSlots')fail(400,'inventory_header','Use an EverQuest inventory export with Location, Name, ID, Count and Slots columns.');
 const counts=new Map(),slots=[],byLocation=new Map();let parent=null,keyRing=false,ignoredRows=0,storageRows=0,keyRingRows=0,augmentCount=0,emptyAugments=0;
 for(let index=1;index<lines.length;index++){
  const raw=lines[index];if(!raw.trim())continue;const line=index+1,cols=raw.split('\t');
  if(cols[0]==='KeyRing'){if(cols[1]!=='Name'||cols[2]!=='ID')fail(400,'invalid_inventory',`Line ${line}: invalid key-ring heading.`);keyRing=true;parent=null;continue;}
  if(keyRing){if(cols.length<3||cols.length>4||!cleanName(cols[0])||!cleanName(cols[1]))fail(400,'invalid_inventory',`Line ${line}: invalid key-ring record.`);number(cols[2],line);keyRingRows++;ignoredRows++;continue;}
  if(cols.length!==5||!cleanName(cols[0])||!cleanName(cols[1]))fail(400,'invalid_inventory',`Line ${line}: expected five tab-separated inventory columns.`);
  const [location,name]=cols,itemId=number(cols[2],line),count=number(cols[3],line);number(cols[4],line);
  if((itemId===0)!==(name==='Empty')||(!itemId&&count!==0)||(itemId&&count<1))fail(400,'invalid_inventory',`Line ${line}: the item ID, name and count disagree.`);
  const nested=/^(.*)-Slot(\d+)$/.exec(location);
  if(nested){
   if(parent&&nested[1]===parent.location){
    const socket=Number(nested[2]);if(!Number.isInteger(socket)||socket<1||socket>6||parent.augments.some(a=>a.socket===socket)||parent.emptySockets.includes(socket))fail(400,'invalid_inventory',`Line ${line}: duplicate or unsupported augment slot.`);
    if(itemId){if(!parent.itemId||count!==1)fail(400,'invalid_inventory',`Line ${line}: an installed augment needs one item in a nonempty equipment slot.`);parent.augments.push({socket,itemId,name,line});augmentCount++;}else {parent.emptySockets.push(socket);emptyAugments++;}
   }else {if(byLocation.has(nested[1]))fail(400,'invalid_inventory',`Line ${line}: the augment is separated from its equipped item.`);ignoredRows++;}
   continue;
  }
  parent=null;
  const choices=definitions.filter(([source])=>source===location);
  if(!choices.length){if(!/^(?:General \d+|Bank\d+|SharedBank\d+|Held)$/.test(location))fail(400,'unknown_inventory_location',`Line ${line}: unrecognized inventory location "${location}". Nothing was imported.`);storageRows++;ignoredRows++;continue;}
  const occurrence=counts.get(location)||0,definition=choices[occurrence];if(!definition)fail(400,'duplicate_inventory_slot',`Line ${line}: too many ${location} equipment entries.`);
  counts.set(location,occurrence+1);
  parent={slotKey:definition[1],label:definition[2],location,itemId:itemId||null,quantity:count,exportedName:itemId?name:null,line,augments:[],emptySockets:[]};slots.push(parent);byLocation.set(location,parent);
 }
 if(slots.length!==23||definitions.some(([,key])=>!slots.some(s=>s.slotKey===key)))fail(400,'incomplete_inventory','The export must contain all 23 equipment locations, including Empty entries. Nothing was imported.');
 return{slots,summary:{equipped:slots.filter(s=>s.itemId!==null).length,emptySlots:slots.filter(s=>s.itemId===null).length,augmentCount,emptyAugments,storageRows,keyRingRows,ignoredRows}};
}
const ownerSql="SELECT id,name,class_name AS className,owner_id AS ownerId,kind FROM characters WHERE id=? AND owner_id=? AND kind IN('main','alt') AND approved_at IS NOT NULL";
const currentSql='SELECT e.slot_key AS slotKey,e.item_id AS itemId,r.name AS itemName FROM character_equipment e LEFT JOIN item_references r ON r.item_id=e.item_id WHERE e.character_id=?';
async function readInput(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'content_type','Send JSON inventory data.');
 const raw=await readText(request,{limit:INVENTORY_MAX_BYTES+256*1024,sizeCode:'inventory_too_large',sizeMessage:'Choose an inventory text file under 2 MiB.',fatalUtf8:true});
 let input;try{input=JSON.parse(raw);}catch{fail(400,'invalid_json','Send valid inventory upload data.');}
 if(!input||Array.isArray(input)||typeof input.text!=='string'||typeof input.fileName!=='string'||!/\.txt$/i.test(input.fileName)||input.fileName.length>180||/[\\/\x00-\x1f]/.test(input.fileName))fail(400,'invalid_inventory','Choose a .txt inventory export.');return input;
}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function owner(db,characterId,userId){const row=await statement(db,ownerSql,characterId,userId).first();if(!row)fail(403,'forbidden','Only the approved character owner may upload its inventory.');return row;}
function mayWrite(context){return !Object.hasOwn(context,'access')||['overview','mains'].some(key=>context.access?.permissions?.[key]===3);}
export async function getInventoryAugments(db,characterId,{withOperations=false}={}){
 const rows=await statement(db,'SELECT a.slot_key AS slotKey,a.operation_id AS operationId,a.augments_json AS augments FROM inventory_equipment_augments a JOIN character_equipment e ON e.character_id=a.character_id AND e.slot_key=a.slot_key AND e.operation_id=a.operation_id WHERE a.character_id=?',characterId).all();
 return Object.fromEntries(rows.results.map(row=>[row.slotKey,withOperations?{operationId:row.operationId,augments:JSON.parse(row.augments)}:JSON.parse(row.augments)]));
}
export function createInventoryApi({catalog}={}){
 return async function(request,env,context={}){
  const route=/^\/api\/characters\/([^/]+)\/inventory\/(preview|import)$/.exec(new URL(request.url).pathname);if(!route)return null;
  try{
   if(!context.user?.id)fail(401,'unauthorized','Sign in to upload character inventory.');if(!env?.DB)fail(503,'database_unavailable','Inventory storage is unavailable.');
   if(request.method!=='POST')fail(405,'method_not_allowed','Use POST for inventory previews and imports.');
   if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'origin','A same-origin request is required.');if(!context.csrfToken||request.headers.get('x-csrf-token')!==context.csrfToken)fail(403,'csrf','Refresh your session before uploading inventory.');
   if(!mayWrite(context))fail(403,'forbidden','Profile write access is required to import inventory.');
   const db=env.DB,characterId=route[1],userId=context.user.id,character=await owner(db,characterId,userId),data=await readInput(request),parsed=parseInventoryExport(data.text),fileHash=await hash(data.text);
   const current=new Map((await statement(db,currentSql,characterId).all()).results.map(row=>[row.slotKey,row]));
   const getItem=async id=>id&&catalog?.getCatalogItem?await catalog.getCatalogItem(db,id):null;
   if(route[2]==='preview'){
    const slots=[];
    for(const row of parsed.slots){const item=await getItem(row.itemId),previous=current.get(row.slotKey),currentItemId=previous?.itemId??null;slots.push({...row,itemName:item?.name||row.exportedName,catalogAvailable:!!item,currentItemId,currentItemName:previous?.itemName??null,status:row.itemId===null?'empty':row.itemId===currentItemId?'same':item?'ready':'missing_reference',selectedByDefault:currentItemId===null&&row.itemId!==null});}
    return response({character,importId:crypto.randomUUID(),fileName:data.fileName,fileHash,slots,summary:parsed.summary});
   }
   if(typeof data.importId!=='string'||!/^[-a-f0-9]{36}$/i.test(data.importId)||!Array.isArray(data.selections)||!data.selections.length||data.selections.length>23)fail(400,'validation','Preview the inventory and select one or more equipment slots.');
   const selected=new Map();for(const choice of data.selections){if(!choice||selected.has(choice.slotKey)||!parsed.slots.some(s=>s.slotKey===choice.slotKey&&s.itemId!==null)||!(choice.expectedItemId===null||isItemId(choice.expectedItemId)))fail(400,'validation','Select each nonempty equipment slot once with its previous item ID.');selected.set(choice.slotKey,choice.expectedItemId);}
   const choices=parsed.slots.filter(row=>selected.has(row.slotKey)),requestHash=await hash(JSON.stringify({characterId,userId,fileHash,selections:[...selected].sort(([a],[b])=>a.localeCompare(b))}));
   const prior=await statement(db,'SELECT request_hash AS requestHash,applied_count AS imported,actor_id AS actorId,character_id AS characterId FROM inventory_imports WHERE id=?',data.importId).first();
   if(prior){if(prior.requestHash!==requestHash||prior.actorId!==userId||prior.characterId!==characterId)fail(409,'inventory_conflict','This import identifier has already been used. Preview the file again.');return response({imported:prior.imported,alreadyApplied:true});}
   const references=new Map();for(const row of choices){for(const part of [row,...row.augments]){const id=part.itemId;if(!references.has(id)){const item=await getItem(id);references.set(id,item||{itemId:id,name:part.exportedName||part.name,sourceUrl:'https://items.eqresource.com/items.php?id='+id,metadataStatus:'unresolved'});}}}
   const at=new Date().toISOString(),nonce=crypto.randomUUID(),queries=[],checks=choices.map(()=> 'COALESCE((SELECT item_id FROM character_equipment WHERE character_id=c.id AND slot_key=?),0)=COALESCE(?,0)').join(' AND ');
   queries.push(statement(db,`INSERT INTO inventory_imports(id,character_id,actor_id,file_name,file_hash,request_hash,operation_nonce,applied_count,created_at) SELECT ?,c.id,?,?,?,?,?,?,? FROM characters c WHERE c.id=? AND c.owner_id=? AND c.kind IN('main','alt') AND c.approved_at IS NOT NULL AND ${checks} ON CONFLICT(id) DO NOTHING`,data.importId,userId,data.fileName,fileHash,requestHash,nonce,choices.length,at,characterId,userId,...choices.flatMap(row=>[row.slotKey,selected.get(row.slotKey)])));
   // Cache selected uploaded details in the same transaction, including augments.
   // Historical auction snapshots are separate. Unknown export identities never
   // overwrite rich cached details; all writes require this exact import nonce.
   const chunks=[];let records=[],recordBytes=2;
   for(const item of references.values()){
    const record={...item,metadataStatus:item.metadataStatus==='verified_reference'?'verified_reference':'unresolved',sourceUrl:'https://items.eqresource.com/items.php?id='+item.itemId},bytes=new TextEncoder().encode(JSON.stringify(record)).byteLength+1;
    if(bytes>1024*1024)fail(413,'inventory_too_large','An item reference is too large to import. Select fewer items or use a smaller catalog record.');
    if(records.length&&recordBytes+bytes>1024*1024){chunks.push(records);records=[];recordBytes=2;}records.push(record);recordBytes+=bytes;
   }if(records.length)chunks.push(records);
   if(chunks.length+choices.length*2+2>94)fail(413,'inventory_too_large','Select fewer equipment slots for this import.');
   for(const records of chunks)queries.push(statement(db,`INSERT INTO item_references(item_id,name,classes_json,races_json,slots_json,stats_json,flags_json,advanced_loot,source_url,source_checked_at,source_updated_at,retrieved_at,verification_method,metadata_status,full_details_json,icon_url,metadata_complete,source_status_json)
    SELECT json_extract(value,'$.itemId'),json_extract(value,'$.name'),json_extract(value,'$.classes'),json_extract(value,'$.races'),json_extract(value,'$.slots'),json_extract(value,'$.stats'),json_extract(value,'$.flags'),json_extract(value,'$.advancedLoot'),json_extract(value,'$.sourceUrl'),json_extract(value,'$.sourceCheckedAt'),json_extract(value,'$.sourceUpdatedAt'),?,CASE WHEN json_extract(value,'$.metadataStatus')='verified_reference' THEN 'Uploaded item catalog; selected through inventory export' ELSE 'EverQuest inventory export: item identity only' END,json_extract(value,'$.metadataStatus'),json_extract(value,'$.details'),NULL,COALESCE(json_extract(value,'$.metadataComplete'),0),json_extract(value,'$.sourceStatus') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM inventory_imports WHERE id=? AND operation_nonce=?)
    ON CONFLICT(item_id) DO UPDATE SET name=excluded.name,classes_json=excluded.classes_json,races_json=excluded.races_json,slots_json=excluded.slots_json,stats_json=excluded.stats_json,flags_json=excluded.flags_json,advanced_loot=excluded.advanced_loot,source_checked_at=excluded.source_checked_at,source_updated_at=excluded.source_updated_at,retrieved_at=excluded.retrieved_at,verification_method=excluded.verification_method,metadata_status=excluded.metadata_status,full_details_json=excluded.full_details_json,icon_url=NULL,metadata_complete=excluded.metadata_complete,source_status_json=excluded.source_status_json WHERE excluded.metadata_status='verified_reference'`,at,JSON.stringify(records),data.importId,nonce));
   for(const row of choices){
    const operation=nonce+':'+row.slotKey;
    queries.push(statement(db,`INSERT INTO character_equipment(character_id,slot_key,item_id,source,updated_at,updated_by,operation_id) SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM auction_awards w JOIN auctions a ON a.id=w.auction_id WHERE w.character_id=? AND a.item_id=? AND w.status='confirmed') THEN 'award' ELSE 'reference' END,?,?,? WHERE EXISTS(SELECT 1 FROM inventory_imports WHERE id=? AND operation_nonce=?) ON CONFLICT(character_id,slot_key) DO UPDATE SET item_id=excluded.item_id,source=excluded.source,updated_at=excluded.updated_at,updated_by=excluded.updated_by,operation_id=excluded.operation_id`,characterId,row.slotKey,row.itemId,characterId,row.itemId,at,userId,operation,data.importId,nonce));
    queries.push(statement(db,`INSERT INTO inventory_equipment_augments(character_id,slot_key,operation_id,augments_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM inventory_imports WHERE id=? AND operation_nonce=?) ON CONFLICT(character_id,slot_key) DO UPDATE SET operation_id=excluded.operation_id,augments_json=excluded.augments_json`,characterId,row.slotKey,operation,JSON.stringify(row.augments.map(({socket,itemId,name})=>({socket,itemId,name}))),data.importId,nonce));
   }
   queries.push(statement(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'character_inventory_imported',?,? WHERE EXISTS(SELECT 1 FROM inventory_imports WHERE id=? AND operation_nonce=?)`,crypto.randomUUID(),userId,JSON.stringify({characterId,subjectUserId:userId,importId:data.importId,fileHash,slots:choices.map(row=>({slot:row.slotKey,previousItemId:selected.get(row.slotKey),itemId:row.itemId,augments:row.augments.map(({socket,itemId})=>({socket,itemId}))}))}),at,data.importId,nonce));
   const result=await db.batch(queries);
   if(!result[0].meta.changes){await owner(db,characterId,userId);const retry=await statement(db,'SELECT request_hash AS requestHash,applied_count AS imported FROM inventory_imports WHERE id=?',data.importId).first();if(retry?.requestHash===requestHash)return response({imported:retry.imported,alreadyApplied:true});fail(409,'inventory_conflict','Equipment changed since the preview. Preview the file again before importing.');}
   return response({imported:choices.length,alreadyApplied:false});
  }catch(error){return response({error:error instanceof InventoryError?error.message:'The inventory import could not be completed. Preview the file before retrying.',code:error.code||'inventory_error'},error.status||500);}
 };
}
