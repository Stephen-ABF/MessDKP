import test from 'node:test';
import assert from 'node:assert/strict';
import realWorker from '../dist/server/index.js';
import {activeFixtureWorker} from './account-fixture.mjs';
const worker=activeFixtureWorker(realWorker);
import {createD1} from './d1-adapter.mjs';
import {applicationSchema} from './app-schema.mjs';
const origin='https://spell-names.test';
test('bundled item details resolve missing worn names from persisted reference while preserving uploaded focus names and raw stats',async()=>{
 const DB=createD1(await applicationSchema());
 try{
  const signup=await worker.fetch(new Request(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Fixture Owner',email:'effects@fixture.invalid',password:'Disposable effect integration123!'})}),{DB},{});assert.equal(signup.status,201);const identity=await signup.json(),cookie=signup.headers.get('set-cookie').split(';')[0];
  const header='itemclass|id|name|classes|races|slots|ac|hp|mana|endurance|astr|reclevel|worneffect|wornname|focuseffect|focusname';
  const data=header+'\n0|105313|Fixture Cowl|65535|65535|4|10|20|0|0|0|0|3660||33156|Current Uploaded Focus\n';
  const form=new FormData();form.set('file',new File([data],'synthetic-effects.txt'));form.set('expectedRevision','0');
  const uploaded=await worker.fetch(new Request(origin+'/api/catalog/import',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':identity.csrfToken},body:form}),{DB},{});assert.equal(uploaded.status,200);
  DB.raw.prepare("INSERT INTO spell_name_cache VALUES(1,'https://s3.amazonaws.com/raidloot/spells.csv.gz','2023-07-12T06:15:07Z','2026-11-12T00:00:00Z',?,2)").run('0'.repeat(64));
  DB.raw.prepare('INSERT INTO spell_name_entries VALUES(?,?)').run(3660,'Faerune');DB.raw.prepare('INSERT INTO spell_name_entries VALUES(?,?)').run(33156,'Older Reference Name');
  const detail=await worker.fetch(new Request(origin+'/api/items/105313',{headers:{Cookie:cookie}}),{DB},{}),body=await detail.json();assert.equal(detail.status,200);assert.ok(body.item.details.effects.includes('Worn: Faerune'));assert.ok(body.item.details.effects.includes('Focus: Current Uploaded Focus'));assert.ok(!body.item.details.effects.some(s=>/Older Reference|Spell #/.test(s)));assert.equal(body.item.stats.mana,0);assert.equal(body.item.stats.recommendedLevel,0);assert.equal(body.item.stats.ac,10);
  const listed=await worker.fetch(new Request(origin+'/api/items?q=105313',{headers:{Cookie:cookie}}),{DB},{}),list=await listed.json();assert.equal(listed.status,200);assert.equal(list.items[0].details,undefined);assert.equal(list.items[0].stats,undefined);assert.equal(list.items[0].name,'Fixture Cowl');
  const status=await worker.fetch(new Request(origin+'/api/catalog/spell-names',{headers:{Cookie:cookie}}),{DB},{});assert.equal(status.status,200);assert.equal((await status.json()).available,true);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM auction_awards').get().n,0);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 }finally{DB.close();}
});
