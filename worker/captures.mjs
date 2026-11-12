const CAPTURE_LIFETIME=86400000;
const captureJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class CaptureError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const captureFail=(status,code,message)=>{throw new CaptureError(status,code,message);};
const captureSql=(db,q,...values)=>db.prepare(q).bind(...values);
const captureAll=async statement=>(await statement.all()).results;
const captureHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const captureText=(v,label,max=150)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max||/[\x00-\x1f\x7f]/.test(v))captureFail(400,'validation',`${label} is required (up to ${max} printable characters).`);return v.trim();};
async function captureBody(request,empty=false){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')){if(empty&&!request.body)return {};captureFail(415,'content_type','Send JSON data.');}
 const reader=request.body?.getReader(),decoder=new TextDecoder();let text='',size=0;
 if(reader){try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel().catch(()=>{});captureFail(413,'too_large','Capture request exceeds 256 KiB.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
 if(empty&&!text.trim())return {};
 try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{captureFail(400,'invalid_json','Send valid JSON data.');}
}
const captureEvent=row=>({id:row.event_id,eventId:row.event_id,sender:row.sender,sourceTime:row.source_time,fileName:row.file_name,offset:row.file_offset,line:row.raw_line,ignored:!!row.ignored,items:JSON.parse(row.items_json),warnings:JSON.parse(row.warnings_json)});
function captureShape(row,events=[]){return {id:row.id,bossName:row.boss_name,raidId:row.raid_id,channelName:row.channel_name,allowedSenders:JSON.parse(row.senders_json),status:row.status,createdAt:row.created_at,expiresAt:new Date(row.expires_at_ms).toISOString(),draftId:row.draft_id,eventCount:events.length,ignoredCount:events.filter(e=>e.ignored).length,itemCount:events.filter(e=>!e.ignored).reduce((n,e)=>n+e.items.length,0),warningCount:events.filter(e=>!e.ignored).reduce((n,e)=>n+e.warnings.length,0)};}

export function createCaptureApi({parseLootChannelLine,handleLootApi,clock=()=>Date.now()}={}){
 const load=async(db,id)=>{const row=await captureSql(db,'SELECT * FROM capture_sessions WHERE id=?',id).first();if(!row)captureFail(404,'not_found','Loot capture not found.');return row;};
 const events=async(db,id)=>(await captureAll(captureSql(db,'SELECT * FROM capture_events WHERE capture_id=? ORDER BY received_at,file_offset,event_id',id))).map(captureEvent);
 const read=async(db,id)=>{const row=await load(db,id),list=await events(db,id);return {session:captureShape(row,list),events:list,warnings:[...new Set(list.filter(e=>!e.ignored).flatMap(e=>e.warnings))]};};
 function mutation(request,context){if(request.headers.get('origin')!==new URL(request.url).origin)captureFail(403,'origin','A same-origin request is required.');if(!context.csrfToken||request.headers.get('x-csrf-token')!==context.csrfToken)captureFail(403,'csrf','Refresh your session before changing loot capture.');}
 function creatorAllowed(identity,accessEnabled){return accessEnabled?"EXISTS(SELECT 1 FROM access_effective_permissions acl WHERE acl.user_id="+identity+" AND json_type(acl.permissions_json,'$.captures')='integer' AND json_extract(acl.permissions_json,'$.captures')=3)":"EXISTS(SELECT 1 FROM users creator WHERE creator.id="+identity+" AND creator.role='admin')";}
 async function tokenSession(request,db,accessEnabled=false){
  if(request.headers.has('origin'))captureFail(403,'native_only','Use the external companion for capture uploads.');
  const match=/^Bearer (gdcp_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');if(!match)captureFail(401,'capture_token','A valid capture pairing token is required.');
  const row=await captureSql(db,`SELECT s.* FROM capture_sessions s WHERE s.token_hash=? AND ${creatorAllowed('s.created_by',accessEnabled)}`,await captureHash(match[1])).first();
  if(!row)captureFail(401,'capture_token','This capture pairing token is invalid.');
  if(row.status!=='open'||row.expires_at_ms<=clock())captureFail(410,'capture_closed','This capture is finished, revoked, or expired. Create a new capture for the next boss.');return row;
 }
 async function ingest(request,db,row,accessEnabled=false){
  const input=await captureBody(request);
  if(typeof input.watcherId!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(input.watcherId))captureFail(400,'validation','A stable companion watcher ID is required.');
  if(row.watcher_id&&row.watcher_id!==input.watcherId)captureFail(409,'capture_source_conflict','Another companion is paired to this capture. Resume its saved state or create a new capture.');
  if(!Array.isArray(input.events)||!input.events.length||input.events.length>50)captureFail(400,'validation','Send 1-50 captured messages per request.');
  const old=await captureAll(captureSql(db,'SELECT event_id,signature,payload_hash FROM capture_events WHERE capture_id=?',row.id));
  const existing=new Map(old.map(e=>[e.event_id,e])),payloads=new Set(old.map(e=>e.payload_hash)),ids=new Set(),records=[];let unrelated=0;
  for(const event of input.events){
   if(!event||typeof event.eventId!=='string'||!/^([a-f0-9]{64})$/.test(event.eventId)||ids.has(event.eventId))captureFail(400,'validation','Each message needs a distinct stable SHA-256 event ID.');ids.add(event.eventId);
   if(!Number.isSafeInteger(event.offset)||event.offset<0)captureFail(400,'validation','A nonnegative log byte offset is required.');
   const fileName=captureText(event.fileName,'Log filename',250);if(/[\\/:]/.test(fileName))captureFail(400,'validation','Send the log filename without its local directory.');
   if(typeof event.line!=='string'||event.line.length>32768)captureFail(400,'validation','A captured log line is required.');
   const parsed=parseLootChannelLine(event.line,{channelName:row.channel_name,allowedSenders:JSON.parse(row.senders_json)});
   if(!parsed||!parsed.items.length){unrelated++;continue;}
   const signature=await captureHash(JSON.stringify({line:event.line,fileName,offset:event.offset}));
   if(existing.has(event.eventId)&&existing.get(event.eventId).signature!==signature)captureFail(409,'event_conflict','A capture event ID was reused for different log data.');
   const payloadHash=await captureHash(parsed.payload),warnings=[...parsed.warnings];
   if(!existing.has(event.eventId)&&payloads.has(payloadHash))warnings.push('Repeated identical loot message payload counted again. Review whether this was a repost before publishing.');payloads.add(payloadHash);
   records.push({eventId:event.eventId,signature,fileName,offset:event.offset,line:event.line,sender:parsed.sender,sourceTime:parsed.sourceTime,payloadHash,items:parsed.items,warnings});
  }
  if(!records.length)return captureJson({accepted:0,duplicates:0,unrelated,sessionId:row.id});
  const encoded=JSON.stringify(records),operation=crypto.randomUUID(),at=new Date(clock()).toISOString();
  const results=await db.batch([
   captureSql(db,`UPDATE capture_sessions SET watcher_id=COALESCE(watcher_id,?),ingest_op=? WHERE id=? AND token_hash=? AND status='open' AND expires_at_ms>? AND (watcher_id IS NULL OR watcher_id=?) AND ${creatorAllowed('capture_sessions.created_by',accessEnabled)} AND NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN capture_events e ON e.capture_id=capture_sessions.id AND e.event_id=json_extract(j.value,'$.eventId') WHERE e.signature<>json_extract(j.value,'$.signature')) AND (SELECT COUNT(*) FROM capture_events WHERE capture_id=capture_sessions.id)+(SELECT COUNT(*) FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM capture_events e WHERE e.capture_id=capture_sessions.id AND e.event_id=json_extract(j.value,'$.eventId')))<=200 AND (SELECT COALESCE(SUM(item_count),0) FROM capture_events WHERE capture_id=capture_sessions.id)+(SELECT COALESCE(SUM(json_array_length(json_extract(j.value,'$.items'))),0) FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM capture_events e WHERE e.capture_id=capture_sessions.id AND e.event_id=json_extract(j.value,'$.eventId')))<=1000 AND (SELECT COALESCE(SUM(length(CAST(raw_line AS BLOB))+1),0) FROM capture_events WHERE capture_id=capture_sessions.id)+(SELECT COALESCE(SUM(length(CAST(json_extract(j.value,'$.line') AS BLOB))+1),0) FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM capture_events e WHERE e.capture_id=capture_sessions.id AND e.event_id=json_extract(j.value,'$.eventId')))<=524288`,input.watcherId,operation,row.id,row.token_hash,clock(),input.watcherId,encoded,encoded,encoded,encoded),
   captureSql(db,`INSERT INTO capture_events(capture_id,event_id,signature,file_name,file_offset,raw_line,sender,source_time,payload_hash,items_json,warnings_json,item_count,warning_count,received_at) SELECT ?,json_extract(value,'$.eventId'),json_extract(value,'$.signature'),json_extract(value,'$.fileName'),json_extract(value,'$.offset'),json_extract(value,'$.line'),json_extract(value,'$.sender'),json_extract(value,'$.sourceTime'),json_extract(value,'$.payloadHash'),json_extract(value,'$.items'),json_extract(value,'$.warnings'),json_array_length(json_extract(value,'$.items')),json_array_length(json_extract(value,'$.warnings')),? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND ingest_op=?) ON CONFLICT(capture_id,event_id) DO NOTHING`,row.id,at,encoded,row.id,operation)
  ]);
  if(!results[0].meta.changes)captureFail(409,'capture_changed','Capture changed, reached its limit, or stopped. Refresh its website page before retrying.');
  const stored=await captureAll(captureSql(db,'SELECT event_id,signature FROM capture_events WHERE capture_id=?',row.id));const actual=new Map(stored.map(e=>[e.event_id,e.signature]));
  if(records.some(e=>actual.get(e.eventId)!==e.signature))captureFail(409,'event_conflict','A capture event changed. Review it before retrying.');
  const accepted=results[1].meta.changes;return captureJson({accepted,duplicates:records.length-accepted,unrelated,sessionId:row.id});
 }
 async function prepare(request,env,context,row){
  if(row.status==='finished')return captureJson({session:(await read(env.DB,row.id)).session,draftId:row.draft_id});
  if(row.status==='revoked')captureFail(409,'capture_revoked','A revoked capture cannot create a draft. Its captured evidence remains available.');
  await captureSql(env.DB,"UPDATE capture_sessions SET status='preparing',prepared_by=COALESCE(prepared_by,?) WHERE id=? AND status='open'",context.user.id,row.id).run();
  row=await load(env.DB,row.id);if(row.status==='finished')return captureJson({session:(await read(env.DB,row.id)).session,draftId:row.draft_id});if(row.status!=='preparing')captureFail(409,'capture_changed','Refresh the capture before preparing it.');
  const list=(await events(env.DB,row.id)).filter(e=>!e.ignored);
  if(!list.length){await captureSql(env.DB,"UPDATE capture_sessions SET status='open' WHERE id=? AND status='preparing'",row.id).run();captureFail(400,'empty_capture','Capture at least one loot message before preparing a draft.');}
  const origin=new URL(request.url).origin,internalToken=crypto.randomUUID();
  const payload={bossName:row.boss_name,raidId:row.raid_id,idempotencyKey:'capture-'+row.id,chatCapture:{channelName:row.channel_name,allowedSenders:JSON.parse(row.senders_json)},files:[{name:'Capture '+row.id+'.log',text:list.map(e=>e.line).join('\n'),format:'log'}]};
  const response=await handleLootApi(new Request(origin+'/api/loot/drafts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':internalToken},body:JSON.stringify(payload)}),env,{user:{id:row.prepared_by,role:'admin'},csrfToken:internalToken});
  const data=await response.json();
  if(response.status>=400){if(response.status<500)await captureSql(env.DB,"UPDATE capture_sessions SET status='open' WHERE id=? AND status='preparing'",row.id).run();return captureJson(data,response.status);}
  const draftId=data.draft.id,at=new Date(clock()).toISOString();
  await env.DB.batch([
   captureSql(env.DB,"UPDATE capture_sessions SET status='finished',draft_id=? WHERE id=? AND status='preparing'",draftId,row.id),
   captureSql(env.DB,"INSERT OR IGNORE INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'loot_capture_prepared',?,? WHERE EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND draft_id=?)",'capture-prepared-'+row.id,context.user.id,JSON.stringify({captureId:row.id,draftId,preparedBy:row.prepared_by}),at,row.id,draftId)
  ]);
  return captureJson({session:(await read(env.DB,row.id)).session,draftId});
 }
 return async function handleCaptureApi(request,env,context={}){
  const path=new URL(request.url).pathname,native=path.startsWith('/api/companion/');if(!native&&path!=='/api/captures'&&!path.startsWith('/api/captures/'))return null;
  try{
   if(!env.DB)captureFail(503,'database_unavailable','The capture database is unavailable.');
   if(native){const row=await tokenSession(request,env.DB,!!env.FEATURE_ACCESS);if(path==='/api/companion/session'&&request.method==='GET')return captureJson({session:captureShape(row)});if(path==='/api/companion/events'&&request.method==='POST')return await ingest(request,env.DB,row,!!env.FEATURE_ACCESS);captureFail(405,'method_not_allowed','Companion endpoint not supported.');}
   if(!context.user?.id)captureFail(401,'unauthorized','Sign in to manage live loot capture.');if(context.user.role!=='admin')captureFail(403,'forbidden','Officer access is required for live loot capture.');if(request.method!=='GET')mutation(request,context);
   if(path==='/api/captures'&&request.method==='GET'){
    const rows=await captureAll(captureSql(env.DB,`SELECT s.*,COUNT(e.event_id) AS event_count,COALESCE(SUM(e.ignored),0) AS ignored_count,COALESCE(SUM(CASE WHEN e.ignored=0 THEN e.item_count ELSE 0 END),0) AS item_count,COALESCE(SUM(CASE WHEN e.ignored=0 THEN e.warning_count ELSE 0 END),0) AS warning_count FROM capture_sessions s LEFT JOIN capture_events e ON e.capture_id=s.id GROUP BY s.id ORDER BY s.created_at DESC,s.id LIMIT 100`));return captureJson({sessions:rows.map(r=>({...captureShape(r),eventCount:r.event_count,ignoredCount:r.ignored_count,itemCount:r.item_count,warningCount:r.warning_count}))});
   }
   if(path==='/api/captures'&&request.method==='POST'){
    const input=await captureBody(request),bossName=captureText(input.bossName,'Boss name'),channelName=input.channelName??'abfloot',allowedSenders=input.allowedSenders??[];
    parseLootChannelLine('',{channelName,allowedSenders});
    const raidId=input.raidId?captureText(input.raidId,'Raid ID',100):null;if(raidId&&!await captureSql(env.DB,'SELECT id FROM raids WHERE id=?',raidId).first())captureFail(404,'raid_not_found','Choose an existing raid.');
    const id=crypto.randomUUID(),token='gdcp_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),at=new Date(clock()).toISOString();
    await env.DB.batch([captureSql(env.DB,'INSERT INTO capture_sessions(id,boss_name,raid_id,created_by,channel_name,senders_json,token_hash,created_at,expires_at_ms) VALUES(?,?,?,?,?,?,?,?,?)',id,bossName,raidId,context.user.id,channelName,JSON.stringify(allowedSenders),await captureHash(token),at,clock()+CAPTURE_LIFETIME),captureSql(env.DB,"INSERT INTO audit(id,actor_id,action,details,created_at) VALUES(?,?,'loot_capture_created',?,?)",crypto.randomUUID(),context.user.id,JSON.stringify({captureId:id,bossName,channelName}),at)]);
    return captureJson({session:(await read(env.DB,id)).session,pairing:{version:1,siteUrl:new URL(request.url).origin,captureId:id,token}},201);
   }
   const route=/^\/api\/captures\/([^/]+)(?:\/(prepare|revoke|pair|events)(?:\/([a-f0-9]{64}))?)?$/.exec(path);if(!route)captureFail(404,'not_found','Capture endpoint not found.');let row=await load(env.DB,route[1]);
   if(!route[2]&&request.method==='GET')return captureJson(await read(env.DB,row.id));
   if(route[2]==='pair'&&request.method==='POST'){
    await captureBody(request,true);if(row.status!=='open')captureFail(409,'capture_changed','Only an open capture can reconnect a companion.');
    const token='gdcp_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),hash=await captureHash(token),operation=crypto.randomUUID(),at=new Date(clock()).toISOString();
    const result=await env.DB.batch([captureSql(env.DB,"UPDATE capture_sessions SET token_hash=?,expires_at_ms=?,ingest_op=? WHERE id=? AND status='open'",hash,clock()+CAPTURE_LIFETIME,operation,row.id),captureSql(env.DB,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'loot_capture_repaired',?,? WHERE EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND ingest_op=? AND token_hash=?)",operation,context.user.id,JSON.stringify({captureId:row.id}),at,row.id,operation,hash)]);
    if(!result[0].meta.changes)captureFail(409,'capture_changed','The capture stopped before it could reconnect.');
    return captureJson({session:(await read(env.DB,row.id)).session,pairing:{version:1,siteUrl:new URL(request.url).origin,captureId:row.id,token}});
   }
   if(route[2]==='prepare'&&request.method==='POST'){await captureBody(request,true);return await prepare(request,env,context,row);}
   if(route[2]==='revoke'&&request.method==='POST'){
    if(row.status!=='open'&&row.status!=='revoked')captureFail(409,'capture_changed','Only an open capture can be revoked.');
    if(row.status==='revoked')return captureJson({session:(await read(env.DB,row.id)).session});
    const operation=crypto.randomUUID();
    const result=await env.DB.batch([captureSql(env.DB,"UPDATE capture_sessions SET status='revoked',ingest_op=? WHERE id=? AND status='open'",operation,row.id),captureSql(env.DB,"INSERT OR IGNORE INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'loot_capture_revoked',?,? WHERE EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND status='revoked' AND ingest_op=?)",'capture-revoked-'+row.id,context.user.id,JSON.stringify({captureId:row.id}),new Date(clock()).toISOString(),row.id,operation)]);
    const latest=(await read(env.DB,row.id)).session;
    if(!result[0].meta.changes&&latest.status!=='revoked')captureFail(409,'capture_changed','Capture preparation already started; this connection was not revoked.');
    return captureJson({session:latest});
   }
   if(route[2]==='events'&&route[3]&&request.method==='PUT'){
    const input=await captureBody(request);if(typeof input.ignore!=='boolean')captureFail(400,'validation','Choose whether to ignore this message.');if(row.status!=='open')captureFail(409,'capture_changed','Only open captures can be reviewed.');
    const operation=crypto.randomUUID(),at=new Date(clock()).toISOString();
    const result=await env.DB.batch([captureSql(env.DB,"UPDATE capture_events SET ignored=? WHERE capture_id=? AND event_id=? AND EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND status='open')",input.ignore?1:0,row.id,route[3],row.id),captureSql(env.DB,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'loot_capture_message_reviewed',?,? WHERE changes()>0",operation,context.user.id,JSON.stringify({captureId:row.id,eventId:route[3],ignored:input.ignore}),at)]);
    if(!result[0].meta.changes)captureFail(409,'capture_changed','Message not found or capture stopped. Refresh it.');return captureJson(await read(env.DB,row.id));
   }
   captureFail(405,'method_not_allowed','Capture method not supported.');
  }catch(error){return captureJson({error:error.status?error.message:'The capture request could not be completed. Retry without discarding local queued messages.',code:error.code||'capture_error'},error.status||500);}
 };
}
