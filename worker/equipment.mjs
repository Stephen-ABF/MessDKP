// Website equipment notes only. No inventory sync, gameplay or DKP side effects.
export const EQUIPMENT_SLOTS=Object.freeze([
 ['charm','Charm','CHARM'],['ear1','Left ear','EAR'],['head','Head','HEAD'],['face','Face','FACE'],['ear2','Right ear','EAR'],['neck','Neck','NECK'],['shoulders','Shoulders','SHOULDERS'],['arms','Arms','ARMS'],['back','Back','BACK'],['wrist1','Left wrist','WRIST'],['wrist2','Right wrist','WRIST'],['ranged','Ranged','RANGE'],['hands','Hands','HANDS'],['primary','Primary','PRIMARY'],['secondary','Secondary','SECONDARY'],['finger1','Left finger','FINGER'],['finger2','Right finger','FINGER'],['chest','Chest','CHEST'],['legs','Legs','LEGS'],['feet','Feet','FEET'],['waist','Waist','WAIST'],['powerSource','Power source','POWER SOURCE'],['ammo','Ammo','AMMO']
].map(([key,label,sourceSlot])=>Object.freeze({key,label,sourceSlot})));
class EquipmentError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new EquipmentError(status,code,message);};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql=(db,query,...params)=>db.prepare(query).bind(...params);
const validItem=value=>value===null||Number.isSafeInteger(value)&&value>0;
const characterQuery="SELECT c.id,c.name,c.class_name AS className,c.kind,c.owner_id AS ownerId,CASE WHEN u.role='admin' OR (c.owner_id=u.id AND c.kind IN('main','alt') AND c.approved_at IS NOT NULL) THEN 1 ELSE 0 END AS can_edit FROM characters c JOIN users u ON u.id=? WHERE c.id=?";
const slotQuery='SELECT e.slot_key AS slotKey,e.item_id AS itemId,r.name AS itemName,e.source,e.updated_at AS updatedAt FROM character_equipment e LEFT JOIN item_references r ON r.item_id=e.item_id WHERE e.character_id=?';
function slotShape(key,row){const definition=EQUIPMENT_SLOTS.find(s=>s.key===key);return {...definition,itemId:row?.itemId??null,itemName:row?.itemId?(row.itemName||'EQ Item '+row.itemId):null,source:row?.itemId?row.source:null,updatedAt:row?.updatedAt??null};}
async function input(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'content_type','Send JSON equipment data.');
 const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
 if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel().catch(()=>{});fail(413,'too_large','Equipment requests must be at most 8 KiB.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 let parsed;try{parsed=JSON.parse(raw);}catch{fail(400,'invalid_json','Send valid JSON equipment data.');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Object.hasOwn(parsed,'itemId')||!Object.hasOwn(parsed,'expectedItemId')||!validItem(parsed.itemId)||!validItem(parsed.expectedItemId))fail(400,'validation','Supply itemId and expectedItemId as positive whole item IDs or null.');return parsed;
}
async function character(db,id,userId){const row=await sql(db,characterQuery,userId,id).first();if(!row)fail(404,'not_found','Character not found.');return row;}
export function createEquipmentApi({knownItems=[]}={}){
 const known=new Map(knownItems.filter(i=>Number.isSafeInteger(i.itemId)&&i.itemId>0).map(i=>[i.itemId,i]));
 return async function(request,env,context={}){
 const route=/^\/api\/characters\/([^/]+)\/equipment(?:\/([^/]+))?$/.exec(new URL(request.url).pathname);if(!route)return null;
 try{
  if(!context.user?.id)fail(401,'unauthorized','Sign in to view character equipment.');if(!env?.DB)fail(503,'database_unavailable','Character equipment storage is unavailable.');
  const db=env.DB,characterId=route[1],key=route[2];
  if(request.method==='GET'&&!key){
   const result=await db.batch([sql(db,characterQuery,context.user.id,characterId),sql(db,slotQuery,characterId)]),row=result[0].results[0];if(!row)fail(404,'not_found','Character not found.');
   const rows=new Map(result[1].results.map(s=>[s.slotKey,s]));const {can_edit,...character}=row;return json({character,canEdit:!!can_edit,slots:EQUIPMENT_SLOTS.map(s=>slotShape(s.key,rows.get(s.key)))});
  }
  if(request.method!=='PUT'||!key)fail(405,'method_not_allowed','Use GET to view equipment or PUT to update one equipment slot.');
  if(!EQUIPMENT_SLOTS.some(s=>s.key===key))fail(400,'invalid_slot','Choose a valid character equipment slot.');
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'origin','A same-origin request is required.');if(!context.csrfToken||request.headers.get('x-csrf-token')!==context.csrfToken)fail(403,'csrf','Refresh your session before updating equipment.');
  const data=await input(request),row=await character(db,characterId,context.user.id);if(!row.can_edit)fail(403,'forbidden','Only this approved character owner or an officer may edit its equipment.');
  let seed=null;
  if(data.itemId!==null&&!await sql(db,'SELECT item_id FROM item_references WHERE item_id=?',data.itemId).first()){seed=known.get(data.itemId);if(!seed)fail(400,'unknown_item','Add this item reference to the guild catalog before selecting it.');}
  const old=await sql(db,slotQuery+' AND e.slot_key=?',characterId,key).first();
  if((old?.itemId??null)===data.itemId)return json({slot:slotShape(key,old),alreadyApplied:true});
  if((old?.itemId??null)!==data.expectedItemId)fail(409,'equipment_conflict','This equipment slot changed. Refresh the character profile before saving.');
  const operation=crypto.randomUUID(),at=new Date().toISOString();
  const mutations=[];
  if(seed)mutations.push(sql(db,`INSERT INTO item_references(item_id,name,classes_json,races_json,slots_json,stats_json,flags_json,advanced_loot,source_url,source_checked_at,source_updated_at,retrieved_at,verification_method,metadata_status)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM characters c JOIN users u ON u.id=? WHERE c.id=?
    AND (u.role='admin' OR (c.owner_id=u.id AND c.kind IN('main','alt') AND c.approved_at IS NOT NULL))
    AND COALESCE((SELECT item_id FROM character_equipment WHERE character_id=c.id AND slot_key=?),0)=COALESCE(?,0)
   ON CONFLICT(item_id) DO NOTHING`,seed.itemId,seed.name,...['classes','races','slots','stats','flags'].map(k=>seed[k]==null?null:JSON.stringify(seed[k])),seed.advancedLoot??null,seed.sourceUrl,seed.sourceCheckedAt??null,seed.sourceUpdatedAt??null,seed.retrievedAt,seed.verificationMethod,seed.metadataStatus,context.user.id,characterId,key,data.expectedItemId));
  const equipmentIndex=mutations.length;
  mutations.push(
   sql(db,`INSERT INTO character_equipment(character_id,slot_key,item_id,source,updated_at,updated_by,operation_id)
    SELECT c.id,?,?,CASE WHEN ? IS NULL THEN NULL WHEN EXISTS(SELECT 1 FROM auction_awards w JOIN auctions a ON a.id=w.auction_id WHERE w.character_id=c.id AND a.item_id=? AND w.status='confirmed') THEN 'award' ELSE 'reference' END,?,?,?
    FROM characters c JOIN users u ON u.id=? WHERE c.id=?
     AND (u.role='admin' OR (c.owner_id=u.id AND c.kind IN('main','alt') AND c.approved_at IS NOT NULL))
     AND COALESCE((SELECT item_id FROM character_equipment WHERE character_id=c.id AND slot_key=?),0)=COALESCE(?,0)
     AND (? IS NULL OR EXISTS(SELECT 1 FROM item_references WHERE item_id=?))
    ON CONFLICT(character_id,slot_key) DO UPDATE SET item_id=excluded.item_id,source=excluded.source,updated_at=excluded.updated_at,updated_by=excluded.updated_by,operation_id=excluded.operation_id`,key,data.itemId,data.itemId,data.itemId,at,context.user.id,operation,context.user.id,characterId,key,data.expectedItemId,data.itemId,data.itemId),
   sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'character_equipment_changed',?,? WHERE EXISTS(SELECT 1 FROM character_equipment WHERE character_id=? AND slot_key=? AND operation_id=?)`,crypto.randomUUID(),context.user.id,JSON.stringify({characterId,slot:key,previousItemId:data.expectedItemId,itemId:data.itemId}),at,characterId,key,operation)
  );
  const result=await db.batch(mutations);
  const current=await sql(db,slotQuery+' AND e.slot_key=?',characterId,key).first();
  if(!result[equipmentIndex].meta.changes){
   if(!(await character(db,characterId,context.user.id)).can_edit)fail(403,'forbidden','Only this approved character owner or an officer may edit its equipment.');
   if((current?.itemId??null)===data.itemId)return json({slot:slotShape(key,current),alreadyApplied:true});
   fail(409,'equipment_conflict','This equipment slot changed. Refresh the character profile before saving.');
  }
  return json({slot:slotShape(key,current),alreadyApplied:false});
 }catch(error){return json({error:error instanceof EquipmentError?error.message:'The equipment update could not be completed. Refresh before retrying.',code:error.code||'equipment_error'},error.status||500);}
 };
}
export const handleEquipmentApi=createEquipmentApi();
