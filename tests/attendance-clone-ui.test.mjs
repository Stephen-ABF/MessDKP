import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
const raid={id:'raid-fixture',name:'Fixture raid',date:'2026-11-12',rate:5};
const tick={id:'source-tick',sourceTime:'2026-11-12T20:00:00',fileName:'Fixture roster.txt',rowCount:2};
function harness(permissions={attendance:3}){
 const handlers={},nodes=new Map(),calls=[],navigations=[],errors=[],messages=[],scrolls=[];
 const node=()=>({innerHTML:'',value:'',files:[],hidden:false,isConnected:true,dataset:{},style:{},classList:{toggle(){},remove(){},add(){}},addEventListener(){},remove(){},removeAttribute(){},setAttribute(){},replaceChildren(){this.innerHTML='';},querySelectorAll(){return[];},querySelector(){return node();},focus(){}});
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
 let respond=()=>{throw Error('Unexpected fetch');};
 const context=vm.createContext({document:{querySelector:get,querySelectorAll(){return[];},addEventListener(name,handler){handlers[name]=handler;}},window:{addEventListener(){},location:{origin:'https://guild.test'},scrollX:0,scrollY:360,scrollTo(options){scrolls.push(options);}},fetch:async(path,options)=>{const request={path,method:options.method,body:options.body?JSON.parse(options.body):undefined,headers:options.headers};calls.push(request);return respond(request);},recordError:(form,message)=>{if(message)errors.push(message);},recordFlash:(message,error)=>messages.push({message,error}),recordNavigation:async(...args)=>navigations.push(args),TextEncoder,URL,URLSearchParams,Date,Map,Set,WeakMap,crypto,Response,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},FormData:class{constructor(form){this.entries=Object.entries(form.values || {});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}});
 vm.runInContext(source,context,{filename:'guild-desk-attendance-clone-ui.js'});context.permissions=permissions;
 const run=code=>vm.runInContext(code,context);
 run("state.user={id:'attendance-writer',role:'member'};state.csrfToken='fixture-csrf';state.access={permissions};state.page='attendance';state.raidId='raid-fixture';state.generation=1;formError=recordError;flash=recordFlash;navigate=recordNavigation;");
 const form=(kind,values={},dataset={},controls={})=>({dataset:{form:kind,...dataset},values,isConnected:true,reportValidity(){return true;},closest(selector){return selector==='[data-form]'?this:null;},querySelectorAll(){return[];},querySelector(selector){return controls[selector] || get(selector);}});
 return{context,run,handlers,get,calls,navigations,errors,messages,scrolls,state:run('state'),form,submit:form=>handlers.submit({target:{closest(){return form;}},preventDefault(){}}),setRespond(handler){respond=handler;}};
}

test('an attendance-only writer can open a raid without overview or correction access',async()=>{
 const h=harness({attendance:3,overview:0,corrections:0});h.setRespond(request=>{assert.equal(request.path,'/api/raids/raid-fixture');return Response.json({raid,ticks:[tick],attendance:[]});});
 const html=await h.run("raidPage('raid-fixture')");assert.equal(h.calls.length,1);assert.match(html,/Attendance ticks/);assert.match(html,/Fixture roster/);assert.match(html,/data-form="preview-import"/);assert.doesNotMatch(html,/Request missing attendance|\/dashboard/);
});

test('a correction-enabled attendance reader uses the narrow own-options endpoint instead of overview',async()=>{
 const h=harness({attendance:2,overview:0,corrections:3});h.setRespond(request=>request.path==='/api/raids/raid-fixture'?Response.json({raid,ticks:[tick],attendance:[]}):Response.json({character:{id:'main-fixture',name:'Fixture main'},ticks:[{...tick,raidId:raid.id},{id:'other-tick',raidId:'other-raid',fileName:'Other raid roster',sourceTime:'2026-11-11T20:00:00'}]}));
 const html=await h.run("raidPage('raid-fixture')");assert.deepEqual(h.calls.map(request=>request.path),['/api/raids/raid-fixture','/api/attendance-requests/options']);assert.match(html,/data-form="request-attendance"/);assert.match(html,/value="source-tick"/);assert.doesNotMatch(html,/value="other-tick"|data-form="preview-import"/);
});


