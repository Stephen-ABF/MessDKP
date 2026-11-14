import {PARCEL_CAN_SQL,resolveAwardHolders,CUSTODY_CTE} from './parcels.mjs';
// Guild history includes settled awards and holding-looter delivery status.
// Personal outcomes expose only the caller's final bids.
const historyJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const historyArray=value=>{try{const a=JSON.parse(value);return Array.isArray(a)?a:[];}catch{return[];}};
const typeExpression="(SELECT CAST(json_extract(f.value,'$.value') AS TEXT) FROM json_each(CASE WHEN json_valid(ir.full_details_json) AND json_type(ir.full_details_json,'$.fields')='array' THEN json_extract(ir.full_details_json,'$.fields') ELSE '[]' END) f WHERE lower(replace(json_extract(f.value,'$.label'),' ',''))='itemtype' LIMIT 1)";
const historyBase=` FROM auctions a LEFT JOIN item_references ir ON ir.item_id=a.item_id LEFT JOIN loot_draft_items li ON li.auction_id=a.id LEFT JOIN loot_drafts d ON d.id=li.draft_id AND d.status='published' LEFT JOIN raids r ON r.id=d.raid_id LEFT JOIN auction_awards w ON w.auction_id=a.id LEFT JOIN characters c ON c.id=w.character_id LEFT JOIN h ON h.auction_id=w.auction_id AND h.character_id=w.character_id LEFT JOIN loot_parcels p ON p.auction_id=w.auction_id AND p.character_id=w.character_id WHERE a.status='closed' AND a.closed_at_ms IS NOT NULL AND a.cancelled_at_ms IS NULL`;
const historyList=column=>`json_each(CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END)`;
export async function handleLootHistoryApi(request,env,context={}){
 const url=new URL(request.url);if(url.pathname!=='/api/loot-history')return null;
 if(!context.user?.id)return historyJson({error:'Sign in to view guild loot history.',code:'unauthorized'},401);
 if(request.method!=='GET')return historyJson({error:'Loot history is read-only.',code:'method_not_allowed'},405);
 if(!env.DB)return historyJson({error:'History storage is unavailable.',code:'database_unavailable'},503);
 try{
  const filters={};for(const key of ['q','class','slot','type','winner','boss','from','to','status','looter','queue']){const value=url.searchParams.get(key)||'';if(value.length>120||/[\u0000-\u001f\u007f]/.test(value))throw Error('Choose valid history filters.');filters[key]=value.trim();}
  for(const key of ['from','to'])if(filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||filters[key]<'0001-01-01'||!Number.isFinite(Date.parse(filters[key]+'T00:00:00Z'))||new Date(filters[key]+'T00:00:00Z').toISOString().slice(0,10)!==filters[key]))throw Error('Choose actual raid dates (YYYY-MM-DD).');
  if(filters.from&&filters.to&&filters.from>filters.to)throw Error('Start date must be on or before end date.');
  if(filters.status&&!['confirmed','pending','unsold','parceled'].includes(filters.status))throw Error('Choose a valid award status.');
  if(filters.queue&&!['mine'].includes(filters.queue))throw Error('Choose a valid parcel queue.');
  const rawOffset=url.searchParams.get('offset')||'0';if(!/^\d{1,9}$/.test(rawOffset))throw Error('Choose a valid history page.');const offset=Number(rawOffset),limit=50;
  let where='',params=[];const text=(column,value)=>{where+=` AND ${column} LIKE ? ESCAPE '\\'`;params.push('%'+value.replace(/[\\%_]/g,'\\$&')+'%');};
  if(filters.q)text('a.item_name',filters.q);if(filters.winner)text('c.name',filters.winner);if(filters.boss)text('d.boss_name',filters.boss);if(filters.looter){where+=' AND COALESCE(p.holder_name,h.holder_name)=? COLLATE NOCASE';params.push(filters.looter);}
  for(const[key,column]of [['class','a.classes_json'],['slot','a.slots_json']])if(filters[key]){where+=` AND EXISTS(SELECT 1 FROM ${historyList(column)} WHERE value=?${key==='class'?" OR value='ALL'":''})`;params.push(filters[key]);}
  if(filters.type){where+=` AND ${typeExpression}=?`;params.push(filters.type);}
  if(filters.from){where+=' AND r.date>=?';params.push(filters.from);}if(filters.to){where+=' AND r.date<=?';params.push(filters.to);}
  if(filters.status==='unsold')where+=' AND w.character_id IS NULL';else if(filters.status==='parceled')where+=' AND p.parceled_at IS NOT NULL';else if(filters.status){where+=' AND w.status=?';params.push(filters.status);if(filters.status==='confirmed')where+=' AND p.parceled_at IS NULL';}
  if(filters.queue==='mine'){where+=` AND w.status='confirmed' AND p.parceled_at IS NULL AND (${PARCEL_CAN_SQL})`;params.push(context.user.id,context.user.id,context.user.id);}
  const db=env.DB,query=(sql,...args)=>db.prepare(sql).bind(...args);
  const custody=JSON.stringify(await resolveAwardHolders(db));
  const results=await db.batch([
   query(`${CUSTODY_CTE}SELECT a.id AS auctionId,a.item_id AS itemId,a.item_name AS itemName,a.classes_json,a.slots_json,ir.advanced_loot AS advancedLoot,${typeExpression} AS itemType,a.quantity,a.closed_at_ms AS closedAt,d.boss_name AS bossName,r.name AS raidName,r.date AS raidDate,c.name AS winnerName,w.winning_bid AS winningBid,w.price,w.status AS awardStatus,w.award_rank AS awardRank,w.character_id AS characterId,h.holder_event_id AS holderEventId,COALESCE(p.holder_name,h.holder_name) AS looterName,p.parceled_at AS parceledAt,CASE WHEN w.status='confirmed' AND p.parceled_at IS NULL AND (${PARCEL_CAN_SQL}) THEN 1 ELSE 0 END AS canParcel${historyBase}${where} ORDER BY a.closed_at_ms DESC,a.id,w.award_rank LIMIT ? OFFSET ?`,custody,context.user.id,context.user.id,context.user.id,...params,limit,offset),
   query(`${CUSTODY_CTE}SELECT COUNT(*) AS total${historyBase}${where}`,custody,...params),
   query(`SELECT DISTINCT value AS slot FROM auctions a,${historyList('a.slots_json')} WHERE a.status='closed' AND a.closed_at_ms IS NOT NULL AND a.cancelled_at_ms IS NULL ORDER BY value`),
   query(`${CUSTODY_CTE}SELECT DISTINCT ${typeExpression} AS itemType${historyBase} AND ${typeExpression} IS NOT NULL ORDER BY itemType`,custody),
   query(`${CUSTODY_CTE}SELECT DISTINCT holder_name AS name FROM h WHERE holder_name IS NOT NULL ORDER BY name COLLATE NOCASE`,custody)
  ]);
  return historyJson({rows:results[0].results.map(({classes_json,slots_json,...row})=>({...row,classes:historyArray(classes_json),slots:historyArray(slots_json)})),total:results[1].results[0].total,offset,limit,slots:results[2].results.map(r=>r.slot),types:results[3].results.map(r=>r.itemType),looters:results[4].results.map(r=>r.name)});
 }catch(error){if(/Choose|Start date/.test(error.message))return historyJson({error:error.message,code:'validation'},400);throw error;}
}
export async function handleItemComparisonApi(request,env,context={}){
 if(new URL(request.url).pathname!=='/api/item-comparison')return null;
 if(!context.user?.id)return historyJson({error:'Sign in to compare your equipment.',code:'unauthorized'},401);
 if(request.method!=='GET')return historyJson({error:'Equipment comparison is read-only.',code:'method_not_allowed'},405);
 if(!env.DB)return historyJson({error:'Equipment storage is unavailable.',code:'database_unavailable'},503);
 const result=await env.DB.batch([
  env.DB.prepare("SELECT id,name,class_name AS className,kind FROM characters WHERE owner_id=? AND kind IN('main','alt') AND approved_at IS NOT NULL ORDER BY CASE kind WHEN 'main' THEN 0 ELSE 1 END,name,id").bind(context.user.id),
  env.DB.prepare("SELECT e.character_id AS characterId,e.slot_key AS slotKey,e.item_id AS itemId,r.name AS itemName,r.advanced_loot AS advancedLoot FROM character_equipment e JOIN characters c ON c.id=e.character_id LEFT JOIN item_references r ON r.item_id=e.item_id WHERE c.owner_id=? AND c.kind IN('main','alt') AND c.approved_at IS NOT NULL").bind(context.user.id)
 ]);
 return historyJson({characters:result[0].results.map(c=>({...c,slots:result[1].results.filter(s=>s.characterId===c.id).map(({characterId,...s})=>s)}))});
}
export async function decorateImportItems(db,events){
 const normalize=value=>String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(),names=[...new Set(events.map(e=>normalize(e.itemName)))],icons=new Map();
 for(let start=0;start<names.length;start+=50){const encoded=JSON.stringify(names.slice(start,start+50));const result=await db.batch([
  db.prepare(`WITH matches AS (SELECT i.name_key,COUNT(*) AS name_count,MIN(i.item_id) AS item_id FROM catalog_items i JOIN catalog_state s ON s.active_import_id=i.import_id WHERE i.name_key IN(SELECT value FROM json_each(?)) GROUP BY i.name_key) SELECT m.name_key,m.name_count,i.item_id,i.name,i.raw_record,c.header_json FROM matches m LEFT JOIN catalog_state s ON s.id=1 LEFT JOIN catalog_items i ON m.name_count=1 AND i.import_id=s.active_import_id AND i.item_id=m.item_id LEFT JOIN catalog_imports c ON c.id=i.import_id`).bind(encoded),
  db.prepare('SELECT lower(trim(name)) AS name_key,COUNT(*) AS name_count,MIN(item_id) AS item_id,CASE WHEN COUNT(*)=1 THEN MIN(advanced_loot) END AS advanced_loot FROM item_references WHERE lower(trim(name)) IN(SELECT value FROM json_each(?)) GROUP BY lower(trim(name))').bind(encoded)
 ]);
 const byName=new Map(result[0].results.map(row=>[row.name_key,row]));for(const row of result[1].results)if(!byName.has(row.name_key))byName.set(row.name_key,row);
 for(const[key,row]of byName){if(row.name_count!==1)continue;let advancedLoot=row.advanced_loot;
  if(row.raw_record){const header=JSON.parse(row.header_json),index=header.findIndex(h=>String(h).toLowerCase()==='icon'),values=[];let value='';for(let i=0;i<row.raw_record.length;i++){const c=row.raw_record[i];if(c==='\\'&&row.raw_record[i+1]==='|'){value+='|';i++;}else if(c==='|'){values.push(value);value='';}else value+=c;}values.push(value);const icon=index<0?null:values[index];if(/^\d{1,7}$/.test(icon||'')&&Number(icon)>0)advancedLoot=row.item_id+'^'+Number(icon)+'^'+row.name;}
  icons.set(key,{itemId:row.item_id,advancedLoot:advancedLoot||null});
 }}
 return events.map(event=>icons.has(normalize(event.itemName))?{...event,...icons.get(normalize(event.itemName))}:event);
}
export async function handleMyAuctionsApi(request,env,context={}){
 const url=new URL(request.url);if(url.pathname!=='/api/my-auctions')return null;
 if(!context.user?.id)return historyJson({error:'Sign in to view your auction outcomes.',code:'unauthorized'},401);
 if(request.method!=='GET')return historyJson({error:'Auction outcomes are read-only.',code:'method_not_allowed'},405);
 const outcome=url.searchParams.get('outcome')||'won',raw=url.searchParams.get('offset')||'0';if(!['won','lost'].includes(outcome)||!/^\d{1,9}$/.test(raw))return historyJson({error:'Choose won or lost and a valid page.',code:'validation'},400);
 if(!env.DB)return historyJson({error:'Auction storage is unavailable.',code:'database_unavailable'},503);
 const db=env.DB,offset=Number(raw),limit=50,base=` FROM auction_bids b JOIN auctions a ON a.id=b.auction_id LEFT JOIN auction_awards w ON w.auction_id=a.id AND w.user_id=b.user_id LEFT JOIN loot_parcels p ON p.auction_id=w.auction_id AND p.character_id=w.character_id LEFT JOIN characters c ON c.id=b.character_id LEFT JOIN item_references ir ON ir.item_id=a.item_id LEFT JOIN loot_draft_items li ON li.auction_id=a.id LEFT JOIN loot_drafts d ON d.id=li.draft_id LEFT JOIN raids r ON r.id=d.raid_id WHERE b.user_id=? AND b.active=1 AND a.status='closed' AND a.closed_at_ms IS NOT NULL AND a.cancelled_at_ms IS NULL AND w.character_id IS ${outcome==='won'?'NOT ':''}NULL`;
 const results=await db.batch([
  db.prepare(`SELECT a.id AS auctionId,a.item_id AS itemId,a.item_name AS itemName,ir.advanced_loot AS advancedLoot,a.closed_at_ms AS closedAt,b.character_id AS characterId,p.parceled_at AS parceledAt,b.amount AS yourBid,b.eligible_at_close AS eligible,c.name AS characterName,d.id AS draftId,d.boss_name AS bossName,r.name AS raidName,r.date AS raidDate,w.price,w.status AS awardStatus,(SELECT MIN(winning_bid) FROM auction_awards WHERE auction_id=a.id) AS lowestWinningBid${base} ORDER BY a.closed_at_ms DESC,a.id LIMIT ? OFFSET ?`).bind(context.user.id,limit,offset),
  db.prepare(`SELECT COUNT(*) AS total${base}`).bind(context.user.id)
 ]);
 const rows=results[0].results,custody=new Map(),draftIds=JSON.stringify([...new Set(rows.map(r=>r.draftId).filter(Boolean))]);
 if(outcome==='won'&&rows.some(r=>r.draftId)){
  const groups=(await db.prepare(`SELECT g.draft_id AS draftId,e.item_name AS itemName,e.holder,SUM(e.quantity) AS quantity FROM raid_loot_import_events e JOIN raid_loot_import_groups g ON g.id=e.handoff_group_id WHERE g.draft_id IN(SELECT value FROM json_each(?)) AND e.excluded=0 GROUP BY g.draft_id,e.item_name,e.holder`).bind(draftIds).all()).results;
  const normalize=value=>String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  // Match the retained draft name rather than a renamed catalog display name.
  const originals=(await db.prepare('SELECT auction_id,name FROM loot_draft_items WHERE auction_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map(r=>r.auctionId))).all()).results;
  for(const row of rows){const key=normalize(originals.find(i=>i.auction_id===row.auctionId)?.name||row.itemName),holders=new Map();for(const g of groups)if(g.draftId===row.draftId&&normalize(g.itemName)===key)holders.set(g.holder,(holders.get(g.holder)||0)+g.quantity);custody.set(row.auctionId,[...holders].map(([name,quantity])=>({name,quantity})));}
 }
 const assigned=outcome==='won'?await resolveAwardHolders(db,rows.map(row=>row.auctionId)):[];
 return historyJson({outcome,offset,limit,total:results[1].results[0].total,rows:rows.map(({draftId,...row})=>({...row,eligible:row.eligible===1,bidGap:outcome==='lost'&&row.eligible===1&&row.lowestWinningBid!==null?Math.max(0,row.lowestWinningBid-row.yourBid):null,...(outcome==='won'?{holdingLooters:custody.get(row.auctionId)||[],assignedLooter:assigned.find(a=>a.auctionId===row.auctionId&&a.characterId===row.characterId)?.holderName??null}: {})}))});
}
