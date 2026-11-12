import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
const auction={id:'auction-fixture',itemId:1,itemName:'Fixture ring',status:'open',slots:['FINGER'],classes:['ALL'],quantity:1,minimumBid:1,mode:'sealed',publishedAt:'2026-11-12T18:00:00Z',closesAt:'2026-11-13T18:00:00Z',ownBid:null,ownEligibility:{eligible:false,maxBid:0,reason:'Fixture'},metadataStatus:'verified_reference'};
function harness(permissions={auctionAdmin:3,auctions:3,loot:3,captures:3}){
 const handlers={},nodes=new Map(),calls=[],navigations=[],errors=[],messages=[];const node=()=>({innerHTML:'',value:'',files:[],hidden:false,dataset:{},classList:{toggle(){},remove(){},add(){}},querySelectorAll(){return[];},querySelector(){return node();},addEventListener(){},removeAttribute(){},setAttribute(){},focus(){},remove(){},scrollIntoView(){}});const get=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);};let respond=()=>{throw Error('Unexpected fetch');};
 const ctx=vm.createContext({document:{querySelector:get,querySelectorAll(){return[];},addEventListener(k,h){handlers[k]=h;}},window:{location:{origin:'https://guild.test'},addEventListener(){},scrollTo(){}},fetch:async(path,options)=>{const r={path,method:options.method,body:options.body?JSON.parse(options.body):undefined};calls.push(r);return respond(r);},recordError:(_,m)=>{if(m)errors.push(m);},recordFlash:m=>messages.push(m),recordNavigation:async(...a)=>navigations.push(a),TextEncoder,URL,URLSearchParams,Date,Map,Set,WeakMap,crypto,Response,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},FormData:class{constructor(f){this.entries=Object.entries(f.values||{});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}});vm.runInContext(source,ctx);ctx.permissions=permissions;ctx.fixtureAuction=auction;const run=s=>vm.runInContext(s,ctx);run("state.user={id:'officer',role:'member'};state.csrfToken='csrf';state.access={permissions};state.page='auctions';state.auctionId='auction-fixture';state.generation=1;formError=recordError;flash=recordFlash;navigate=recordNavigation;renderAuth=()=>{};");
 const form=(kind,values={},dataset={})=>({dataset:{form:kind,...dataset},values,isConnected:true,reportValidity(){return true;},querySelectorAll(){return[];},querySelector(){return node();},closest(){return this;}});
 return{run,get,calls,navigations,errors,messages,form,submit:f=>handlers.submit({target:{closest:()=>f},preventDefault(){}}),respond:f=>{respond=f;}};
}

test('auction list exposes slot choices from imported metadata and officer controls only to writers',async()=>{
 const h=harness();h.respond(r=>r.path.startsWith('/api/auctions?')?Response.json({auctions:[auction],slots:['EAR','FINGER']}):r.path.startsWith('/api/items?')?Response.json({items:[]}):Response.json({settings:{minimumBid:1}}));const html=await h.run('auctionsPage()');assert.match(html,/<select name="slot">/);assert.match(html,/<option value="FINGER"/);assert.match(html,/Cancel auction/);assert.match(html,/Complete now \(testing\)/);assert.doesNotMatch(html,/Cancel a character bid/);
 const member=harness({auctions:3,auctionAdmin:0});member.respond(()=>Response.json({auctions:[auction],slots:['FINGER']}));const normal=await member.run('auctionsPage()');assert.doesNotMatch(normal,/Officer auction controls|Cancel auction|Complete now/);assert.match(normal,/<select name="slot">/);
});

test('management retries preserve the exact operation key and require an explicit confirmation',async()=>{
 const h=harness(),f=h.form('manage-auction',{reason:'Officer approved request',characterId:'char-alice'},{auction:'auction-fixture',management:'cancel-bid'});h.respond(()=>{throw Error('Uncertain network reply');});await h.submit(f);assert.equal(h.calls.length,0);assert.match(h.errors[0],/Confirm/);
 f.values.confirmed='on';await h.submit(f);assert.equal(h.calls.length,1);const first=h.calls[0];assert.equal(first.path,'/api/auctions/auction-fixture/bids/char-alice/cancel');assert.equal(first.body.confirm,true);assert.ok(first.body.idempotencyKey);
 f.values.characterId='char-bob';await h.submit(f);assert.equal(h.calls.length,1);assert.match(h.errors.at(-1),/Refresh this auction/);f.values.characterId='char-alice';
 h.respond(()=>Response.json({auction}));await h.submit(f);assert.deepEqual(h.calls[1].body,first.body);assert.equal(h.navigations.length,1);assert.match(h.messages[0],/Any active bid/);
});

test('read-only authority and late session expiry cannot perform or display management success',async()=>{
 const h=harness({auctions:3,auctionAdmin:2}),f=h.form('manage-auction',{reason:'Do not permit write',confirmed:'on'},{auction:'auction-fixture',management:'cancel'});h.respond(()=>{throw Error('Must not request');});await h.submit(f);assert.equal(h.calls.length,0);
 const expired=harness(),form=expired.form('manage-auction',{reason:'Expired session test',confirmed:'on'},{auction:'auction-fixture',management:'complete-early'});expired.respond(()=>Response.json({error:'Expired',code:'authentication_required'},{status:401}));await expired.submit(form);assert.equal(expired.navigations.length,0);assert.equal(expired.messages.length,0);
});

test('slot and cancelled filters are retained by the actual filter submission',async()=>{
 const h=harness();await h.submit(h.form('filter-auctions',{q:'ring',class:'CLR',slot:'FINGER',status:'cancelled'}));assert.deepEqual(JSON.parse(h.run('JSON.stringify(state.auctionFilters)')),{q:'ring',class:'CLR',slot:'FINGER',status:'cancelled'});assert.equal(h.navigations.length,1);
});

test('cancelled and early-completed details describe the real state without exposing management or bid forms',async()=>{
 const h=harness();h.respond(()=>Response.json({auction:{...auction,status:'cancelled',cancelledAt:'2026-11-12T18:01:00Z',cancellationReason:'Duplicate boss auction'},bids:null,awards:[]}));let html=await h.run("auctionPage('auction-fixture')");assert.match(html,/Auction cancelled|Duplicate boss auction/);assert.doesNotMatch(html,/data-form="place-bid"|data-form="manage-auction"/);assert.match(html,/only your own bid events/);
 h.respond(()=>Response.json({auction:{...auction,status:'closed',completedEarly:true,scheduledClosesAt:auction.closesAt},bids:[],awards:[]}));html=await h.run("auctionPage('auction-fixture')");assert.match(html,/Completed early for testing/);assert.match(html,/Final bids and results/);
});

test('live companion page is hidden even with capture permission, while Python paste and file import remain visible',async()=>{
 const h=harness();assert.equal(h.run("canReadPage('captures')"),false);assert.equal(h.run("canViewPage('captures')"),false);
 h.respond(r=>r.path==='/api/loot-imports'?Response.json({imports:[]}):Response.json({raids:[]}));const html=await h.run('raidLootImportsPage()');assert.match(html,/Paste JSON from Python/);assert.match(html,/Upload JSON or loot file/);assert.match(html,/name="text"/);assert.match(html,/name="raidFile"/);assert.doesNotMatch(html,/Connect companion|Open companion/);
});
