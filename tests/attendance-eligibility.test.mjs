import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createD1} from './d1-adapter.mjs';
import {handleReportsApi} from '../worker/reports.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
function fixture(migrate=true){
 const DB=createD1(read('schema.sql')+(migrate?'\n'+read('attendance-eligibility.sql'):''));
 DB.raw.exec("INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('officer','officer@fixture.test','Officer','x','x','admin','2026-11-12');INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('member','member@fixture.test','Member','x','x','member','2026-11-12');");
 const character=(id,owned=true)=>DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run(id,id,id,85,'Cleric','Raider',owned?'main':'unclassified',owned?'member':null,owned?'2026-12-01':null);
 const raid=(id,date,times,sourceDate=date)=>{DB.raw.prepare('INSERT INTO raids VALUES(?,?,?,?,?,?)').run(id,id,date,5,'officer',date+'T00:00:00Z');return times.map((time,i)=>{const tick=id+'-'+i;DB.raw.prepare('INSERT INTO ticks VALUES(?,?,?,?,?,?,?,?,?,?)').run(tick,id,tick,tick+'.txt',sourceDate+'T'+time,'hash','raw',1,date+'T23:00:00Z',tick);return tick;});};
 const attend=(id,tick,status='pending')=>DB.raw.prepare('INSERT INTO attendance VALUES(?,?,?,?,?,?,?)').run(id+'-'+tick,tick,id,'Cleric','Test zone',status,5);
 const claim=(id,createdAt)=>DB.raw.prepare('INSERT INTO claims(id,character_id,user_id,created_at) VALUES(?,?,?,?)').run('claim-'+id,id,'member',createdAt);
 const report=async(id,asOf='2026-11-12')=>{const response=await handleReportsApi(new Request('https://guild.test/api/reports/mains/'+id+'/attendance?asOf='+asOf),{DB},{user:{id:'officer'}});assert.equal(response.status,200);return response.json();};
 return {DB,character,raid,attend,claim,report,close(){DB.close();}};
}

test('first unclaimed capture starts eligibility at that exact tick, excluding prior years and earlier same-night ticks',async()=>{const h=fixture();try{
 h.character('Recruit',false);h.raid('old','2024-11-12',['18:00:00','18:15:00']);const ticks=h.raid('today','2026-11-12',['18:00:00','18:15:00','18:30:00']);
 h.attend('Recruit',ticks[1]);assert.equal(h.DB.raw.prepare('SELECT start_at FROM character_attendance_eligibility').get().start_at,'2026-11-12T18:15:00');
 h.claim('Recruit','2026-12-01T14:00:00.000Z');h.DB.raw.prepare("UPDATE characters SET kind='main',owner_id='member',approved_at='2026-12-01' WHERE id='Recruit'").run();
 h.DB.raw.prepare("UPDATE attendance SET status='credited'").run();
 const data=await h.report('Recruit');assert.equal(data.main.attendanceStartSource,'attendance_capture');
 for(const window of Object.values(data.main.windows))assert.deepEqual(window,{attendedTicks:1,totalTicks:2,percentage:50});
 assert.deepEqual(data.raids.map(r=>[r.id,r.attendedTicks,r.totalTicks]),[['today',1,2]]);assert.equal(data.windows.allTime.totalTicks,5);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});

test('manual character creation starts opportunities before first attendance and never uses later approval time',async()=>{const h=fixture();try{
 h.character('Recruit');h.claim('Recruit','2026-11-12T18:10:00.000Z');h.raid('today','2026-11-12',['18:00:00','18:15:00','18:30:00']);
 const data=await h.report('Recruit');assert.equal(data.main.attendanceStartAt,'2026-11-12T18:10:00');assert.equal(data.main.attendanceStartSource,'registry_request');assert.deepEqual(data.main.windows.days30,{attendedTicks:0,totalTicks:2,percentage:0});assert.equal(data.raids[0].totalTicks,2);
}finally{h.close();}});

test('legacy characters without dated registry or attendance evidence have unknown opportunities rather than historical penalties',async()=>{const h=fixture();try{
 h.character('Unknown');h.claim('Unknown','then');h.raid('past','2025-11-12',['18:00:00']);h.raid('today','2026-11-12',['18:00:00']);
 const data=await h.report('Unknown');assert.equal(data.main.attendanceStartAt,null);assert.deepEqual(data.main.windows.allTime,{attendedTicks:0,totalTicks:0,percentage:null});assert.deepEqual(data.raids,[]);
}finally{h.close();}});

test('backdated imports can establish earlier observed membership without changing attendance or balances',async()=>{const h=fixture();try{
 h.character('Recruit');h.claim('Recruit','2026-11-12T18:10:00.000Z');const old=h.raid('old','2026-10-20',['18:00:00','18:15:00']);const now=h.raid('today','2026-11-12',['18:00:00']);
 h.attend('Recruit',now[0],'credited');h.attend('Recruit',old[1],'pending');
 const data=await h.report('Recruit');assert.equal(data.main.attendanceStartAt,'2026-10-20T18:15:00');assert.equal(data.main.attendanceStartSource,'attendance_capture');assert.deepEqual(data.main.windows.allTime,{attendedTicks:1,totalTicks:2,percentage:50});
 assert.equal(h.DB.raw.prepare("SELECT status FROM attendance WHERE tick_id=?").get(old[1]).status,'pending');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
}finally{h.close();}});

test('capture eligibility keeps raid calendar authority when filename capture date differs',async()=>{const h=fixture();try{
 h.character('Recruit');const ticks=h.raid('recorded','2026-11-11',['18:00:00','18:15:00'],'2026-11-12');h.attend('Recruit',ticks[1],'credited');
 const data=await h.report('Recruit','2026-11-11');assert.equal(data.main.attendanceStartAt,'2026-11-11T18:15:00');assert.deepEqual(data.main.windows.days30,{attendedTicks:1,totalTicks:1,percentage:100});
}finally{h.close();}});

test('migration backfills earliest existing evidence and preserves the ledger and original raw capture',async()=>{const h=fixture(false);try{
 h.character('Imported',false);h.character('Manual',false);h.character('Unknown',false);const ticks=h.raid('old','2025-11-12',['18:00:00']);h.attend('Imported',ticks[0]);
 h.claim('Imported','2026-11-12T12:00:00.000Z');h.claim('Manual','2024-11-12T12:00:00.000Z');h.claim('Unknown','then');
 h.DB.raw.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run('previous','Imported',null,-75,'Previous award','officer','2025-11-12','prior');
 h.DB.raw.exec(read('attendance-eligibility.sql'));
 assert.deepEqual(h.DB.raw.prepare('SELECT character_id,start_at FROM character_attendance_eligibility ORDER BY character_id').all().map(r=>({...r})),[{character_id:'Imported',start_at:'2025-11-12T18:00:00'},{character_id:'Manual',start_at:'2024-11-12T12:00:00'}]);
 assert.equal(h.DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,-75);assert.equal(h.DB.raw.prepare('SELECT raw_text FROM ticks').get().raw_text,'raw');assert.equal(h.DB.raw.prepare('SELECT status FROM attendance').get().status,'pending');
}finally{h.close();}});

test('failed attendance transaction rolls eligibility evidence back with its source record',async()=>{const h=fixture();try{
 h.character('Recruit');const ticks=h.raid('today','2026-11-12',['18:00:00']);
 h.DB.raw.exec('BEGIN');h.attend('Recruit',ticks[0]);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM character_attendance_eligibility').get().n,1);h.DB.raw.exec('ROLLBACK');
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM character_attendance_eligibility').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM attendance').get().n,0);
}finally{h.close();}});