const clonePreview=(extra={})=>({preview:true,previewToken:'preview-fixture',source:{tickId:tick.id,fileName:tick.fileName,sourceTime:tick.sourceTime,rowCount:2},target:{raidId:raid.id,raidName:raid.name,raidDate:raid.date,sourceTime:'2026-11-12T20:15:00',rate:5},counts:{rows:2,creditableMains:2,pending:0,ineligible:0,projectedDkp:10},rows:[{characterId:'main1',name:'Fixture main',className:'Cleric',zone:'Fixture zone',status:'credited',dkp:5},{characterId:'main2',name:'Other main',className:'Warrior',zone:'Fixture zone',status:'credited',dkp:5}],reason:'Missed checkpoint',...extra});
function cloneForms(h){
 const key=JSON.stringify([raid.id,tick.id]),sourceInputs=[{disabled:false,readOnly:false},{disabled:false,readOnly:false}],sourceButton={disabled:false},checkbox={disabled:false},commitButton={disabled:false,textContent:'Confirm cloned attendance tick',setAttribute(name){if(name==='disabled')this.disabled=true;}},refreshButton={disabled:false};
 const row={dataset:{attendanceTick:tick.id},getBoundingClientRect(){return{top:100};}},target=h.get('fixture-clone-preview');
 const component={querySelector(selector){if(selector==='[data-clone-preview]')return target;if(selector==='[data-form="preview-attendance-clone"]')return previewForm;if(selector.includes('commit-attendance-clone'))return commitButton;return h.get(selector);}};
 const workspace={isConnected:true,dataset:{},querySelectorAll(){return [...sourceInputs,sourceButton,checkbox,commitButton,refreshButton];}};
 const configure=(form,ownControls)=>{form.closest=selector=>selector==='[data-form]'?form:selector==='[data-attendance-clone]'?component:selector==='[data-attendance-tick]'?row:selector.includes('#attendance-clone-workspace')?workspace:null;form.querySelectorAll=selector=>selector==='input,textarea'?sourceInputs:selector==='button'?[sourceButton]:ownControls;return form;};
 const previewForm=configure(h.form('preview-attendance-clone',{targetTime:'20:15',reason:'Missed checkpoint'},{raid:raid.id,source:tick.id,cloneKey:key}),[...sourceInputs,sourceButton]);
 const commitForm=configure(h.form('commit-attendance-clone',{reviewed:'on'},{raid:raid.id,source:tick.id,cloneKey:key},{'button[type="submit"]':commitButton}),[checkbox,commitButton,refreshButton]);
 return{key,previewForm,commitForm,sourceInputs,sourceButton,commitButton,target,component};
}
const recordFor=(h,key)=>{h.context.cloneKey=key;return h.run('attendanceClonePreviews.get(cloneKey)');};

test('clone controls appear on original raid ticks and tick details but never on an officer clone',async()=>{
 const h=harness(),origin={kind:'officer_clone',sourceTickId:tick.id,sourceFileName:tick.fileName,sourceCaptureTime:tick.sourceTime,reason:'Checkpoint <script>',actorName:'Officer <img>',clonedAt:'2026-11-12T21:00:00Z',rate:5},copied={...tick,id:'copied-tick',sourceTime:'2026-11-12T20:15:00',origin};
 h.context.raid=raid;h.context.tick=tick;h.context.copied=copied;
 assert.match(h.run('attendanceCloneControl(raid,tick)'),/Clone dump/);assert.equal(h.run('attendanceCloneControl(raid,copied)'),'');
 const provenance=h.run('tickCloneOrigin(copied,raid.id)');assert.match(provenance,/Officer-cloned attendance/);assert.match(provenance,/Checkpoint &lt;script&gt;/);assert.match(provenance,/Officer &lt;img&gt;/);assert.match(provenance,/data-tick="source-tick"/);
 h.setRespond(request=>Response.json(request.path.endsWith('/ticks/source-tick')?{raid,tick,attendance:[]}:{raid,ticks:[tick,copied],attendance:[]}));
 let html=await h.run("raidPage('raid-fixture')");assert.equal((html.match(/data-form="preview-attendance-clone"/g)||[]).length,1);assert.match(html,/Officer-cloned attendance/);
 html=await h.run("tickAttendancePage('raid-fixture','source-tick')");assert.match(html,/Clone dump/);
 h.state.user.role='admin';h.state.access.permissions.attendance=2;assert.equal(h.run('attendanceCloneControl(raid,tick)'),'');
});

test('preview is a write-permission-gated read step showing the source, same raid, row count, rate and projected DKP',async()=>{
 const h=harness(),f=cloneForms(h);h.setRespond(()=>Response.json(clonePreview()));await h.submit(f.previewForm);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/raids/raid-fixture/ticks/source-tick/clone/preview');assert.deepEqual(h.calls[0].body,{targetTime:'20:15',reason:'Missed checkpoint'});assert.equal(h.calls[0].headers['X-CSRF-Token'],'fixture-csrf');
 for(const text of ['Fixture roster.txt','Fixture raid','20:15:00','Copied rows','DKP per approved main','10 projected DKP','officer-cloned attendance','Fixture main','name="reviewed" required'])assert.ok(f.target.innerHTML.includes(text),text);
 assert.ok(recordFor(h,f.key).idempotencyKey.length>=8);assert.equal(h.navigations.length,0);
});

