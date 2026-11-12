// Public EQResource adapter. No undocumented API or fixed search parameter is assumed.
const EQ_ORIGIN = 'https://items.eqresource.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const CLASS_ALIASES = {
  WAR:'Warrior', CLR:'Cleric', PAL:'Paladin', RNG:'Ranger', SHD:'Shadow Knight', DRU:'Druid',
  MNK:'Monk', BRD:'Bard', ROG:'Rogue', SHM:'Shaman', NEC:'Necromancer', WIZ:'Wizard',
  MAG:'Magician', ENC:'Enchanter', BST:'Beastlord', BER:'Berserker'
};
const SLOT_ALIASES = { EAR:'EAR', FACE:'FACE', HEAD:'HEAD', NECK:'NECK', SHOULDERS:'SHOULDERS', SHOULDER:'SHOULDERS', ARMS:'ARMS', BACK:'BACK', WRIST:'WRIST', RANGE:'RANGE', HANDS:'HANDS', PRIMARY:'PRIMARY', SECONDARY:'SECONDARY', FINGER:'FINGER', CHEST:'CHEST', LEGS:'LEGS', FEET:'FEET', WAIST:'WAIST', AMMO:'AMMO', CHARM:'CHARM' };
const STAT_NAMES = {
  ac:'ac', hp:'hp', mana:'mana', end:'endurance', endurance:'endurance', strength:'strength', stamina:'stamina',
  intelligence:'intelligence', wisdom:'wisdom', agility:'agility', dexterity:'dexterity', charisma:'charisma',
  magic:'magicResist', fire:'fireResist', cold:'coldResist', disease:'diseaseResist', poison:'poisonResist', corruption:'corruptionResist',
  attack:'attack', hpregen:'hpRegen', manaregen:'manaRegen', endregen:'enduranceRegen', enduranceregen:'enduranceRegen',
  healamount:'healAmount', spelldamage:'spellDamage', clairvoyance:'clairvoyance', combateffects:'combatEffects',
  avoidance:'avoidance', accuracy:'accuracy', shielding:'shielding', strikethrough:'strikethrough', stunresist:'stunResist',
  dotshielding:'dotShielding', spellshield:'spellShield', spellshielding:'spellShield', damageshield:'damageShield',
  damageshieldmitigation:'damageShieldMitigation', haste:'haste', damage:'damage', delay:'delay', ratio:'ratio', range:'range',
  backstabdamage:'backstabDamage', weight:'weight', tribute:'tribute', reclvl:'recommendedLevel', reqlvl:'requiredLevel'
};

