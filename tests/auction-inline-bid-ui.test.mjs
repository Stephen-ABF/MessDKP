import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
const auction={id:'inline-fixture',itemId:900001,itemName:'Fixture cloak',status:'open',quantity:2,minimumBid:5,closesAt:'2099-01-01T00:00:00Z',classes:['ALL'],slots:['BACK'],ownBid:{amount:20},ownEligibility:{eligible:true,maxBid:35}};
function harness(){
 const nodes=new Map(),forms=[],calls=[],refreshes=[],errors=[],messages=[];let respond=()=>Response.json({auction});
 const node=()=>({innerHTML:'',textContent:'',dataset:{},value:'',isConnected:true,disabled:false,querySelectorAll(){return[];},querySelector(){return node();},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},removeAttribute(){},focus(){}});
 const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
 const document={querySelector:get,querySelectorAll:selector=>selector==='[data-form="inline-place-bid"]'?forms:[],addEventListener(){}};
 const context=vm.createContext({document,window:{location:{origin:'https://inline.test'},addEventListener(){}},URL,URLSearchParams,Response,Date,Map,Set,WeakMap,BigInt,crypto,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},fetch:async(path,options)=>{calls.push({path,options});return respond(path,options);},recordRefresh:async(...args)=>refreshes.push(args),recordError:(form,message)=>{if(message)errors.push(message);},recordFlash:message=>messages.push(message)});
 vm.runInContext(source,context);const run=s=>vm.runInContext(s,context);
 run("state.user={id:'member'};state.csrfToken='csrf';state.access={permissions:{auctions:3,auctionAdmin:0}};state.page='auctions';formError=recordError;flash=recordFlash;lockForm=()=>{};refreshAuctionFilters=recordRefresh;");context.auction=auction;
 const form=(id='inline-fixture',amount='30')=>{const input={value:amount},button={textContent:'Bid'},status={textContent:''};const f={...node(),dataset:{auction:id,minimum:'5',limit:'35'},querySelector:s=>s==='[name="amount"]'?input:s==='[data-inline-status]'?status:button,closest:()=>({querySelector:()=>({textContent:'30 DKP'})})};forms.push(f);return {form:f,input,status};};
 return{context,run,get,forms,calls,refreshes,errors,messages,form,respond:fn=>respond=fn};
}
test('concept B renders an empty entry independently of the saved bid and preserves sortable saved amounts',()=>{
 const h=harness(),html=h.run('auctionResults({auctions:[auction]},new Set())');
 assert.match(html,/<th scope="col">Place bid<\/th>/);assert.match(html,/data-sort="ownBid"/);assert.match(html,/<strong>20<\/strong> <small>DKP/);assert.match(html,/data-form="inline-place-bid"/);assert.match(html,/min="5" max="35"/);assert.match(html,/>Update<\/button>/);assert.doesNotMatch(h.run('inlineAuctionBidForm(auction)'),/value="20"/);assert.doesNotMatch(html,/View \/ bid|auction-controls-menu/);
});
test('closed, unapproved, insufficient and read-only states never expose a writable inline form',()=>{
 const h=harness();for(const variant of [{status:'closed'},{status:'cancelled'},{ownEligibility:{eligible:false,maxBid:0,reason:'Main approval required'}},{ownEligibility:{eligible:true,maxBid:4}}]){h.context.item={...auction,...variant};assert.doesNotMatch(h.run('inlineAuctionBidForm(item)'),/<form/);}
 h.run('state.access.permissions.auctions=2');assert.doesNotMatch(h.run('inlineAuctionBidForm(auction)'),/<form/);
});
test('inline save calls the existing bid API, clears only the submitted draft and refreshes without navigation',async()=>{
 const h=harness(),a=h.form(),b=h.form('another-auction','34');h.context.form=a.form;await h.run('submitInlineAuctionBid(form)');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/auctions/inline-fixture/bid');assert.equal(h.calls[0].options.method,'PUT');assert.deepEqual(JSON.parse(h.calls[0].options.body),{amount:30});assert.equal(a.input.value,'');assert.equal(b.input.value,'34');assert.equal(h.refreshes.length,1);assert.equal(h.refreshes[0][2].skipInlineDraft,'inline-fixture');assert.match(a.status.textContent,/Saved 30 DKP/);assert.equal(h.run('state.auctionId'),null);
});
test('duplicate submission during an outstanding save issues one write and unlocks after completion',async()=>{
 const h=harness(),a=h.form();h.context.form=a.form;let release;h.respond(()=>new Promise(r=>release=r));const first=h.run('submitInlineAuctionBid(form)');await new Promise(r=>setImmediate(r));await h.run('submitInlineAuctionBid(form)');assert.equal(h.calls.length,1);release(Response.json({auction}));await first;assert.equal(h.run('inlineBidPending.size'),0);
});
test('invalid whole-number/minimum/per-item-cap bids never reach the server',async()=>{
 for(const value of ['0','4','36','1.5','Infinity','']){const h=harness(),a=h.form('inline-fixture',value);h.context.form=a.form;await h.run('submitInlineAuctionBid(form)');assert.equal(h.calls.length,0,value);assert.equal(h.errors.length,1,value);}
});
test('server rejection retains the typed amount and saved bid, reports the error and permits retry',async()=>{
 const h=harness(),a=h.form();h.context.form=a.form;h.respond(()=>Response.json({code:'bid_exceeds_balance',error:'Your maximum bid is 10 DKP.'},{status:409}));await h.run('submitInlineAuctionBid(form)');assert.equal(a.input.value,'30');assert.equal(h.refreshes.length,0);assert.match(h.errors[0],/maximum bid is 10/);assert.equal(h.run('inlineBidPending.size'),0);
});
test('late replies after navigation or session change cannot refresh a new page or announce success',async()=>{
 for(const change of ['state.generation++','state.sessionEpoch++']){const h=harness(),a=h.form();h.context.form=a.form;let release;h.respond(()=>new Promise(r=>release=r));const first=h.run('submitInlineAuctionBid(form)');await new Promise(r=>setImmediate(r));h.run(change);release(Response.json({auction}));await first;assert.equal(h.refreshes.length,0);assert.equal(a.status.textContent,'');assert.equal(h.messages.length,0);assert.equal(h.run('inlineBidPending.size'),0);}
});
test('per-item limits permit independent full bids without any combined reservation block',async()=>{
 const h=harness(),a=h.form('one','35'),b=h.form('two','35');h.context.a=a.form;h.context.b=b.form;await h.run('submitInlineAuctionBid(a)');await h.run('submitInlineAuctionBid(b)');assert.equal(h.calls.length,2);assert.equal(h.calls.reduce((sum,c)=>sum+JSON.parse(c.options.body).amount,0),70);
});
test('returning to auctions during a pending save releases recreated controls without a stale success message',async()=>{
 const h=harness(),old=h.form();h.context.form=old.form;let release;
 h.respond(()=>new Promise(r=>release=r));const pending=h.run('submitInlineAuctionBid(form)');await new Promise(r=>setImmediate(r));
 old.form.isConnected=false;h.forms.length=0;h.run('state.generation+=2');
 const fresh=h.form(),input={disabled:true},button={disabled:true,textContent:'Saving…'};
 fresh.form.querySelectorAll=()=>[input,button];const originalQuery=fresh.form.querySelector;
 fresh.form.querySelector=selector=>selector==='button[type="submit"]'?button:originalQuery(selector);
 release(Response.json({auction}));await pending;
 assert.equal(input.disabled,false);assert.equal(button.disabled,false);assert.equal(button.textContent,'Update');assert.equal(fresh.status.textContent,'');assert.equal(h.refreshes.length,0);assert.equal(h.run('inlineBidPending.size'),0);
});
