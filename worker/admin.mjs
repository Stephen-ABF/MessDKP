const encoder = new TextEncoder();
const MAX_BODY = 128 * 1024;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
class AdminError extends Error { constructor(status,code,message) { super(message); this.status=status; this.code=code; } }
const fail = (status,code,message) => { throw new AdminError(status,code,message); };
const sql = (db,query,...params) => db.prepare(query).bind(...params);
const all = async statement => (await statement.all()).results;
const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function text(value,field,min=1,max=1000) { if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(400,'validation',`${field} must contain ${min}-${max} characters.`);return value.trim(); }
function positive(value,field) {if(!Number.isSafeInteger(value)||value<1||value>1000000)fail(400,'validation',`${field} must be a whole number from 1 to 1000000.`);return value;}
function sameText(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
function officer(user) {if(user.role!=='admin')fail(403,'forbidden','Officer access is required.');}
async function body(request) {
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'content_type','Send JSON data.');
 if(Number(request.headers.get('content-length')||0)>MAX_BODY)fail(413,'too_large','Request is too large.');
 const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
 if(reader){try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel().catch(()=>{});fail(413,'too_large','Request is too large.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 try{const result=JSON.parse(raw);if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{fail(400,'invalid_json','Invalid JSON request.');}
}
const requestSelect=`SELECT q.id,q.tick_id AS tickId,q.character_id AS characterId,c.name AS characterName,q.requester_id AS requesterId,u.name AS requesterName,t.raid_id AS raidId,r.name AS raidName,t.source_time AS sourceTime,q.reason,q.status,q.tick_rate AS tickRate,q.created_at AS createdAt,q.decision_reason AS decisionReason,q.decided_by AS decidedBy,d.name AS decidedByName,q.decided_at AS decidedAt FROM correction_requests q JOIN characters c ON c.id=q.character_id JOIN users u ON u.id=q.requester_id JOIN ticks t ON t.id=q.tick_id JOIN raids r ON r.id=t.raid_id LEFT JOIN users d ON d.id=q.decided_by`;
const adjustmentSelect=`SELECT a.id,a.character_id AS characterId,c.name AS characterName,a.amount,a.reason,a.actor_id AS actorId,u.name AS actorName,a.idempotency_key AS idempotencyKey,a.created_at AS createdAt FROM dkp_adjustments a JOIN characters c ON c.id=a.character_id JOIN users u ON u.id=a.actor_id`;
const defaultSettings=()=>({defaultTickRate:5,minimumBid:1,presets:[],updatedAt:null,updatedBy:null});
async function readSettings(db) {
 const row=await sql(db,'SELECT settings_json,updated_at,updated_by FROM guild_settings WHERE id=1').first();
 return row?{...JSON.parse(row.settings_json),updatedAt:row.updated_at,updatedBy:row.updated_by}:defaultSettings();
}
function settingsInput(input) {
 const defaultTickRate=positive(input.defaultTickRate,'Default tick rate'),minimumBid=positive(input.minimumBid,'Minimum bid');
 if(!Array.isArray(input.presets)||input.presets.length>100)fail(400,'validation','Provide at most 100 rate presets.');
 const keys=new Set(),presets=input.presets.map(preset=>{
  if(!preset||typeof preset!=='object')fail(400,'validation','Each rate preset needs an expansion, raid type, and rate.');
  const expansion=text(preset.expansion,'Expansion',1,100),raidType=text(preset.raidType,'Raid type',1,100),rate=positive(preset.rate,'Preset rate');
  const key=JSON.stringify([expansion.toLowerCase(),raidType.toLowerCase()]);if(keys.has(key))fail(400,'validation','Each expansion and raid-type pair must be unique.');keys.add(key);return {expansion,raidType,rate};
 });
 return {defaultTickRate,minimumBid,presets};
}
async function saveSettings(request,db,user) {
 officer(user);const settings=settingsInput(await body(request)),value=JSON.stringify(settings),operation=id(),at=now();
 await db.batch([
  sql(db,`INSERT INTO guild_settings(id,settings_json,updated_by,updated_at,operation_id) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_by=CASE WHEN guild_settings.settings_json=excluded.settings_json THEN guild_settings.updated_by ELSE excluded.updated_by END,updated_at=CASE WHEN guild_settings.settings_json=excluded.settings_json THEN guild_settings.updated_at ELSE excluded.updated_at END,operation_id=CASE WHEN guild_settings.settings_json=excluded.settings_json THEN guild_settings.operation_id ELSE excluded.operation_id END,settings_json=excluded.settings_json`,value,user.id,at,operation),
  sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'settings_changed',?,? WHERE EXISTS(SELECT 1 FROM guild_settings WHERE id=1 AND operation_id=?)`,id(),user.id,JSON.stringify({settings,appliesTo:'new_raids_and_auctions_only'}),at,operation)
 ]);
 const stored=await sql(db,'SELECT operation_id FROM guild_settings WHERE id=1').first();
 return json({settings:await readSettings(db),appliesTo:'new_raids_and_auctions_only',changed:stored.operation_id===operation});
}
async function createRequest(request,db,user) {
 const input=await body(request),tickId=text(input.tickId,'Attendance tick',1,100),characterId=text(input.characterId,'Character',1,100),reason=text(input.reason,'Reason');
 const character=await sql(db,'SELECT id FROM characters WHERE id=? AND owner_id=? AND kind=\'main\'',characterId,user.id).first();
 if(!character)fail(403,'main_required','Request attendance only for your own approved main.');
 const tick=await sql(db,'SELECT t.id,r.rate FROM ticks t JOIN raids r ON r.id=t.raid_id WHERE t.id=?',tickId).first();if(!tick)fail(404,'not_found','Attendance tick not found.');
 const rates=await sql(db,'SELECT MIN(dkp) AS rate,COUNT(DISTINCT dkp) AS variants FROM attendance WHERE tick_id=?',tickId).first();
 if(rates.variants>1)fail(409,'tick_rate_conflict','This tick has conflicting recorded rates and needs officer review.');
 const rate=positive(rates.rate??tick.rate,'Original tick rate');
 const existing=await sql(db,requestSelect+' WHERE q.tick_id=? AND q.character_id=?',tickId,characterId).first();
 if(existing){if(existing.requesterId!==user.id||existing.reason!==reason)fail(409,'request_exists','An attendance request already exists for this main and tick.');return json({request:existing,duplicate:true});}
 const requestId=id(),at=now();
 await db.batch([
  sql(db,`INSERT INTO correction_requests(id,tick_id,character_id,requester_id,reason,tick_rate,created_at) SELECT ?,?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM characters WHERE id=? AND owner_id=? AND kind='main') ON CONFLICT(tick_id,character_id) DO NOTHING`,requestId,tickId,characterId,user.id,reason,rate,at,characterId,user.id),
  sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'attendance_correction_requested',?,? WHERE EXISTS(SELECT 1 FROM correction_requests WHERE id=?)`,id(),user.id,JSON.stringify({requestId,tickId,characterId,subjectUserId:user.id,reason,tickRate:rate}),at,requestId)
 ]);
 const result=await sql(db,requestSelect+' WHERE q.tick_id=? AND q.character_id=?',tickId,characterId).first();
 if(!result)fail(409,'request_conflict','The character assignment changed. Refresh and try again.');
 if(result.requesterId!==user.id||result.reason!==reason)fail(409,'request_exists','Another request already exists for this main and tick.');
 return json({request:result,duplicate:result.id!==requestId},result.id===requestId?201:200);
}
async function decideRequest(request,db,user,requestId,decision) {
 officer(user);const input=await body(request),reason=text(input.reason,'Decision reason');
 const current=await sql(db,requestSelect+' WHERE q.id=?',requestId).first();if(!current)fail(404,'not_found','Attendance request not found.');
 if(current.status!=='pending'){
  if(current.status!==decision||current.decisionReason!==reason)fail(409,'decision_conflict','This request already has another recorded decision.');
  return json({request:current,creditedDkp:0,duplicate:true});
 }
 if(decision==='approved'){
  const eligible=await sql(db,"SELECT id FROM characters WHERE id=? AND owner_id=? AND kind='main'",current.characterId,current.requesterId).first();
  if(!eligible)fail(409,'main_required','This request no longer belongs to an approved main.');
  const existing=await sql(db,'SELECT dkp FROM attendance WHERE tick_id=? AND character_id=?',current.tickId,current.characterId).first();
  if(existing&&existing.dkp!==current.tickRate)fail(409,'tick_rate_conflict','Existing attendance uses another rate and needs officer review.');
 }
 const operation=id(),at=now();
 const statusExpression=decision==='approved'?`CASE WHEN EXISTS(SELECT 1 FROM ledger l JOIN attendance a ON a.id=l.attendance_id WHERE a.tick_id=correction_requests.tick_id AND a.character_id=correction_requests.character_id) OR ((SELECT COALESCE(SUM(amount),0) FROM ledger WHERE character_id=correction_requests.character_id)+tick_rate BETWEEN ? AND ?) THEN ? ELSE NULL END`:'?';
 const statusValues=decision==='approved'?[-MAX_SAFE,MAX_SAFE,decision]:[decision];
 const statements=[sql(db,`UPDATE correction_requests SET status=${statusExpression},decision_reason=?,decided_by=?,decided_at=?,decision_op=? WHERE id=? AND status='pending'${decision==='approved'?" AND EXISTS(SELECT 1 FROM characters c WHERE c.id=correction_requests.character_id AND c.owner_id=correction_requests.requester_id AND c.kind='main')":''}`,...statusValues,reason,user.id,at,operation,requestId)];
 if(decision==='approved'){
  statements.push(
   sql(db,`INSERT INTO attendance(id,tick_id,character_id,class_name,zone,status,dkp) SELECT lower(hex(randomblob(16))),q.tick_id,q.character_id,c.class_name,'Officer correction','pending',q.tick_rate FROM correction_requests q JOIN characters c ON c.id=q.character_id WHERE q.id=? AND q.decision_op=? AND q.status='approved' ON CONFLICT(tick_id,character_id) DO NOTHING`,requestId,operation),
   sql(db,`INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) SELECT lower(hex(randomblob(16))),q.character_id,a.id,q.tick_rate,'Missing attendance approved: '||q.reason,?,?,? FROM correction_requests q JOIN attendance a ON a.tick_id=q.tick_id AND a.character_id=q.character_id WHERE q.id=? AND q.decision_op=? AND q.status='approved' ON CONFLICT(attendance_id) DO NOTHING`,user.id,at,operation,requestId,operation),
   sql(db,`UPDATE attendance SET status='credited' WHERE tick_id=? AND character_id=? AND EXISTS(SELECT 1 FROM correction_requests q WHERE q.id=? AND q.decision_op=?) AND EXISTS(SELECT 1 FROM ledger l WHERE l.attendance_id=attendance.id)`,current.tickId,current.characterId,requestId,operation)
  );
 }
 statements.push(sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,?,json_object('requestId',q.id,'tickId',q.tick_id,'characterId',q.character_id,'subjectUserId',q.requester_id,'requestReason',q.reason,'decisionReason',q.decision_reason,'creditedDkp',(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE operation_id=?),'originalDumpPreserved',1),? FROM correction_requests q WHERE q.id=? AND q.decision_op=?`,id(),user.id,decision==='approved'?'attendance_correction_approved':'attendance_correction_rejected',operation,at,requestId,operation));
 try{await db.batch(statements);}catch(error){if(/correction_requests\.status/i.test(String(error)))fail(400,'balance_range','This credit would exceed the supported exact integer balance range. No attendance or decision was changed.');throw error;}
 const result=await sql(db,requestSelect+' WHERE q.id=?',requestId).first();
 if(result.status!==decision||result.decisionReason!==reason)fail(409,'decision_conflict','Another officer decision was recorded. Refresh to review it.');
 const credit=await sql(db,'SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE operation_id=?',operation).first();
 const operationResult=await sql(db,'SELECT decision_op FROM correction_requests WHERE id=?',requestId).first();
 return json({request:result,creditedDkp:credit.n,duplicate:operationResult.decision_op!==operation});
}
function sameAdjustment(row,input,user) {return row.characterId===input.characterId&&row.amount===input.amount&&row.reason===input.reason&&row.actorId===user.id;}
async function adjustmentBalance(db,characterId) {return (await sql(db,'SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE character_id=?',characterId).first()).n;}
async function adjust(request,db,user) {
 officer(user);const bodyInput=await body(request),input={characterId:text(bodyInput.characterId,'Character',1,100),amount:bodyInput.amount,reason:text(bodyInput.reason,'Reason'),idempotencyKey:text(bodyInput.idempotencyKey,'Idempotency key',8,128)};
 if(!Number.isSafeInteger(input.amount)||input.amount===0)fail(400,'validation','Adjustment amount must be a nonzero signed safe integer.');
 const character=await sql(db,"SELECT id FROM characters WHERE id=? AND kind='main' AND owner_id IS NOT NULL",input.characterId).first();if(!character)fail(400,'main_required','Adjust DKP only for an approved main.');
 const existing=await sql(db,adjustmentSelect+' WHERE a.idempotency_key=?',input.idempotencyKey).first();
 if(existing){if(!sameAdjustment(existing,input,user))fail(409,'idempotency_conflict','This key was already used for a different adjustment.');return json({adjustment:existing,duplicate:true,balance:await adjustmentBalance(db,input.characterId)});}
 const adjustmentId=id(),operation=id(),at=now();
 try{await db.batch([
  sql(db,`INSERT INTO dkp_adjustments(id,idempotency_key,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dkp_adjustments WHERE idempotency_key=?) OR ((SELECT COALESCE(SUM(amount),0) FROM ledger WHERE character_id=?)+? BETWEEN ? AND ?) THEN ? ELSE NULL END,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=CASE WHEN dkp_adjustments.character_id=excluded.character_id AND dkp_adjustments.amount=excluded.amount AND dkp_adjustments.reason=excluded.reason AND dkp_adjustments.actor_id=excluded.actor_id THEN dkp_adjustments.idempotency_key ELSE NULL END`,adjustmentId,input.idempotencyKey,input.characterId,input.amount,-MAX_SAFE,MAX_SAFE,input.idempotencyKey,input.characterId,input.amount,input.reason,user.id,at,operation),
  sql(db,`INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) SELECT 'adjustment:'||a.id,a.character_id,NULL,a.amount,'Officer adjustment: '||a.reason,a.actor_id,a.created_at,a.operation_id FROM dkp_adjustments a WHERE a.id=? AND a.operation_id=? ON CONFLICT(id) DO NOTHING`,adjustmentId,operation),
  sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'dkp_adjustment',json_object('adjustmentId',a.id,'characterId',a.character_id,'subjectUserId',(SELECT c.owner_id FROM characters c WHERE c.id=a.character_id),'amount',a.amount,'reason',a.reason,'idempotencyKey',a.idempotency_key,'balanceAfter',(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE character_id=a.character_id)),? FROM dkp_adjustments a WHERE a.id=? AND a.operation_id=?`,id(),user.id,at,adjustmentId,operation)
 ]);}catch(error){
  if(/dkp_adjustments|constraint|UNIQUE/i.test(String(error))){const conflicting=await sql(db,adjustmentSelect+' WHERE a.idempotency_key=?',input.idempotencyKey).first();if(conflicting&&!sameAdjustment(conflicting,input,user))fail(409,'idempotency_conflict','This key was already used for a different adjustment.');if(!conflicting)fail(400,'balance_range','This adjustment would exceed the supported exact integer balance range.');}
  throw error;
 }
 const result=await sql(db,adjustmentSelect+' WHERE a.idempotency_key=?',input.idempotencyKey).first();
 if(!result||!sameAdjustment(result,input,user))fail(409,'idempotency_conflict','Another adjustment used this key.');
 return json({adjustment:result,duplicate:result.id!==adjustmentId,balance:await adjustmentBalance(db,input.characterId)},result.id===adjustmentId?201:200);
}
export async function handleAdminApi(request,env,context={}) {
 const url=new URL(request.url),path=url.pathname.replace(/\/$/,'')||'/';
 if(path!=='/api/settings'&&path!=='/api/adjustments'&&path!=='/api/attendance-requests'&&!path.startsWith('/api/attendance-requests/'))return null;
 try{
  if(!env.DB)fail(503,'database_unavailable','The database is not configured.');const db=env.DB,user=context.user;
  if(!user?.id)fail(401,'authentication_required','Please sign in.');
  if(!['GET','POST','PUT'].includes(request.method))fail(405,'method_not_allowed','Method not allowed.');
  if(request.method!=='GET'){
   if(request.headers.get('origin')!==url.origin)fail(403,'origin','A same-origin request is required.');
   if(!context.csrfToken||!sameText(request.headers.get('x-csrf-token'),context.csrfToken))fail(403,'csrf','Refresh your session and try again.');
  }
  if(path==='/api/settings'&&request.method==='GET')return json({settings:await readSettings(db),appliesTo:'new_raids_and_auctions_only'});
  if(path==='/api/settings'&&request.method==='PUT')return await saveSettings(request,db,user);
  if(path==='/api/adjustments'&&request.method==='POST')return await adjust(request,db,user);
  if(path==='/api/attendance-requests'&&request.method==='GET')return json({requests:await all(sql(db,requestSelect+(user.role==='admin'?'':' WHERE q.requester_id=?')+' ORDER BY q.created_at DESC,q.id DESC',...(user.role==='admin'?[]:[user.id])))});
  if(path==='/api/attendance-requests'&&request.method==='POST')return await createRequest(request,db,user);
  const match=/^\/api\/attendance-requests\/([^/]+)\/(approve|reject)$/.exec(path);
  if(match&&request.method==='POST')return await decideRequest(request,db,user,match[1],match[2]==='approve'?'approved':'rejected');
  fail(404,'not_found','Endpoint not found.');
 }catch(error){if(error instanceof AdminError)return json({error:error.message,code:error.code},error.status);return json({error:'The request could not be completed. Please refresh and try again.',code:'internal_error'},500);}
}
