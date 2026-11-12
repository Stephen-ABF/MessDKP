const detailsJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleDetailsApi(request,env,auth={}){
 const path=new URL(request.url).pathname,tickRoute=/^\/api\/raids\/([^/]+)\/ticks\/([^/]+)$/.exec(path),lootRoute=/^\/api\/reports\/mains\/([^/]+)\/loot$/.exec(path);
 if(!tickRoute&&!lootRoute)return null;
 if(!auth.user?.id)return detailsJson({error:'Sign in to view guild records.',code:'unauthorized'},401);
 if(request.method!=='GET')return detailsJson({error:'These records are read-only.',code:'method_not_allowed'},405);
 if(!env.DB)return detailsJson({error:'The database is unavailable.',code:'database_unavailable'},503);
 try{
  if(tickRoute){
   const results=await env.DB.batch([
    env.DB.prepare('SELECT r.id,r.name,r.date,r.rate,r.created_at AS createdAt FROM raids r JOIN ticks t ON t.raid_id=r.id WHERE r.id=? AND t.id=?').bind(tickRoute[1],tickRoute[2]),
    env.DB.prepare('SELECT id,raid_id AS raidId,file_name AS fileName,source_time AS sourceTime,row_count AS rowCount,created_at AS createdAt FROM ticks WHERE raid_id=? AND id=?').bind(tickRoute[1],tickRoute[2]),
    env.DB.prepare('SELECT a.id,a.tick_id AS tickId,a.character_id AS characterId,c.name AS characterName,a.class_name AS className,a.zone,a.status,a.dkp FROM attendance a JOIN characters c ON c.id=a.character_id WHERE a.tick_id=? AND EXISTS(SELECT 1 FROM ticks WHERE id=a.tick_id AND raid_id=?) ORDER BY c.name,c.id').bind(tickRoute[2],tickRoute[1])
   ]);
   if(!results[0].results.length)return detailsJson({error:'Source capture not found in this raid.',code:'not_found'},404);
   return detailsJson({raid:results[0].results[0],tick:results[1].results[0],attendance:results[2].results});
  }
  const results=await env.DB.batch([
   env.DB.prepare("SELECT id FROM characters WHERE id=? AND kind='main' AND owner_id IS NOT NULL").bind(lootRoute[1]),
   env.DB.prepare("SELECT a.id AS auctionId,a.item_id AS itemId,a.item_name AS itemName,a.source_url AS sourceUrl,w.winning_bid AS winningBid,w.price,w.status,w.confirmed_at_ms AS confirmedAt,a.closed_at_ms AS closedAt FROM auction_awards w JOIN auctions a ON a.id=w.auction_id WHERE w.character_id=? AND a.status='closed' AND a.cancelled_at_ms IS NULL AND a.closes_at_ms<=? ORDER BY COALESCE(w.confirmed_at_ms,a.closed_at_ms) DESC,a.id").bind(lootRoute[1],Date.now())
  ]);
  if(!results[0].results.length)return detailsJson({error:'This character is not an approved main.',code:'main_not_found'},404);
  return detailsJson({characterId:lootRoute[1],loot:results[1].results.map(row=>({...row,confirmedAt:row.confirmedAt===null?null:new Date(row.confirmedAt).toISOString(),closedAt:row.closedAt===null?null:new Date(row.closedAt).toISOString()}))});
 }catch{return detailsJson({error:'The requested records could not be loaded.',code:'detail_error'},500);}
}
