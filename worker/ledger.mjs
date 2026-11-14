import {HttpError} from './http.mjs';
function validDate(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return false;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
export async function mainBalance(db,userId) {
 const rows=(await db.prepare("SELECT c.id,c.name,COALESCE((SELECT SUM(amount) FROM ledger WHERE character_id=c.id),0) AS balance FROM characters c WHERE c.owner_id=? AND c.kind='main' AND c.approved_at IS NOT NULL").bind(userId).all()).results;
 if(rows.length!==1)return {balance:null,characterName:null};
 if(!Number.isSafeInteger(rows[0].balance))throw new HttpError(409,'balance_range','Your DKP balance needs officer review.');
 return {balance:rows[0].balance,characterName:rows[0].name};
}
export async function ledgerData(db,user,url) {
 const get=key=>(url.searchParams.get(key)||'').trim();
 const filters=Object.fromEntries(['characterId','actorId','from','to'].map(key=>[key,get(key)]));
 if(Object.values(filters).some(value=>value.length>128||/[\u0000-\u001f]/.test(value)))throw new HttpError(400,'validation','Choose valid ledger filters.');
 for(const key of ['from','to'])if(filters[key]&&!validDate(filters[key]))throw new HttpError(400,'validation','Choose actual recorded dates.');
 if(filters.from&&filters.to&&filters.from>filters.to)throw new HttpError(400,'validation','Start date must be on or before end date.');
 const sort=get('sort')||'createdAt',direction=get('direction')||'desc';
 const columns={createdAt:'l.created_at',characterName:'c.name COLLATE NOCASE',amount:'l.amount',actorName:'u.name COLLATE NOCASE'};
 if(!Object.hasOwn(columns,sort)||!['asc','desc'].includes(direction))throw new HttpError(400,'validation','Choose a valid ledger sort.');
 const raw=get('offset')||'0';if(!/^\d{1,7}$/.test(raw)||Number(raw)>1000000)throw new HttpError(400,'validation','Choose a valid ledger page.');
 const offset=Number(raw),limit=50,scope=user.role==='admin'?'':' AND c.owner_id=?',scopeArgs=scope?[user.id]:[];
 let where=scope,params=[...scopeArgs];
 for(const [key,column]of [['characterId','l.character_id'],['actorId','l.actor_id']])if(filters[key]){where+=` AND ${column}=?`;params.push(filters[key]);}
 if(filters.from){where+=' AND substr(l.created_at,1,10)>=?';params.push(filters.from);}
 if(filters.to){where+=' AND substr(l.created_at,1,10)<=?';params.push(filters.to);}
 const base=' FROM ledger l JOIN characters c ON c.id=l.character_id JOIN users u ON u.id=l.actor_id';
 const results=await db.batch([
  db.prepare(`SELECT l.id,l.character_id AS characterId,c.name AS characterName,l.amount,l.reason,l.created_at AS createdAt,u.name AS actorName,l.actor_id AS actorId,r.name AS raidName,t.source_time AS sourceTime${base} LEFT JOIN attendance a ON a.id=l.attendance_id LEFT JOIN ticks t ON t.id=a.tick_id LEFT JOIN raids r ON r.id=t.raid_id WHERE 1=1${where} ORDER BY ${columns[sort]} ${direction.toUpperCase()},l.id ${direction.toUpperCase()} LIMIT ? OFFSET ?`).bind(...params,limit,offset),
  db.prepare(`SELECT COUNT(*) AS total${base} WHERE 1=1${where}`).bind(...params),
  db.prepare(`SELECT DISTINCT c.id,c.name${base} WHERE 1=1${scope} ORDER BY c.name COLLATE NOCASE,c.id`).bind(...scopeArgs),
  db.prepare(`SELECT DISTINCT u.id,u.name${base} WHERE 1=1${scope} ORDER BY u.name COLLATE NOCASE,u.id`).bind(...scopeArgs)
 ]);
 return {entries:results[0].results,total:results[1].results[0].total,characters:results[2].results,recorders:results[3].results,offset,limit,filters,sort,direction};
}
