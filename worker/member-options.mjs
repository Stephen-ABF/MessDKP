const optionsJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function handleMemberOptions(request,env,auth){
 const path=new URL(request.url).pathname;
 if(!['/api/raid-options','/api/attendance-requests/options','/api/ledger/characters'].includes(path))return null;
 if(!auth?.user?.id)return optionsJson({error:'Sign in to view available records.',code:'unauthorized'},401);
 if(request.method!=='GET')return optionsJson({error:'Use GET for available records.',code:'method_not_allowed'},405);
 if(path==='/api/raid-options'){const result=await env.DB.prepare('SELECT r.id,r.name,r.date,(SELECT COUNT(*) FROM ticks t WHERE t.raid_id=r.id) AS tickCount FROM raids r ORDER BY r.date DESC,r.id LIMIT 500').all();return optionsJson({raids:result.results});}
 if(path==='/api/ledger/characters'){const result=await env.DB.prepare("SELECT c.id,c.name,COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.character_id=c.id),0) AS balance FROM characters c WHERE c.kind='main' AND c.owner_id IS NOT NULL AND c.approved_at IS NOT NULL ORDER BY c.name,c.id LIMIT 1000").all();return optionsJson({characters:result.results});}
 const result=await env.DB.batch([
  env.DB.prepare("SELECT id,name FROM characters WHERE owner_id=? AND kind='main' AND approved_at IS NOT NULL").bind(auth.user.id),
  env.DB.prepare("SELECT t.id,t.raid_id AS raidId,r.name AS raidName,r.date AS raidDate,t.source_time AS sourceTime,t.file_name AS fileName,r.rate FROM ticks t JOIN raids r ON r.id=t.raid_id JOIN characters c ON c.owner_id=? AND c.kind='main' AND c.approved_at IS NOT NULL JOIN character_attendance_eligibility e ON e.character_id=c.id WHERE r.date||'T'||substr(t.source_time,12,8)>=e.start_at AND NOT EXISTS(SELECT 1 FROM attendance a WHERE a.tick_id=t.id AND a.character_id=c.id AND a.status='credited') AND NOT EXISTS(SELECT 1 FROM correction_requests q WHERE q.tick_id=t.id AND q.character_id=c.id) ORDER BY r.date DESC,t.source_time DESC,t.id LIMIT 500").bind(auth.user.id)
 ]);
 return optionsJson({character:result[0].results[0]??null,ticks:result[1].results});
}
