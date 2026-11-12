// Persistent, capture-only native device authorization. No browser sessions or DKP.
const deviceJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class DeviceError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const deviceFail=(status,code,message)=>{throw new DeviceError(status,code,message);};
const deviceSql=(db,q,...values)=>db.prepare(q).bind(...values);
const deviceHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const deviceSecret=prefix=>prefix+Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const deviceAllowed=(identity,minimum=3)=>"EXISTS(SELECT 1 FROM access_effective_permissions acl WHERE acl.user_id="+identity+" AND json_type(acl.permissions_json,'$.captures')='integer' AND json_extract(acl.permissions_json,'$.captures') BETWEEN "+minimum+" AND 3)";
const deviceDto=r=>({id:r.id,label:r.label,status:r.status,activeCaptureId:r.active_capture_id,readyCaptureId:r.ready_capture_id,lastSeenAt:r.last_seen_at_ms==null?null:new Date(r.last_seen_at_ms).toISOString(),expiresAt:new Date(r.expires_at_ms).toISOString(),createdAt:new Date(r.created_at_ms).toISOString()});
async function deviceBody(request,max=8192){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))deviceFail(415,'content_type','Send JSON data.');
 const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
 if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel().catch(()=>{});deviceFail(413,'too_large','The companion request is too large.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 try{const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw Error();return d;}catch{deviceFail(400,'invalid_json','Send valid JSON data.');}
}
function deviceGuardDb(db,device,tokenHash,captureId,clock){
 let denied=false;const raw=Symbol('raw');
 async function execute(statements){const op=crypto.randomUUID();try{const result=await db.batch([deviceSql(db,'INSERT INTO companion_device_guards VALUES(?,?,?,?,?)',op,device.id,tokenHash,captureId,clock()),...statements,deviceSql(db,'DELETE FROM companion_device_guards WHERE operation_id=?',op)]);return result.slice(1,-1);}catch(error){if(/COMPANION_DEVICE_DENIED/.test(String(error)))denied=true;throw error;}}
 class Statement{constructor(s){this[raw]=s;}bind(...p){return new Statement(this[raw].bind(...p));}async first(key){const r=(await execute([this[raw]]))[0].results[0];return r?(key?r[key]:r):null;}async all(){return(await execute([this[raw]]))[0];}async run(){return(await execute([this[raw]]))[0];}}
 return{prepare(q){return new Statement(db.prepare(q));},batch(s){return execute(s.map(v=>v[raw]??v));},get denied(){return denied;}};
}
export function createCompanionDeviceApi({handleCaptureApi,clock=()=>Date.now()}={}){
 const owned=async(db,user,id)=>{const row=await deviceSql(db,'SELECT * FROM companion_devices WHERE id=? AND created_by=?',id,user.id).first();if(!row)deviceFail(404,'not_found','Companion device not found.');return row;};
 async function native(request,env){
  if(request.headers.has('origin'))deviceFail(403,'native_only','Use the local companion to connect.');
  const path=new URL(request.url).pathname,db=env.DB;let now=clock();
  if(path==='/api/companion-device/claim'&&request.method==='POST'){
   const input=await deviceBody(request);now=clock();if(!/^gdpair_[a-f0-9]{64}$/.test(input.code||'')||!/^gddev_[a-f0-9]{64}$/.test(input.deviceToken||''))deviceFail(400,'pairing','Use a fresh website connection link.');
   const codeHash=await deviceHash(input.code),tokenHash=await deviceHash(input.deviceToken),row=await deviceSql(db,'SELECT * FROM companion_devices WHERE code_hash=?',codeHash).first();
   if(!row||row.status==='revoked'||row.expires_at_ms<=now)deviceFail(401,'pairing','This connection link is no longer valid.');
   if(row.status==='active'&&row.token_hash===tokenHash){if(!await deviceSql(db,`SELECT id FROM companion_devices d WHERE id=? AND ${deviceAllowed('d.created_by')}`,row.id).first())deviceFail(401,'permission','Capture access is no longer available.');return deviceJson({device:deviceDto(row),alreadyConnected:true});}
   if(row.status!=='pending'||row.code_expires_at_ms<=now)deviceFail(401,'pairing','This connection link expired or was already used. Create a new connection.');
   const op=crypto.randomUUID();
   const result=await db.batch([
    deviceSql(db,`UPDATE companion_devices SET status='active',token_hash=? WHERE id=? AND status='pending' AND token_hash IS NULL AND code_expires_at_ms>? AND ${deviceAllowed('companion_devices.created_by')}`,tokenHash,row.id,clock()),
    deviceSql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,created_by,'companion_device_connected',json_object('deviceId',id,'subjectUserId',created_by),? FROM companion_devices WHERE id=? AND token_hash=? AND changes()>0",op,new Date(now).toISOString(),row.id,tokenHash)
   ]);
   const current=await deviceSql(db,'SELECT * FROM companion_devices WHERE id=?',row.id).first();if(current.status!=='active'||current.token_hash!==tokenHash)deviceFail(409,'pairing','Another companion claimed this connection link. Create a new connection.');
   return deviceJson({device:deviceDto(current),alreadyConnected:!result[0].meta.changes});
  }
  const match=/^Bearer (gddev_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');if(!match)deviceFail(401,'device_token','A connected companion is required.');
  const tokenHash=await deviceHash(match[1]),device=await deviceSql(db,`SELECT * FROM companion_devices d WHERE d.token_hash=? AND d.status='active' AND d.expires_at_ms>? AND ${deviceAllowed('d.created_by')}`,tokenHash,now).first();if(!device)deviceFail(401,'device_token','This companion connection expired, was revoked, or lost capture access.');
  if(path==='/api/companion-device/session'&&request.method==='GET'){
   const guarded=deviceGuardDb(db,device,tokenHash,null,clock);try{
    const result=await guarded.batch([deviceSql(guarded,'UPDATE companion_devices SET last_seen_at_ms=? WHERE id=?',now,device.id),deviceSql(guarded,'SELECT * FROM companion_devices WHERE id=?',device.id),deviceSql(guarded,`SELECT c.id,c.boss_name AS bossName,c.channel_name AS channelName,c.senders_json,c.status,c.expires_at_ms FROM capture_sessions c JOIN companion_devices d ON d.active_capture_id=c.id AND d.id=? WHERE c.created_by=d.created_by AND c.status='open' AND c.expires_at_ms>? AND ${deviceAllowed('c.created_by')}`,device.id,now)]);
    const row=result[2].results[0];return deviceJson({device:deviceDto(result[1].results[0]),capture:row?{id:row.id,bossName:row.bossName,channelName:row.channelName,allowedSenders:JSON.parse(row.senders_json),status:row.status,expiresAt:new Date(row.expires_at_ms).toISOString()}:null});
   }catch(error){if(guarded.denied)deviceFail(401,'device_token','Companion access changed. Reconnect from Guild Desk.');throw error;}
  }
  if(path==='/api/companion-device/events'&&request.method==='POST'){
   const input=await deviceBody(request,256*1024);if(typeof input.captureId!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(input.captureId))deviceFail(400,'capture','Choose an active boss capture.');
   if(typeof handleCaptureApi!=='function')deviceFail(503,'unavailable','Capture ingestion is unavailable.');
   const guarded=deviceGuardDb(db,device,tokenHash,input.captureId,clock),url=new URL(request.url);url.pathname='/api/companion/events';
   let response;try{response=await handleCaptureApi(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watcherId:input.watcherId,events:input.events})}),{...env,DB:guarded},{nativeCaptureId:input.captureId});}catch(error){if(!guarded.denied)throw error;}
   if(guarded.denied)deviceFail(409,'capture_changed','The active boss or companion access changed. Retain this capture queue and review it before switching.');return response;
  }
  if(path==='/api/companion-device/ready'&&request.method==='POST'){
   const input=await deviceBody(request);if(typeof input.captureId!=='string'||typeof input.watcherId!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(input.watcherId))deviceFail(400,'capture','Choose an active boss capture and stable watcher.');const guarded=deviceGuardDb(db,device,tokenHash,input.captureId,clock);
   try{const result=await guarded.batch([deviceSql(guarded,'UPDATE capture_sessions SET watcher_id=COALESCE(watcher_id,?) WHERE id=? AND (watcher_id IS NULL OR watcher_id=?)',input.watcherId,input.captureId,input.watcherId),deviceSql(guarded,'UPDATE companion_devices SET ready_capture_id=CASE WHEN EXISTS(SELECT 1 FROM capture_sessions WHERE id=? AND watcher_id=?) THEN ? ELSE NULL END,last_seen_at_ms=? WHERE id=?',input.captureId,input.watcherId,input.captureId,clock(),device.id),deviceSql(guarded,'SELECT ready_capture_id FROM companion_devices WHERE id=?',device.id)]);if(result[2].results[0]?.ready_capture_id!==input.captureId)deviceFail(409,'capture_source_conflict','Another watcher owns this capture. Resume its saved state or start a new boss capture.');return deviceJson({ready:true,captureId:input.captureId});}catch(error){if(guarded.denied)deviceFail(409,'capture_changed','The active boss changed before monitoring was ready.');throw error;}
  }
  if(path==='/api/companion-device/pause'&&request.method==='POST'){
   await deviceBody(request);const guarded=deviceGuardDb(db,device,tokenHash,null,clock);try{await guarded.prepare('UPDATE companion_devices SET ready_capture_id=NULL,last_seen_at_ms=? WHERE id=?').bind(clock(),device.id).run();return deviceJson({paused:true});}catch(error){if(guarded.denied)deviceFail(401,'device_token','Companion access changed.');throw error;}
  }
  deviceFail(405,'method_not_allowed','Companion endpoint not supported.');
 }
 return async function handleCompanionDeviceApi(request,env,auth={}){
  const path=new URL(request.url).pathname;if(!path.startsWith('/api/companion-device/')&&path!=='/api/companion-devices'&&!path.startsWith('/api/companion-devices/'))return null;
  try{
   if(!env?.DB)deviceFail(503,'database_unavailable','Companion storage is unavailable.');
   if(path.startsWith('/api/companion-device/'))return await native(request,env);
   if(!auth.user?.id)deviceFail(401,'unauthorized','Sign in to connect a companion.');
   const db=env.DB,user=auth.user;let now=clock();if(!await deviceSql(db,`SELECT id FROM users u WHERE id=? AND ${deviceAllowed('u.id',request.method==='GET'?2:3)}`,user.id).first())deviceFail(403,'forbidden','Capture access is required to manage your companion.');
   if(request.method!=='GET'&&(request.headers.get('origin')!==new URL(request.url).origin||!auth.csrfToken||request.headers.get('x-csrf-token')!==auth.csrfToken))deviceFail(403,'csrf','Refresh your session before connecting a companion.');
   if(path==='/api/companion-devices'&&request.method==='GET')return deviceJson({devices:(await deviceSql(db,'SELECT * FROM companion_devices WHERE created_by=? ORDER BY created_at_ms DESC,id',user.id).all()).results.map(deviceDto)});
   if(path==='/api/companion-devices'&&request.method==='POST'){
    const input=await deviceBody(request),label=typeof input.label==='string'?input.label.trim():'';now=clock();if(!label||label.length>80||/[\u0000-\u001f\u007f]/.test(label))deviceFail(400,'label','Enter a companion name up to 80 characters.');
    const id=crypto.randomUUID(),code=deviceSecret('gdpair_'),codeHash=await deviceHash(code),expires=now+30*86400000;
    const results=await db.batch([deviceSql(db,`INSERT INTO companion_devices(id,created_by,label,status,code_hash,code_expires_at_ms,expires_at_ms,created_at_ms) SELECT ?,?,?,'pending',?,?,?,? WHERE (SELECT COUNT(*) FROM companion_devices WHERE created_by=? AND status<>'revoked' AND expires_at_ms>?)<10 AND ${deviceAllowed('?')}`,id,user.id,label,codeHash,now+600000,expires,now,user.id,now,user.id),deviceSql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,created_by,'companion_device_created',json_object('deviceId',id,'subjectUserId',created_by),? FROM companion_devices WHERE id=?",crypto.randomUUID(),new Date(now).toISOString(),id)]);
    if(!results[0].meta.changes)deviceFail(409,'device_limit','Revoke an old companion before creating another connection.');const row=await owned(db,user,id);return deviceJson({device:deviceDto(row),pairing:{siteUrl:new URL(request.url).origin,code}},201);
   }
   const route=/^\/api\/companion-devices\/([^/]+)\/(activate|revoke)$/.exec(path);if(!route||request.method!=='POST')deviceFail(405,'method_not_allowed','Companion action not supported.');const row=await owned(db,user,route[1]);
   if(route[2]==='revoke'){
    await deviceBody(request);await db.batch([deviceSql(db,"UPDATE companion_devices SET status='revoked',active_capture_id=NULL,ready_capture_id=NULL,binding_revision=binding_revision+1 WHERE id=? AND status<>'revoked'",row.id),deviceSql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,created_by,'companion_device_revoked',json_object('deviceId',id,'subjectUserId',created_by),? FROM companion_devices WHERE id=? AND changes()>0",crypto.randomUUID(),new Date(now).toISOString(),row.id)]);return deviceJson({device:deviceDto(await owned(db,user,row.id))});
   }
   const input=await deviceBody(request);now=clock();if(typeof input.captureId!=='string'||input.captureId.length>128)deviceFail(400,'capture','Choose an open boss capture.');
   if(!await deviceSql(db,"SELECT id FROM capture_sessions WHERE id=? AND created_by=? AND status='open' AND expires_at_ms>?",input.captureId,user.id,now).first())deviceFail(409,'capture','Choose your own open boss capture.');
   const result=await db.batch([deviceSql(db,`UPDATE companion_devices SET active_capture_id=?,ready_capture_id=NULL,binding_revision=binding_revision+1 WHERE id=? AND status='active' AND expires_at_ms>? AND (active_capture_id IS NULL OR active_capture_id<>?) AND EXISTS(SELECT 1 FROM capture_sessions c WHERE c.id=? AND c.created_by=? AND c.status='open' AND c.expires_at_ms>?) AND ${deviceAllowed('companion_devices.created_by')}`,input.captureId,row.id,now,input.captureId,input.captureId,user.id,now),deviceSql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,created_by,'companion_device_activated',json_object('deviceId',id,'captureId',active_capture_id,'subjectUserId',created_by),? FROM companion_devices WHERE id=? AND changes()>0",crypto.randomUUID(),new Date(now).toISOString(),row.id)]);
   const current=await owned(db,user,row.id);if(current.status!=='active'||current.expires_at_ms<=now||current.active_capture_id!==input.captureId)deviceFail(409,'capture','Connect this companion first and choose your own open boss capture.');
   return deviceJson({device:deviceDto(current),alreadyActive:!result[0].meta.changes});
  }catch(error){return deviceJson({error:error instanceof DeviceError?error.message:'The companion connection could not be completed. Retry without deleting local queues.',code:error instanceof DeviceError?error.code:'device_error'},error.status||500);}
 };
}
