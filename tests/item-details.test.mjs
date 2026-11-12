import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {cacheItemDetails,getCachedItemDetails,createItemApi} from '../worker/items.mjs';

const reference=(overrides={})=>({itemId:901,name:'Fixture Ring',classes:['CLR'],races:['ALL'],slots:['FINGER'],stats:{ac:20},flags:['Lore'],sourceUrl:'https://items.eqresource.com/items.php?id=901',metadataStatus:'verified_reference',metadataComplete:false,verificationMethod:'Synthetic test fixture',details:{fields:[{label:'AC',value:'20'}],effects:['Fixture effect'],augments:['Type 7'],lore:'Fixture lore',sourceText:'Fixture item panel'},...overrides});
const context={user:{id:'officer',role:'admin'},csrfToken:'fixture-csrf'};
const origin='https://guild.test';

test('catalog preserves full available fields and verified identity while refusing unsafe icons or wrong source IDs',async()=>{
 const db=createD1(await applicationSchema());
 try {
  const saved=await cacheItemDetails(db,reference({iconUrl:'https://evil.test/icon.png'}));
  assert.equal(saved.iconUrl,null);assert.equal(saved.metadataComplete,false);
  assert.deepEqual(saved.details.effects,['Fixture effect']);assert.equal(saved.details.lore,'Fixture lore');
  const unchanged=await cacheItemDetails(db,reference({name:'Unverified replacement',metadataStatus:'unresolved'}));
  assert.equal(unchanged.name,'Fixture Ring');
  await assert.rejects(()=>cacheItemDetails(db,reference({sourceUrl:'https://items.eqresource.com/items.php?id=902'})),/different source ID/);
  assert.equal((await getCachedItemDetails(db,901)).name,'Fixture Ring');
  const cached=await cacheItemDetails(db,reference({metadataComplete:true,iconUrl:'https://items.eqresource.com/images/item.gif'}));
  assert.equal(cached.metadataComplete,true);assert.equal(cached.iconUrl,'https://items.eqresource.com/images/item.gif');
  const incomplete=await cacheItemDetails(db,reference({name:'Incomplete response',details:{fields:[]}}));
  assert.equal(incomplete.name,'Fixture Ring');assert.equal(incomplete.metadataComplete,true);assert.equal(incomplete.sourceStatus.status,'incomplete');
 }finally{db.close();}
});

test('successful snapshots clear explicitly unknown eligibility and stats instead of relabeling stale facts as current',async()=>{
 const db=createD1(await applicationSchema());
 try{
  await cacheItemDetails(db,reference());
  const updated=await cacheItemDetails(db,reference({classes:null,slots:null,stats:{},details:{fields:[{label:'Class',value:'Unrecognized future class'},{label:'AC',value:'Unrecognized value'}]}}));
  assert.equal(updated.classes,null);assert.equal(updated.slots,null);assert.equal(updated.stats,null);
  assert.equal(updated.details.fields[0].value,'Unrecognized future class');
  const identityOnly=await cacheItemDetails(db,{itemId:901,name:'Fixture Ring',metadataStatus:'verified_reference'});
  assert.equal(identityOnly.classes,null);assert.deepEqual(identityOnly.details,updated.details);
 }finally{db.close();}
});

test('detail reads use only cached data and failed officer refresh preserves facts and exposes failure honestly',async()=>{
 const db=createD1(await applicationSchema());let fetches=0;
 const api=createItemApi({fetchItemDetails:async()=>{fetches++;const error=new Error('Source returned HTTP 403.');error.code='source_blocked';throw error;}});
 const call=async(path,method='GET',ctx=context,headers={})=>{
  const r=await api(new Request(origin+path,{method,headers:{Origin:origin,'X-CSRF-Token':'fixture-csrf',...headers}}),{DB:db},ctx);
  return{status:r.status,body:await r.json()};
 };
 try{
  await cacheItemDetails(db,reference());
  assert.equal((await call('/api/items/901','GET',{})).status,401);
  assert.equal((await call('/api/items/901')).body.item.name,'Fixture Ring');assert.equal(fetches,0);
  assert.equal((await call('/api/items/901/refresh','POST',{user:{id:'member',role:'member'},csrfToken:'fixture-csrf'})).status,403);
  assert.equal((await call('/api/items/901/refresh','POST',context,{Origin:'https://evil.test'})).status,403);assert.equal(fetches,0);
  const failed=await call('/api/items/901/refresh','POST');
  assert.equal(failed.status,200);assert.equal(failed.body.sourceStatus.status,'unavailable');assert.equal(failed.body.sourceStatus.code,'source_blocked');
  assert.equal(failed.body.item.name,'Fixture Ring');assert.equal(failed.body.item.details.fields[0].value,'20');assert.equal(fetches,1);
  assert.equal((await call('/api/items/9999')).status,404);
 }finally{db.close();}
});
