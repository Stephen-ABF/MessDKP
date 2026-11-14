import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_REFERENCE_SCHEMA_SQL } from './worker/items.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const modules=await Promise.all(['schema.sql','auctions.sql','admin.sql'].map(name=>readFile(path.join(root,'worker',name),'utf8')));
const combined=[modules[0],ITEM_REFERENCE_SCHEMA_SQL,modules[1],modules[2]].join('\n');
// Keep each CREATE/PRAGMA statement intact, including the trigger body.
const statements=combined.split(/(?=^(?:CREATE|PRAGMA)\s)/m).map(part=>part.trim()).filter(Boolean);
const schema=statements.join('\n--> statement-breakpoint\n')+'\n';
const directory = path.join(root, 'drizzle');
await mkdir(path.join(directory, 'meta'), { recursive: true });
const target = path.join(directory, '0000_initial.sql');
let existing;
try { existing = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing && existing !== schema) throw new Error('Initial migration already exists with different SQL. Append a new migration; never rewrite an applied migration.');
if (!existing) await writeFile(target, schema, 'utf8');
const journal = path.join(directory, 'meta/_journal.json');
try { await access(journal); } catch {
  await writeFile(journal, JSON.stringify({ version:'7', dialect:'sqlite', entries:[{idx:0,version:'6',when:Date.now(),tag:'0000_initial',breakpoints:true}] },null,2)+'\n','utf8');
}
const addition=(await Promise.all(['item-details.sql','loot.sql'].map(name=>readFile(path.join(root,'worker',name),'utf8')))).join('\n');
const nextSchema=addition.split(/(?=^(?:CREATE|ALTER|PRAGMA)\s)/m).map(part=>part.trim()).filter(Boolean).join('\n--> statement-breakpoint\n')+'\n';
const nextTarget=path.join(directory,'0001_item_catalog_boss_loot.sql');
let nextExisting;
try {nextExisting=await readFile(nextTarget,'utf8');} catch(error) {if(error.code!=='ENOENT')throw error;}
if(nextExisting&&nextExisting!==nextSchema)throw new Error('Migration 0001 already exists with different SQL. Append a migration; never rewrite an applied migration.');
if(!nextExisting)await writeFile(nextTarget,nextSchema,'utf8');
const journalData=JSON.parse(await readFile(journal,'utf8'));
if(!journalData.entries.some(entry=>entry.tag==='0001_item_catalog_boss_loot')){
 journalData.entries.push({idx:1,version:'6',when:Date.now(),tag:'0001_item_catalog_boss_loot',breakpoints:true});
 await writeFile(journal,JSON.stringify(journalData,null,2)+'\n','utf8');
}
const captureSchema=(await readFile(path.join(root,'worker/captures.sql'),'utf8')).split(/(?=^CREATE\s)/m).map(s=>s.trim()).filter(Boolean).join('\n--> statement-breakpoint\n')+'\n';
const captureTarget=path.join(directory,'0002_live_loot_capture.sql');
let captureExisting;try{captureExisting=await readFile(captureTarget,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(captureExisting&&captureExisting!==captureSchema)throw new Error('Migration 0002 differs. Append a migration instead of rewriting history.');
if(!captureExisting)await writeFile(captureTarget,captureSchema,'utf8');
if(!journalData.entries.some(entry=>entry.tag==='0002_live_loot_capture')){
 journalData.entries.push({idx:2,version:'6',when:Date.now(),tag:'0002_live_loot_capture',breakpoints:true});
 await writeFile(journal,JSON.stringify(journalData,null,2)+'\n','utf8');
}
const ownershipSchema=(await readFile(path.join(root,'worker/ownership.sql'),'utf8')).split(/(?=^(?:CREATE|ALTER|UPDATE|INSERT)\s)/m).map(s=>s.trim()).filter(Boolean).join('\n--> statement-breakpoint\n')+'\n';
const ownershipTarget=path.join(directory,'0003_assignment_history.sql');
let ownershipExisting;try{ownershipExisting=await readFile(ownershipTarget,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(ownershipExisting&&ownershipExisting!==ownershipSchema)throw new Error('Migration0003 differs. Append a migration instead of rewriting history.');
if(!ownershipExisting)await writeFile(ownershipTarget,ownershipSchema,'utf8');
if(!journalData.entries.some(entry=>entry.tag==='0003_assignment_history')){
 journalData.entries.push({idx:3,version:'6',when:Date.now(),tag:'0003_assignment_history',breakpoints:true});
 await writeFile(journal,JSON.stringify(journalData,null,2)+'\n','utf8');
}
const equipmentSchema=(await readFile(path.join(root,'worker/equipment.sql'),'utf8')).split(/(?=^CREATE\s)/m).map(s=>s.trim()).filter(Boolean).join('\n--> statement-breakpoint\n')+'\n';
const equipmentTarget=path.join(directory,'0004_character_equipment.sql');
let equipmentExisting;try{equipmentExisting=await readFile(equipmentTarget,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(equipmentExisting&&equipmentExisting!==equipmentSchema)throw new Error('Migration0004 differs. Append a migration instead of rewriting history.');
if(!equipmentExisting)await writeFile(equipmentTarget,equipmentSchema,'utf8');
if(!journalData.entries.some(entry=>entry.tag==='0004_character_equipment')){
 journalData.entries.push({idx:4,version:'6',when:Date.now(),tag:'0004_character_equipment',breakpoints:true});
 await writeFile(journal,JSON.stringify(journalData,null,2)+'\n','utf8');
}
for(const [idx,tag,file]of [[5,'0005_attendance_eligibility','attendance-eligibility.sql'],[6,'0006_access_profiles','access.sql'],[7,'0007_companion_devices','companion-devices.sql'],[8,'0008_uploaded_item_catalog','catalog.sql'],[9,'0009_inventory_imports','inventory.sql'],[10,'0010_spell_names','spell-names.sql'],[11,'0011_raid_loot_imports','raid-loot-import.sql'],[12,'0012_attendance_clones','attendance-clones.sql'],[13,'0013_auction_management','auction-management.sql'],[14,'0014_raid_deletion','raid-deletion.sql'],[15,'0015_character_wishlist','wishlist.sql'],[16,'0016_account_safety','account-safety.sql']]){
 const addition=(await readFile(path.join(root,'worker',file),'utf8')).split(idx>=14?/(?=^(?:CREATE|INSERT|ALTER|UPDATE|DROP)\s)/m:idx===13?/(?=^(?:CREATE|INSERT|ALTER|UPDATE)\s)/m:/(?=^(?:CREATE|INSERT)\s)/m).map(s=>s.trim()).filter(Boolean).join('\n--> statement-breakpoint\n')+'\n';
 const target=path.join(directory,tag+'.sql');let previous;try{previous=await readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&previous!==addition)throw new Error('Applied migration '+tag+' differs. Append a migration instead.');
 if(!previous)await writeFile(target,addition,'utf8');
 if(!journalData.entries.some(entry=>entry.tag===tag)){journalData.entries.push({idx,version:'6',when:Date.now(),tag,breakpoints:true});await writeFile(journal,JSON.stringify(journalData,null,2)+'\n','utf8');}
}
console.log('Prepared ordered migrations through scoped raid deletion and character wish lists. Existing guild records are retained.');
