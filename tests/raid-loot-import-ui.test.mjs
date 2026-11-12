import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
const exportText=JSON.stringify({format:'guild-desk-loot-events',version:1,exportId:'fixture-export-1',events:[{id:'fixture-event-1',itemName:'Fixture item',quantity:2,holder:'Custodian',bossName:'Fixture boss',source:'Fixture boss',observedAt:'2026-11-12T20:00:00',timeText:'20:00:00',timeKind:'tracker-clock'}]});
const preview=(extra={})=>({previewHash:'preview-fixture',sourceHash:'source-fixture',fileName:'Fixture export',format:'tracker-json',raidDate:'2026-11-12',eventCount:1,totalQuantity:2,newCount:1,duplicateCount:0,possibleOverlapCount:0,warnings:[],groups:[{key:'boss-key',bossName:'Fixture boss',eventCount:1,includedCount:1,totalQuantity:2}],events:[{id:'source-event',itemName:'Fixture item',quantity:2,holder:'Custodian',bossName:'Fixture boss',observedAt:null,timeText:null,excluded:false}],...extra});
const savedImport=(extra={})=>({id:'import-fixture',fileName:'Fixture export',raidDate:'2026-11-12',warnings:[],groups:[{id:'group-fixture',key:'boss-key',bossName:'Fixture boss',status:'review',eventCount:1,includedCount:1,totalQuantity:2,draftId:null}],events:[{id:'row-fixture',groupId:'group-fixture',revision:7,itemName:'Fixture item',quantity:2,holder:'Custodian',bossName:'Fixture boss',observedAt:null,timeText:null,excluded:false}],...extra});
function harness(){
 const handlers={},nodes=new Map(),calls=[],navigations=[],messages=[],errors=[],scrolls=[];
 const node=()=>({innerHTML:'',value:'',files:[],hidden:false,isConnected:true,dataset:{},style:{},classList:{toggle(){},remove(){},add(){}},addEventListener(){},remove(){},removeAttribute(){},setAttribute(){},replaceChildren(){this.innerHTML='';},querySelectorAll(){return[];},querySelector(){return node();},focus(){},scrollIntoView(){}});
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
 let respond=()=>{throw Error('Unexpected fetch');},realNavigation=false;
 const context=vm.createContext({document:{querySelector:get,querySelectorAll(){return[];},addEventListener(name,handler){handlers[name]=handler;}},window:{addEventListener(){},location:{origin:'https://guild.test'},scrollX:0,scrollY:420,scrollTo(options){scrolls.push(options);}},fetch:async(path,options)=>{const request={path,method:options.method,body:options.body?JSON.parse(options.body):undefined,headers:options.headers};calls.push(request);return respond(request);},recordFlash:(message,error)=>messages.push({message,error}),recordError:(form,message)=>{if(message)errors.push(message);},recordAuth(){},TextEncoder,URL,URLSearchParams,Date,Map,Set,WeakMap,crypto,Response,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},FormData:class{constructor(form){this.entries=Object.entries(form.values || {});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}});
 vm.runInContext(source,context,{filename:'guild-desk-raid-import-ui.js'});
 const run=code=>vm.runInContext(code,context),originalNavigate=run('navigate');
 context.recordNavigation=async(...args)=>{navigations.push(args);if(realNavigation)return originalNavigate(...args);};
 run("state.user={id:'officer',role:'member'};state.csrfToken='fixture-csrf';state.access={permissions:{loot:3,overview:3}};state.page='loot';state.lootTab='raid-import';state.generation=1;flash=recordFlash;formError=recordError;navigate=recordNavigation;renderShell=()=>{};renderAuth=recordAuth;");
 function form(kind,values={},dataset={},controls={}){
  const elements=new Map(),field=selector=>{if(selector in controls)return controls[selector];if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);};
  return{dataset:{form:kind,...dataset},values,isConnected:true,reportValidity(){return true;},closest(selector){return selector==='[data-form]'?this:null;},querySelectorAll(){return[];},querySelector:field,field};
 }
 const submit=form=>handlers.submit({target:{closest(){return form;}},preventDefault(){}});
 return{context,run,get,handlers,calls,navigations,messages,errors,scrolls,form,submit,setRespond(handler){respond=handler;},useRealNavigation(){realNavigation=true;},state:run('state')};
}
const previewForm=h=>h.form('preview-raid-loot',{format:'tracker-json',text:exportText,raidDate:'2026-11-12',raidId:'raid-fixture',bossName:'Fixture boss',sourceLabel:'Fixture export',myCharacter:'',looters:'',ignoreItems:''});
async function waitForRequest(h){for(let i=0;i<10&&!h.calls.length;i++)await Promise.resolve();assert.equal(h.calls.length,1);}

