// Dedicated EQ loot-chat capture only; this is not a general game-log loot parser.
const CHAT_MAX_SOURCE=1024*1024;
const CHAT_CONTROLS=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const chatNormalize=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export class ChatLootError extends Error {
 constructor(status,code,message){super(message);this.name='ChatLootError';this.status=status;this.code=code;}
}
const chatFail=(code,message,status=400)=>{throw new ChatLootError(status,code,message);};
function chatConfiguration(config={}){
 if(!config||typeof config!=='object'||Array.isArray(config))chatFail('validation','Choose loot chat capture settings.');
 const channelName=config.channelName??'abfloot',allowedSenders=config.allowedSenders??[];
 if(typeof channelName!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(channelName))chatFail('validation','Use a channel name with 1-64 letters, digits, underscores or hyphens.');
 if(!Array.isArray(allowedSenders)||allowedSenders.length>100||allowedSenders.some(name=>typeof name!=='string'||!name.trim()||name.trim().length>64||CHAT_CONTROLS.test(name)))chatFail('validation','Allowed senders must be a list of up to 100 exact character names (including You if wanted).');
 return {channelName,allowedSenders:[...new Set(allowedSenders.map(name=>name.trim().toLowerCase()))]};
}

export function parseLootChannelLine(line,config={channelName:'abfloot',allowedSenders:[]}){
 const settings=chatConfiguration(config);
 if(typeof line!=='string')chatFail('validation','A chat line must be text.');
 // A UTF-8 BOM is permitted only at the beginning; callers retain the original line.
 line=line.replace(/^\uFEFF/,'');
 // The You tell shape is verified by the user's supplied log. Named tells is synthetic support.
 const prefix=/^\[([^\]\r\n]{1,80})\] (You tell|([A-Za-z][A-Za-z0-9_'\-]{0,63}) tells) ([A-Za-z0-9_-]{1,64}):(\d+), /.exec(line);
 if(!prefix||prefix[4].toLowerCase()!==settings.channelName.toLowerCase())return null;
 const namedSyntax=prefix[2]!=='You tell',sender=namedSyntax?prefix[3]:'You';
 if(settings.allowedSenders.length&&!settings.allowedSenders.includes(sender.toLowerCase()))return null;
 if(line.length>32768)chatFail('chat_line_too_large','A matching loot chat line exceeds 32,768 characters.');
 if(CHAT_CONTROLS.test(line))chatFail('unsafe_chat_text','A matching loot chat line contains unsupported control characters.');
 if(!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:[1-9]|0[1-9]| [1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d \d{4}$/.test(prefix[1]))chatFail('invalid_chat_time','A matching loot chat line has an unsupported timestamp.');
 const channelNumber=Number(prefix[5]);
 if(!Number.isSafeInteger(channelNumber)||channelNumber<1)chatFail('invalid_chat_channel','The loot channel number must be a positive whole number.');
 const quoted=line.slice(prefix[0].length);
 if(quoted.length<2||quoted[0]!=="'"||quoted.at(-1)!=="'")chatFail('invalid_chat_payload','A matching loot chat message must have its original opening and closing quote.');
 const payload=quoted.slice(1,-1);
 if(payload.length>16384)chatFail('chat_payload_too_large','A loot chat payload exceeds 16,384 characters.');
 const warnings=[],items=[],fragments=payload.split('|');
 let lastItem=-1;for(let i=0;i<fragments.length;i++)if(fragments[i].trim())lastItem=i;
 let emptySegmentWarned=false;
 if(namedSyntax)warnings.push('Named-sender channel syntax is supported as an unverified format; review the captured message.');
 for(let index=0;index<fragments.length;index++){
  const name=fragments[index].trim();
  if(!name){if(index<lastItem&&!emptySegmentWarned){warnings.push('An empty item segment occurred inside the loot message.');emptySegmentWarned=true;}continue;}
  if(name.length>250)chatFail('chat_item_too_large','A loot item fragment exceeds 250 characters; review the original message.');
  const needsReview=/\p{Ll}\p{Lu}/u.test(name);
  items.push({name,needsReview,...(needsReview?{note:'Possible concatenated item names: a lowercase letter touches an uppercase letter. Review this intact fragment; no split was guessed.'}:{})});
 }
 if(!items.length)warnings.push('The matching loot chat message contained no item names.');
 if(items.some(item=>item.needsReview))warnings.push('Possible concatenated item names require manager review; fragments were kept intact.');
 return {sender,channelName:prefix[4],channelNumber,sourceTime:prefix[1],payload,items,warnings};
}

export function parseChatLootSources(input){
 if(!input||typeof input!=='object'||Array.isArray(input))chatFail('validation','Supply loot chat text or log files.');
 const settings=chatConfiguration(input.chatCapture??{}),sources=[];
 const addSource=(name,text,format='log')=>{
  if(typeof name!=='string'||!name.trim()||name.trim().length>250||CHAT_CONTROLS.test(name))chatFail('validation','Source filenames must contain 1-250 printable characters.');
  if(typeof text!=='string')chatFail('validation','Each source needs its original text.');
  if(format!=='log')chatFail('validation','Dedicated chat capture accepts log sources.');
  if(text.length>CHAT_MAX_SOURCE||new TextEncoder().encode(text).byteLength>CHAT_MAX_SOURCE)chatFail('too_large','Each source must be at most 1 MiB of text.',413);
  sources.push({name:name.trim(),text,format:'log',chatCapture:{channelName:settings.channelName,allowedSenders:[...settings.allowedSenders]}});
 };
 if(input.text!==undefined)addSource('Pasted loot text',input.text,input.format??'log');
 if(input.files!==undefined){
  if(!Array.isArray(input.files)||input.files.length>20)chatFail('validation','Choose at most 20 log files.');
  for(const file of input.files){if(!file||typeof file!=='object')chatFail('validation','Each source needs its original text.');addSource(file.name,file.text,file.format??'log');}
 }
 if(!sources.length)chatFail('validation','Paste loot chat text or choose a log file.');
 const rows=[],warnings=[],byName=new Map(),messages=new Map();let matchedMessages=0,totalPieces=0;
 const warn=value=>{if(!warnings.includes(value))warnings.push(value);};
 for(const source of sources){
  for(const [index,original]of source.text.split(/\r?\n/).entries()){
   const parsed=parseLootChannelLine(original,settings);if(!parsed)continue;
   if(++matchedMessages>200)chatFail('too_many_messages','Use at most 200 matching loot chat messages per boss batch.');
   for(const warning of parsed.warnings)warn(warning);
   const messageKey=parsed.channelName.toLowerCase()+'\u0000'+parsed.payload;
   const repeated=messages.has(messageKey);messages.set(messageKey,(messages.get(messageKey)||0)+1);
   if(repeated)warn('Repeated identical loot message payloads were counted again. Review the original lines and quantities before publishing; messages were not deduplicated.');
   for(const [itemIndex,item]of parsed.items.entries()){
    if(++totalPieces>1000)chatFail('too_many_pieces','Use at most 1000 total pieces per boss batch.');
    const normalizedName=chatNormalize(item.name);
    const raw={sourceName:source.name,lineNumber:index+1,text:original,sender:parsed.sender,channelName:parsed.channelName,channelNumber:parsed.channelNumber,sourceTime:parsed.sourceTime,payload:parsed.payload,itemPosition:itemIndex+1};
    let row=byName.get(normalizedName);
    if(row){if(++row.quantity>50)chatFail('too_many_copies','One item auction supports at most 50 identical copies. Split or review this source explicitly.');row.rawLines.push(raw);if(item.needsReview){row.matchStatus='needs_review';row.note=item.note;}}
    else{
     row={id:crypto.randomUUID(),ordinal:rows.length,name:item.name,normalizedName,quantity:1,itemId:null,matchStatus:item.needsReview?'needs_review':'unmatched',candidates:[],rawLines:[raw],note:item.note??'Item name captured from the configured loot chat channel; no item ID or statistics have been inferred.'};
     rows.push(row);byName.set(normalizedName,row);
    }
   }
  }
 }
 if(!rows.length)chatFail('empty_loot','No item names were found in matching loot chat messages. Check the channel and sender settings.');
 return {sources,rows,warnings,totalPieces};
}
