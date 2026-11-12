export class CompanionError extends Error {
 constructor(code,message,{terminal=false,status=null}={}){super(message);this.name='CompanionError';this.code=code;this.terminal=terminal;this.status=status;}
}
export function validatePairing(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)throw new CompanionError('pairing_invalid','Use a version1 pairing configuration copied from Guild Desk.',{terminal:true});
 let url;try{url=new URL(value.siteUrl);}catch{throw new CompanionError('pairing_invalid','The pairing site URL is invalid.',{terminal:true});}
 const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new CompanionError('pairing_invalid','Use an HTTPS site root, or HTTP localhost/127.0.0.1 for local testing. Credentials, paths, queries and fragments are not allowed.',{terminal:true});
 if(typeof value.captureId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.captureId))throw new CompanionError('pairing_invalid','The capture identity is invalid.',{terminal:true});
 if(typeof value.token!=='string'||value.token.length<16||value.token.length>4096||!/^[\x21-\x7e]+$/.test(value.token))throw new CompanionError('pairing_invalid','The pairing token is invalid. Copy a fresh pairing configuration.',{terminal:true});
 if(url.href.includes(value.token)||value.captureId.includes(value.token))throw new CompanionError('pairing_invalid','Pairing credentials must not appear in the site URL or capture identity. Copy a fresh configuration.',{terminal:true});
 return{version:1,siteUrl:url.origin,captureId:value.captureId,token:value.token};
}
export function createTransport(config,{fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
 const pairing=validatePairing(config);
 async function request(path,method='GET',data){
  let response;try{response=await fetchImpl(pairing.siteUrl+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${pairing.token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});}
  catch{throw new CompanionError('network_retry','The connection failed or timed out. Selected events remain queued for retry.');}
  if(!response.ok){const terminal=response.status>=400&&response.status<500&&![408,425,429].includes(response.status);throw new CompanionError(terminal?'capture_paused':'server_retry',terminal?`Capture paused by the server (HTTP${response.status}). Pending events are retained; review the capture in Guild Desk before restarting.`:`The server is temporarily unavailable (HTTP${response.status}). Selected events remain queued for retry.`,{terminal,status:response.status});}
  const reader=response.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
  if(reader){try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel().catch(()=>{});throw new CompanionError('protocol','The server reply exceeded the expected size. Pending events are retained.',{terminal:true});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
  try{return JSON.parse(raw);}catch{throw new CompanionError('protocol','The server reply was not valid JSON. Pending events are retained.',{terminal:true});}
 }
 return{
  async getSession(){const result=await request('/api/companion/session');const session=result?.session;if(!session||session.id!==pairing.captureId||typeof session.channelName!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(session.channelName)||!Array.isArray(session.allowedSenders)||session.allowedSenders.length>100||session.allowedSenders.some(s=>typeof s!=='string'||!s.trim()||s.length>64)||typeof session.expiresAt!=='string'||!Number.isFinite(Date.parse(session.expiresAt)))throw new CompanionError('protocol','The server returned an invalid or different capture session.',{terminal:true});if(session.status!=='open')throw new CompanionError('capture_closed','This capture is no longer open. Pending events are retained for officer review.',{terminal:true,status:410});return session;},
  async sendEvents(watcherId,events){if(events.length>50||Buffer.byteLength(JSON.stringify({watcherId,events}))>256*1024)throw new CompanionError('batch_too_large','The event batch is too large; pending events are retained.',{terminal:true});return await request('/api/companion/events','POST',{watcherId,events});}
 };
}
