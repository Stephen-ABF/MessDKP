import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
import {createCaptureApi} from '../worker/captures.mjs';
import {createLootApi} from '../worker/loot.mjs';
import {parseLootChannelLine,parseChatLootSources} from '../worker/log-parser.mjs';
const origin='https://guild.test';
const lines=["[Thu Nov 12 00:28:32 2026] You tell abfloot:4, 'Gloves of True Darkness | Steel Hilted Flint Dagger | Complex Platinum Gem Dusted Rune | Words of Tenancy | '","[Thu Nov 12 00:28:32 2026] You tell abfloot:4, 'Spell: Gangrenous Touch of Zum`uul | Tatrinek's Curse | Tatrinek's Curse | Spell: Dyzil's Deafening Decoy | '","[Thu Nov 12 00:28:33 2026] You tell abfloot:4, 'Spell: Thrall of Bones'"];
async function fixture(){
 const DB=createD1(await applicationSchema());let time=Date.parse('2026-11-12T05:00:00Z');
 for(const id of ['owner','second','member'])DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@test.invalid',id,'test','test',id==='member'?'member':'admin',new Date(time).toISOString());
 const loot=createLootApi({parseChatLootSources}),api=createCaptureApi({parseLootChannelLine,handleLootApi:loot,clock:()=>time});
 const context={user:{id:'owner',role:'admin'},csrfToken:'test-csrf'};
 const call=async(path,method='GET',body,ctx=context,extra={})=>{const response=await api(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'test-csrf',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},ctx);return {status:response.status,body:await response.json()};};
 const native=async(token,path='/api/companion/events',body)=>{const r=await api(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json()};};
 const create=async(extra={})=>{const r=await call('/api/captures','POST',{bossName:'Fixture Boss',channelName:'abfloot',...extra});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
 const events=(raw=lines)=>raw.map((line,i)=>({eventId:(i+1).toString(16).padStart(64,'0'),fileName:'eqlog_Fixture_test.txt',offset:i*500,line}));
 return {DB,api,call,native,create,events,context,setTime(value){time=value;},close(){DB.close();}};
}

test('capture credentials are one-time scoped tokens, hashed at rest, and web mutations require officer CSRF',async()=>{
 const h=await fixture();try{
  assert.equal((await h.call('/api/captures','GET',undefined,{})).status,401);
  assert.equal((await h.call('/api/captures','POST',{}, {user:{id:'member',role:'member'},csrfToken:'test-csrf'})).status,403);
  assert.equal((await h.call('/api/captures','POST',{},h.context,{Origin:'https://evil.test'})).status,403);
  const {session,pairing}=await h.create();assert.equal(pairing.captureId,session.id);assert.match(pairing.token,/^gdcp_[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify((await h.call('/api/captures')).body),/token|gdcp_/);
  assert.doesNotMatch(JSON.stringify((await h.call('/api/captures/'+session.id)).body),/token|gdcp_/);
  assert.notEqual(h.DB.raw.prepare('SELECT token_hash FROM capture_sessions').get().token_hash,pairing.token);
  assert.equal((await h.native(pairing.token,'/api/companion/session')).status,200);
  assert.equal((await h.native('gdcp_'+'0'.repeat(64),'/api/companion/session')).status,401);
  assert.equal((await h.call('/api/companion/session','GET',undefined,h.context,{Authorization:'Bearer '+pairing.token})).status,403);
  assert.equal((await h.api(new Request(origin+'/api/auctions',{headers:{Authorization:'Bearer '+pairing.token}}),{DB:h.DB},{})),null);
 }finally{h.close();}
});

test('verified abfloot messages yield nine pieces, preserve raw evidence and count legitimate copies without duplicate retries',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create(),body={watcherId:'fixture-watcher',events:h.events()};
  const sent=await h.native(pairing.token,undefined,body);assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal(sent.body.accepted,3);
  const retry=await h.native(pairing.token,undefined,body);assert.equal(retry.body.accepted,0);assert.equal(retry.body.duplicates,3);
  const detail=(await h.call('/api/captures/'+session.id)).body;assert.equal(detail.session.itemCount,9);assert.equal(detail.events[0].line,lines[0]);
  const prepared=await h.call('/api/captures/'+session.id+'/prepare','POST',{});assert.equal(prepared.status,200,JSON.stringify(prepared.body));
  const rows=h.DB.raw.prepare('SELECT name,quantity FROM loot_draft_items WHERE draft_id=?').all(prepared.body.draftId);assert.equal(rows.length,8);assert.equal(rows.find(r=>r.name==="Tatrinek's Curse").quantity,2);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auctions').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
  const second=await h.call('/api/captures/'+session.id+'/prepare','POST',{}, {user:{id:'second',role:'admin'},csrfToken:'test-csrf'});assert.equal(second.body.draftId,prepared.body.draftId);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,1);
  assert.equal((await h.native(pairing.token,undefined,body)).status,410);
 }finally{h.close();}
});

test('channel/sender filtering, watcher binding, event conflicts and malformed messages cannot silently alter captured loot',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create({allowedSenders:['You']});const original=h.events([lines[0]])[0];
  const unrelated=h.events([lines[0].replace('abfloot:4','abflootExtra:4')]);assert.equal((await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:unrelated})).body.accepted,0);
  const first=await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:[original]});assert.equal(first.status,200);
  assert.equal((await h.native(pairing.token,undefined,{watcherId:'second-watcher',events:[original]})).status,409);
  assert.equal((await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:[{...original,line:lines[2]}]})).status,409);
  assert.equal((await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:[{...original,eventId:'f'.repeat(64),line:lines[2].slice(0,-1)}]})).status,400);
  assert.equal((await h.call('/api/captures/'+session.id)).body.events.length,1);
 }finally{h.close();}
});

