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
console.log('Prepared ordered schema-only migrations through live loot capture. No accounts or guild data are seeded.');