export function normalizeItemName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase() : '';
}
function cleanText(value) { return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim(); }
function decodeEntities(value) {
  const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'-',mdash:'-',rsquo:"'",lsquo:"'",rdquo:'"',ldquo:'"'};
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
    if(key[0]==='#'){const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';}
    return names[key.toLowerCase()]??whole;
  });
}
function attributes(source) {
  const out={};
  for(const match of String(source).matchAll(/([a-z_:][a-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/gi))out[match[1].toLowerCase()]=decodeEntities(match[2]??match[3]??match[4]??'');
  return out;
}
function withoutInactiveMarkup(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
}
function visibleText(html) {
  return cleanText(decodeEntities(withoutInactiveMarkup(html).replace(/<br\b[^>]*>/gi,'\n').replace(/<\/(?:tr|p|div|section|article|h[1-6]|li|nav|footer|header)\s*>/gi,'\n').replace(/<\/(?:td|th)\s*>/gi,'\t').replace(/<[^>]*>/g,'')));
}
function sourceUrl(input, base=EQ_ORIGIN) {
  const url=new URL(input,base);
  if(url.origin!==EQ_ORIGIN||url.username||url.password||url.hash)throw new SourceError('unsafe_source_url','The source returned an unsupported destination.');
  return url;
}
export class SourceError extends Error { constructor(code,message,status=code.startsWith('invalid_')?400:503) {super(message);this.name='SourceError';this.code=code;this.status=status;} }
function positiveId(value) {const id=Number(value);if(!Number.isSafeInteger(id)||id<1||!/^[0-9]+$/.test(String(value)))throw new SourceError('invalid_item_id','Enter a positive whole-number item ID.');return id;}

function newContext(options={}) {
  const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new SourceError('invalid_timeout','Source timeout must be from 1 to 30000 milliseconds.');
  if(typeof(options.fetchImpl??globalThis.fetch)!=='function')throw new SourceError('source_unavailable','Source retrieval is unavailable.');
  return {fetchImpl:options.fetchImpl??globalThis.fetch,deadline:Date.now()+timeoutMs,cookies:new Map()};
}
async function requestSource(input,context,init={}) {
  let url=sourceUrl(input),method=init.method??'GET',body=init.body;
  for(let redirects=0;redirects<=3;redirects++){
    const remaining=context.deadline-Date.now();if(remaining<=0)throw new SourceError('source_timeout','EQResource did not respond before the timeout.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);
    try{
      const headers={Accept:'text/html, application/xhtml+xml, text/plain;q=0.8',...(init.headers??{})};
      if(context.cookies.size)headers.Cookie=[...context.cookies].map(([key,value])=>key+'='+value).join('; ');
      const response=await context.fetchImpl(url.href,{method,body,headers,signal:controller.signal,redirect:'manual',credentials:'omit'});
      const responseUrl=response.url?sourceUrl(response.url):url;
      if(responseUrl.origin!==url.origin)throw new SourceError('unsafe_source_url','The source returned an unsupported destination.');
      const cookies=response.headers.getSetCookie?.()??(response.headers.get('set-cookie')?[response.headers.get('set-cookie')]:[]);
      for(const cookie of cookies){const pair=/^([^=;\s]+)=([^;]*)/.exec(cookie);if(pair&&pair[0].length<2048&&(context.cookies.has(pair[1])||context.cookies.size<16))context.cookies.set(pair[1],pair[2]);}
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');if(!location)throw new SourceError('source_redirect','The source returned an incomplete redirect.');
        url=sourceUrl(location,url);await response.body?.cancel();if(response.status===303||((response.status===301||response.status===302)&&method==='POST')){method='GET';body=undefined;}
        continue;
      }
      if(response.status===403||response.status===401||response.status===429)throw new SourceError('source_access_unavailable','EQResource declined automated access. Open the source to review this item.');
      if(!response.ok)throw new SourceError('source_http_error','EQResource returned HTTP '+response.status+'.');
      const type=response.headers.get('content-type')??'';
      if(type&&!/^(?:text\/(?:html|plain)|application\/xhtml\+xml)\b/i.test(type))throw new SourceError('source_content_type','The source did not return an item/search page.');
      if(Number(response.headers.get('content-length'))>MAX_RESPONSE_BYTES)throw new SourceError('source_too_large','The source response exceeded the supported page size.');
      const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
      if(reader){try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new SourceError('source_too_large','The source response exceeded the supported page size.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
      else text=await response.text();
      if(new TextEncoder().encode(text).length>MAX_RESPONSE_BYTES)throw new SourceError('source_too_large','The source response exceeded the supported page size.');
      return {html:text,url:responseUrl.href};
    }catch(error){
      if(error instanceof SourceError)throw error;
      if(controller.signal.aborted||error?.name==='AbortError')throw new SourceError('source_timeout','EQResource did not respond before the timeout.');
      throw new SourceError('source_unavailable','EQResource could not be reached.');
    }finally{clearTimeout(timer);}
  }
  throw new SourceError('source_redirect','EQResource returned too many redirects.');
}

// Discover the public form's actual controls. No guessed item-name parameter is sent.
export function discoverNameSearchForm(html,baseUrl=EQ_ORIGIN+'/itemsearch.php') {
  const forms=[];
  for(const match of withoutInactiveMarkup(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)){
    const form=attributes(match[1]),content=match[2],inputs=[...content.matchAll(/<input\b([^>]*)>/gi)].map(m=>attributes(m[1]));
    const fields=inputs.filter(i=>i.name&&!('disabled'in i)&&['text','search'].includes((i.type||'text').toLowerCase()));
    const labels=[...content.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)].map(m=>({attrs:attributes(m[1]),text:normalizeItemName(visibleText(m[2])).replace(/:$/,'')}));
    let named=fields.filter(i=>labels.some(l=>l.text==='item name'&&l.attrs.for&&l.attrs.for===i.id));
    if(!named.length&&fields.length===1&&/\bitem\s+name\b/i.test(visibleText(content)))named=fields;
    if(named.length!==1)continue;
    const method=(form.method||'GET').toUpperCase();if(!['GET','POST'].includes(method))continue;
    let action;try{action=sourceUrl(form.action||baseUrl,baseUrl);}catch{continue;}
    if(action.pathname!=='/itemsearch.php')continue;
    const params=[];
    for(const input of inputs){if(!input.name||'disabled'in input)continue;const type=(input.type||'text').toLowerCase();if(type==='hidden')params.push([input.name,input.value||'']);}
    const submits=inputs.filter(i=>i.name&&!('disabled'in i)&&['submit','image'].includes((i.type||'').toLowerCase()));
    if(submits.length===1&&submits[0].type.toLowerCase()==='submit')params.push([submits[0].name,submits[0].value||'']);
    forms.push({action:action.href,method,nameField:named[0].name,params});
  }
  if(forms.length!==1)throw new SourceError('source_layout_unrecognized','The item-name search form could not be identified safely.');
  return forms[0];
}

export function parseSearchCandidates(html,query,baseUrl=EQ_ORIGIN+'/itemsearch.php') {
  const entries=new Map();
  for(const match of withoutInactiveMarkup(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const attr=attributes(match[1]);if(!attr.href)continue;
    let url;try{url=sourceUrl(attr.href,baseUrl);}catch{continue;}
    if(url.pathname!=='/items.php'||url.searchParams.size!==1||!url.searchParams.has('id'))continue;
    let itemId;try{itemId=positiveId(url.searchParams.get('id'));}catch{continue;}
    const name=visibleText(match[2]).replace(/\s+/g,' ').trim();
    if(!name||name.length>250||/^(?:<<\s*)?(?:previous|next) item id|^(?:image|details|view item)$/i.test(name))continue;
    const existing=entries.get(itemId);if(existing&&normalizeItemName(existing.name)!==normalizeItemName(name))existing.nameConflict=true;
    else if(!existing)entries.set(itemId,{itemId,name,sourceUrl:EQ_ORIGIN+'/items.php?id='+itemId,match:normalizeItemName(name)===normalizeItemName(query)?'exact':'candidate',nameConflict:false});
  }
  const candidates=[...entries.values()];
  const total=/Total\s+results\s*:\s*([\d,]+)/i.exec(visibleText(html));
  const additionalPages=Boolean(total&&Number(total[1].replace(/,/g,''))>candidates.length);
  const exact=candidates.filter(c=>c.match==='exact'&&!c.nameConflict);
  return {candidates,exactMatch:exact.length===1&&!additionalPages?exact[0]:null,additionalPages};
}

export async function searchItemsByName(name,options={}) {
  const query=typeof name==='string'?name.trim():'';
  if(!query||query.length>250)return {status:'unavailable',query,candidates:[],exactMatch:null,sourceUrl:EQ_ORIGIN+'/itemsearch.php',reason:'Enter an item name from 1 to 250 characters.',message:'Enter an item name from 1 to 250 characters.',code:'invalid_item_name'};
  try{
    const context=newContext(options),landing=await requestSource(EQ_ORIGIN+'/itemsearch.php',context),form=discoverNameSearchForm(landing.html,landing.url);
    const params=new URLSearchParams(form.params);params.set(form.nameField,query);
    const action=sourceUrl(form.action);let response;
    if(form.method==='GET'){for(const [key,value]of params)action.searchParams.set(key,value);response=await requestSource(action.href,context);}
    else response=await requestSource(action.href,context,{method:'POST',body:params.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:landing.url}});
    const parsed=parseSearchCandidates(response.html,query,response.url);
    if(!parsed.candidates.length&&!/Total\s+results\s*:\s*0\b/i.test(visibleText(response.html)))throw new SourceError('source_layout_unrecognized','The source did not return a recognized item search result.');
    const reason=parsed.additionalPages?'The source has additional results; manager review is required.':parsed.exactMatch?null:parsed.candidates.length?'Review the matching candidates before selecting an item.':null;
    return {status:parsed.exactMatch?'matched':parsed.candidates.length?'ambiguous':'not_found',query,...parsed,sourceUrl:response.url,reason,message:reason};
  }catch(error){const reason=error instanceof SourceError?error.message:'EQResource lookup could not be completed.';return {status:'unavailable',query,candidates:[],exactMatch:null,sourceUrl:EQ_ORIGIN+'/itemsearch.php',reason,message:reason,code:error.code||'source_unavailable'};}
}

function compactLabel(label){return label.toLowerCase().replace(/[^a-z0-9]/g,'');}
function labeledFields(tokens){
  const fields=[];
  for(let i=0;i<tokens.length;i++){
    const inline=/^([^:]{1,70}):\s*(.*)$/.exec(tokens[i]);if(!inline)continue;
    if(inline[2]){fields.push({label:inline[1].trim(),value:inline[2].trim()});continue;}
    const labels=[];let cursor=i;
    while(cursor<tokens.length&&/^([^:]{1,70}):\s*$/.test(tokens[cursor])){labels.push(tokens[cursor].replace(/:\s*$/,'').trim());cursor++;}
    const values=tokens.slice(cursor,cursor+labels.length);
    if(values.length===labels.length&&values.every(v=>!/^([^:]{1,70}):/.test(v))){labels.forEach((label,j)=>fields.push({label,value:values[j]}));i=cursor+labels.length-1;}
  }
  return fields;
}
function parseClasses(value){
  if(!value)return null;if(/^all$/i.test(value.trim()))return ['ALL'];
  const chunks=value.split(/[,;/]+/).map(v=>v.trim()).filter(Boolean);let codes=[];
  for(const chunk of chunks){let code=Object.keys(CLASS_ALIASES).find(c=>c===chunk.toUpperCase()||compactLabel(CLASS_ALIASES[c])===compactLabel(chunk));if(code){codes.push(code);continue;}const parts=chunk.split(/\s+/);if(parts.every(p=>CLASS_ALIASES[p.toUpperCase()]))codes.push(...parts.map(p=>p.toUpperCase()));else return null;}
  return codes.length?[...new Set(codes)]:null;
}
function parseSlots(value){if(!value)return null;const parts=value.toUpperCase().split(/[,;/\s]+/).filter(Boolean);return parts.length&&parts.every(p=>SLOT_ALIASES[p])?[...new Set(parts.map(p=>SLOT_ALIASES[p]))]:null;}

export function parseItemDetails(html,itemId,{retrievedAt=new Date().toISOString()}={}) {
  itemId=positiveId(itemId);
  // Page chrome can contain filters named Class/Slot. Never treat those as item fields.
  const itemMarkup=withoutInactiveMarkup(html).replace(/<(head|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const plain=visibleText(itemMarkup),lines=plain.split(/\r?\n/).map(l=>l.replace(/[ \f\v]+/g,' ').trim()).filter(Boolean),tokens=lines.flatMap(l=>l.split('\t').map(v=>v.trim()).filter(Boolean));
  const lootRecords=[...plain.matchAll(/Advanced\s+Loot\s*:\s*(\d+)\^(\d+)\^([^\r\n\t]+)/gi)],loot=lootRecords[0];
  if(lootRecords.length!==1||Number(loot[1])!==itemId)throw new SourceError('source_layout_unrecognized','The item page did not identify the requested item safely.');
  const name=cleanText(loot[3]);if(!name||name.length>250)throw new SourceError('source_layout_unrecognized','The source item name was not recognized.');
  const lootIndex=tokens.findIndex(t=>/^Advanced\s+Loot\s*:/i.test(t));
  const starts=tokens.map((t,i)=>normalizeItemName(t)===normalizeItemName(name)&&i<lootIndex?i:-1).filter(i=>i>=0);
  if(starts.length!==1)throw new SourceError('source_layout_unrecognized','The requested item heading could not be identified unambiguously.');
  const start=starts[0],classIndex=tokens.findIndex((t,i)=>i>start&&i<lootIndex&&/^Class\s*:/i.test(t));
  if(classIndex<0)throw new SourceError('source_layout_unrecognized','The item class field was not found after its heading.');
  let end=tokens.findIndex((t,i)=>i>classIndex&&(/By\s*:\s*EQResource Item Collector|Questions\?\s*Comments\?|^Comments?$|^Copyright\b|^Privacy Policy\b/i.test(t)));
  if(end<0||end<=lootIndex)throw new SourceError('source_layout_unrecognized','The item panel boundary could not be identified safely.');
  const panel=tokens.slice(start,end);
  for(const label of ['Class','Race','Slot'])if(panel.filter(t=>new RegExp('^'+label+'\\s*:','i').test(t)).length>1)throw new SourceError('source_layout_unrecognized','The item eligibility fields were ambiguous.');
  if(panel.join('\n').length>30000)throw new SourceError('source_panel_too_large','The item panel could not be isolated from unrelated page content.');
  const fields=labeledFields(panel),get=label=>fields.find(f=>compactLabel(f.label)===compactLabel(label))?.value??null;
  const classes=parseClasses(get('Class')),raceText=get('Race'),slots=parseSlots(get('Slot'));
  const stats={};for(const field of fields){const key=STAT_NAMES[compactLabel(field.label)];if(!key)continue;const match=/^([+-]?\d+(?:\.\d+)?)\s*(?:\+\s*(\d+(?:\.\d+)?))?\s*%?$/.exec(field.value);if(match){stats[key]=Number(match[1]);if(match[2]!==undefined)stats['heroic'+key[0].toUpperCase()+key.slice(1)]=Number(match[2]);}}
  const effects=fields.filter(f=>/^(?:effect|focus|click|worn|proc)$/i.test(f.label)).map(f=>f.label+': '+f.value);
  const augments=panel.filter(t=>/^Type\s+\d+\s*\(/i.test(t)).map(t=>t.replace(/\s*-?\s*Find an Aug\s*$/i,''));
  const prefix=panel.slice(0,Math.max(0,panel.findIndex(t=>/^Class\s*:/i.test(t)))).join(' ');
  const flags=['Magic','Lore','No Trade','Placeable','No Rent','Prestige','Attunable','Heirloom','Augmentation'].filter(flag=>new RegExp('\\b'+flag.replace(/ /g,'\\s+')+'\\b','i').test(prefix));
  let iconUrl=null;const iconId=Number(loot[2]);
  for(const image of itemMarkup.matchAll(/<img\b([^>]*)>/gi)){const attrs=attributes(image[1]);if(!attrs.src)continue;try{const url=sourceUrl(attrs.src,EQ_ORIGIN+'/items.php?id='+itemId);if(new RegExp('(?:^|/)(?:item[_-]?)?'+iconId+'\\.(?:png|gif|jpe?g|webp)$','i').test(url.pathname)){iconUrl=url.href;break;}}catch{}}
  return {itemId,name,classes,races:raceText?(/^all$/i.test(raceText)?['ALL']:raceText.split(',').map(v=>v.trim()).filter(Boolean)):null,slots,stats,flags,advancedLoot:itemId+'^'+iconId+'^'+name,sourceUrl:EQ_ORIGIN+'/items.php?id='+itemId,sourceCheckedAt:get('Checked'),sourceUpdatedAt:get('Updated'),retrievedAt,verificationMethod:'EQResource source item page; structured completeness unverified',metadataStatus:'verified_reference',iconUrl,metadataComplete:false,details:{fields,effects,augments,lore:get('Item Lore'),sourceText:panel.join('\n')}};
}

export async function fetchItemDetails(itemId,options={}) {
  const id=positiveId(itemId);
  const url=EQ_ORIGIN+'/items.php?id='+id;
  const context=newContext(options),response=await requestSource(url,context);
  return parseItemDetails(response.html,id);
}
