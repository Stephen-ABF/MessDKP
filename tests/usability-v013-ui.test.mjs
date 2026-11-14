import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
function harness(){
 const handlers={},events={},nodes=new Map(),calls=[],history=[];let respond=()=>Response.json({});
 const get=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',dataset:{},isConnected:true,disabled:false,required:false,hidden:false,attributes:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return[];},querySelector:get,addEventListener(){},remove(){},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},removeAttribute(k){delete this.attributes[k];},replaceChildren(){this.innerHTML='';},focus(){document.activeElement=this;}});return nodes.get(key);};
 const document={activeElement:null,querySelector:get,querySelectorAll(){return[];},addEventListener(k,fn){handlers[k]=fn;}},location={origin:'https://usability.test',hash:''};
 const window={location,scrollTo(){},addEventListener(k,fn){events[k]=fn;},history:{}};
 window.history={pushState(a,b,hash){history.push({method:'push',hash});location.hash=hash;},replaceState(a,b,hash){history.push({method:'replace',hash});location.hash=hash;}};
 const context=vm.createContext({document,window,URL,URLSearchParams,Response,Date,Map,Set,WeakMap,BigInt,crypto,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},fetch:async(path,opts)=>{calls.push({path,opts});return respond(path,opts);}});
 vm.runInContext(source,context);const run=s=>vm.runInContext(s,context);run("state.user={id:'officer'};state.csrfToken='csrf';state.access={permissions:{overview:3,characters:3,mains:3,auctions:3,auctionAdmin:3,audit:3}};state.page='auctions';state.generation=1");
 return{context,run,get,calls,history,window,handlers,events,respond:fn=>respond=fn};
}
test('hash routes support direct sections, encoded record IDs, capture IDs and won/lost tabs with bounded malformed fallbacks',()=>{
 const h=harness(),parse=hash=>{h.context.hash=hash;return JSON.parse(h.run('JSON.stringify(readRoute(hash))'));};
 assert.equal(parse('#auctions').page,'auctions');assert.equal(parse('#auctions').options.auctionTab,'current');assert.equal(parse('#auctions?tab=lost').options.auctionTab,'lost');assert.equal(parse('#characters/create').recordId,'create');assert.equal(parse('#attendance/raid%20one/tick-one').recordId,'raid one');assert.equal(parse('#attendance/raid-one/tick-one').detailId,'tick-one');
 for(const hash of ['#unknown','#auctions/%ZZ','#auctions/a%2Fb','#auctions/'+ 'x'.repeat(129),'#auctions/a/b/c'])assert.equal(parse(hash).page,'dashboard',hash);
});
test('navigation writes one shareable URL and restores browser history without adding duplicate back entries',async()=>{
 const h=harness();h.run("renderShell=()=>{};heading=()=>{};auctionTabs=()=>'';auctionsPage=async()=>'<p>Auction list</p>';personalAuctionsPage=async()=>'<p>Won list</p>';startCompanionPolling=()=>{};startCountdowns=()=>{};");
 await h.run("navigate('auctions')");assert.equal(h.window.location.hash,'#auctions');assert.equal(h.history.length,1);
 await h.run("navigate('auctions')");assert.equal(h.history.length,1);
 h.window.location.hash='#auctions?tab=won';await h.run('openCurrentRoute()');assert.equal(h.run('auctionTab'),'won');assert.match(h.get('#page-content').innerHTML,/Won list/);assert.equal(h.history.length,1);
 h.window.location.hash='#auctions';await h.events.hashchange();assert.equal(h.run('auctionTab'),'current');await new Promise(r=>setImmediate(r));assert.match(h.get('#page-content').innerHTML,/Auction list/);assert.equal(h.history.length,1);
});
test('catalog picker searches actual text rather than a preloaded first-100 dropdown and ignores late replies',async()=>{
 const h=harness(),input=h.get('#auction-catalog-query');input.value='Zulu raid reward';let release;h.respond(()=>new Promise(r=>release=r));h.context.input=input;const pending=h.run('searchAuctionCatalog(input,auctionPickerVersion)');await new Promise(r=>setImmediate(r));h.run('auctionPickerVersion++');release(Response.json({items:[{itemId:99999,name:'Stale reward'}],total:1}));await pending;assert.equal(h.get('#auction-picker-results').innerHTML,'');
 h.respond(()=>Response.json({items:[{itemId:99999,name:'Zulu raid reward',slots:['HEAD']}],total:1}));await h.run('searchAuctionCatalog(input,auctionPickerVersion)');assert.match(h.calls.at(-1).path,/q=Zulu\+raid\+reward/);assert.match(h.get('#auction-picker-results').innerHTML,/data-item="99999"/);assert.match(h.get('#auction-picker-status').textContent,/1 matches/);
});
test('selecting a catalog item hydrates the reference once and keeps publication fields across selection',async()=>{
 const h=harness(),form=h.get('[data-form="create-auction"]'),copies=h.get('copies');copies.value='7';form.querySelectorAll=()=>[copies];let release;h.respond(()=>new Promise(r=>release=r));h.context.button={dataset:{item:'99999'}};
 const first=h.run('selectAuctionItem(button)');await new Promise(r=>setImmediate(r));assert.equal(copies.disabled,true);await h.run('selectAuctionItem(button)');assert.equal(h.calls.length,1);release(Response.json({item:{itemId:99999,name:'Raid reward'}}));await first;assert.equal(copies.disabled,false);assert.equal(copies.value,'7');assert.equal(h.run('state.auctionDraftItemId'),99999);assert.match(h.get('#auction-item-reference').innerHTML,/value="99999" selected/);assert.equal(h.calls[0].path,'/api/items/lookup');
});
test('auction detail exposes a single compact controls picker and explicit class label, and audit renders escaped descriptions',async()=>{
 const h=harness();h.context.auction={id:'raid-item',status:'open',itemName:'Raid reward'};const html=h.run('auctionManagement(auction,[])');assert.match(html,/auction-controls-menu/);assert.doesNotMatch(html,/data-form="manage-auction"/);h.run('state.access.permissions.auctionAdmin=2');assert.equal(h.run('auctionManagement(auction,[])'),'');
 h.respond(()=>Response.json({total:1,limit:50,offset:0,filters:{},entries:[{action:'raid_created',actorName:'Officer',description:'Created <Raid> on 11/13/2026.',details:'{"raidId":"internal-secret"}',createdAt:'2026-11-13'}]}));const audit=await h.run('auditPage()');assert.match(audit,/Created &lt;Raid&gt;/);assert.doesNotMatch(audit,/internal-secret|raidId/);
 assert.match(source,/Usable classes: \$\{escape\(metadataList\(auction.classes\)\)\}/);
});