test('manual preview listener posts the selected source and safe filter keys, never local tracker settings',async()=>{
 const h=harness(),form=previewForm(h),config={log_path:'C:\\private-fixture\\eqlog.txt',auto_start_monitoring:true,my_character:'Fixturechar',looters:['Custodian'],ignore_items:['Fixture, ignored item']};
 form.field('input[name="settingsFile"]').files=[{size:300,text:async()=>JSON.stringify(config)}];
 h.setRespond(()=>Response.json({preview:preview()}));await h.submit(form);
 assert.equal(h.calls[0].path,'/api/loot-imports/preview');assert.equal(h.calls[0].headers['X-CSRF-Token'],'fixture-csrf');
 assert.equal(h.calls[0].body.text,exportText);assert.equal(h.calls[0].body.myCharacter,'Fixturechar');assert.deepEqual(h.calls[0].body.looters,['Custodian']);assert.deepEqual(h.calls[0].body.ignoreItems,['Fixture, ignored item']);
 assert.doesNotMatch(JSON.stringify(h.calls[0].body),/log_path|private-fixture|auto_start_monitoring/);
 assert.equal(h.state.raidLootPreview.preview.previewHash,'preview-fixture');assert.match(h.get('#raid-loot-preview').innerHTML,/Holding looter|Review raid-night loot/);
});

test('selecting a settings JSON as loot source is rejected before fetch or saved preview state',async()=>{
 const h=harness(),form=previewForm(h);form.values.text=JSON.stringify({log_path:'C:\\private-fixture\\eqlog.txt',my_character:'Fixturechar',looters:[],ignore_items:[],auto_start_monitoring:true});
 await h.submit(form);assert.equal(h.calls.length,0);assert.equal(h.state.raidLootPreview,null);assert.match(h.errors.at(-1),/Settings file has no loot events; choose a Guild Desk export, Excel export, or raid log/);
});

test('known filter settings validate together and legacy TSV requires explicit boss context',async()=>{
 const h=harness(),form=previewForm(h);form.field('input[name="settingsFile"]').files=[{size:200,text:async()=>JSON.stringify({my_character:'Fixturechar',looters:['Custodian'],ignore_items:42})}];
 await h.submit(form);assert.equal(h.calls.length,0);assert.equal(form.field('[name="myCharacter"]').value,'');assert.match(h.errors.at(-1),/ignore_items must be an array/);
 form.field('input[name="settingsFile"]').files=[];form.values.format='tracker-tsv';form.values.bossName='';form.values.text='Item\tQty\tLooter\nFixture item\t1\tCustodian';await h.submit(form);assert.equal(h.calls.length,0);assert.match(h.errors.at(-1),/explicit boss name/);
});

