import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseInventoryExport,createInventoryApi,getInventoryAugments,INVENTORY_MAX_BYTES} from '../worker/inventory.mjs';
import {ITEM_REFERENCE_SCHEMA_SQL,getCachedItemDetails} from '../worker/items.mjs';
import {createEquipmentApi} from '../worker/equipment.mjs';
import {createD1} from './d1-adapter.mjs';
const locations=['Charm','Ear','Head','Face','Ear','Neck','Shoulders','Arms','Back','Wrist','Wrist','Range','Hands','Primary','Secondary','Fingers','Fingers','Chest','Legs','Feet','Waist','Power Source','Ammo'];
const read=file=>readFileSync(new URL('../worker/'+file,import.meta.url),'utf8');
const origin='https://guild.test';
function exportText({empty=[],augments=true,extras=true}={}){
 const lines=['Location\tName\tID\tCount\tSlots'];
 locations.forEach((location,index)=>{const absent=empty.includes(index),id=index+101;lines.push(`${location}\t${absent?'Empty':'Synthetic Item '+id}\t${absent?0:id}\t${absent?0:1}\t${absent?0:6}`);if(augments&&!absent){lines.push(`${location}-Slot1\tSynthetic Augment ${id+1000}\t${id+1000}\t1\t6`);lines.push(`${location}-Slot2\tEmpty\t0\t0\t0`);}});
 if(extras)lines.push('General 1\tSynthetic Bag\t3000\t1\t10','General 1-Slot1\tSynthetic Stored Item\t3001\t20\t0','General 1-Slot2\tSynthetic Bag\t3002\t1\t10','General 1-Slot2-Slot1\tSynthetic Nested Item\t3003\t1\t0','Held\tEmpty\t0\t0\t0','Bank1\tSynthetic Bank Item\t3004\t1\t0','SharedBank1\tEmpty\t0\t0\t0','','KeyRing\tName\tID\t','Mount\tSynthetic Mount\t4000\tSTAT','Illusion\tSynthetic Illusion\t4001');
 return lines.join('\r\n')+'\r\n';
}
function fixture({catalog}={}){
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('item-details.sql'),read('auctions.sql'),read('equipment.sql'),read('inventory.sql')].join('\n'));
 for(const id of ['owner','other','officer'])DB.raw.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,id+'@fixture.invalid',id,'fixture','fixture',id==='officer'?'admin':'member','2026-11-12');
 DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run('hero','hero','Hero',100,'Bard','Raider','main','owner','2026-11-12');
 DB.raw.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run('credit','hero',null,42,'Preserve balance','officer','2026-11-12','credit-key');
 const handler=createInventoryApi({catalog});
 const call=async(action='preview',{data={fileName:'Hero_test-Inventory.txt',text:exportText()},user='owner',headers={},context={}}={})=>{const res=await handler(new Request(origin+'/api/characters/hero/inventory/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'token',...headers},body:JSON.stringify(data)}),{DB},{user:user?{id:user,role:user==='officer'?'admin':'member'}:null,csrfToken:'token',...context});return{status:res.status,body:await res.json()};};
 const prepare=async()=>{const preview=await call();assert.equal(preview.status,200,JSON.stringify(preview.body));return{importId:preview.body.importId,fileName:preview.body.fileName,text:exportText(),selections:preview.body.slots.filter(s=>s.selectedByDefault).map(s=>({slotKey:s.slotKey,expectedItemId:s.currentItemId}))};};
 const count=table=>DB.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return{DB,call,prepare,count,close(){DB.close();}};
}
test('verified export format maps repeated ears/wrists/fingers by occurrence and preserves augments without equipping storage',()=>{
 const parsed=parseInventoryExport('\uFEFF'+exportText());assert.equal(parsed.slots.length,23);assert.deepEqual(parsed.slots.filter(s=>/^ear|^wrist|^finger/.test(s.slotKey)).map(s=>[s.slotKey,s.itemId]),[['ear1',102],['ear2',105],['wrist1',110],['wrist2',111],['finger1',116],['finger2',117]]);
 assert.equal(parsed.summary.augmentCount,23);assert.equal(parsed.summary.emptyAugments,23);assert.equal(parsed.summary.keyRingRows,2);assert.equal(parsed.summary.storageRows,4);assert.equal(parsed.summary.ignoredRows,9);assert.equal(parsed.slots[0].augments[0].itemId,1101);assert.ok(!parsed.slots.some(s=>s.itemId>=3000));assert.equal(parsed.slots.at(-2).slotKey,'powerSource');assert.equal(parsed.slots.at(-1).slotKey,'ammo');
});
test('bad headers, truncated exports, duplicate roots, bad values, detached augments and unknown locations reject whole file',()=>{
 const text=exportText();for(const bad of [text.replace('Location\tName','Name\tLocation'),text.replace('Head\tSynthetic Item 103\t103\t1\t6\r\n',''),text.replace('Held\tEmpty\t0\t0\t0','Head\tSynthetic Item 900\t900\t1\t6'),text.replace('\t101\t1\t6','\t101x\t1\t6'),text.replace('Charm-Slot2\tEmpty','Charm-Slot1\tEmpty'),text.replace('General 1\tSynthetic Bag','Unknown Bag\tSynthetic Bag'),text.replace('Ear-Slot1\tSynthetic Augment 1102','Charm-Slot3\tSynthetic Augment 1102'),text.replace('Synthetic Item 101','Empty')])assert.throws(()=>parseInventoryExport(bad));
 assert.throws(()=>parseInventoryExport('x'.repeat(INVENTORY_MAX_BYTES+1)),e=>e.status===413);assert.throws(()=>parseInventoryExport(text+'\x00'));
});
test('preview is read-only, defaults empty current slots only, resolves by catalog ID and names unknown identities honestly',async()=>{const h=fixture({catalog:{async getCatalogItem(db,id){return id===101?{itemId:101,name:'Exact Catalog Name'}:null;}}});try{
 const result=await h.call();assert.equal(result.status,200);assert.equal(result.body.slots[0].itemName,'Exact Catalog Name');assert.equal(result.body.slots[0].exportedName,'Synthetic Item 101');assert.equal(result.body.slots[0].status,'ready');assert.equal(result.body.slots[1].status,'missing_reference');assert.ok(result.body.slots.every(s=>s.selectedByDefault));assert.equal(h.count('item_references'),0);assert.equal(h.count('inventory_imports'),0);assert.equal(h.count('audit'),0);
 const input=await h.prepare();input.selections=input.selections.slice(0,1);assert.equal((await h.call('import',{data:input})).status,200);const next=await h.call();assert.equal(next.body.slots[0].status,'same');assert.equal(next.body.slots[0].selectedByDefault,false);
}finally{h.close();}});
test('owner-only import is atomic, retry-safe and retains installed augment IDs without changing DKP or awards',async()=>{const h=fixture();try{
 const input=await h.prepare(),before=h.DB.raw.prepare('SELECT * FROM ledger').all();const result=await h.call('import',{data:input});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.imported,23);assert.equal(result.body.alreadyApplied,false);assert.equal(h.count('character_equipment'),23);assert.equal(h.count('item_references'),46);assert.equal(h.count('audit'),1);assert.equal(h.count('inventory_imports'),1);assert.equal((await getInventoryAugments(h.DB,'hero')).ear2[0].itemId,1105);assert.deepEqual(h.DB.raw.prepare('SELECT * FROM ledger').all(),before);assert.equal(h.count('auction_awards'),0);assert.equal(h.count('attendance'),0);
 const retry=await h.call('import',{data:input});assert.equal(retry.status,200);assert.equal(retry.body.alreadyApplied,true);assert.equal(h.count('audit'),1);
 const preview=await h.call();assert.ok(preview.body.slots.every(s=>!s.selectedByDefault));
 input.selections.pop();assert.equal((await h.call('import',{data:input})).status,409);
}finally{h.close();}});
test('authentication, ownership, ACL, origin and CSRF protect previews and imports even from administrators',async()=>{const h=fixture();try{
 for(const[user,status]of[[null,401],['other',403],['officer',403]])assert.equal((await h.call('preview',{user})).status,status);
 assert.equal((await h.call('preview',{headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal((await h.call('preview',{headers:{'X-CSRF-Token':'wrong'}})).status,403);assert.equal((await h.call('preview',{context:{access:{permissions:{overview:2,mains:2}}}})).status,403);assert.equal((await h.call('preview',{context:{access:{permissions:{overview:3}}}})).status,200);assert.equal(h.count('audit'),0);
}finally{h.close();}});
test('one stale selected slot rejects every selection and seeds no catalog references',async()=>{const h=fixture();try{
 const input=await h.prepare();input.selections[0].expectedItemId=999;assert.equal((await h.call('import',{data:input})).status,409);assert.equal(h.count('character_equipment'),0);assert.equal(h.count('item_references'),0);assert.equal(h.count('inventory_imports'),0);assert.equal(h.count('audit'),0);
}finally{h.close();}});
test('ownership or concurrent slot change after validation is rechecked atomically',async()=>{for(const change of ['owner','equipment']){const h=fixture();try{
 const input=await h.prepare(),batch=h.DB.batch.bind(h.DB);h.DB.batch=async statements=>{if(change==='owner')h.DB.raw.prepare("UPDATE characters SET owner_id='other' WHERE id='hero'").run();else {h.DB.raw.prepare("INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(999,'Concurrent item','https://items.eqresource.com/items.php?id=999','now','fixture','unresolved')").run();h.DB.raw.prepare("INSERT INTO character_equipment VALUES('hero','charm',999,'reference','now','owner','concurrent')").run();}return batch(statements);};
 assert.equal((await h.call('import',{data:input})).status,change==='owner'?403:409);assert.equal(h.count('inventory_imports'),0);assert.equal(h.count('audit'),0);assert.equal(h.count('character_equipment'),change==='owner'?0:1);
}finally{h.close();}}});
test('audit failure rolls back all references, equipment and import receipt',async()=>{const h=fixture();try{
 const input=await h.prepare();h.DB.raw.exec("CREATE TRIGGER fail_inventory BEFORE INSERT ON audit WHEN NEW.action='character_inventory_imported' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");assert.equal((await h.call('import',{data:input})).status,500);for(const table of ['inventory_imports','character_equipment','inventory_equipment_augments','item_references','audit'])assert.equal(h.count(table),0);assert.equal(h.count('ledger'),1);
}finally{h.close();}});
test('empty export slots never clear saved gear, and nonselected slots remain unchanged',async()=>{const h=fixture();try{
 const input=await h.prepare();input.selections=input.selections.slice(0,1);assert.equal((await h.call('import',{data:input})).status,200);
 const text=exportText({empty:[0]}),preview=await h.call('preview',{data:{fileName:'Hero_test-Inventory.txt',text}});assert.equal(preview.body.slots[0].status,'empty');assert.equal(preview.body.slots[0].currentItemId,101);assert.equal(preview.body.slots[0].selectedByDefault,false);
 const next={importId:preview.body.importId,fileName:preview.body.fileName,text,selections:[{slotKey:'charm',expectedItemId:101}]};assert.equal((await h.call('import',{data:next})).status,400);assert.equal(h.DB.raw.prepare("SELECT item_id FROM character_equipment WHERE slot_key='charm'").get().item_id,101);
}finally{h.close();}});
test('concurrent identical imports converge; manual gear change invalidates imported augment association',async()=>{const h=fixture();try{
 const input=await h.prepare(),results=await Promise.all([h.call('import',{data:input}),h.call('import',{data:input})]);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(h.count('audit'),1);assert.equal(results.filter(r=>r.body.alreadyApplied).length,1);
 h.DB.raw.prepare("UPDATE character_equipment SET operation_id='manual-change' WHERE slot_key='charm'").run();assert.equal((await getInventoryAugments(h.DB,'hero')).charm,undefined);
}finally{h.close();}});
test('selected catalog details survive future catalog absence; unknown exports cannot erase a rich reference',async()=>{let available=true;const h=fixture({catalog:{async getCatalogItem(db,id){return available&&id===101?{itemId:101,name:'Catalog Gear',metadataStatus:'verified_reference',classes:['BRD'],stats:{hp:123},details:{fields:[{label:'ac',value:'12'}],effects:['Worn: Fixture effect'],augments:[]},sourceStatus:{status:'uploaded'},metadataComplete:false}:null;}}});try{
 const first=await h.prepare();first.selections=first.selections.slice(0,1);assert.equal((await h.call('import',{data:first})).status,200);available=false;
 const stored=await getCachedItemDetails(h.DB,101);assert.equal(stored.stats.hp,123);assert.deepEqual(stored.details.effects,['Worn: Fixture effect']);
 const preview=(await h.call()).body,next={fileName:preview.fileName,text:exportText(),importId:preview.importId,selections:[{slotKey:'charm',expectedItemId:101}]};assert.equal((await h.call('import',{data:next})).status,200);assert.equal((await getCachedItemDetails(h.DB,101)).stats.hp,123);
}finally{h.close();}});
test('stacked ammunition is one equipment item with its count retained',()=>{
 const parsed=parseInventoryExport(exportText().replace('Ammo\tSynthetic Item 123\t123\t1\t6','Ammo\tSynthetic Item 123\t123\t200\t6'));assert.equal(parsed.slots.at(-1).itemId,123);assert.equal(parsed.slots.at(-1).quantity,200);
});
