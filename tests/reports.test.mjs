import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createD1 } from './d1-adapter.mjs';
import { handleReportsApi } from '../worker/reports.mjs';

const schema = await readFile(new URL('../worker/schema.sql', import.meta.url), 'utf8');
function fixture() {
 const DB = createD1(schema);
 // Match D1's SELECT-batch result contract without editing the shared adapter here.
 const batch = DB.batch;
 DB.batch = async statements => {
  if (!statements.every(s=>/^SELECT\b/i.test(s.query.trim()))) return batch(statements);
  DB.raw.exec('BEGIN');
  try { const result=statements.map(s=>({success:true,results:DB.raw.prepare(s.query).all(...s.params).map(row=>({...row})),meta:{}}));DB.raw.exec('COMMIT');return result; }
  catch(error){DB.raw.exec('ROLLBACK');throw error;}
 };
 const addUser = id => DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@example.test','Member '+id,'test','test','member','2024-01-01');
 addUser('officer');
 const character = (id, kind='main', owner=id, cls='Cleric') => {
  if(owner && owner!=='officer')addUser(owner);
  DB.raw.prepare('INSERT INTO characters(id,name_key,name,level,class_name,guild_rank,kind,owner_id,approved_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,id.toLowerCase(),id,85,cls,'Raider',kind,owner,owner?'2024-01-01':null);
  return id;
 };
 const raid = (id,date,count,sourceDate=date) => {
  DB.raw.prepare('INSERT INTO raids(id,name,date,rate,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id,'Raid '+id,date,5,'officer',date+'T20:00:00Z');
  const ticks=[];
  for(let i=0;i<count;i++) {
   const tick=id+'-tick-'+i;
   DB.raw.prepare('INSERT INTO ticks(id,raid_id,source_key,file_name,source_time,content_hash,raw_text,row_count,created_at,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(tick,id,tick,tick+'.txt',sourceDate+'T23:59:59','hash','raw original dump',1,date+'T20:00:00Z',tick);
   ticks.push(tick);
  }
  return ticks;
 };
 const credit = (characterId,tick,status='credited') => {
  const id=characterId+'-'+tick;
  DB.raw.prepare('INSERT INTO attendance(id,tick_id,character_id,class_name,zone,status,dkp) VALUES(?,?,?,?,?,?,?)').run(id,tick,characterId,'Cleric','Test zone',status,5);
  if(status==='credited')DB.raw.prepare('INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?,?)').run(id,characterId,id,5,'Attendance tick','officer','2024-01-01',id);
  return id;
 };
 const adjust = (characterId,amount,id='adjustment') => DB.raw.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?)').run(id,characterId,amount,'Officer adjustment','officer','2027-01-01',id);
 const call = async(path='/api/reports/mains?asOf=2026-11-11',auth={user:{id:'officer',role:'member'}},method='GET') => {
  const response=await handleReportsApi(new Request('https://guild.test'+path,{method}),{DB},auth);
  return response?{response,body:await response.json()}:null;
 };
 return {DB,character,raid,credit,adjust,call,close:()=>DB.close()};
}

test('summary groups every approved main by class with current zero and negative DKP, excluding alts and unclaimed records',async()=>{
 const h=fixture();try {
  h.character('Zelda','main','zelda','CLR');h.character('Arden','main','arden','Cleric');h.character('Briar','main','briar','ShadowKnight');
  h.character('Alt','alt','alt','Wizard');h.character('Unclaimed','unclassified',null,'Cleric');h.character('UnownedMain','main',null,'Bard');
  h.adjust('Zelda',-25,'negative');h.adjust('Alt',100,'alt-balance');
  const {response,body}=await h.call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(body.classGroups.map(g=>g.className),['Cleric','Shadow Knight']);assert.deepEqual(body.classGroups[0].mains.map(m=>m.name),['Arden','Zelda']);
  assert.equal(body.mains.length,3);assert.equal(body.mains.find(m=>m.name==='Zelda').balance,-25);assert.equal(body.mains.find(m=>m.name==='Arden').balance,0);
  assert.equal(body.mains.find(m=>m.name==='Briar').sourceClassName,'ShadowKnight');assert.equal(JSON.stringify(body).includes('@example.test'),false);
  assert.equal(body.mains[0].windows.days30.percentage,null);assert.equal(body.windows.days30.totalTicks,0);
 }finally{h.close();}
});

test('three of six ticks is fifty percent and six of six is one hundred; window totals weight ticks instead of raid percentages',async()=>{
 const h=fixture();try {
  h.character('Half');h.character('Full');const six=h.raid('six','2026-11-09',6);const one=h.raid('one','2026-11-10',1);
  six.slice(0,3).forEach(t=>h.credit('Half',t));six.forEach(t=>h.credit('Full',t));h.credit('Half',one[0]);
  const summary=(await h.call()).body;assert.deepEqual(summary.mains.find(m=>m.name==='Half').windows.days30,{attendedTicks:4,totalTicks:7,percentage:57.14});
  const detail=(await h.call('/api/reports/mains/Half/attendance?asOf=2026-11-11')).body;
  assert.deepEqual(detail.raids.map(r=>[r.name,r.attendedTicks,r.totalTicks,r.percentage]),[['Raid one',1,1,100],['Raid six',3,6,50]]);
  assert.equal((await h.call('/api/reports/mains/Full/attendance?asOf=2026-11-11')).body.raids.find(r=>r.id==='six').percentage,100);
 }finally{h.close();}
});

test('30,60,90 day bounds include the exact first day across leap February and exclude future raids',async()=>{
 const h=fixture();try {
  h.character('Main');
  const dates=['2024-03-01','2024-02-01','2024-01-31','2024-01-02','2024-01-01','2023-12-03','2023-12-02','2024-03-02'];
  dates.forEach((date,i)=>h.credit('Main',h.raid('r'+i,date,1)[0]));
  const body=(await h.call('/api/reports/mains?asOf=2024-03-01')).body;
  assert.equal(body.windows.days30.startDate,'2024-02-01');assert.equal(body.windows.days60.startDate,'2024-01-02');assert.equal(body.windows.days90.startDate,'2023-12-03');
  assert.deepEqual(Object.values(body.windows).map(w=>w.totalTicks),[2,4,6,7]);
  assert.deepEqual(Object.values(body.mains[0].windows).map(w=>w.attendedTicks),[2,4,6,7]);
  assert.ok(Object.values(body.mains[0].windows).every(w=>w.percentage===100));
 }finally{h.close();}
});

test('reporting uses raid calendar dates rather than timezone-unconfirmed source captures and keeps DKP current',async()=>{
 const h=fixture();try {
  h.character('Main');h.credit('Main',h.raid('inside','2026-11-11',1,'2026-11-12')[0]);h.credit('Main',h.raid('future','2026-11-12',1,'2026-11-11')[0]);h.adjust('Main',-30);
  const body=(await h.call()).body;assert.equal(body.mains[0].balance,-20);assert.deepEqual(body.mains[0].windows.days30,{attendedTicks:1,totalTicks:1,percentage:100});
  const detail=(await h.call('/api/reports/mains/Main/attendance?asOf=2026-11-11')).body;assert.equal(detail.raids.length,1);assert.equal(detail.raids[0].id,'inside');
 }finally{h.close();}
});

test('corrected credited attendance counts once while pending,ineligible and empty raid drafts do not inflate check-ins',async()=>{
 const h=fixture();try {
  h.character('Main');h.raid('empty','2026-11-11',0);const ticks=h.raid('actual','2026-11-11',3);
  const corrected=h.credit('Main',ticks[0],'pending');h.credit('Main',ticks[1],'pending');h.credit('Main',ticks[2],'ineligible');
  h.DB.raw.prepare("UPDATE attendance SET status='credited',zone='Officer correction' WHERE id=?").run(corrected);
  h.DB.raw.prepare('INSERT INTO ledger(id,character_id,attendance_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?,?)').run('correction','Main',corrected,5,'Missing attendance correction','officer','2026-11-11','correction');
  const body=(await h.call()).body;assert.deepEqual(body.mains[0].windows.days30,{attendedTicks:1,totalTicks:3,percentage:33.33});
  assert.equal((await h.call('/api/reports/mains/Main/attendance?asOf=2026-11-11')).body.raids.length,1);
  const before=h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n;await h.call();assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,before);
 }finally{h.close();}
});

test('approved mains with no check-ins receive zero of actual guild ticks and historical opportunities are not silently prorated',async()=>{
 const h=fixture();try {
  h.character('Absent');h.DB.raw.prepare("UPDATE characters SET approved_at='2026-11-11' WHERE id='Absent'").run();h.raid('past','2026-10-20',2);h.raid('today','2026-11-11',4);
  const body=(await h.call()).body;assert.deepEqual(body.mains[0].windows.days30,{attendedTicks:0,totalTicks:6,percentage:0});assert.equal(body.denominator,'all_guild_ticks_in_window');
 }finally{h.close();}
});

test('authenticated reads are required and unsupported methods, invalid dates and non-main details fail explicitly',async()=>{
 const h=fixture();try {
  h.character('Alt','alt','alt');assert.equal((await h.call('/api/reports/mains',{})).response.status,401);
  const post=await h.call('/api/reports/mains',undefined,'POST');assert.equal(post.response.status,405);assert.equal(post.response.headers.get('allow'),'GET');
  for(const date of ['2026-02-29','2024-02-30','2026-13-01','11/11/2026','0000-01-01','99999-01-01',''])assert.equal((await h.call('/api/reports/mains?asOf='+encodeURIComponent(date))).response.status,400,date);
  assert.equal((await h.call('/api/reports/mains?asOf=2026-11-11&asOf=2026-11-12')).response.status,400);
  assert.equal((await h.call('/api/reports/mains/Alt/attendance?asOf=2026-11-11')).response.status,404);
  assert.equal((await h.call('/api/reports/mains/%27%20OR%201%3D1/attendance?asOf=2026-11-11')).response.status,404);
  assert.equal(await h.call('/api/unrelated'),null);
  const tiny=(await h.call('/api/reports/mains?asOf=0001-01-01')).body;assert.equal(tiny.windows.days90.startDate,'0001-01-01');
 }finally{h.close();}
});

test('zero-main and zero-tick reports remain meaningful and the optional date defaults to the UTC calendar',async()=>{
 const h=fixture();try {
  const body=(await h.call('/api/reports/mains')).body;assert.equal(body.asOf,new Date().toISOString().slice(0,10));assert.deepEqual(body.mains,[]);assert.deepEqual(body.classGroups,[]);assert.equal(body.windows.allTime.totalTicks,0);
 }finally{h.close();}
});
