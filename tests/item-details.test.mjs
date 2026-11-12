import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {cacheItemDetails,getCachedItemDetails,createItemApi} from '../worker/items.mjs';

const reference=(overrides={})=>({itemId:901,name:'Fixture Ring',classes:['CLR'],races:['ALL'],slots:['FINGER'],stats:{ac:20},flags:['Lore'],sourceUrl:'https://items.eqresource.com/items.php?id=901',metadataStatus:'verified_reference',metadataComplete:false,verificationMethod:'Synthetic test fixture',details:{fields:[{label:'AC',value:'20'}],effects:['Fixture effect'],augments:['Type 7'],lore:'Fixture lore',sourceText:'Fixture item panel'},...overrides});
const context={user:{id:'officer',role:'admin'},csrfToken:'fixture-csrf'};
const origin='https://guild.test';

async function nameSearchFixture(searchItemsByName,fetchItemDetails){
 const db=createD1(await applicationSchema()),api=createItemApi({searchItemsByName,fetchItemDetails});
 const call=async(name,options={})=>{const response=await api(new Request(origin+'/api/items/search',{method:options.method||'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':context.csrfToken,...options.headers},...(options.method==='GET'?{}:{body:options.raw??JSON.stringify({name})})}),{DB:db},options.context??context);return{status:response.status,body:await response.json()};};
 return{db,call,close(){db.close();}};
}
test('explicit remote item search uses the full prefixed name and caches only its verified exact identity and details',async()=>{
 let submitted;
 const h=await nameSearchFixture(async name=>{submitted=name;return{status:'matched',candidates:[{itemId:901,name},{itemId:902,name:'Fixture Helm'}]};},async id=>reference({itemId:id,name:'Darkened Fixture Helm',slots:['HEAD']}));
 try{const r=await h.call('Darkened Fixture Helm');assert.equal(r.status,200);assert.equal(submitted,'Darkened Fixture Helm');assert.equal(r.body.status,'matched');assert.equal(r.body.exactMatch.itemId,901);assert.equal(r.body.item.name,'Darkened Fixture Helm');assert.equal(r.body.item.stats.ac,20);assert.equal(r.body.sourceUrl,'https://items.eqresource.com/itemsearch.php');assert.equal(r.body.candidates[1].match,'candidate');assert.equal(h.db.raw.prepare('SELECT COUNT(*) n FROM item_references').get().n,1);}finally{h.close();}
});
test('near names, duplicate source identities and prefixed variants are never silently accepted by name search',async()=>{
 for(const candidates of [[{itemId:901,name:'Fabled Fixture Helm'}],[{itemId:901,name:'Fixture Helm'},{itemId:901,name:'Fabled Fixture Helm'}],[{itemId:901,name:'Fixture Helm'},{itemId:902,name:'Fixture Helm'}]]){
  let detailFetches=0;const h=await nameSearchFixture(async()=>({status:'matched',candidates}),async()=>{detailFetches++;return reference();});try{const r=await h.call('Fixture Helm');assert.notEqual(r.body.status,'matched');assert.equal(r.body.exactMatch,null);assert.equal(r.body.item,null);assert.equal(detailFetches,0);assert.equal(h.db.raw.prepare('SELECT COUNT(*) n FROM item_references').get().n,0);}finally{h.close();}
 }
});
test('a changed detail-page name cannot attach another variant stats and cache name conflicts require review',async()=>{
 const search=async name=>({status:'matched',candidates:[{itemId:901,name}]});
 const h=await nameSearchFixture(search,async()=>reference({name:'Fabled Fixture Helm',stats:{hp:999}}));try{const r=await h.call('Fixture Helm');assert.equal(r.body.status,'matched');assert.equal(r.body.item.name,'Fixture Helm');assert.equal(r.body.item.stats,null);assert.equal(r.body.sourceStatus.code,'source_identity_changed');}finally{h.close();}
 const k=await nameSearchFixture(search,async()=>{throw Error('Source blocked');});try{await cacheItemDetails(k.db,reference({name:'Fabled Fixture Helm'}));const r=await k.call('Fixture Helm');assert.equal(r.body.status,'ambiguous');assert.equal(r.body.item,null);assert.equal(r.body.sourceStatus.code,'cached_identity_conflict');const saved=await getCachedItemDetails(k.db,901);assert.equal(saved.name,'Fabled Fixture Helm');assert.equal(saved.stats.ac,20);}finally{k.close();}
});
test('unavailable remote item search does not mean not found, alter cached facts or invent a local catalog match',async()=>{
 const h=await nameSearchFixture(async()=>({status:'unavailable',code:'source_access_unavailable',message:'EQResource declined automated access.',candidates:[]}),async()=>{throw Error('Must not fetch');});try{await cacheItemDetails(h.db,reference());const r=await h.call('Fixture Ring');assert.equal(r.status,200);assert.equal(r.body.status,'unavailable');assert.equal(r.body.sourceStatus.code,'source_access_unavailable');assert.equal(r.body.exactMatch,null);assert.equal(r.body.item,null);assert.equal((await getCachedItemDetails(h.db,901)).stats.ac,20);assert.equal(h.db.raw.prepare('SELECT COUNT(*) n FROM item_references').get().n,1);}finally{h.close();}
});
test('remote item-name search requires officer Origin/CSRF and bounded valid JSON',async()=>{
 let calls=0;const h=await nameSearchFixture(async()=>{calls++;return{status:'not_found',candidates:[]};});try{
  assert.equal((await h.call('Fixture',{context:{}})).status,401);
  assert.equal((await h.call('Fixture',{context:{user:{id:'member',role:'member'},csrfToken:context.csrfToken}})).status,403);
  assert.equal((await h.call('Fixture',{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await h.call('Fixture',{headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await h.call('Fixture',{method:'GET'})).status,405);
  assert.equal((await h.call('Fixture',{raw:'['})).status,400);
  assert.equal((await h.call('Fixture',{raw:JSON.stringify({name:'x'.repeat(3000)})})).status,413);
  assert.equal((await h.call('   ')).status,400);assert.equal(calls,0);
  const r=await h.call('Fixture');assert.equal(r.body.status,'not_found');assert.equal(calls,1);
 }finally{h.close();}
});

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