test('an in-flight publication owns the form lock and cannot be changed by another item selection',async()=>{
 const h=harness(),form=h.get('[data-form="create-auction"]'),copies=h.get('copies');form.querySelectorAll=()=>[copies];h.context.form=form;h.context.button={dataset:{item:'99999'}};
 h.run('lockForm(form,true)');assert.equal(copies.disabled,true);await h.run('selectAuctionItem(button)');assert.equal(h.calls.length,0);assert.equal(h.run('state.auctionDraftItemId'),null);h.run('lockForm(form,false)');assert.equal(copies.disabled,false);
});


test('a last-page refresh retains keyboard focus on the page count when Next becomes disabled',async()=>{
 const h=harness(),button=h.get('old-next');h.context.oldButton=button;h.context.document.activeElement=button;h.get('[data-page-direction="next"]').disabled=true;
 h.respond(path=>Response.json(path.includes('auction-matches')?{itemIds:[]}:{auctions:[],total:25,offset:25,limit:25,activeBidSummary:{count:0,totalDkp:'0'}}));
 await h.run('refreshAuctionFilters($(\'[data-form="filter-auctions"]\'),auctionFilterVersion,{element:oldButton,selector:\'[data-page-direction="next"]\'})');
 assert.equal(h.context.document.activeElement,h.get('[data-page-position]'));
});


test('a reset link in an already-open signed-in tab clears stale account state and consumes the fragment into memory',async()=>{
 const h=harness(),token='a'.repeat(64);h.window.location.hash='#reset-password?token='+token;h.run('clearCapturePairing=()=>{};stopCompanionPolling=()=>{};closeItemSurfaces=()=>{};');await h.events.hashchange();assert.equal(h.run('state.user'),null);assert.equal(h.run('state.resetToken'),token);assert.equal(h.run('state.authMode'),'reset');assert.equal(h.window.location.hash,'#reset-password');assert.match(h.get('#auth').innerHTML,/Set a new password/);assert.equal(h.get('#auth').innerHTML.includes(token),false);assert.equal(h.calls.length,0);
});