test('reposts are visibly counted, exclusions preserve source, concatenations remain unresolved, and freeze rejects further capture',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create();const items=h.events([lines[0],lines[0],"[Thu Nov 12 00:28:33 2026] You tell abfloot:5, 'Kylong GreavesIndium Ore | '"]);
  const r=await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:items});assert.equal(r.status,200);
  let detail=(await h.call('/api/captures/'+session.id)).body;assert.ok(detail.warnings.some(w=>/Repeated/.test(w)));assert.equal(detail.session.itemCount,9);
  const ignored=await h.call('/api/captures/'+session.id+'/events/'+items[1].eventId,'PUT',{ignore:true});assert.equal(ignored.status,200);assert.equal(ignored.body.session.itemCount,5);assert.equal(ignored.body.events[1].line,lines[0]);
  const [a,b]=await Promise.all([h.call('/api/captures/'+session.id+'/prepare','POST',{}),h.call('/api/captures/'+session.id+'/prepare','POST',{}, {user:{id:'second',role:'admin'},csrfToken:'test-csrf'})]);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.status,200,JSON.stringify(b.body));assert.equal(a.body.draftId,b.body.draftId);
  assert.equal(h.DB.raw.prepare("SELECT match_status FROM loot_draft_items WHERE name='Kylong GreavesIndium Ore'").get().match_status,'needs_review');
  assert.equal((await h.call('/api/captures/'+session.id+'/events/'+items[0].eventId,'PUT',{ignore:true})).status,409);
 }finally{h.close();}
});

test('revoked, expired and demoted-creator credentials stop ingestion without discarding captured evidence',async()=>{
 const h=await fixture();try{
  const a=await h.create();assert.equal((await h.call('/api/captures/'+a.session.id+'/revoke','POST',{})).status,200);assert.equal((await h.native(a.pairing.token,'/api/companion/session')).status,410);
  const b=await h.create();h.setTime(Date.parse(b.session.expiresAt));assert.equal((await h.native(b.pairing.token,'/api/companion/session')).status,410);
  const c=await h.create();h.DB.raw.prepare("UPDATE users SET role='member' WHERE id='owner'").run();assert.equal((await h.native(c.pairing.token,'/api/companion/session')).status,401);
 }finally{h.close();}
});

test('a revocation losing to preparation cannot report success or create a false revocation audit',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create();assert.equal((await h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:h.events()})).status,200);
  const batch=h.DB.batch.bind(h.DB);let release,started;
  const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  h.DB.batch=async statements=>{if(statements.some(s=>s.query.includes("SET status='revoked'"))){started();await held;}return batch(statements);};
  const revoke=h.call('/api/captures/'+session.id+'/revoke','POST',{});await ready;
  const prepared=await h.call('/api/captures/'+session.id+'/prepare','POST',{});assert.equal(prepared.status,200);release();
  assert.equal((await revoke).status,409);
  assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM audit WHERE action='loot_capture_revoked'").get().n,0);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM loot_drafts').get().n,1);
 }finally{h.close();}
});

test('raw capture bytes are bounded before the next complete upload and prior evidence remains preparable',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create();const line="[Thu Nov 12 00:28:33 2026] You tell abfloot:4, '"+'|'.repeat(16000)+"Sample Ring'";
  const send=async(start,count)=>h.native(pairing.token,undefined,{watcherId:'fixture-watcher',events:Array.from({length:count},(_,i)=>({eventId:(start+i+1).toString(16).padStart(64,'0'),offset:(start+i)*17000,fileName:'eqlog_Fixture_test.txt',line}))});
  assert.equal((await send(0,16)).status,200);assert.equal((await send(16,16)).status,200);
  assert.equal((await send(32,1)).status,409);
  assert.equal((await h.call('/api/captures/'+session.id)).body.events.length,32);
  const result=await h.call('/api/captures/'+session.id+'/prepare','POST',{});assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(h.DB.raw.prepare('SELECT quantity FROM loot_draft_items WHERE draft_id=?').get(result.body.draftId).quantity,32);
 }finally{h.close();}
});

test('reconnecting rotates an expired token while preserving capture identity, existing evidence and retry keys',async()=>{
 const h=await fixture();try{
  const {session,pairing}=await h.create(),body={watcherId:'fixture-watcher',events:h.events()};
  assert.equal((await h.native(pairing.token,undefined,body)).body.accepted,3);
  h.setTime(Date.parse(session.expiresAt));assert.equal((await h.native(pairing.token,'/api/companion/session')).status,410);
  const repaired=await h.call('/api/captures/'+session.id+'/pair','POST',{});assert.equal(repaired.status,200);assert.equal(repaired.body.pairing.captureId,session.id);assert.notEqual(repaired.body.pairing.token,pairing.token);
  assert.equal((await h.native(pairing.token,'/api/companion/session')).status,401);
  const retried=await h.native(repaired.body.pairing.token,undefined,body);assert.equal(retried.status,200);assert.equal(retried.body.accepted,0);assert.equal(retried.body.duplicates,3);
  const prepared=await h.call('/api/captures/'+session.id+'/prepare','POST',{});assert.equal(prepared.status,200);
  assert.equal((await h.call('/api/captures/'+session.id+'/pair','POST',{})).status,409);
 }finally{h.close();}
});
