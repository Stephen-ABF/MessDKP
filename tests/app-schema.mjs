import { readFile } from 'node:fs/promises';
import { ITEM_REFERENCE_SCHEMA_SQL } from '../worker/items.mjs';
export async function applicationSchema() {
 const parts=await Promise.all(['schema.sql','auctions.sql','admin.sql','item-details.sql','loot.sql','captures.sql','ownership.sql','equipment.sql','attendance-eligibility.sql','access.sql','companion-devices.sql','catalog.sql','inventory.sql','spell-names.sql','raid-loot-import.sql','attendance-clones.sql','auction-management.sql','raid-deletion.sql','wishlist.sql','account-safety.sql','parcels.sql'].map(name=>readFile(new URL('../worker/'+name,import.meta.url),'utf8')));
 return [parts[0],ITEM_REFERENCE_SCHEMA_SQL,...parts.slice(1)].join('\n');
}
