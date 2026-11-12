import { readFile } from 'node:fs/promises';
import { ITEM_REFERENCE_SCHEMA_SQL } from '../worker/items.mjs';
export async function applicationSchema() {
 const parts=await Promise.all(['schema.sql','auctions.sql','admin.sql','item-details.sql','loot.sql','captures.sql'].map(name=>readFile(new URL('../worker/'+name,import.meta.url),'utf8')));
 return [parts[0],ITEM_REFERENCE_SCHEMA_SQL,...parts.slice(1)].join('\n');
}
