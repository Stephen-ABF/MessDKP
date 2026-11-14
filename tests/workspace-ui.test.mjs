import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
function harness(){
 const nodes=new Map(),handlers={},calls=[],navigations=[],errors=[];let respond=()=>Response.json({});
 const node=()=>({innerHTML:'',textContent:'',value:'',hidden:false,isConnected:true,disabled:false,checked:false,dataset:{},classList:{toggle(){},remove(){},add(){}},querySelectorAll(){return[];},querySelector:s=>get(s),setAttribute(){},removeAttribute(){},addEventListener(){},replaceChildren(){this.innerHTML='';},focus(){},scrollIntoView(){},closest(){return null;}});
 const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
 const document={querySelector:get,querySelectorAll(){return[];},addEventListener(k,fn){handlers[k]=fn;},activeElement:null};
 const context=vm.createContext({document,window:{location:{origin:'https://workspace.test'},addEventListener(){},scrollTo(){}},fetch:async(path,opts)=>{calls.push({path,opts});return respond(path,opts);},URL,URLSearchParams,Response,Date,Map,Set,WeakMap,BigInt,crypto,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},FormData:class{constructor(form){this.entries=Object.entries(form.values||{});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}},recordNavigate:async(...args)=>navigations.push(args),recordError:(form,message)=>{if(message)errors.push(message);}});
 vm.runInContext(source,context);const run=s=>vm.runInContext(s,context);
 run("state.user={id:'member',name:'Roamer'};state.access={profileName:'Administrator',permissions:{auctions:3,auctionAdmin:3,overview:3,mains:3,characters:3,ledger:3}};state.csrfToken='csrf';state.generation=1;state.page='auctions';reviewContext=()=>({scrollY:100});formError=recordError;renderAuth=()=>{};");
 const form=(kind,values={},dataset={})=>({...node(),dataset:{form:kind,...dataset},values,reportValidity(){return true;}});
 return{context,run,get,calls,handlers,errors,navigations,form,respond:fn=>respond=fn,submit:form=>handlers.submit({target:{closest:()=>form},preventDefault(){}})};
}
test('account header shows the current user profile and signed main DKP',()=>{const h=harness();h.run('state.headerDkp=-14;renderShell()');const html=h.get('#account-bar').innerHTML;assert.match(html,/Roamer/);assert.match(html,/Administrator/);assert.match(html,/-14 DKP/);assert.match(html,/header-dkp negative/);h.run('state.headerDkp=null;renderShell()');assert.match(h.get('#account-bar').innerHTML,/id="header-dkp"[^>]*hidden/);});
test('late header balance responses cannot replace a more recent balance or another session',async()=>{
 const h=harness(),replies=[];h.respond(()=>new Promise(r=>replies.push(r)));const a=h.run('refreshHeaderDkp()'),b=h.run('refreshHeaderDkp()');await new Promise(r=>setImmediate(r));replies[1](Response.json({balance:14}));await b;replies[0](Response.json({balance:999}));await a;assert.equal(h.run('state.headerDkp'),14);
 const pending=h.run('refreshHeaderDkp()');await new Promise(r=>setImmediate(r));h.run('state.sessionEpoch++');replies[2](Response.json({balance:500}));await pending;assert.equal(h.run('state.headerDkp'),14);
});
test('guild auctions no longer loads publishing/settings and the separate management route retains the catalog picker',async()=>{
 const h=harness();h.respond(path=>Response.json(path.includes('auction-matches')?{itemIds:[]}:path.includes('/settings')?{settings:{minimumBid:1}}:{auctions:[],activeBidSummary:{count:0,totalDkp:'0'},slots:[]}));
 const list=await h.run('auctionsPage()');assert.doesNotMatch(list,/data-form="create-auction"|Publish a sealed auction/);assert.ok(h.calls.every(c=>!c.path.includes('/settings')));
 const publisher=await h.run('auctionPublishingPage()');assert.match(publisher,/Publish single auction/);assert.match(publisher,/auction-catalog-query/);assert.match(publisher,/data-form="create-auction"/);assert.equal(h.run("readRoute('#publishAuction').page"),'publishAuction');h.run('state.access.permissions.auctionAdmin=0');assert.equal(h.run("canViewPage('publishAuction')"),false);
});
test('ledger UI exposes filtered paged records and sort controls with escaped recorder/reason text',()=>{
 const h=harness();h.context.data={entries:[{characterName:'Romar',amount:-5,reason:'<script>reason</script>',actorName:'<Recorder>',createdAt:'2026-11-14T12:00:00Z'}],characters:[{id:'main',name:'Romar'}],recorders:[{id:'officer',name:'Officer'}],total:101,offset:50,limit:50};const html=h.run('ledgerTransactions(data)');for(const key of ['characterId','actorId','from','to'])assert.ok(html.includes('name="'+key+'"'));assert.match(html,/data-sort="characterName"/);assert.match(html,/data-sort="actorName"/);assert.match(html,/data-offset="100"/);assert.match(html,/&lt;Recorder&gt;/);assert.doesNotMatch(html,/<script>/);
});
const wishes={character:{id:'char',name:'Romar'},expansion:'House of Thule',items:[{itemId:1,name:'Cowl',slots:['HEAD'],classes:['BST'],fulfilledAt:null,operationId:'one'},{itemId:2,name:'Tunic',slots:['CHEST'],classes:['ALL'],fulfilledAt:'2026-11-14',operationId:'two'},{itemId:3,name:'Wizard crown',slots:['HEAD'],classes:['WIZ'],fulfilledAt:null,operationId:'three'}]};
test('wishlist name, slot, class and completion filters combine without changing saved wishes',()=>{
 const h=harness();h.context.data=wishes;h.run("wishlistState.filterName='cowl';wishlistState.filterSlot='HEAD';wishlistState.filterClass='BST';wishlistState.filterStatus='needed'");const html=h.run('wishlistDesiredItems(data,true)');assert.match(html,/Cowl/);assert.doesNotMatch(html,/Wizard crown|Tunic/);assert.equal(wishes.items.length,3);
 h.run("wishlistState.filterName='';wishlistState.filterSlot='';wishlistState.filterClass='';wishlistState.filterStatus='fulfilled'");assert.match(h.run('wishlistDesiredItems(data,true)'),/wish-completed/);
});
test('equipment wishlist uses all current slots and add-alternative actions, never equipment mutation forms',()=>{
 const h=harness();h.context.data=wishes;h.run("wishlistState.view='equipment'");const html=h.run('wishlistDesiredItems(data,true)');assert.match(html,/Wish list equipment/);assert.match(html,/gear-head/);assert.match(html,/data-action="wishlist-slot" data-slot="HEAD"/);assert.match(html,/Add alternative/);assert.doesNotMatch(html,/data-form="equip|data-action="gear-open"/);assert.doesNotMatch(h.run('wishlistDesiredItems(data,false)'),/data-action="wishlist-slot"/);
});
test('stale wishlist filtering cannot render a previous page or account',()=>{const h=harness();h.context.data=wishes;h.run('wishlistDisplay={data,editable:true,generation:0,epoch:0};refreshWishlistDesired()');assert.equal(h.get('#wishlist-desired-items').innerHTML,'');});
test('loot history collapses filters, omits Boss, shows assigned looter/status and only server-authorized parcel checkboxes',async()=>{
 const h=harness();const row={auctionId:'auction',characterId:'char',itemId:1,itemName:'Cowl',slots:['HEAD'],classes:['BST'],raidName:'Raid',raidDate:'2026-11-13',winnerName:'Romar',winningBid:10,price:5,awardStatus:'confirmed',looterName:'Holdera',holderEventId:'event',canParcel:1};h.respond(()=>Response.json({rows:[row,{...row,canParcel:0,looterName:'Other holder',parceledAt:'2026-11-14T12:00:00Z'}],total:2,slots:['HEAD'],types:[],looters:['Holdera','Other holder']}));const html=await h.run('lootHistoryPage()');assert.match(html,/<details class="history-filter-panel" >/);assert.doesNotMatch(html,/<th scope="col">Boss<\/th>|name="boss"/);assert.match(html,/name="looter"/);assert.match(html,/Parceled/);assert.equal((html.match(/data-parcel-check/g)||[]).length,1);assert.match(html,/data-holder="event"/);
});
test('parcel submission uses the assigned copy endpoint and does not call DKP or award-confirmation routes',async()=>{
 const h=harness();h.run('navigate=recordNavigate');h.respond(()=>Response.json({parcel:{parceledAt:'now'}}));await h.submit(h.form('parcel-loot',{parceled:'on'},{auction:'auction',character:'winner',holder:'source-event'}));assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/loot-history/auction/winner/parcel');assert.deepEqual(JSON.parse(h.calls[0].opts.body),{parceled:true,holderEventId:'source-event'});assert.equal(h.navigations[0][0],'lootHistory');
});
test('reversed ledger dates stay inline without persisting invalid filters or replacing the controls',async()=>{
 const h=harness();h.run('navigate=recordNavigate');await h.submit(h.form('filter-ledger',{from:'2026-11-14',to:'2026-11-13'}));assert.equal(h.navigations.length,0);assert.equal(h.run('ledgerFilters.from'),'');assert.match(h.errors[0],/Start date/);
});
test('wishlist character changes reset view filters while removing the final matching slot keeps its active label visible',async()=>{
 const h=harness();h.run("wishlistState.characterId='old';wishlistState.filterSlot='HEAD'");h.context.equipment={canEdit:true,character:{id:'new',name:'Alt',ownerId:'member',kind:'alt',className:'Cleric'}};h.respond(()=>Response.json({...wishes,character:{id:'new',name:'Alt'},canEdit:true,expansions:['House of Thule'],items:[wishes.items[1]]}));const changed=await h.run('wishlistPanel(equipment)');assert.equal(h.run('wishlistState.filterSlot'),'');assert.match(changed,/Tunic/);
 h.run("wishlistState.filterSlot='HEAD'");const removed=await h.run('wishlistPanel(equipment)');assert.match(removed,/<option value="HEAD" selected>HEAD<\/option>/);assert.match(removed,/No matching desired items/);
});
test('choosing a new wishlist slot clears the actual search field as well as retained results',async()=>{
 const h=harness();h.get('[name="q"]').value='Helmet';h.run("wishlistState.query='Helmet';wishlistState.results=[{itemId:1}]");const action={dataset:{action:'wishlist-slot',slot:'PRIMARY'},disabled:false};await h.handlers.click({target:{closest:selector=>selector==='[data-action]'?action:null},preventDefault(){}});assert.equal(h.get('[name="q"]').value,'');assert.equal(h.get('[name="slot"]').value,'PRIMARY');assert.equal(h.run('wishlistState.results.length'),0);
});
test('late character or main page parents cannot replace the current character wishlist state',async()=>{
 for(const parent of ['characterProfilePage','mainAttendancePage']){
  const h=harness();let release;
  const equipment=id=>({canEdit:true,character:{id,name:id,ownerId:'member',kind:'alt',className:'Cleric'},slots:[]});
  h.respond(path=>path==='/api/characters/A/equipment'?new Promise(r=>release=r):path==='/api/characters/B/equipment'?Response.json(equipment('B')):path.includes('/wishlist')?Response.json({...wishes,character:{id:'B',name:'B'},canEdit:true,expansions:['House of Thule']}):Response.json({main:{name:'A'},raids:[],loot:[]}));
  h.run("state.profileTab='wishlist';state.page='profile'");const pending=h.run(parent+"('A')");await new Promise(r=>setImmediate(r));h.run('state.generation=2');await h.run("characterProfilePage('B')");release(Response.json(equipment('A')));await pending;
  assert.equal(h.run('state.equipment.character.id'),'B',parent);assert.equal(h.run('wishlistDisplay.data.character.id'),'B',parent);assert.equal(h.run('wishlistState.characterId'),'B',parent);assert.ok(h.calls.every(c=>!c.path.includes('/characters/A/wishlist')),parent);
 }
});

test('a delayed main loot request cannot replace the next character wishlist',async()=>{
 const h=harness();let release;
 const equipment=id=>({canEdit:true,character:{id,name:id,ownerId:'member',kind:id==='A'?'main':'alt',className:'Cleric'},slots:[]});
 h.respond(path=>path==='/api/reports/mains/A/loot'?new Promise(r=>release=r):path.endsWith('/equipment')?Response.json(equipment(path.includes('/A/')?'A':'B')):Response.json({...wishes,character:{id:'B',name:'B'},canEdit:true,expansions:['House of Thule']}));
 h.run("state.profileTab='wishlist'");const pending=h.run("characterProfilePage('A')");await new Promise(r=>setImmediate(r));
 assert.equal(typeof release,'function');h.run('state.generation=2');await h.run("characterProfilePage('B')");release(Response.json({loot:[]}));assert.equal(await pending,'');
 assert.equal(h.run('state.equipment.character.id'),'B');assert.equal(h.run('wishlistDisplay.data.character.id'),'B');assert.equal(h.run('wishlistState.characterId'),'B');assert.ok(h.calls.every(c=>!c.path.includes('/characters/A/wishlist')));
});

test('late overview dashboard data cannot start a main profile under the next generation',async()=>{
 const h=harness();let release;
 h.respond(path=>path==='/api/dashboard'?new Promise(r=>release=r):path.endsWith('/equipment')?Response.json({canEdit:true,character:{id:'B',name:'B',ownerId:'member',kind:'alt',className:'Cleric'},slots:[]}):Response.json({...wishes,character:{id:'B',name:'B'},canEdit:true,expansions:['House of Thule']}));
 h.run("state.profileTab='wishlist'");const pending=h.run('dashboardPage()');await new Promise(r=>setImmediate(r));h.run('state.generation=2');await h.run("characterProfilePage('B')");
 release(Response.json({characters:[{id:'A',kind:'main'}]}));assert.equal(await pending,'');assert.equal(h.run('wishlistState.characterId'),'B');assert.equal(h.run('state.equipment.character.id'),'B');assert.ok(h.calls.every(c=>!c.path.includes('/mains/A')));
});
