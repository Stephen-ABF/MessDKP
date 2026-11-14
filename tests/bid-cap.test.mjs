import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAuctionApi} from '../worker/auctions.mjs';
import {ITEM_REFERENCE_SCHEMA_SQL} from '../worker/items.mjs';
import {createD1} from './d1-adapter.mjs';
const read=name=>readFileSync(new URL('../worker/'+name,import.meta.url),'utf8');
const origin='https://guild.test';
function fixture(){
 const DB=createD1([read('schema.sql'),ITEM_REFERENCE_SCHEMA_SQL,read('auctions.sql'),read('auction-management.sql'),read('admin.sql')].join('\n'));
 let time=Date.parse('2026-11-12T18:00:00Z');const api=createAuctionApi({clock:()=>time});
 const users={officer:{id:'officer',role:'admin'},member:{id:'member',role:'member'},other:{id:'other',role:'member'}};
 for(const u of Object.values(users))DB.raw.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES(?,?,?,?,?,?,?)').run(u.id,u.id+'@fixture.test',u.id,'fixture','fixture',u.role,new Date(time).toISOString());
 for(const[who,amount]of[['member',35],['other',80]]){
  DB.raw.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)').run('char-'+who,who,who,85,'Monk','Raider','main',who,new Date(time).toISOString());
  DB.raw.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?)').run('opening-'+who,'char-'+who,amount,'Fixture opening balance','officer',new Date(time).toISOString(),'opening-'+who);
 }
 DB.raw.prepare('INSERT INTO item_references(item_id,name,source_url,retrieved_at,verification_method,metadata_status) VALUES(?,?,?,?,?,?)').run(1,'Fixture Ring','https://items.eqresource.com/items.php?id=1',new Date(time).toISOString(),'fixture','unresolved');
 const call=async(path,method='GET',data,who='member')=>{const r=await api(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'token'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB},{user:users[who],csrfToken:'token'});return{status:r.status,body:await r.json()};};
 const create=async(minimumBid=1)=>{const r=await call('/api/auctions','POST',{itemId:1,quantity:1,minimumBid},'officer');assert.equal(r.status,201,JSON.stringify(r));return r.body.auction;};
 const bid=(a,amount,who='member')=>call('/api/auctions/'+a.id+'/bid','PUT',{amount},who);
 const withdraw=a=>call('/api/auctions/'+a.id+'/bid','DELETE');
 const close=async a=>{time=Date.parse(a.closesAt);const r=await call('/api/auctions/'+a.id+'/close','POST',undefined,'officer');assert.equal(r.status,200,JSON.stringify(r));return r.body;};
 const adjust=(amount,who='member')=>DB.raw.prepare('INSERT INTO ledger(id,character_id,amount,reason,actor_id,created_at,operation_id) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'char-'+who,amount,'Fixture separate transaction','officer',new Date(time).toISOString(),crypto.randomUUID());
 const balance=(who='member')=>DB.raw.prepare('SELECT SUM(amount) n FROM ledger WHERE character_id=?').get('char-'+who).n;
 return{DB,call,create,bid,withdraw,close,adjust,balance,dispose(){DB.close();}};
}

test('a single new or edited bid cannot exceed the current balance, and rejection preserves accepted evidence and priority',async()=>{const h=fixture();try{
 const a=await h.create();assert.equal(a.ownEligibility.balance,null);
 const first=await h.bid(a,35);assert.equal(first.status,200);assert.equal(first.body.auction.ownEligibility.balance,35);assert.equal(first.body.auction.ownEligibility.maxBid,35);
 const events=h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n;
 const rejected=await h.bid(a,36);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'bid_exceeds_balance');assert.equal(rejected.body.balance,35);assert.equal(rejected.body.maxBid,35);
 const again=await h.call('/api/auctions/'+a.id);assert.equal(again.body.auction.ownBid.amount,35);assert.equal(again.body.auction.ownBid.firstSubmittedAt,first.body.ownBid.firstSubmittedAt);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n,events);assert.equal(h.balance(),35);
 assert.equal((await h.bid(a,34)).status,200);
}finally{h.dispose();}});