test('commit listener requires review and distinct-overlap confirmation then posts the exact preview hash once',async()=>{
 const h=harness(),payload={format:'tracker-tsv',fileName:'Fixture.tsv',text:'Item\tQty\tLooter\nFixture item\t2\tCustodian',raidDate:'2026-11-12',bossName:'Fixture boss'};
 h.state.raidLootPreview={payload,preview:preview({possibleOverlapCount:1})};const form=h.form('commit-raid-loot',{});
 h.setRespond(()=>Response.json({import:savedImport(),alreadyImported:false}));await h.submit(form);assert.equal(h.calls.length,0);
 form.values.reviewed='on';await h.submit(form);assert.equal(h.calls.length,0);assert.match(h.errors.at(-1),/overlapping legacy rows/);
 form.values.confirmDistinctLegacy='on';await h.submit(form);assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/loot-imports');
 assert.deepEqual(h.calls[0].body,{...payload,expectedPreviewHash:'preview-fixture',confirmDistinctLegacy:true});assert.equal(h.state.raidLootPreview,null);
 assert.equal(h.navigations.at(-1)[0],'loot');assert.equal(h.navigations.at(-1)[1],'import-fixture');assert.equal(h.navigations.at(-1)[3].lootTab,'raid-import');
 assert.ok(h.calls.every(call=>!/^\/api\/(?:auctions|ledger|characters)/.test(call.path)));
});

test('changing source context invalidates its saved preview before commit',async()=>{
 const h=harness(),form=previewForm(h);h.state.raidLootPreview={payload:{text:exportText},preview:preview()};
 h.handlers.input({target:{id:'raid-date',closest(selector){return selector==='[data-form="preview-raid-loot"]'?form:null;}}});
 assert.equal(h.state.raidLootPreview,null);await h.submit(h.form('commit-raid-loot',{reviewed:'on'}));assert.equal(h.calls.length,0);assert.match(h.errors.at(-1),/Preview the raid-night source/);
});

test('saved rows use their own revisions and escape holders; handed-off rows link to their existing boss draft',()=>{
 const h=harness(),entry=savedImport();entry.events=[{...entry.events[0],id:'row-first',revision:2,itemName:'Item <script>',holder:'Holder <img>'},{...entry.events[0],id:'row-second',revision:7},{...entry.events[0],id:'row-prepared',revision:9,handoffGroupId:'old-group',preparedDraftId:'saved-draft'}];h.context.entry=entry;
 const html=h.run('raidLootEventTable(entry)');assert.match(html,/data-event="row-first"[^>]*data-revision="2"/);assert.match(html,/data-event="row-second"[^>]*data-revision="7"/);assert.equal((html.match(/data-form="exclude-raid-loot"/g)||[]).length,2);
 assert.match(html,/Holder &lt;img&gt;/);assert.match(html,/Item &lt;script&gt;/);assert.doesNotMatch(html,/<script>|Holder <img>/);assert.match(html,/data-action="open-loot-draft" data-draft="saved-draft"/);assert.doesNotMatch(html,/data-event="row-prepared"/);
});

test('exclude and restore listeners send exact per-row revisions and preserve the import review context',async()=>{
 const h=harness();h.setRespond(()=>Response.json({}));
 for(const [excluded,revision]of[['true','7'],['false','8']]){
  const form=h.form('exclude-raid-loot',{reason:'Reviewed source event'},{import:'import-fixture',event:'row-second',excluded,revision});await h.submit(form);
  assert.equal(h.calls.at(-1).path,'/api/loot-imports/import-fixture/events/row-second');assert.equal(h.calls.at(-1).method,'PUT');assert.deepEqual(h.calls.at(-1).body,{excluded:excluded==='true',reason:'Reviewed source event',expectedRevision:Number(revision)});
  assert.equal(h.navigations.at(-1)[1],'import-fixture');assert.equal(h.navigations.at(-1)[3].lootTab,'raid-import');assert.equal(h.navigations.at(-1)[3].preserveContext.scrollY,420);
 }
});

