import {HttpError as AccessError,readJson,requireCsrf,constantTimeEqual} from './http.mjs';
export const ACCESS_AREAS=Object.freeze([
 ['accounts','Account management'],['overview','Overview'],['characters','Characters'],['mains','Mains and attendance'],['corrections','Missing attendance'],['correctionReview','Attendance request review'],['auctions','Auctions'],['auctionAdmin','Auction management'],['attendance','Attendance records'],['ledger','DKP ledger'],['items','Item references'],['captures','Log companion'],['loot','Loot preparation'],['claims','Character claims'],['settings','Settings'],['audit','Audit log'],['access','Access management']
].map(([key,label])=>Object.freeze({key,label})));
export const ACCESS_LEVELS=Object.freeze(['None','View','Read','Write'].map((label,value)=>Object.freeze({value,label})));
const areaKeys=new Set(ACCESS_AREAS.map(a=>a.key));
const validLevel=value=>Number.isInteger(value)&&value>=0&&value<=3;
const sql=(db,query,...params)=>db.prepare(query).bind(...params);
const all=async statement=>(await statement.all()).results;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(status,code,message)=>{throw new AccessError(status,code,message);};
function decode(value){try{const v=JSON.parse(value);return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return{};}}
function permissions(profile,overrides={}){return Object.fromEntries(ACCESS_AREAS.map(({key})=>{const value=Object.hasOwn(overrides,key)?overrides[key]:profile[key];return[key,validLevel(value)?value:0];}));}
function profileDto(row){return{id:row.id,name:row.name,templateKey:row.template_key,permissions:permissions(decode(row.permissions_json)),revision:row.revision,updatedAt:row.updated_at,updatedBy:row.updated_by};}
const userQuery=`SELECT u.id,u.name,u.email,u.role AS legacyRole,p.id AS profileId,p.name AS profileName,p.template_key AS templateKey,p.permissions_json,p.revision AS profileRevision,a.overrides_json,COALESCE(a.revision,0) AS revision,a.updated_at AS updatedAt,a.updated_by AS updatedBy,CASE WHEN a.user_id IS NULL THEN 1 ELSE 0 END AS usesDefault
 FROM users u LEFT JOIN access_user_profiles a ON a.user_id=u.id JOIN access_profiles p ON p.id=COALESCE(a.profile_id,CASE WHEN u.role='admin' THEN 'admin' ELSE 'member' END)`;
