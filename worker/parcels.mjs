import {HttpError,readJson,requireCsrf,jsonResponse} from './http.mjs';
// Role and looter ownership are checked against current database records, never
// the policy adapter's legacy role or a looter name supplied by the caller.
export const PARCEL_ADMIN_SQL = `EXISTS(SELECT 1 FROM users pu LEFT JOIN access_user_profiles pa ON pa.user_id=pu.id JOIN access_profiles pp ON pp.id=COALESCE(pa.profile_id,CASE WHEN pu.role='admin' THEN 'admin' ELSE 'member' END) WHERE pu.id=? AND pp.template_key='admin')`;
export const PARCEL_OWNER_SQL = `EXISTS(SELECT 1 FROM characters pc WHERE pc.owner_id=? AND pc.kind IN('main','alt') AND pc.approved_at IS NOT NULL AND pc.name_key=lower(trim(h.holder_name)))`;
export const PARCEL_CAN_SQL = `(${PARCEL_ADMIN_SQL} OR ${PARCEL_OWNER_SQL}) AND EXISTS(SELECT 1 FROM access_effective_permissions pe WHERE pe.user_id=? AND ((json_type(pe.permissions_json,'$.auctions')='integer' AND json_extract(pe.permissions_json,'$.auctions')=3) OR (json_type(pe.permissions_json,'$.auctionAdmin')='integer' AND json_extract(pe.permissions_json,'$.auctionAdmin')=3)))`;
const normalize=value=>String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
// The proof includes every linked source row, even exclusions and other items.
// Rechecking it in the INSERT batch fences the JS canonicalization against a
// changed handoff, export order, quantity, exclusion or source topology.
export function custodyProofSql(auctionExpression) {
 return `(SELECT json_group_array(json_object('draftItemId',x.draftItemId,'sourceName',x.sourceName,'groupId',x.groupId,'groupStatus',x.groupStatus,'eventId',x.eventId,'signature',x.signature,'itemName',x.itemName,'quantity',x.quantity,'holderName',x.holderName,'excluded',x.excluded,'revision',x.revision,'ordinal',x.ordinal)) FROM (
 SELECT li.id AS draftItemId,li.name AS sourceName,g.id AS groupId,g.status AS groupStatus,e.id AS eventId,e.evidence_signature AS signature,e.item_name AS itemName,e.quantity,e.holder AS holderName,e.excluded,e.revision,link.ordinal
 FROM loot_draft_items li JOIN raid_loot_import_groups g ON g.draft_id=li.draft_id JOIN raid_loot_import_events e ON e.handoff_group_id=g.id JOIN raid_loot_import_links link ON link.event_id=e.id AND link.group_id=g.id AND link.import_id=g.import_id WHERE li.auction_id=${auctionExpression} ORDER BY link.ordinal,e.id) x)`;
}
export async function resolveAwardHolders(db,auctionId=null) {
 const multiple=Array.isArray(auctionId),single=typeof auctionId==='string';
 const scope=multiple?' AND a.id IN(SELECT value FROM json_each(?))':single?' AND a.id=?':'',params=multiple?[JSON.stringify(auctionId)]:single?[auctionId]:[];
 const result=await db.batch([
  db.prepare(`SELECT g.draft_id AS draftId,e.id AS eventId,e.item_name AS itemName,e.quantity,e.holder AS holderName,e.excluded,link.ordinal FROM raid_loot_import_groups g JOIN raid_loot_import_events e ON e.handoff_group_id=g.id JOIN raid_loot_import_links link ON link.event_id=e.id AND link.group_id=g.id AND link.import_id=g.import_id WHERE EXISTS(SELECT 1 FROM loot_draft_items li JOIN auctions a ON a.id=li.auction_id WHERE li.draft_id=g.draft_id AND a.status='closed' AND a.cancelled_at_ms IS NULL${scope}) ORDER BY g.draft_id,link.ordinal,e.id`).bind(...params),
  db.prepare(`SELECT w.auction_id AS auctionId,w.character_id AS characterId,w.award_rank AS rank,li.draft_id AS draftId,li.name AS sourceName FROM auction_awards w JOIN auctions a ON a.id=w.auction_id LEFT JOIN loot_draft_items li ON li.auction_id=a.id WHERE a.status='closed' AND a.cancelled_at_ms IS NULL${scope}`).bind(...params),
  ...(single?[db.prepare(`SELECT ${custodyProofSql('?')} AS proof`).bind(auctionId)]:[])
 ]);
 const sources=new Map();
 for(const event of result[0].results){
  if(event.excluded)continue;
  if(!sources.has(event.draftId))sources.set(event.draftId,new Map());
  const byName=sources.get(event.draftId),name=normalize(event.itemName);
  if(!byName.has(name))byName.set(name,[]);
  const items=byName.get(name);items.push({...event,through:(items.at(-1)?.through||0)+event.quantity});
 }
 return result[1].results.map(award=>{
  const events=sources.get(award.draftId)?.get(normalize(award.sourceName))||[];
  const holder=events.find(event=>award.rank<=event.through);
  return {auctionId:award.auctionId,characterId:award.characterId,rank:award.rank,holderEventId:holder?.eventId??null,holderName:holder?.holderName??null,proof:result[2]?.results[0]?.proof??null};
 });
}
export const CUSTODY_CTE = `WITH h AS MATERIALIZED(SELECT json_extract(value,'$.auctionId') AS auction_id,json_extract(value,'$.characterId') AS character_id,json_extract(value,'$.holderEventId') AS holder_event_id,json_extract(value,'$.holderName') AS holder_name FROM json_each(?)) `;
export async function handleParcelApi(request,env,context={}) {
 const route=/^\/api\/loot-history\/([^/]+)\/([^/]+)\/parcel$/.exec(new URL(request.url).pathname);
 if(!route)return null;
 try {
  if(!context.user?.id)throw new HttpError(401,'unauthorized','Sign in to record a parcel.');
  if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST to record a parcel.');
  requireCsrf(request,context.csrfToken);
  const input=await readJson(request,{limit:2048});
  if(input.parceled!==true||!(input.holderEventId===null||typeof input.holderEventId==='string'&&input.holderEventId.length<=128))throw new HttpError(400,'validation','Confirm the parcel using its recorded holding looter.');
  const [auctionId,characterId]=route.slice(1).map(decodeURIComponent),actor=context.user.id,op=crypto.randomUUID(),at=new Date().toISOString(),db=env.DB;
  const holding=(await resolveAwardHolders(db,auctionId)).find(row=>row.characterId===characterId);
  if(!holding||holding.holderEventId!==input.holderEventId)throw new HttpError(409,'parcel_unavailable','The holding copy changed. Refresh the delivery record.');
  const permission=PARCEL_CAN_SQL;
  const result=await db.batch([
   db.prepare(`INSERT INTO loot_parcels(auction_id,character_id,holder_event_id,holder_name,parceled_by,parceled_at,operation_id)
    SELECT w.auction_id,w.character_id,h.holder_event_id,h.holder_name,?,?,? FROM auction_awards w
    JOIN auctions a ON a.id=w.auction_id JOIN (SELECT ? AS holder_event_id,? AS holder_name) h
    WHERE w.auction_id=? AND w.character_id=? AND w.status='confirmed' AND a.status='closed' AND a.cancelled_at_ms IS NULL
    AND w.award_rank=? AND ${custodyProofSql('w.auction_id')}=? AND ${permission} ON CONFLICT(auction_id,character_id) DO NOTHING`).bind(actor,at,op,holding.holderEventId,holding.holderName,auctionId,characterId,holding.rank,holding.proof,actor,actor,actor),
   db.prepare(`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'loot_parceled',json_object('auctionId',p.auction_id,'characterId',p.character_id,'item',a.item_name,'winner',c.name,'looter',p.holder_name),? FROM loot_parcels p JOIN auctions a ON a.id=p.auction_id JOIN characters c ON c.id=p.character_id WHERE p.operation_id=?`).bind(crypto.randomUUID(),actor,at,op),
   db.prepare(`SELECT p.parceled_at AS parceledAt,p.parceled_by AS parceledBy FROM loot_parcels p JOIN (SELECT ? AS holder_name) h WHERE p.auction_id=? AND p.character_id=? AND ${permission}`).bind(holding.holderName,auctionId,characterId,actor,actor,actor)
  ]);
  const parcel=result[2].results[0];
  if(!parcel)throw new HttpError(409,'parcel_unavailable','Only an administrator or the current approved holding looter can mark a confirmed award parceled. Refresh the record.');
  return jsonResponse({parcel});
 }catch(error){if(error instanceof HttpError)return jsonResponse({error:error.message,code:error.code},error.status);throw error;}
}
