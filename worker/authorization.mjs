// The HTTP boundary owns area permissions. Resource owners are checked again by
// the underlying mutation. Guards keep access revocation atomic with each batch.
export class AuthorizationError extends Error {constructor(message='Your access profile does not permit this action.'){super(message);this.status=403;this.code='forbidden';}}
function level(access,area){const n=access?.permissions?.[area];return Number.isInteger(n)&&n>=0&&n<=3?n:0;}
const allowed=(access,area,minimum)=>level(access,area)>=minimum;
export async function authorizeRoute(request,db,auth){
 const path=new URL(request.url).pathname,method=request.method,read=method==='GET',access=auth.access;
 const one=(area,minimum=read?2:3)=>{if(!allowed(access,area,minimum))throw new AuthorizationError();return{grants:[{area,level:minimum}],legacyRole:'member'};};
 const any=(areas,minimum=read?2:3)=>{const area=areas.find(a=>allowed(access,a,minimum));if(!area)throw new AuthorizationError();return one(area,minimum);};
 const both=(first,second)=>{const a=one(first),b=one(second);return{...a,grants:[...a.grants,...b.grants],legacyRole:'admin'};};
 const managed=(area,minimum=read?2:3)=>({...one(area,minimum),legacyRole:'admin'});
 const owned=async characterId=>!!await db.prepare("SELECT id FROM characters WHERE id=? AND owner_id=? AND kind IN('main','alt') AND approved_at IS NOT NULL").bind(characterId,auth.user.id).first();
 let match;
 if(path==='/api/wishlist/auction-matches')return any(['auctions','auctionAdmin'],2);
 if((match=/^\/api\/raids\/[^/]+\/(delete-preview|delete)$/.exec(path)))return managed('attendance',3);
 if((match=/^\/api\/characters\/([^/]+)\/wishlist(?:\/search)?$/.exec(path))){if(!read){if(!await owned(match[1]))throw new AuthorizationError('Only the approved character owner can edit its wish list.');return any(['overview','mains'],3);}if(await owned(match[1]))return any(['overview','mains','characters'],2);return any(['mains','characters'],2);}
 if(path==='/api/dashboard')return one('overview',2);
 if(path==='/api/loot-history')return any(['auctions','auctionAdmin'],2);
 if(path==='/api/my-auctions')return any(['auctions','auctionAdmin'],2);
 if(path==='/api/item-comparison')return any(['items','auctionAdmin','overview','mains','characters','auctions'],2);
 if(path==='/api/access'||path.startsWith('/api/access/'))return one('access');
 if(path==='/api/audit')return one('audit',2);
 if(path==='/api/catalog'||path.startsWith('/api/catalog/'))return managed('items');
 if(path==='/api/loot-imports'||path.startsWith('/api/loot-imports/'))return managed('loot');
 if((match=/^\/api\/characters\/([^/]+)\/inventory\/(preview|import)$/.exec(path))){if(!await owned(match[1]))throw new AuthorizationError('You can import inventory only for your own approved character.');return any(['overview','mains'],3);}
 if(path==='/api/raid-options')return any(['attendance','loot','captures'],2);
 if(path==='/api/attendance-requests/options')return one('corrections',2);
 if(path==='/api/ledger/characters')return managed('ledger',3);
 if((match=/^\/api\/characters\/([^/]+)\/equipment(?:\/([^/]+))?$/.exec(path))){
  if((read&&match[2]==='references')||!read){if(!await owned(match[1]))throw new AuthorizationError('You can edit equipment only for your own approved character.');return any(['overview','mains'],3);}
  if(!match[2]&&read){if(await owned(match[1]))return any(['characters','mains','overview'],2);return any(['characters','mains'],2);}
 }
 if(path==='/api/characters')return{...one('characters'),legacyRole:allowed(access,'claims',2)?'admin':'member'};
 if(path==='/api/claims'&&method==='POST')return one('characters',3);
 if(path==='/api/claims'||/^\/api\/claims\/[^/]+\/approve$/.test(path)||/^\/api\/characters\/[^/]+\/detach$/.test(path))return managed('claims');
 if(path==='/api/reports/mains')return one('mains',2);
 if((match=/^\/api\/reports\/mains\/([^/]+)\/(attendance|loot)$/.exec(path))){if(await owned(match[1]))return any(['overview','mains','characters'],2);return any(match[2]==='loot'?['mains','characters']:['mains'],2);}
 if(path==='/api/raids'||path.startsWith('/api/raids/'))return managed('attendance');
 if(path==='/api/ledger'||path==='/api/adjustments')return managed('ledger');
 if(path==='/api/settings')return read?{...any(['settings','attendance','auctionAdmin'],2),legacyRole:'admin'}:managed('settings',3);
 if(path==='/api/attendance-requests'&&read)return{...any(['corrections','correctionReview'],2),legacyRole:allowed(access,'correctionReview',2)?'admin':'member'};
 if(path==='/api/attendance-requests'&&method==='POST')return one('corrections',3);
 if(/^\/api\/attendance-requests\/[^/]+\/(approve|reject)$/.test(path))return managed('correctionReview',3);
 if(path==='/api/items')return{...any(['items','auctionAdmin'],2),legacyRole:'admin'};
 if(/^\/api\/items\/\d+$/.test(path)&&read)return any(['items','auctionAdmin','overview','mains','characters','auctions'],2);
 if(path.startsWith('/api/items/'))return managed('items');
 if(/^\/api\/loot\/items\/\d+\/history$/.test(path)&&read)return any(['items','auctionAdmin','overview','mains','characters','auctions'],2);
 if(path==='/api/auctions'&&method==='POST'||/^\/api\/auctions\/[^/]+\/(?:close|cancel|complete-early|bids\/[^/]+\/cancel|awards\/[^/]+\/confirm)$/.test(path))return managed('auctionAdmin',3);
 if(path==='/api/auctions'||path.startsWith('/api/auctions/'))return{...(read?any(['auctions','auctionAdmin'],2):one('auctions')),legacyRole:allowed(access,'auctionAdmin',2)?'admin':'member'};
 if(path==='/api/captures'||path.startsWith('/api/captures/'))return !read&&path.endsWith('/prepare')?both('captures','loot'):managed('captures');
 if(path==='/api/companion-devices'||path.startsWith('/api/companion-devices/'))return managed('captures');
 if(path==='/api/loot'||path.startsWith('/api/loot/'))return !read&&path.endsWith('/publish')?both('loot','auctionAdmin'):managed('loot');
 throw new AuthorizationError();
}
export function guardedDatabase(db,userId,grants){
 let denied=false;
 const rawStatement=Symbol('prepared');
 async function execute(statements){
  const operations=grants.map(()=>crypto.randomUUID());
  const before=grants.map((g,i)=>db.prepare('INSERT INTO access_operation_guards(operation_id,user_id,area,minimum_level) VALUES(?,?,?,?)').bind(operations[i],userId,g.area,g.level));
  const after=operations.map(id=>db.prepare('DELETE FROM access_operation_guards WHERE operation_id=?').bind(id));
  try{const result=await db.batch([...before,...statements,...after]);return result.slice(before.length,before.length+statements.length);}
  catch(error){if(/ACCESS_DENIED/.test(String(error))){denied=true;throw new AuthorizationError('Your access changed. Refresh your session before retrying.');}throw error;}
 }
 class Statement{
  constructor(raw){this[rawStatement]=raw;}
  bind(...args){return new Statement(this[rawStatement].bind(...args));}
  async first(column){const r=(await execute([this[rawStatement]]))[0].results[0];return r?(column?r[column]:r):null;}
  async all(){return(await execute([this[rawStatement]]))[0];}
  async run(){return(await execute([this[rawStatement]]))[0];}
 }
 return{prepare(query){return new Statement(db.prepare(query));},batch(statements){return execute(statements.map(s=>s[rawStatement]??s));},get authorityDenied(){return denied;}};
}
