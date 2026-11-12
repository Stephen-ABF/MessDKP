import test from 'node:test';import assert from 'node:assert/strict';import worker from '../dist/server/index.js';import {createD1} from './d1-adapter.mjs';import {applicationSchema} from './app-schema.mjs';
test('production boundary enforces management ACL and CSRF while early results use normal officer-confirmed charges',async()=>{
 const DB=createD1(await applicationSchema()),origin='https://auction-management.test';
 const call=async(path,method='GET',body,auth,csrf=true)=>{const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},{});return{status:r.status,body:await r.json(),headers:r.headers};};
 const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body;};
 const register=async name=>{const r=await call('/api/register','POST',{name,email:name+'@fixture.invalid',password:'Disposable management QA123!'});ok(r);return{...r.body,cookie:r.headers.get('set-cookie').split(';')[0]};};
 try{
  const admin=await register('Administrator'),member=await register('Member'),manager=await register('Manager');
  const main=ok(await call('/api/characters','POST',{name:'Bidhero',level:100,className:'Cleric'},member));ok(await call('/api/claims/'+main.claim.id+'/approve','POST',{kind:'main'},admin));DB.raw.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run('prior-balance',main.character.id,null,100,'Existing balance',admin.user.id,'2026-11-12','prior-balance');
  DB.raw.prepare("INSERT INTO item_references(item_id,name,classes_json,slots_json,source_url,retrieved_at,verification_method,metadata_status) VALUES(900001,'Synthetic test helmet','[\"ALL\"]','[\"HEAD\"]','https://items.eqresource.com/items.php?id=900001','now','fixture','verified_reference')").run();
  const entry=ok(await call('/api/access','GET',undefined,admin)).users.find(u=>u.id===manager.user.id);ok(await call('/api/access/users/'+manager.user.id,'PUT',{profileId:'member',overrides:{auctionAdmin:3,auctions:0},expectedRevision:entry.revision},admin));
  const a=ok(await call('/api/auctions','POST',{itemId:900001,quantity:1},manager)).auction;
  assert.deepEqual(a.slots,['HEAD']);ok(await call('/api/auctions/'+a.id+'/bid','PUT',{amount:20},member));
  const action={reason:'Immediate officer testing',confirm:true,idempotencyKey:'integration-early-complete'};
  assert.equal((await call('/api/auctions/'+a.id+'/complete-early','POST',action,member)).status,403);
  assert.equal((await call('/api/auctions/'+a.id+'/complete-early','POST',action,manager,false)).status,403);
  const results=ok(await call('/api/auctions/'+a.id+'/complete-early','POST',action,manager));assert.equal(results.auction.status,'closed');assert.equal(results.awards.length,1);assert.equal(results.awards[0].price,1);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,1);
  ok(await call('/api/auctions/'+a.id+'/awards/'+main.character.id+'/confirm','POST',undefined,manager));assert.equal(DB.raw.prepare('SELECT SUM(amount) n FROM ledger').get().n,99);
  const b=ok(await call('/api/auctions','POST',{itemId:900001,quantity:1},manager)).auction;ok(await call('/api/auctions/'+b.id+'/bid','PUT',{amount:10},member));
  const cancelled=ok(await call('/api/auctions/'+b.id+'/cancel','POST',{...action,idempotencyKey:'integration-cancel'},manager));assert.equal(cancelled.auction.status,'cancelled');assert.equal(cancelled.bids,null);
  const history=ok(await call('/api/loot/items/900001/history','GET',undefined,member));assert.equal(history.auctions.find(row=>row.id===b.id).status,'cancelled');assert.equal(history.auctions.find(row=>row.id===b.id).bids,null);
  assert.equal(ok(await call('/api/auctions?slot=HEAD&status=cancelled','GET',undefined,manager)).auctions.length,1);
  const fresh=ok(await call('/api/access','GET',undefined,admin)).users.find(u=>u.id===manager.user.id);ok(await call('/api/access/users/'+manager.user.id,'PUT',{profileId:'member',overrides:{auctionAdmin:0},expectedRevision:fresh.revision},admin));
  assert.equal((await call('/api/auctions/'+b.id+'/cancel','POST',{...action,idempotencyKey:'integration-cancel'},manager)).status,403);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM auction_admin_actions').get().n,2);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM access_operation_guards').get().n,0);
 }finally{DB.close();}
});