test('stale row conflict reloads that import without retrying the mutation and keeps the reader position',async()=>{
 const h=harness();h.state.raidLootImportId='import-fixture';h.useRealNavigation();
 h.setRespond(request=>request.method==='PUT'?Response.json({error:'Row changed since review',code:'revision_conflict'},{status:409}):Response.json({import:savedImport({events:[{...savedImport().events[0],revision:8}]})}));
 await h.submit(h.form('exclude-raid-loot',{reason:'Reviewed source event'},{import:'import-fixture',event:'row-fixture',excluded:'true',revision:'7'}));
 assert.deepEqual(h.calls.map(call=>[call.method,call.path]),[['PUT','/api/loot-imports/import-fixture/events/row-fixture'],['GET','/api/loot-imports/import-fixture']]);
 assert.equal(h.state.raidLootImportId,'import-fixture');assert.equal(h.state.raidLootImport.events[0].revision,8);assert.equal(h.state.lootTab,'raid-import');assert.equal(h.scrolls.at(-1).top,420);assert.match(h.messages.at(-1).message,/Latest import status loaded/);
});

test('prepare uses explicit review context, frozen retries use an empty body, and an existing draft is opened without publishing',async()=>{
 const h=harness();h.setRespond(()=>Response.json({draftId:'saved-draft',alreadyPrepared:true}));
 await h.submit(h.form('prepare-raid-loot',{bossName:'Fixture boss'},{import:'import-fixture',group:'group-fixture',preparing:'false'}));assert.deepEqual(h.calls[0].body,{bossName:'Fixture boss'});
 await h.submit(h.form('prepare-raid-loot',{bossName:'Must not rename frozen snapshot'},{import:'import-fixture',group:'group-fixture',preparing:'true'}));assert.deepEqual(h.calls[1].body,{});
 assert.ok(h.calls.every(call=>call.path==='/api/loot-imports/import-fixture/groups/group-fixture/prepare'));assert.equal(h.navigations.at(-1)[1],'saved-draft');assert.equal(h.navigations.at(-1)[3],undefined);
});

test('read-only loot permission blocks forged import mutations even when the legacy role is administrator',async()=>{
 const h=harness();h.state.user.role='admin';h.state.access.permissions.loot=2;await h.submit(previewForm(h));assert.equal(h.calls.length,0);assert.match(h.errors.at(-1),/Write access is required/);
});

test('late preview replies cannot restore private source after sign-out',async()=>{
 const h=harness();let finish;h.setRespond(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.submit(previewForm(h));await waitForRequest(h);
 h.run('setSession(null);');finish(Response.json({preview:preview()}));await pending;assert.equal(h.state.user,null);assert.equal(h.state.raidLootPreview,null);assert.equal(h.navigations.length,0);assert.equal(h.errors.length,0);assert.equal(h.get('#raid-loot-preview').innerHTML,'');
});

test('a stale previous-session failure cannot sign out a newly created account or display its old preview',async()=>{
 const h=harness();let finish;h.setRespond(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.submit(previewForm(h));await waitForRequest(h);
 h.run("setSession({id:'new-account',role:'member'},'new-csrf',{permissions:{loot:3}});");finish(Response.json({error:'Old session expired'},{status:401}));await pending;
 assert.equal(h.state.user.id,'new-account');assert.equal(h.state.csrfToken,'new-csrf');assert.equal(h.state.raidLootPreview,null);assert.equal(h.navigations.length,0);assert.equal(h.errors.length,0);assert.equal(h.messages.length,0);
});


test('unknown source groups require a real boss name while frozen preparation keeps that context read-only',async()=>{
 const h=harness(),entry=savedImport();entry.groups[0].bossName='Unassigned source';h.context.importId='import-fixture';h.setRespond(()=>Response.json({import:entry}));
 let html=await h.run('raidLootImportPage(importId)');assert.match(html,/Boss context required/);assert.match(html,/name="bossName"[^>]*value=""[^>]*required/);assert.doesNotMatch(html,/name="bossName"[^>]*value="Unassigned source"/);
 entry.groups[0].status='preparing';html=await h.run('raidLootImportPage(importId)');assert.match(html,/data-preparing="true"/);assert.match(html,/Retry boss draft preparation/);assert.doesNotMatch(html,/name="bossName"/);
});