test('independent auctions each allow the full balance without reservations and confirmed awards may later make it negative',async()=>{const h=fixture();try{
 const a=await h.create(35),b=await h.create(35);
 const before=h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n;
 const results=await Promise.all([h.bid(a,35),h.bid(b,35)]);assert.ok(results.every(r=>r.status===200));assert.equal(h.balance(),35);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM ledger').get().n,before);
 for(const auction of[a,b]){const closed=await h.close(auction);assert.equal(closed.awards[0].winningBid,35);assert.equal(closed.awards[0].price,35);assert.equal(closed.awards[0].status,'pending');}
 assert.equal(h.balance(),35);
 for(const auction of[a,b])assert.equal((await h.call('/api/auctions/'+auction.id+'/awards/char-member/confirm','POST',undefined,'officer')).status,200);
 assert.equal(h.balance(),-35);
 assert.equal(h.DB.raw.prepare("SELECT COUNT(*) n FROM ledger WHERE reason LIKE 'Auction award:%'").get().n,2);
}finally{h.dispose();}});

test('zero and negative balance prevent positive bids but never prevent withdrawing an already accepted bid',async()=>{const h=fixture();try{
 const a=await h.create();assert.equal((await h.bid(a,35)).status,200);
 h.adjust(-35);const zero=await h.bid(a,1);assert.equal(zero.status,409);assert.equal(zero.body.maxBid,0);assert.equal(zero.body.balance,0);
 h.adjust(-5);const negative=await h.bid(a,35);assert.equal(negative.status,409);assert.equal(negative.body.balance,-5);assert.equal(negative.body.maxBid,0);
 const detail=await h.call('/api/auctions/'+a.id);assert.equal(detail.body.auction.ownEligibility.eligible,true);assert.equal(detail.body.auction.ownBid.amount,35);
 const withdrawn=await h.withdraw(a);assert.equal(withdrawn.status,200);assert.equal(withdrawn.body.withdrawn,true);assert.equal(withdrawn.body.auction.ownBid,null);assert.equal(h.balance(),-5);
 assert.deepEqual(h.DB.raw.prepare('SELECT action FROM auction_bid_events ORDER BY sequence').all().map(e=>e.action),['place','withdraw']);
}finally{h.dispose();}});

test('a balance decrease between preflight and the atomic write rejects a late bid with no accepted event or projection',async()=>{const h=fixture();try{
 const a=await h.create(),original=h.DB.batch.bind(h.DB);let raced=false;
 h.DB.batch=async statements=>{if(!raced&&statements.some(s=>s.query?.startsWith('INSERT INTO auction_bid_events'))){raced=true;h.adjust(-1);}return original(statements);};
 const r=await h.bid(a,35);assert.equal(raced,true);assert.equal(r.status,409);assert.equal(r.body.code,'bid_exceeds_balance');assert.equal(r.body.balance,34);assert.equal(r.body.maxBid,34);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n,0);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bids').get().n,0);assert.equal(h.balance(),34);
}finally{h.dispose();}});

test('a raced over-cap edit cannot alter the prior bid or its tie priority',async()=>{const h=fixture();try{
 const a=await h.create();const first=await h.bid(a,20);assert.equal(first.status,200);
 const original=h.DB.batch.bind(h.DB);let raced=false;
 h.DB.batch=async statements=>{if(!raced&&statements.some(s=>s.query?.startsWith('INSERT INTO auction_bid_events'))){raced=true;h.adjust(-6);}return original(statements);};
 const r=await h.bid(a,30);assert.equal(r.status,409);assert.equal(r.body.maxBid,29);
 const after=await h.call('/api/auctions/'+a.id);assert.equal(after.body.auction.ownBid.amount,20);assert.equal(after.body.auction.ownBid.firstSubmittedAt,first.body.ownBid.firstSubmittedAt);
 assert.equal(h.DB.raw.prepare('SELECT COUNT(*) n FROM auction_bid_events').get().n,1);
}finally{h.dispose();}});

test('viewer-specific balance and maximum never disclose another sealed bid or bidder balance',async()=>{const h=fixture();try{
 const a=await h.create();assert.equal((await h.bid(a,35)).status,200);assert.equal((await h.bid(a,70,'other')).status,200);
 const officer=await h.call('/api/auctions/'+a.id,'GET',undefined,'officer');assert.equal(officer.body.bids,null);assert.deepEqual(officer.body.awards,[]);assert.equal(officer.body.auction.ownEligibility.balance,null);assert.equal(officer.body.auction.ownEligibility.maxBid,0);
 assert.doesNotMatch(JSON.stringify(officer.body),/"amount":(?:35|70)|"balance":(?:35|80)|"maxBid":(?:35|80)/);
 const own=await h.call('/api/auctions/'+a.id);assert.equal(own.body.auction.ownEligibility.balance,35);assert.equal(own.body.auction.ownEligibility.maxBid,35);assert.doesNotMatch(JSON.stringify(own.body),/"amount":70|"balance":80|"maxBid":80/);
}finally{h.dispose();}});
