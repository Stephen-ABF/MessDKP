import {PASSWORD_ITERATIONS,passwordHash,verifyPassword,validatePassword,authRateLimit} from './passwords.mjs';
import {HttpError as ApiError,readJson,requireCsrf,constantTimeEqual} from './http.mjs';
const encoder = new TextEncoder();
const COOKIE = '__Host-guild_session';
const MAX_BODY = 5 * 1024 * 1024;
const sessionLife = 7 * 86400;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const sql = (db, query, ...params) => db.prepare(query).bind(...params);
const all = async statement => (await statement.all()).results;
const publicUser = row => ({ id: row.id, email: row.email, name: row.name, role: row.role,credentialRevision:row.credentialRevision??row.credential_revision??0,resetRequired:!!(row.resetRequired??row.reset_required) });
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } }); }
function text(value, field, min, max) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, 'validation', `${field} must contain ${min}-${max} characters.`); return value.trim(); }
function integer(value, field, min = 1, max = 1000000) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'validation', `${field} must be a whole number from ${min} to ${max}.`); return value; }
function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, 'validation', 'Use a valid YYYY-MM-DD date.'); return value; }
const body=request=>readJson(request,{limit:MAX_BODY,sizeMessage:'Upload is too large.'});
const sameHex=constantTimeEqual;
async function session(request, db) {
 const cookie = request.headers.get('cookie') || ''; const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
 if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
 return await sql(db, "SELECT u.id,u.email,u.name,u.role,u.credential_revision AS credentialRevision,u.reset_required AS resetRequired,s.csrf_token,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='active' AND u.reset_required=0", await hash(token), Date.now()).first();
}
function cookie(token, age = sessionLife) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`; }
function officer(user) { if (user.role !== 'admin') fail(403, 'forbidden', 'Officer access is required.'); }
async function rateLimit(db,request,email,action){
 const registering=action==='register';await authRateLimit(db,request,email,action+'-ip',{ipOnly:true,maximum:registering?10:60,milliseconds:registering?3600000:900000});
 await authRateLimit(db,request,email,action,{maximum:registering?5:15,milliseconds:registering?3600000:900000});
}

function emailInput(value) { const email = text(value, 'Email', 3, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'validation', 'Enter a valid email address.'); return email; }
const characterSelect = `SELECT c.id,c.name,c.level,c.class_name AS className,c.guild_rank AS rank,c.kind,c.owner_id AS ownerId,u.name AS ownerName,u.email AS ownerEmail,COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.character_id=c.id),0) AS balance,(SELECT COUNT(*) FROM attendance a WHERE a.character_id=c.id AND a.status='pending') AS pendingTicks FROM characters c LEFT JOIN users u ON u.id=c.owner_id`;
const claimSelect = `SELECT q.id,q.character_id AS characterId,c.name AS characterName,q.user_id AS userId,u.name AS userName,u.email AS userEmail,q.status,q.kind,q.created_at AS createdAt,q.approved_at AS approvedAt,q.rejected_at AS rejectedAt,q.rejected_by AS rejectedBy,q.rejection_reason AS rejectionReason,c.owner_id AS ownerId,(q.status='approved' AND c.owner_id=q.user_id AND c.kind=q.kind) AS currentlyAssigned,(SELECT a.actor_id FROM audit a WHERE a.action='claim_approved' AND json_valid(a.details) AND json_extract(a.details,'$.claimId')=q.id AND a.created_at=q.approved_at ORDER BY a.id LIMIT 1) AS approvedBy,(SELECT actor.name FROM audit a JOIN users actor ON actor.id=a.actor_id WHERE a.action='claim_approved' AND json_valid(a.details) AND json_extract(a.details,'$.claimId')=q.id AND a.created_at=q.approved_at ORDER BY a.id LIMIT 1) AS assignedBy FROM claims q JOIN characters c ON c.id=q.character_id JOIN users u ON u.id=q.user_id`;
const assignmentSelect = `SELECT e.id,e.claim_id AS claimId,e.character_id AS characterId,c.name AS characterName,e.user_id AS userId,u.name AS userName,u.email AS userEmail,e.kind,e.action AS outcome,e.resolved_at AS resolvedAt,e.reason,e.actor_id AS actorId,actor.name AS actorName,assigner.name AS assignedBy,c.owner_id AS ownerId,(e.action='approved' AND c.owner_id=e.user_id AND c.kind=e.kind AND c.approved_at=e.resolved_at AND NOT EXISTS(SELECT 1 FROM assignment_events d WHERE d.related_assignment_id=e.id AND d.action='detached')) AS currentlyAssigned FROM assignment_events e JOIN characters c ON c.id=e.character_id JOIN users u ON u.id=e.user_id LEFT JOIN users actor ON actor.id=e.actor_id LEFT JOIN users assigner ON assigner.id=e.assigned_by`;
const raidSelect = `SELECT r.id,r.name,r.date,r.rate,r.created_at AS createdAt,(SELECT COUNT(*) FROM ticks t WHERE t.raid_id=r.id) AS tickCount FROM raids r`;
const auditStmt = (db, user, action, details, at = now(), auditId = id()) => sql(db, 'INSERT INTO audit(id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)', auditId, user.id, action, JSON.stringify(details), at);
async function creationDefaults(db, enabled) {
 if (!enabled) return { defaultTickRate:5, minimumBid:1, presets:[] };
 const row=await sql(db,'SELECT settings_json FROM guild_settings WHERE id=1').first();
 if (!row) return { defaultTickRate:5, minimumBid:1, presets:[] };
 let settings;try{settings=JSON.parse(row.settings_json);}catch{fail(500,'configuration_error','Reward settings could not be read.');}
 if (!Number.isSafeInteger(settings.defaultTickRate)||settings.defaultTickRate<1||settings.defaultTickRate>1000000||!Array.isArray(settings.presets))fail(500,'configuration_error','Reward settings need officer review.');
 return settings;
}
async function characters(db, user) {
 const rows = await all(sql(db, characterSelect + ' ORDER BY c.name COLLATE NOCASE'));
 const claims = await all(sql(db, 'SELECT character_id,status FROM claims WHERE user_id=?', user.id));
 const map = new Map(claims.map(c => [c.character_id, c.status]));
 return rows.map(row => { if (user.role !== 'admin' && row.ownerId !== user.id) delete row.ownerEmail; return { ...row, claimStatus: map.get(row.id) || null }; });
}
function parseDump(file) {
 if (!file || typeof file !== 'object') fail(400, 'validation', 'Each file needs a name and text.');
 const name = text(file.name, 'Filename', 1, 250);
 if (typeof file.text !== 'string' || encoder.encode(file.text).length > 1024 * 1024) fail(400, 'invalid_dump', 'Each dump must be text of at most 1 MiB.');
 const match = /^(.+)_([A-Za-z0-9]+)-(\d{8})-(\d{6})(?:\s*\(\d+\))?\.txt$/i.exec(name);
 if (!match) fail(400, 'invalid_filename', 'Use an EverQuest dump filename such as DemoGuild_test-20261111-180515.txt.');
 const [, guild, server, d, t] = match; const date = validDate(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
 if (+t.slice(0,2)>23 || +t.slice(2,4)>59 || +t.slice(4,6)>59) fail(400,'invalid_filename','Filename contains an invalid time.');
 const sourceTime = `${date}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
 const normalized = file.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
 const lines = normalized.split('\n'); if (!normalized || lines.length > 500) fail(400, 'invalid_dump', 'A dump must contain 1-500 character rows.');
 const names = new Set();
 const rows = lines.map((line, index) => {
  const cols = line.split('\t'); if (cols.length !== 15) fail(400, 'invalid_dump', `Line ${index+1} must contain 15 tab-separated fields, including the final blank field.`);
  const name = cols[0].trim(); if (!/^[A-Za-z][A-Za-z'-]{1,63}$/.test(name)) fail(400,'invalid_dump',`Line ${index+1} contains an invalid character name.`);
  const key = name.toLowerCase(); if (names.has(key)) fail(400,'invalid_dump',`Duplicate character ${name} in one tick.`); names.add(key);
  const level = Number(cols[1]); if (!Number.isInteger(level) || level < 1 || level > 255) fail(400,'invalid_dump',`Invalid level for ${name}.`);
  return { key, name, level, className:text(cols[2],'Class',1,80), rank:text(cols[3],'Rank',1,80), zone:text(cols[6],'Zone',1,200) };
 });
 const guildKey=guild.trim().toLowerCase(),serverKey=server.toLowerCase();
 return { name, sourceTime, guildKey, serverKey, sourceKey:JSON.stringify([guildKey,serverKey,sourceTime]), normalized, raw:file.text, rows };
}
async function importDumps(request, db, user, raidId) {
 officer(user); const raid = await sql(db, raidSelect+' WHERE r.id=?',raidId).first(); if (!raid) fail(404,'not_found','Raid not found.');
 const input = await body(request); if (!Array.isArray(input.files) || !input.files.length || input.files.length > 10) fail(400,'validation','Choose 1-10 attendance dumps.');
 if (input.commit !== undefined && typeof input.commit !== 'boolean') fail(400,'validation','commit must be true or false.');
 const files = input.files.map(parseDump),scope=files[0];
 if(files.some(file=>file.guildKey!==scope.guildKey||file.serverKey!==scope.serverKey))fail(409,'scope_conflict','One import batch must contain attendance from a single guild and server.');
 const boundScope=await sql(db,'SELECT guild_key,server_key FROM import_scope WHERE id=1').first();
 if(boundScope&&(boundScope.guild_key!==scope.guildKey||boundScope.server_key!==scope.serverKey))fail(409,'scope_conflict','These dumps belong to another guild or server. This site is already bound to its first committed attendance source.');
 const existingChars = new Map((await all(sql(db,'SELECT name_key,kind,owner_id FROM characters'))).map(c=>[c.name_key,c]));
 const seen = new Map(); const previews=[];
 for (const file of files) {
  file.contentHash=await hash(file.normalized);
  const existing=seen.get(file.sourceKey)||await sql(db,'SELECT raid_id,content_hash FROM ticks WHERE source_key=?',file.sourceKey).first();
  if (existing&&(existing.raid_id!==raidId||existing.content_hash!==file.contentHash)) fail(409,'snapshot_conflict','A capture with this filename time has different contents or belongs to another raid. Ask an officer to review it.');
  file.duplicate=Boolean(existing); seen.set(file.sourceKey,{raid_id:raidId,content_hash:file.contentHash});
  const warnings=[]; let eligibleMains=0,unclaimed=0,alts=0;
  for (const row of file.rows) {const c=existingChars.get(row.key);if(c?.kind==='main'&&c.owner_id)eligibleMains++;else if(c?.kind==='alt')alts++;else unclaimed++;}
  previews.push({name:file.name,sourceTime:file.sourceTime,rowCount:file.rows.length,status:file.duplicate?'duplicate':'new',eligibleMains,unclaimed,alts,warnings});
 }
 if (input.commit!==true) return json({preview:true,files:previews,totalRows:files.reduce((n,f)=>n+f.rows.length,0)});
 const operation=id(), at=now(), hasNewFiles=files.some(file=>!file.duplicate), statements=[
  sql(db,`INSERT INTO import_scope(id,guild_key,server_key,created_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET guild_key=CASE WHEN import_scope.guild_key=excluded.guild_key AND import_scope.server_key=excluded.server_key THEN import_scope.guild_key ELSE NULL END`,scope.guildKey,scope.serverKey,at)
 ];
 for (const file of files.filter(f=>!f.duplicate)) {
  const tickId=id(), rows=JSON.stringify(file.rows);
  statements.push(sql(db,`INSERT INTO ticks(id,raid_id,source_key,file_name,source_time,content_hash,raw_text,row_count,created_at,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET source_key=CASE WHEN ticks.content_hash=excluded.content_hash AND ticks.raid_id=excluded.raid_id THEN ticks.source_key ELSE NULL END`,tickId,raidId,file.sourceKey,file.name,file.sourceTime,file.contentHash,file.raw,file.rows.length,at,operation));
  statements.push(sql(db,`INSERT INTO characters(id,name_key,name,level,class_name,guild_rank) SELECT lower(hex(randomblob(16))),json_extract(value,'$.key'),json_extract(value,'$.name'),json_extract(value,'$.level'),json_extract(value,'$.className'),json_extract(value,'$.rank') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM ticks WHERE id=? AND operation_id=?) ON CONFLICT(name_key) DO NOTHING`,rows,tickId,operation));
  statements.push(sql(db,`INSERT INTO attendance(id,tick_id,character_id,class_name,zone,status,dkp) SELECT lower(hex(randomblob(16))),?,c.id,c.class_name,json_extract(j.value,'$.zone'),CASE WHEN c.kind='alt' THEN 'ineligible' ELSE 'pending' END,? FROM json_each(?) j JOIN characters c ON c.name_key=json_extract(j.value,'$.key') WHERE EXISTS(SELECT 1 FROM ticks WHERE id=? AND operation_id=?) ON CONFLICT(tick_id,character_id) DO NOTHING`,tickId,raid.rate,rows,tickId,operation));
  statements.push(sql(db,`INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) SELECT lower(hex(randomblob(16))),a.character_id,a.id,a.dkp,'Attendance tick',?,?,? FROM attendance a JOIN characters c ON c.id=a.character_id WHERE a.tick_id=? AND c.kind='main' AND c.owner_id IS NOT NULL AND EXISTS(SELECT 1 FROM ticks WHERE id=? AND operation_id=?) ON CONFLICT(attendance_id) DO NOTHING`,user.id,at,operation,tickId,tickId,operation));
  statements.push(sql(db,`UPDATE attendance SET status='credited' WHERE tick_id=? AND EXISTS(SELECT 1 FROM ledger l WHERE l.attendance_id=attendance.id)`,tickId));
 }
 if(hasNewFiles) statements.push(auditStmt(db,user,'attendance_import',{raidId,fileNames:files.filter(f=>!f.duplicate).map(f=>f.name)},at));
 try{await db.batch(statements);}catch(error){if(/import_scope/i.test(String(error)))fail(409,'scope_conflict','Another import bound this site to a different guild or server. No attendance from this batch was posted.');if(/source_key|UNIQUE|constraint/i.test(String(error)))fail(409,'snapshot_conflict','A concurrent import changed this capture. Refresh and review before retrying.');throw error;}
 const count=await sql(db,'SELECT COUNT(*) AS n FROM ticks WHERE operation_id=?',operation).first();
 const credits=await sql(db,'SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE operation_id=?',operation).first();
 return json({preview:false,files:previews,importedTicks:count.n,duplicateTicks:files.length-count.n,creditedDkp:credits.n});
}
async function approveClaim(db,user,claimId,input,ownership=false) {
 officer(user); if(!['main','alt'].includes(input.kind))fail(400,'validation','Choose main or alt.');
 const claim=await sql(db,'SELECT * FROM claims WHERE id=?',claimId).first();if(!claim)fail(404,'not_found','Claim not found.');
 if(claim.status==='approved'){if(claim.kind!==input.kind)fail(409,'claim_conflict','This claim was already approved with another character type.');return json({claim:await sql(db,claimSelect+' WHERE q.id=?',claimId).first(),creditedDkp:0});}
 if(claim.status==='rejected')fail(409,'claim_rejected','This claim was superseded by another approved character assignment.');
 if(input.kind==='main'&&await sql(db,"SELECT id FROM characters WHERE owner_id=? AND kind='main' AND id<>?",claim.user_id,claim.character_id).first())fail(409,'main_exists','This account already has an approved main. Approve this character as an alt instead. Main changes are not available in this build.');
 const operation=id(),at=now(),rejectionReason='Another claim for this character was approved.';
 try{await db.batch([
  sql(db,`UPDATE claims SET status='approved',kind=?,approved_at=?,approval_op=?${ownership?',approved_by=?':''} WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM characters c WHERE c.id=claims.character_id AND c.owner_id IS NULL)`,input.kind,at,operation,...(ownership?[user.id]:[]),claimId),
  sql(db,`UPDATE characters SET owner_id=?,kind=?,approved_at=? WHERE id=? AND owner_id IS NULL AND EXISTS(SELECT 1 FROM claims WHERE id=? AND approval_op=?)`,claim.user_id,input.kind,at,claim.character_id,claimId,operation),
  sql(db,`INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) SELECT lower(hex(randomblob(16))),a.character_id,a.id,a.dkp,'Pending attendance approved',?,?,? FROM attendance a JOIN characters c ON c.id=a.character_id WHERE a.character_id=? AND a.status='pending' AND c.kind='main' AND c.owner_id=? AND EXISTS(SELECT 1 FROM claims WHERE id=? AND approval_op=?) ON CONFLICT(attendance_id) DO NOTHING`,user.id,at,operation,claim.character_id,claim.user_id,claimId,operation),
  sql(db,`UPDATE attendance SET status=CASE WHEN ?='alt' THEN 'ineligible' ELSE 'credited' END WHERE character_id=? AND status='pending' AND EXISTS(SELECT 1 FROM claims WHERE id=? AND approval_op=?)`,input.kind,claim.character_id,claimId,operation),
  ...(ownership?[sql(db,`INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,reason,actor_id) SELECT 'rejected-'||?||'-'||q.id,q.id,q.character_id,q.user_id,q.kind,'rejected',?,?,? FROM claims q WHERE q.character_id=? AND q.id<>? AND q.status='pending' AND EXISTS(SELECT 1 FROM claims winner WHERE winner.id=? AND winner.approval_op=?)`,operation,at,rejectionReason,user.id,claim.character_id,claimId,claimId,operation)]:[]),
  sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT lower(hex(randomblob(16))),?,'claim_rejected',json_object('claimId',q.id,'characterId',q.character_id,'subjectUserId',q.user_id,'reason',?,'winningClaimId',?),? FROM claims q WHERE q.character_id=? AND q.id<>? AND q.status='pending' AND EXISTS(SELECT 1 FROM claims winner WHERE winner.id=? AND winner.approval_op=?)`,user.id,rejectionReason,claimId,at,claim.character_id,claimId,claimId,operation),
  sql(db,`UPDATE claims SET status='rejected',rejected_at=?,rejected_by=?,rejection_reason=? WHERE character_id=? AND id<>? AND status='pending' AND EXISTS(SELECT 1 FROM claims winner WHERE winner.id=? AND winner.approval_op=?)`,at,user.id,rejectionReason,claim.character_id,claimId,claimId,operation),
  sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'claim_approved',?,? WHERE EXISTS(SELECT 1 FROM claims WHERE id=? AND approval_op=?)`,id(),user.id,JSON.stringify({claimId,characterId:claim.character_id,subjectUserId:claim.user_id,kind:input.kind}),at,claimId,operation),
  ...(ownership?[sql(db,`INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,actor_id,assigned_by) SELECT ?,id,character_id,user_id,kind,'approved',?,?,? FROM claims WHERE id=? AND approval_op=?`,operation,at,user.id,user.id,claimId,operation)]:[])
 ]);}catch(error){if(/characters\.owner_id|characters_one_main_per_owner/i.test(String(error)))fail(409,'main_exists','This account already has an approved main. No claim, attendance credit, or competing request was changed. Approve this character as an alt instead.');throw error;}
 const approved=await sql(db,claimSelect+' WHERE q.id=?',claimId).first();if(approved.status!=='approved'||approved.kind!==input.kind)fail(409,'claim_conflict','Another approval changed this character. Refresh and review ownership.');
 const credits=await sql(db,'SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE operation_id=?',operation).first();return json({claim:approved,creditedDkp:credits.n});
}
async function detachCharacter(db,user,characterId,input,auctions=false) {
 officer(user);const reason=text(input.reason,'Detach reason',3,1000),expectedOwnerId=text(input.expectedOwnerId,'Expected owner',1,100),assignmentId=text(input.expectedAssignmentId,'Expected assignment',1,150);
 const old=await sql(db,"SELECT * FROM assignment_events WHERE id=? AND character_id=? AND user_id=? AND action='approved'",assignmentId,characterId,expectedOwnerId).first();if(!old)fail(409,'assignment_conflict','This assignment changed. Refresh the claim history before detaching it.');
 const previous=await sql(db,"SELECT id FROM assignment_events WHERE related_assignment_id=? AND action='detached'",assignmentId).first();
 if(previous)return json({character:await sql(db,characterSelect+' WHERE c.id=?',characterId).first(),alreadyDetached:true});
 const character=await sql(db,'SELECT * FROM characters WHERE id=?',characterId).first();if(!character)fail(404,'not_found','Character not found.');
 if(character.owner_id!==expectedOwnerId||character.kind!==old.kind||character.approved_at!==old.resolved_at)fail(409,'assignment_conflict','This character has a different current assignment. Refresh before detaching.');
 const lifecycle=auctions?` AND NOT EXISTS(SELECT 1 FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.character_id=c.id AND b.active=1 AND a.status='open') AND NOT EXISTS(SELECT 1 FROM auction_awards w WHERE w.character_id=c.id AND w.status='pending')`:'';
 if(auctions){const blocked=await sql(db,"SELECT (EXISTS(SELECT 1 FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.character_id=? AND b.active=1 AND a.status='open') OR EXISTS(SELECT 1 FROM auction_awards WHERE character_id=? AND status='pending')) AS blocked",characterId,characterId).first();if(blocked.blocked)fail(409,'assignment_in_use','Withdraw active bids and resolve pending item awards before detaching this character.');}
 const operation=id(),at=now();
 await db.batch([
  sql(db,`INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,reason,actor_id,assigned_by,related_assignment_id) SELECT ?,e.claim_id,e.character_id,e.user_id,e.kind,'detached',?,?,?,e.assigned_by,e.id FROM assignment_events e JOIN characters c ON c.id=e.character_id WHERE e.id=? AND c.owner_id=? AND c.kind=e.kind AND c.approved_at=e.resolved_at AND NOT EXISTS(SELECT 1 FROM assignment_events d WHERE d.related_assignment_id=e.id AND d.action='detached')${lifecycle}`,operation,at,reason,user.id,assignmentId,expectedOwnerId),
  sql(db,"UPDATE characters SET owner_id=NULL,kind='unclassified',approved_at=NULL WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM assignment_events WHERE id=?)",characterId,expectedOwnerId,operation),
  sql(db,"UPDATE claims SET status='rejected',rejected_at=?,rejected_by=?,rejection_reason=? WHERE character_id=? AND status='approved' AND EXISTS(SELECT 1 FROM assignment_events WHERE id=?)",at,user.id,'Detached: '+reason,characterId,operation),
  sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'character_detached',?,? WHERE EXISTS(SELECT 1 FROM assignment_events WHERE id=?)",id(),user.id,JSON.stringify({characterId,subjectUserId:expectedOwnerId,previousOwnerId:expectedOwnerId,assignmentId,reason}),at,operation)
 ]);
 if(!await sql(db,'SELECT id FROM assignment_events WHERE id=?',operation).first()){
  if(await sql(db,"SELECT id FROM assignment_events WHERE related_assignment_id=? AND action='detached'",assignmentId).first())return json({character:await sql(db,characterSelect+' WHERE c.id=?',characterId).first(),alreadyDetached:true});
  fail(409,'assignment_conflict','The character or its auction activity changed. Refresh before detaching.');
 }
 return json({character:await sql(db,characterSelect+' WHERE c.id=?',characterId).first(),alreadyDetached:false});
}
export async function handleApi(request,env,authorization={}) {
 try {
  if(!env.DB)fail(503,'database_unavailable','The database is not configured.');const db=env.DB,url=new URL(request.url),path=url.pathname.replace(/\/$/,'')||'/';
  if(Number(request.headers.get('content-length')||0)>MAX_BODY)fail(413,'too_large','Upload is too large.');
  if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed','Method not allowed.');
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)fail(403,'origin','A same-origin request is required.');
  let user=await session(request,db);
  if(path==='/api/me'&&request.method==='GET')return json(user?{user:publicUser(user),csrfToken:user.csrf_token}:{user:null});
  if((path==='/api/register'||path==='/api/login')&&request.method==='POST') {
   const input=await body(request),email=emailInput(input.email);if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)fail(400,'validation','Password must contain 12-128 characters.');
   const registering=path.endsWith('register');await rateLimit(db,request,email,registering?'register':'login');
   const token=random(),csrfToken=random(),tokenHash=await hash(token),at=now();let account;
   if(registering) {
    const name=text(input.name,'Display name',2,80),userId=id(),salt=random(),password=await passwordHash(input.password,salt);
    try{await db.batch([
     sql(db,"INSERT INTO users(id,email,name,password_hash,salt,role,created_at,password_iterations,account_status) SELECT ?,?,?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'admin' ELSE 'member' END,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'active' ELSE 'pending' END",userId,email,name,password,salt,at,PASSWORD_ITERATIONS),
     sql(db,"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) SELECT ?,id,?,? FROM users WHERE id=? AND account_status='active'",tokenHash,csrfToken,Date.now()+sessionLife*1000,userId),
     sql(db,'INSERT INTO audit(id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)',id(),userId,'account_registered',JSON.stringify({email}),at)
    ]);}catch(error){if(/UNIQUE|users.email/i.test(String(error)))fail(409,'account_exists','An account already uses that email.');throw error;}
    account=await sql(db,'SELECT * FROM users WHERE id=?',userId).first();
    if(account.account_status==='pending')return json({pendingApproval:true,message:'Your account is awaiting officer approval.'},202);
   } else {
    account=await sql(db,'SELECT * FROM users WHERE email=?',email).first();if(!await verifyPassword(input.password,account))fail(401,'invalid_credentials','Email or password is incorrect.');
    if(account.account_status!=='active')fail(403,'account_pending','Your account is awaiting officer approval.');if(account.reset_required)fail(403,'password_reset_required','Ask an officer for your password reset link.');
    const oldHash=account.password_hash,oldRevision=account.credential_revision,operation=id(),upgrade=account.password_iterations<PASSWORD_ITERATIONS;
    const salt=upgrade?random():account.salt,password=upgrade?await passwordHash(input.password,salt):oldHash;
    const statements=[];if(upgrade)statements.push(sql(db,"UPDATE users SET password_hash=?,salt=?,password_iterations=?,credential_revision=credential_revision+1,credential_operation=? WHERE id=? AND password_hash=? AND credential_revision=? AND account_status='active' AND reset_required=0",password,salt,PASSWORD_ITERATIONS,operation,account.id,oldHash,oldRevision));
    const revision=oldRevision+(upgrade?1:0);
    statements.push(sql(db,"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) SELECT ?,id,?,? FROM users WHERE id=? AND password_hash=? AND salt=? AND credential_revision=? AND account_status='active' AND reset_required=0",tokenHash,csrfToken,Date.now()+sessionLife*1000,account.id,password,salt,revision),sql(db,'DELETE FROM sessions WHERE expires_at<=?',Date.now()),sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'login','{}',? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=?)",id(),account.id,at,tokenHash));
    await db.batch(statements);if(!await sql(db,'SELECT token_hash FROM sessions WHERE token_hash=?',tokenHash).first())fail(409,'credentials_changed','Your credentials changed during sign-in. Try again.');account={...account,password_hash:password,salt,password_iterations:upgrade?PASSWORD_ITERATIONS:account.password_iterations,credential_revision:revision};
   }
   return json({user:publicUser(account),csrfToken},registering?201:200,{'Set-Cookie':cookie(token)});
  }
  if(path==='/api/password/reset'&&request.method==='POST'){
   const input=await body(request);validatePassword(input.newPassword);if(typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))fail(400,'invalid_reset','This reset link is invalid or expired.');await rateLimit(db,request,'','reset');
   const digest=await hash(input.token),reset=await sql(db,'SELECT r.*,u.account_status,u.reset_required FROM account_password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?',digest).first();if(!reset)fail(400,'invalid_reset','This reset link is invalid or expired.');
   const salt=random(),password=await passwordHash(input.newPassword,salt),operation=id();const results=await db.batch([
    sql(db,"UPDATE users SET password_hash=?,salt=?,password_iterations=?,reset_required=0,credential_revision=credential_revision+1,credential_operation=? WHERE id=? AND account_status='active' AND reset_required=1 AND credential_revision=? AND EXISTS(SELECT 1 FROM account_password_resets r WHERE r.user_id=users.id AND r.token_hash=? AND r.credential_revision=users.credential_revision AND r.expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))",password,salt,PASSWORD_ITERATIONS,operation,reset.user_id,reset.credential_revision,digest),
    sql(db,'DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND credential_operation=?)',reset.user_id,reset.user_id,operation),
    sql(db,'DELETE FROM account_password_resets WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND credential_operation=?)',reset.user_id,reset.user_id,operation),
    sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,id,'password_reset_completed',json_object('subjectUserId',id),? FROM users WHERE id=? AND credential_operation=?",operation,now(),reset.user_id,operation)
   ]);if(!results[0].meta.changes)fail(400,'invalid_reset','This reset link is invalid or expired.');return json({ok:true,message:'Password updated. Sign in with your new password.'});
  }
  if(!user)fail(401,'authentication_required','Please sign in.');
  if(request.method==='POST')requireCsrf(request,user.csrf_token);
  if(path==='/api/logout'&&request.method==='POST'){await sql(db,'DELETE FROM sessions WHERE token_hash=?',user.token_hash).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
  if(path==='/api/password/change'&&request.method==='POST'){
   const input=await readJson(request,{limit:4096});validatePassword(input.newPassword);await rateLimit(db,request,user.email,'password-change');const account=await sql(db,'SELECT * FROM users WHERE id=?',user.id).first();if(typeof input.currentPassword!=='string'||input.currentPassword.length>128||!await verifyPassword(input.currentPassword,account))fail(403,'invalid_password','Your current password is incorrect.');
   const salt=random(),password=await passwordHash(input.newPassword,salt),operation=id();const result=await db.batch([
    sql(db,"UPDATE users SET password_hash=?,salt=?,password_iterations=?,credential_revision=credential_revision+1,credential_operation=? WHERE id=? AND password_hash=? AND credential_revision=? AND account_status='active' AND reset_required=0 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=users.id AND expires_at>?)",password,salt,PASSWORD_ITERATIONS,operation,user.id,account.password_hash,account.credential_revision,user.token_hash,Date.now()),
    sql(db,'DELETE FROM sessions WHERE user_id=? AND token_hash<>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND credential_operation=?)',user.id,user.token_hash,user.id,operation),
    sql(db,'DELETE FROM account_password_resets WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND credential_operation=?)',user.id,user.id,operation),
    sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,id,'password_changed',json_object('subjectUserId',id),? FROM users WHERE id=? AND credential_operation=?",operation,now(),user.id,operation)
   ]);if(!result[0].meta.changes)fail(409,'credentials_changed','Your credentials changed. Sign in again.');return json({ok:true,user:{...publicUser(user),credentialRevision:account.credential_revision+1},csrfToken:user.csrf_token});
  }
  // The bundled authorization middleware supplies a route-scoped legacy adapter.
  // Client JSON/headers never control this argument, the session identity or CSRF.
  const identityRole=user.role;
  if(authorization?.userId===user.id&&['admin','member'].includes(authorization.role))user={...user,role:authorization.role};
  if(path==='/api/dashboard'&&request.method==='GET') {
   const own=(await characters(db,user)).filter(c=>c.ownerId===user.id);const raidCount=await sql(db,'SELECT COUNT(*) AS n FROM raids').first();const defaults=await creationDefaults(db,env.FEATURE_ADMIN);return json({user:publicUser({...user,role:identityRole}),characters:own,balance:own.filter(c=>c.kind==='main').reduce((n,c)=>n+c.balance,0),pendingTicks:own.reduce((n,c)=>n+c.pendingTicks,0),raidCount:raidCount.n,tickRate:defaults.defaultTickRate,auctionStatus:env.FEATURE_AUCTIONS?'live':'not_implemented'});
  }
  if(path==='/api/characters'&&request.method==='GET')return json({characters:await characters(db,user)});
  if(path==='/api/characters'&&request.method==='POST') {
   const input=await body(request),name=text(input.name,'Character name',2,64),level=integer(input.level,'Level',1,255),className=text(input.className,'Class',1,80);
   if(!/^[A-Za-z][A-Za-z'-]{1,63}$/.test(name))fail(400,'validation','Use a character name containing letters, apostrophes, or hyphens, beginning with a letter.');
   const nameKey=name.toLowerCase();
   if(await sql(db,'SELECT id FROM characters WHERE name_key=?',nameKey).first())fail(409,'character_exists','This character already exists. Find it in the registry and use the existing character claim flow.');
   const characterId=id(),claimId=id(),at=now();
   try{await db.batch([
    sql(db,"INSERT INTO characters(id,name_key,name,level,class_name,guild_rank) VALUES(?,?,?,?,?,'Website request')",characterId,nameKey,name,level,className),
    sql(db,'INSERT INTO claims(id,character_id,user_id,created_at) VALUES(?,?,?,?)',claimId,characterId,user.id,at),
    auditStmt(db,user,'character_requested',{characterId,claimId,subjectUserId:user.id,name,level,className},at)
   ]);}catch(error){if(/characters\.name_key/i.test(String(error)))fail(409,'character_exists','This character already exists. Find it in the registry and use the existing character claim flow.');throw error;}
   const character=await sql(db,characterSelect+' WHERE c.id=?',characterId).first(),claim=await sql(db,claimSelect+' WHERE q.id=?',claimId).first();
   if(user.role!=='admin'&&character.ownerId!==user.id)delete character.ownerEmail;
   return json({character:{...character,claimStatus:claim.status},claim},201);
  }
  if(path==='/api/claims'&&request.method==='POST') {
   const input=await body(request),characterId=text(input.characterId,'Character',1,100);const character=await sql(db,'SELECT * FROM characters WHERE id=?',characterId).first();if(!character)fail(404,'not_found','Character not found.');if(character.owner_id)fail(409,'already_claimed','This character already has an approved owner.');
   const existing=await sql(db,claimSelect+' WHERE q.character_id=? AND q.user_id=?',characterId,user.id).first();
   if(existing){
    if(existing.status!=='rejected'||!env.FEATURE_OWNERSHIP)return json({claim:existing});
    const operation=id(),at=now();await db.batch([
     sql(db,"UPDATE claims SET status='pending',kind=NULL,created_at=?,approved_at=NULL,approved_by=NULL,approval_op=?,rejected_at=NULL,rejected_by=NULL,rejection_reason=NULL WHERE id=? AND status='rejected' AND EXISTS(SELECT 1 FROM characters c WHERE c.id=claims.character_id AND c.owner_id IS NULL)",at,operation,existing.id),
     sql(db,"INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'claim_requested',?,? WHERE EXISTS(SELECT 1 FROM claims WHERE id=? AND approval_op=? AND status='pending')",id(),user.id,JSON.stringify({characterId,subjectUserId:user.id,reopenedClaimId:existing.id}),at,existing.id,operation)
    ]);
    const result=await sql(db,claimSelect+' WHERE q.id=?',existing.id).first();if(result.status==='rejected')fail(409,'already_claimed','This character was assigned while your request was being submitted.');return json({claim:result},201);
   }
   const claimId=id(),at=now();await db.batch([
    sql(db,'INSERT INTO claims(id,character_id,user_id,created_at) SELECT ?,c.id,?,? FROM characters c WHERE c.id=? AND c.owner_id IS NULL ON CONFLICT(character_id,user_id) DO NOTHING',claimId,user.id,at,characterId),
    sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'claim_requested',?,? WHERE EXISTS(SELECT 1 FROM claims WHERE id=?)`,id(),user.id,JSON.stringify({characterId,claimId,subjectUserId:user.id}),at,claimId)
   ]);
   const result=await sql(db,claimSelect+' WHERE q.character_id=? AND q.user_id=?',characterId,user.id).first();
   if(!result)fail(409,'already_claimed','This character was assigned while your request was being submitted.');
   return json({claim:result},201);
  }
  if(path==='/api/claims'&&request.method==='GET'){officer(user);const claims=(await all(sql(db,claimSelect+' ORDER BY q.created_at DESC'))).map(q=>({...q,currentlyAssigned:!!q.currentlyAssigned}));const assignments=env.FEATURE_OWNERSHIP?(await all(sql(db,assignmentSelect+' ORDER BY e.resolved_at DESC,e.id DESC'))).map(e=>({...e,currentlyAssigned:!!e.currentlyAssigned})):[];return json({claims,assignments});}
  let match;
  if((match=/^\/api\/claims\/([^/]+)\/approve$/.exec(path))&&request.method==='POST')return await approveClaim(db,user,match[1],await body(request),!!env.FEATURE_OWNERSHIP);
  if((match=/^\/api\/characters\/([^/]+)\/detach$/.exec(path))&&request.method==='POST'){
   if(!env.FEATURE_OWNERSHIP)fail(503,'ownership_unavailable','Ownership correction is unavailable in this build.');return await detachCharacter(db,user,match[1],await body(request),!!env.FEATURE_AUCTIONS);
  }
  if(path==='/api/raids'&&request.method==='GET')return json({raids:await all(sql(db,raidSelect+' ORDER BY r.date DESC,r.created_at DESC'))});
  if(path==='/api/raids'&&request.method==='POST') {
   officer(user);const input=await body(request),defaults=await creationDefaults(db,env.FEATURE_ADMIN);
   const expansion=input.expansion===undefined?null:text(input.expansion,'Expansion',1,100),raidType=input.raidType===undefined?null:text(input.raidType,'Raid type',1,100);
   if(Boolean(expansion)!==Boolean(raidType))fail(400,'validation','Choose both expansion and raid type for a preset.');
   const preset=expansion?defaults.presets.find(p=>p.expansion.toLowerCase()===expansion.toLowerCase()&&p.raidType.toLowerCase()===raidType.toLowerCase()):null;
   if(input.rate===undefined&&expansion&&!preset)fail(400,'unknown_preset','That reward preset is not configured. Choose a configured preset or enter an officer rate.');
   const raidId=id(),name=text(input.name,'Raid name',2,100),date=validDate(input.date),rate=integer(input.rate===undefined?(preset?.rate??defaults.defaultTickRate):input.rate,'Tick rate'),at=now();await db.batch([sql(db,'INSERT INTO raids(id,name,date,rate,created_by,created_at) VALUES(?,?,?,?,?,?)',raidId,name,date,rate,user.id,at),auditStmt(db,user,'raid_created',{raidId,name,date,rate,expansion,raidType},at)]);return json({raid:await sql(db,raidSelect+' WHERE r.id=?',raidId).first()},201);
  }
  if((match=/^\/api\/raids\/([^/]+)\/import$/.exec(path))&&request.method==='POST')return await importDumps(request,db,user,match[1]);
  if((match=/^\/api\/raids\/([^/]+)$/.exec(path))&&request.method==='GET') {
   const raid=await sql(db,raidSelect+' WHERE r.id=?',match[1]).first();if(!raid)fail(404,'not_found','Raid not found.');return json({raid,ticks:await all(sql(db,'SELECT id,raid_id AS raidId,file_name AS fileName,source_time AS sourceTime,row_count AS rowCount,created_at AS createdAt FROM ticks WHERE raid_id=? ORDER BY source_time',raid.id)),attendance:await all(sql(db,'SELECT a.id,a.tick_id AS tickId,a.character_id AS characterId,c.name AS characterName,a.class_name AS className,a.zone,a.status,a.dkp FROM attendance a JOIN characters c ON c.id=a.character_id JOIN ticks t ON t.id=a.tick_id WHERE t.raid_id=? ORDER BY t.source_time,c.name',raid.id))});
  }
  if(path==='/api/ledger'&&request.method==='GET') {
   const own=user.role==='admin'?'':' WHERE c.owner_id=?';return json({entries:await all(sql(db,`SELECT l.id,l.character_id AS characterId,c.name AS characterName,l.amount,l.reason,l.created_at AS createdAt,u.name AS actorName,r.name AS raidName,t.source_time AS sourceTime FROM ledger l JOIN characters c ON c.id=l.character_id JOIN users u ON u.id=l.actor_id LEFT JOIN attendance a ON a.id=l.attendance_id LEFT JOIN ticks t ON t.id=a.tick_id LEFT JOIN raids r ON r.id=t.raid_id${own} ORDER BY l.created_at DESC,l.id DESC LIMIT 500`,...(own?[user.id]:[])))});
  }
  if(path==='/api/audit'&&request.method==='GET'){officer(user);return json({entries:await all(sql(db,'SELECT a.id,u.name AS actorName,a.action,a.details,a.created_at AS createdAt FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 500'))});}
  fail(404,'not_found','Endpoint not found.');
 }catch(error){if(error instanceof ApiError)return json({error:error.message,code:error.code},error.status);if(/DKP_RANGE/.test(String(error)))return json({error:'This posting exceeds the supported exact whole-point number range. No records were changed.',code:'balance_range'},400);return json({error:'The request could not be completed. Please refresh and try again.',code:'internal_error'},500);}
}