test('confirmation is explicit and posts the reviewed token and stable operation key while retaining source-row focus',async()=>{
 const h=harness(),f=cloneForms(h);h.setRespond(request=>Response.json(request.path.endsWith('/preview')?clonePreview():{created:true,replayed:false,tick:{id:'copied-tick',sourceTime:'2026-11-12T20:15:00'},creditedDkp:10}));await h.submit(f.previewForm);
 const record=recordFor(h,f.key);f.commitForm.values={};await h.submit(f.commitForm);assert.equal(h.calls.length,1);assert.match(h.errors.at(-1),/Confirm the copied roster/);
 f.commitForm.values.reviewed='on';await h.submit(f.commitForm);assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/raids/raid-fixture/ticks/source-tick/clone');assert.deepEqual(h.calls[1].body,{targetTime:'20:15',reason:'Missed checkpoint',previewToken:'preview-fixture',idempotencyKey:record.idempotencyKey});
 const navigation=h.navigations.at(-1);assert.equal(navigation[0],'attendance');assert.equal(navigation[1],raid.id);assert.equal(navigation[3].preserveContext.attendanceTick,tick.id);assert.equal(navigation[3].preserveContext.scrollY,360);
});

test('an uncertain clone result retains the exact token, key and body for a retry instead of previewing or posting twice',async()=>{
 const h=harness(),f=cloneForms(h);let attempts=0;h.setRespond(request=>{if(request.path.endsWith('/preview'))return Response.json(clonePreview());if(++attempts===1)throw Error('Connection interrupted');return Response.json({created:false,replayed:true,tick:{id:'copied-tick',sourceTime:'2026-11-12T20:15:00'},creditedDkp:10});});
 await h.submit(f.previewForm);await h.submit(f.commitForm);const first=h.calls.at(-1).body;assert.ok(recordFor(h,f.key));assert.equal(f.sourceInputs[0].readOnly,true);assert.equal(f.sourceButton.disabled,true);assert.match(f.commitButton.textContent,/Retry/);
 await h.submit(f.previewForm);assert.equal(h.calls.length,2);assert.match(h.errors.at(-1),/Retry the retained confirmation/);
 await h.submit(f.commitForm);assert.equal(h.calls.length,3);assert.deepEqual(h.calls.at(-1).body,first);assert.equal(attempts,2);assert.match(h.messages.at(-1).message,/No duplicate attendance or DKP/);
});

test('a stale preview rejects confirmation and unlocks source fields for a new explicit preview and key',async()=>{
 const h=harness(),f=cloneForms(h);let previews=0;h.setRespond(request=>request.path.endsWith('/preview')?Response.json(clonePreview({previewToken:'preview-'+(++previews)})):Response.json({error:'Source rows or rate changed',code:'stale_preview'},{status:409}));
 await h.submit(f.previewForm);const firstKey=recordFor(h,f.key).idempotencyKey;await h.submit(f.commitForm);assert.equal(recordFor(h,f.key),undefined);assert.equal(f.commitButton.disabled,true);assert.equal(f.sourceButton.disabled,false);assert.equal(f.sourceInputs[0].readOnly,false);assert.match(h.errors.at(-1),/Preview the source again/);
 f.previewForm.values.targetTime='20:20';await h.submit(f.previewForm);assert.equal(h.calls.length,3);assert.notEqual(recordFor(h,f.key).idempotencyKey,firstKey);assert.equal(recordFor(h,f.key).preview.previewToken,'preview-2');
});

test('editing an uncommitted time or reason invalidates the old preview',async()=>{
 const h=harness(),f=cloneForms(h);h.setRespond(()=>Response.json(clonePreview()));await h.submit(f.previewForm);
 h.handlers.input({target:{id:'clone-time',closest(selector){return selector==='[data-form="preview-attendance-clone"]'?f.previewForm:null;}}});
 assert.equal(recordFor(h,f.key),undefined);assert.equal(f.target.innerHTML,'');await h.submit(f.commitForm);assert.equal(h.calls.length,1);assert.match(h.errors.at(-1),/Preview this source attendance/);
});

test('a mismatched raid preview or a read-only legacy administrator never gets a confirmation request',async()=>{
 const h=harness(),f=cloneForms(h);h.setRespond(()=>Response.json(clonePreview({target:{...clonePreview().target,raidId:'different-raid'}})));await h.submit(f.previewForm);assert.equal(recordFor(h,f.key),undefined);assert.match(h.errors.at(-1),/preview context changed/);
 h.state.user.role='admin';h.state.access.permissions.attendance=2;await h.submit(f.previewForm);assert.equal(h.calls.length,1);assert.match(h.errors.at(-1),/Write access is required/);
});

test('late preview replies after a session switch cannot expose or retain the old roster',async()=>{
 const h=harness(),f=cloneForms(h);let finish;h.setRespond(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.submit(f.previewForm);for(let i=0;i<10&&!h.calls.length;i++)await Promise.resolve();assert.equal(h.calls.length,1);
 h.run("setSession({id:'another-account'},'different-csrf',{permissions:{attendance:3}});");finish(Response.json(clonePreview()));await pending;assert.equal(recordFor(h,f.key),undefined);assert.equal(f.target.innerHTML,'');assert.equal(h.navigations.length,0);assert.equal(h.errors.length,0);
});
