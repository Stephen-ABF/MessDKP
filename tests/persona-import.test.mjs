import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../worker/api.mjs';
import {applicationSchema} from './app-schema.mjs';
import {createD1} from './d1-adapter.mjs';
const origin='https://guild.test';
function row(name,level,className,rank,zone='Guild Hall'){return[name,String(level),className,rank,'','11/12/26',zone,'','','on','off','0','','',''].join('\t');}
function capture(time,text){return{name:'Demo_test-20261112-'+time+'.txt',text};}
async function fixture(){
 const DB=createD1(await applicationSchema());
 const call=async(path,method='GET',data,auth)=>{const response=await handleApi(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB,FEATURE_OWNERSHIP:true,FEATURE_AUCTIONS:true});return{status:response.status,body:await response.json(),headers:response.headers};};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@persona.test',password:'Persona import fixture password123!'});assert.equal(r.status,201);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const officer=await register('Officer'),member=await register('Member');
 const raid=await call('/api/raids','POST',{name:'Persona test raid',date:'2026-11-12',rate:5},officer);assert.equal(raid.status,201);
 const upload=async(files,commit=true)=>call('/api/raids/'+raid.body.raid.id+'/import','POST',{files,commit},officer);
 return{DB,call,officer,member,upload,raid:raid.body.raid,close(){DB.close();}};
}

test('later persona class, level, rank and name case retain the approved registry identity and tick credit',async()=>{const h=await fixture();try{
 const first=capture('180000',row('Personaone',85,'Bard','Raider'));
 assert.equal((await h.upload([first])).status,200);
 const character=(await h.call('/api/characters','GET',undefined,h.member)).body.characters[0];
 const requested=await h.call('/api/claims','POST',{characterId:character.id},h.member);assert.equal(requested.status,201);
 assert.equal((await h.call('/api/claims/'+requested.body.claim.id+'/approve','POST',{kind:'main'},h.officer)).status,200);
 const before=h.DB.raw.prepare('SELECT * FROM characters WHERE id=?').get(character.id);
 const second=capture('181500',row('PERSONAONE',110,'Enchanter','Officer','Plane of Knowledge'));
 const preview=await h.upload([second],false);assert.equal(preview.status,200);assert.deepEqual(preview.body.files[0].warnings,[]);assert.equal(preview.body.files[0].eligibleMains,1);
 assert.deepEqual(h.DB.raw.prepare('SELECT * FROM characters WHERE id=?').get(character.id),before);
 const posted=await h.upload([second]);assert.equal(posted.status,200);assert.equal(posted.body.creditedDkp,5);assert.deepEqual(posted.body.files[0].warnings,[]);
 assert.deepEqual(h.DB.raw.prepare('SELECT * FROM characters WHERE id=?').get(character.id),before);
 const attendance=h.DB.raw.prepare('SELECT class_name,status,dkp,zone FROM attendance ORDER BY rowid').all();assert.deepEqual(attendance.map(a=>[a.class_name,a.status,a.dkp]),[['Bard','credited',5],['Bard','credited',5]]);assert.equal(attendance[1].zone,'Plane of Knowledge');
 assert.equal(h.DB.raw.prepare('SELECT SUM(amount) balance FROM ledger WHERE character_id=?').get(character.id).balance,10);
 assert.equal(h.DB.raw.prepare('SELECT raw_text FROM ticks WHERE file_name=?').get(second.name).raw_text,second.text);
 assert.match(second.text,/Enchanter\tOfficer/);assert.equal(before.owner_id,h.member.user.id);assert.equal(before.kind,'main');
}finally{h.close();}});

test('unclaimed registry metadata is seeded once and later persona captures stay pending with canonical class',async()=>{const h=await fixture();try{
 const first=capture('180000',row('Unclaimedhero',50,'Cleric','Recruit'));
 const second=capture('181500',row('Unclaimedhero',90,'Necromancer','Veteran')+'\n'+row('Newfighter',70,'Warrior','Recruit'));
 const imported=await h.upload([first,second]);assert.equal(imported.status,200);assert.equal(imported.body.creditedDkp,0);assert.ok(imported.body.files.every(f=>f.warnings.length===0));
 const registry=(await h.call('/api/characters','GET',undefined,h.member)).body.characters;
 const original=registry.find(c=>c.name==='Unclaimedhero'),newCharacter=registry.find(c=>c.name==='Newfighter');
 assert.equal(original.level,50);assert.equal(original.className,'Cleric');assert.equal(original.rank,'Recruit');assert.equal(original.ownerId,null);assert.equal(original.kind,'unclassified');assert.equal(original.pendingTicks,2);
 assert.equal(newCharacter.level,70);assert.equal(newCharacter.className,'Warrior');assert.equal(newCharacter.rank,'Recruit');assert.equal(newCharacter.ownerId,null);
 assert.deepEqual(h.DB.raw.prepare('SELECT class_name,status FROM attendance WHERE character_id=? ORDER BY rowid').all(original.id).map(a=>[a.class_name,a.status]),[['Cleric','pending'],['Cleric','pending']]);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
 assert.equal(h.DB.raw.prepare('SELECT raw_text FROM ticks WHERE file_name=?').get(second.name).raw_text,second.text);
}finally{h.close();}});

test('manually requested characters keep their registry class and metadata on their first attendance capture',async()=>{const h=await fixture();try{
 const request=await h.call('/api/characters','POST',{name:'Requestedhero',level:75,className:'Ranger'},h.member);assert.equal(request.status,201);
 const before=h.DB.raw.prepare('SELECT * FROM characters WHERE id=?').get(request.body.character.id);
 const file=capture('180000',row('Requestedhero',100,'Beastlord','Raider'));
 const imported=await h.upload([file]);assert.equal(imported.status,200);assert.deepEqual(imported.body.files[0].warnings,[]);assert.equal(imported.body.creditedDkp,0);
 assert.deepEqual(h.DB.raw.prepare('SELECT * FROM characters WHERE id=?').get(request.body.character.id),before);
 assert.equal(h.DB.raw.prepare('SELECT class_name FROM attendance').get().class_name,'Ranger');
 assert.equal(h.DB.raw.prepare('SELECT status FROM claims WHERE id=?').get(request.body.claim.id).status,'pending');
 assert.equal(h.DB.raw.prepare('SELECT raw_text FROM ticks').get().raw_text,file.text);
}finally{h.close();}});