function userDto(row){const overrides=decode(row.overrides_json);return{id:row.id,name:row.name,email:row.email,legacyRole:row.legacyRole,profileId:row.profileId,profileName:row.profileName,templateKey:row.templateKey,overrides,permissions:permissions(decode(row.permissions_json),overrides),revision:row.revision,profileRevision:row.profileRevision,updatedAt:row.updatedAt,updatedBy:row.updatedBy,usesDefault:!!row.usesDefault};}
export async function resolveAccess(db,user){
 if(!user?.id)return null;
 const row=await sql(db,userQuery+' WHERE u.id=?',user.id).first();return row?userDto(row):null;
}
export function canAccess(access,area,level='view'){
 const minimum=typeof level==='string'?{view:1,read:2,write:3}[level]:level;
 return areaKeys.has(area)&&Number.isInteger(minimum)&&minimum>=1&&minimum<=3&&validLevel(access?.permissions?.[area])&&access.permissions[area]>=minimum;
}
const body=request=>readJson(request,{limit:8192,sizeMessage:'Access requests must be at most 8 KiB.',jsonMessage:'Send valid JSON access settings.',objectCode:'validation'});
function nameInput(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))fail(400,'validation','Profile name must contain 1–80 printable characters.');return value.trim();}
function matrix(value,partial=false){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!areaKeys.has(k)||!validLevel(value[k]))||(!partial&&ACCESS_AREAS.some(({key})=>!Object.hasOwn(value,key))))fail(400,'validation',partial?'Overrides must use known areas and levels from 0 to 3.':'Supply a level from 0 to 3 for every access area.');
 return Object.fromEntries(ACCESS_AREAS.filter(({key})=>Object.hasOwn(value,key)).map(({key})=>[key,value[key]]));
}
function revision(value,minimum){if(!Number.isSafeInteger(value)||value<minimum)fail(400,'validation','Supply the current expectedRevision.');return value;}
const writerGuard='EXISTS(SELECT 1 FROM access_effective_managers WHERE user_id=? AND access_level=3)';
async function requireWrite(db,user){if(!canAccess(await resolveAccess(db,user),'access','write'))fail(403,'forbidden','Access management write permission is required.');}
async function profile(db,id){const row=await sql(db,'SELECT * FROM access_profiles WHERE id=?',id).first();if(!row)fail(404,'not_found','Access profile not found.');return profileDto(row);}
async function currentUser(db,id){const row=await sql(db,userQuery+' WHERE u.id=?',id).first();if(!row)fail(404,'not_found','Member account not found.');return userDto(row);}
function auditStatement(db,actor,operation,action,details,at,table,key,value){return sql(db,`INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND operation_id=?)`,crypto.randomUUID(),actor.id,action,JSON.stringify(details),at,value,operation);}
export async function handleAccessApi(request,env,auth={}){
 const pathname=new URL(request.url).pathname,route=/^\/api\/access(?:\/(profiles|users)(?:\/([^/]+))?)?$/.exec(pathname);if(!route)return null;
 try{
  if(!auth.user?.id)fail(401,'unauthorized','Sign in to manage access.');if(!env?.DB)fail(503,'database_unavailable','Access settings storage is unavailable.');
  const db=env.DB,actor=auth.user,access=await resolveAccess(db,actor);
  if(request.method==='GET'&&!route[1]){
   if(!canAccess(access,'access','read'))fail(403,'forbidden','Access management read permission is required.');
   const readGuard='EXISTS(SELECT 1 FROM access_effective_managers WHERE user_id=? AND access_level BETWEEN 2 AND 3)';
   const result=await db.batch([sql(db,`SELECT * FROM access_profiles WHERE ${readGuard} ORDER BY CASE template_key WHEN 'admin' THEN 0 WHEN 'officer' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,name,id`,actor.id),sql(db,userQuery+` WHERE ${readGuard} ORDER BY lower(u.name),u.id`,actor.id)]);
   if(!result[0].results.length)fail(403,'forbidden','Access management read permission is required.');
   const users=result[1].results.map(userDto);return json({areas:ACCESS_AREAS,levels:ACCESS_LEVELS,profiles:result[0].results.map(profileDto),users,access:users.find(u=>u.id===actor.id)});
  }
  const creates=request.method==='POST'&&route[1]==='profiles'&&!route[2],edits=request.method==='PUT'&&!!route[2];
  if(!creates&&!edits)fail(405,'method_not_allowed','Use the supported access settings endpoint and method.');
  if(!canAccess(access,'access','write'))fail(403,'forbidden','Access management write permission is required.');
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'origin','A same-origin request is required.');
  if(!auth.csrfToken||request.headers.get('x-csrf-token')!==auth.csrfToken)fail(403,'csrf','Refresh your session before changing access.');
  const input=await body(request),operation=crypto.randomUUID(),at=new Date().toISOString();let result,target;
  if(route[1]==='profiles'){
   const name=nameInput(input.name),values=matrix(input.permissions);
   if(creates){
    target=crypto.randomUUID();result=await db.batch([
     sql(db,`INSERT INTO access_profiles(id,name,permissions_json,revision,updated_by,updated_at,operation_id) SELECT ?,?,?,1,?,?,? WHERE ${writerGuard} AND (SELECT COUNT(*) FROM access_profiles)<100`,target,name,JSON.stringify(values),actor.id,at,operation,actor.id),
     auditStatement(db,actor,operation,'access_profile_created',{profileId:target,before:null,after:{name,permissions:values}},at,'access_profiles','id',target)
    ]);
    if(!result[0].meta.changes){await requireWrite(db,actor);fail(409,'profile_limit','At most 100 access profiles may be created.');}
   }else{
    target=route[2];const previous=await profile(db,target),expected=revision(input.expectedRevision,1);
    if(previous.revision!==expected)fail(409,'revision_conflict','This profile changed. Reload access settings before saving.');
    result=await db.batch([
     sql(db,`UPDATE access_profiles SET name=?,permissions_json=?,revision=revision+1,updated_by=?,updated_at=?,operation_id=? WHERE id=? AND revision=? AND ${writerGuard}`,name,JSON.stringify(values),actor.id,at,operation,target,expected,actor.id),
     auditStatement(db,actor,operation,'access_profile_changed',{profileId:target,before:{name:previous.name,permissions:previous.permissions,revision:previous.revision},after:{name,permissions:values,revision:expected+1}},at,'access_profiles','id',target)
    ]);
    if(!result[0].meta.changes){await requireWrite(db,actor);fail(409,'revision_conflict','This profile changed. Reload access settings before saving.');}
   }
   return json({profile:await profile(db,target),access:await resolveAccess(db,actor)},creates?201:200);
  }
  target=route[2];const previous=await currentUser(db,target),expected=revision(input.expectedRevision,0),overrides=matrix(input.overrides,true);
  if(typeof input.profileId!=='string'||input.profileId.length>100)fail(400,'validation','Select an access profile.');
  const selected=await profile(db,input.profileId);if(previous.revision!==expected)fail(409,'revision_conflict','This member assignment changed. Reload access settings before saving.');
  result=await db.batch([
   sql(db,`INSERT INTO access_user_profiles(user_id,profile_id,overrides_json,revision,updated_by,updated_at,operation_id)
    SELECT u.id,?,?,1,?,?,? FROM users u WHERE u.id=? AND COALESCE((SELECT revision FROM access_user_profiles WHERE user_id=u.id),0)=? AND ${writerGuard}
     AND COALESCE((SELECT profile_id FROM access_user_profiles WHERE user_id=u.id),CASE WHEN u.role='admin' THEN 'admin' ELSE 'member' END)=?
     AND EXISTS(SELECT 1 FROM access_profiles WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM access_profiles WHERE id=? AND revision=?)
    ON CONFLICT(user_id) DO UPDATE SET profile_id=excluded.profile_id,overrides_json=excluded.overrides_json,revision=access_user_profiles.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at,operation_id=excluded.operation_id`,input.profileId,JSON.stringify(overrides),actor.id,at,operation,target,expected,actor.id,previous.profileId,previous.profileId,previous.profileRevision,input.profileId,selected.revision),
   auditStatement(db,actor,operation,'access_assignment_changed',{userId:target,before:{profileId:previous.profileId,profileRevision:previous.profileRevision,overrides:previous.overrides,permissions:previous.permissions,revision:previous.revision},after:{profileId:input.profileId,profileRevision:selected.revision,overrides,permissions:permissions(selected.permissions,overrides),revision:expected+1}},at,'access_user_profiles','user_id',target)
  ]);
  if(!result[0].meta.changes){await requireWrite(db,actor);fail(409,'revision_conflict','This member assignment changed. Reload access settings before saving.');}
  return json({user:await currentUser(db,target),access:await resolveAccess(db,actor)});
 }catch(error){
  if(String(error?.message).includes('ACCESS_LAST_WRITER'))return json({error:'Keep at least one account with access management write permission.',code:'last_access_writer'},409);
  return json({error:error instanceof AccessError?error.message:'Access settings could not be changed. Reload before retrying.',code:error instanceof AccessError?error.code:'access_error'},error instanceof AccessError?error.status:500);
 }
}
