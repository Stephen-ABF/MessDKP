import {HttpError as AuditLogError,readJson,requireCsrf,constantTimeEqual} from './http.mjs';
// Filtered audit history; original audit evidence is never rewritten.
const auditJson=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const auditFail=(status,code,message)=>{throw new AuditLogError(status,code,message);};
const auditSql=(db,query,...params)=>db.prepare(query).bind(...params);
function auditDate(value,label){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')auditFail(400,'invalid_filter',label+' must be an actual YYYY-MM-DD date.');
 const d=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)auditFail(400,'invalid_filter',label+' must be an actual YYYY-MM-DD date.');return value;
}
function auditFilters(url){
 const allowed=new Set(['actorId','subjectUserId','characterId','action','q','from','to','limit','offset']);
 for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)auditFail(400,'invalid_filter','Use each supported audit filter at most once.');
 const filters={};
 for(const key of ['actorId','subjectUserId','characterId','action','q']){const value=(url.searchParams.get(key)||'').trim();if(value.length>(key==='q'?120:128)||/[\u0000-\u001f\u007f]/.test(value))auditFail(400,'invalid_filter','Keep audit filter values short and printable.');if(value)filters[key]=value;}
 for(const key of ['from','to']){const value=(url.searchParams.get(key)||'').trim();if(value)filters[key]=auditDate(value,key==='from'?'Start date':'End date');}
 if(filters.from&&filters.to&&filters.from>filters.to)auditFail(400,'invalid_filter','The start date must not follow the end date.');
 for(const [key,fallback,min,max]of[['limit',50,1,100],['offset',0,0,1000000]]){const raw=url.searchParams.get(key)??String(fallback);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)auditFail(400,'invalid_filter','Choose a valid audit '+key+'.');filters[key]=Number(raw);}
 return filters;
}
// CASE protects malformed legacy JSON. Subject resolution deliberately avoids
// present-day ownership, which can differ from the person affected by an event.
const AUDIT_RECORDS=`WITH evidence AS (
 SELECT a.id,a.actor_id AS actorId,u.name AS actorName,a.action,a.details,a.created_at AS createdAt,CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END AS evidence
 FROM audit a JOIN users u ON u.id=a.actor_id
), targets AS (
 SELECT e.*,COALESCE(json_extract(e.evidence,'$.characterId'),q.character_id,cr.character_id) AS characterId,
 COALESCE(json_extract(e.evidence,'$.subjectUserId'),json_extract(e.evidence,'$.previousOwnerId'),json_extract(e.evidence,'$.userId'),json_extract(e.evidence,'$.requesterId'),q.user_id,cr.requester_id,CASE WHEN e.action IN('login','account_registered','claim_requested','character_requested') THEN e.actorId END) AS explicitSubjectId
 FROM evidence e LEFT JOIN claims q ON q.id=COALESCE(json_extract(e.evidence,'$.claimId'),json_extract(e.evidence,'$.reopenedClaimId'))
 LEFT JOIN correction_requests cr ON cr.id=json_extract(e.evidence,'$.requestId')
), resolved AS (
 SELECT t.*,COALESCE(t.explicitSubjectId,CASE WHEN julianday(t.createdAt) IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM assignment_events boundary WHERE boundary.character_id=t.characterId AND boundary.action IN('approved','detached') AND julianday(boundary.resolved_at)=julianday(t.createdAt)
 ) THEN (
  SELECT CASE WHEN COUNT(*)=1 THEN MAX(CASE WHEN h.action='approved' THEN h.user_id END) END FROM assignment_events h
  WHERE h.character_id=t.characterId AND h.action IN('approved','detached') AND julianday(h.resolved_at)=(
   SELECT MAX(julianday(prior.resolved_at)) FROM assignment_events prior WHERE prior.character_id=t.characterId AND prior.action IN('approved','detached') AND julianday(prior.resolved_at)<julianday(t.createdAt)
  )
 ) END) AS subjectUserId
 FROM targets t
), records AS (
 SELECT r.id,r.actorId,r.actorName,r.action,r.details,r.createdAt,r.characterId,c.name AS characterName,r.subjectUserId,subject.name AS subjectUserName,
 raid.name AS raidName,COALESCE(json_extract(r.evidence,'$.itemName'),auction.item_name,item.name) AS itemName
 FROM resolved r LEFT JOIN characters c ON c.id=r.characterId LEFT JOIN users subject ON subject.id=r.subjectUserId
 LEFT JOIN ticks tick ON tick.id=json_extract(r.evidence,'$.tickId')
 LEFT JOIN raids raid ON raid.id=COALESCE(json_extract(r.evidence,'$.raidId'),tick.raid_id)
 LEFT JOIN auctions auction ON auction.id=json_extract(r.evidence,'$.auctionId')
 LEFT JOIN item_references item ON item.item_id=json_extract(r.evidence,'$.itemId')
)`;
export function auditDescription(entry){
 let details={};try{const value=typeof entry.details==='string'?JSON.parse(entry.details):entry.details;if(value&&typeof value==='object'&&!Array.isArray(value))details=value;}catch{}
 const text=value=>typeof value==='string'?value.trim().slice(0,1000):'',who=text(entry.characterName)||text(entry.subjectUserName)||'the recorded member',raid=text(entry.raidName)||text(details.raidName)||text(details.name)||'the recorded raid',item=text(entry.itemName)||'the recorded item';
 const descriptions={login:'Signed in.',account_registered:'Created a guild account.',character_requested:`Requested a new character: ${text(details.name)||who}.`,claim_requested:`Requested ownership of ${who}.`,claim_approved:`Approved ownership of ${who}${['main','alt'].includes(details.kind)?' as '+details.kind:''}.`,character_detached:`Detached ${who} from its account.`,raid_created:`Created ${raid}${text(details.date)?' on '+text(details.date):''}.`,raid_deleted:`Deleted ${raid} and its associated raid records.`,attendance_import:`Imported attendance for ${raid}${Array.isArray(details.fileNames)?' from '+details.fileNames.length+' source capture(s)':''}.`,attendance_tick_cloned:`Cloned an attendance capture for ${raid}.`,dkp_adjustment:`Adjusted DKP for ${who}${Number.isSafeInteger(details.amount)?' by '+(details.amount>0?'+':'')+details.amount+' DKP':''}.`,attendance_correction_requested:`Requested missing attendance for ${who}.`,attendance_correction_approved:`Approved missing attendance for ${who}${Number.isSafeInteger(details.creditedDkp)?'; credited '+details.creditedDkp+' DKP':''}.`,attendance_correction_rejected:`Rejected the missing attendance request for ${who}.`,auction_published:`Published ${Number.isSafeInteger(details.quantity)?details.quantity+(details.quantity===1?' copy of ':' copies of '):''}${item}.`,auction_closed:`Completed bidding for ${item}.`,auction_cancelled:`Cancelled the auction for ${item}.`,auction_completed_early:`Completed bidding early for ${item}.`,auction_award_confirmed:`Confirmed ${item} for ${who}${Number.isSafeInteger(details.price)?' at '+details.price+' DKP':''}.`,character_equipment_changed:`Updated equipment for ${who}: ${item}.`,settings_changed:'Updated guild reward settings.',item_catalog_imported:`Updated the item catalog${Number.isSafeInteger(details.itemCount)?' with '+details.itemCount+' items':''}.`};
 let description=descriptions[entry.action]||String(entry.action||'Guild activity').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase())+(entry.characterName?' for '+who:'')+'.';
 const reason=text(details.decisionReason)||text(details.reason);if(reason)description+=' Reason: '+reason;return description;
}
export async function handleAuditLogApi(request,env,auth={}){
 const url=new URL(request.url);if(url.pathname!=='/api/audit')return null;
 try{
  if(!auth.user?.id)auditFail(401,'unauthorized','Sign in to view audit history.');
  if(auth.access?![2,3].includes(auth.access.permissions?.audit):auth.user.role!=='admin')auditFail(403,'forbidden','Audit read access is required.');
  if(request.method!=='GET')auditFail(405,'method_not_allowed','Audit history is read-only.');
  if(!env?.DB)auditFail(503,'database_unavailable','Audit history storage is unavailable.');
  const filters=auditFilters(url),where=[],params=[];
  for(const key of ['actorId','subjectUserId','characterId','action'])if(filters[key]){where.push(key+'=?');params.push(filters[key]);}
  if(filters.q){where.push("instr(lower(COALESCE(actorName,'')||' '||action||' '||COALESCE(characterName,'')||' '||COALESCE(subjectUserName,'')||' '||details),lower(?))>0");params.push(filters.q);}
  if(filters.from){where.push('substr(createdAt,1,10)>=?');params.push(filters.from);}
  if(filters.to){where.push('substr(createdAt,1,10)<=?');params.push(filters.to);}
  const condition=where.length?' WHERE '+where.join(' AND '):'',db=env.DB;
  const results=await db.batch([
   auditSql(db,AUDIT_RECORDS+' SELECT * FROM records'+condition+' ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?',...params,filters.limit,filters.offset),
   auditSql(db,AUDIT_RECORDS+' SELECT COUNT(*) AS total FROM records'+condition,...params),
   auditSql(db,'SELECT DISTINCT u.id,u.name FROM users u JOIN audit a ON a.actor_id=u.id ORDER BY u.name COLLATE NOCASE,u.id'),
   auditSql(db,'SELECT id,name FROM users ORDER BY name COLLATE NOCASE,id'),
   auditSql(db,'SELECT id,name FROM characters ORDER BY name COLLATE NOCASE,id'),
   auditSql(db,'SELECT DISTINCT action FROM audit ORDER BY action')
  ]);
  return auditJson({entries:results[0].results.map(entry=>({...entry,description:auditDescription(entry)})),total:results[1].results[0].total,limit:filters.limit,offset:filters.offset,filters:{actors:results[2].results,subjects:results[3].results,characters:results[4].results,actions:results[5].results.map(row=>row.action)}});
 }catch(error){return auditJson({error:error instanceof AuditLogError?error.message:'The audit history could not be loaded.',code:error instanceof AuditLogError?error.code:'audit_error'},error.status||500);}
}
