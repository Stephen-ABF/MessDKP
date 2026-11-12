import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLootChannelLine, parseChatLootSources, ChatLootError } from '../worker/log-parser.mjs';

const message=(payload,{sender='You',channel='abfloot',number=4,time='Thu Nov 12 00:28:32 2026'}={})=>`[${time}] ${sender==='You'?'You tell':sender+' tells'} ${channel}:${number}, '${payload}'`;
// Three item-only chat protocol examples based on the verified format; no player roster or unrelated chat is included.
const verified="[Thu Nov 12 00:28:32 2026] You tell abfloot:4, 'Gloves of True Darkness | Steel Hilted Flint Dagger | Complex Platinum Gem Dusted Rune | Words of Tenancy | '";
const fixture=[verified,"[Thu Nov 12 00:28:32 2026] You tell abfloot:4, 'Spell: Gangrenous Touch of Zum`uul | Tatrinek's Curse | Tatrinek's Curse | Spell: Dyzil's Deafening Decoy | '","[Thu Nov 12 00:28:33 2026] You tell abfloot:4, 'Spell: Thrall of Bones'"].join('\r\n');
const source=text=>({chatCapture:{channelName:'abfloot',allowedSenders:[]},files:[{name:'eqlog.txt',text,format:'log'}]});

test('verified dedicated-chat format preserves names, punctuation, timestamp and variable channel number',()=>{
 const parsed=parseLootChannelLine(verified);
 assert.equal(parsed.sender,'You');assert.equal(parsed.channelName,'abfloot');assert.equal(parsed.channelNumber,4);assert.equal(parsed.sourceTime,'Thu Nov 12 00:28:32 2026');
 assert.deepEqual(parsed.items.map(item=>item.name),['Gloves of True Darkness','Steel Hilted Flint Dagger','Complex Platinum Gem Dusted Rune','Words of Tenancy']);
 assert.ok(parsed.items.every(item=>!item.needsReview));assert.deepEqual(parsed.warnings,[]);
 const punctuation=parseLootChannelLine(message("Spell: Gangrenous Touch of Zum`uul | Tatrinek's Curse | Spell: Dyzil's Deafening Decoy | ",{channel:'ABFLOOT',number:27}));
 assert.equal(punctuation.channelNumber,27);assert.equal(punctuation.items[0].name,'Spell: Gangrenous Touch of Zum`uul');assert.equal(punctuation.items[1].name,"Tatrinek's Curse");assert.equal(punctuation.items.length,3);
});

test('the three item-only payloads produce nine pieces in eight groups with repeated Curse quantity two',()=>{
 const parsed=parseChatLootSources(source(fixture));
 assert.equal(parsed.totalPieces,9);assert.equal(parsed.rows.length,8);
 const curse=parsed.rows.find(row=>row.name==="Tatrinek's Curse");assert.equal(curse.quantity,2);assert.equal(curse.rawLines.length,2);assert.deepEqual(curse.rawLines.map(raw=>raw.itemPosition),[2,3]);
 assert.ok(parsed.rows.every(row=>row.itemId===null&&row.matchStatus==='unmatched'&&row.candidates.length===0));
 assert.equal(parsed.rows[0].rawLines[0].text,verified);assert.equal(parsed.sources[0].text,fixture);assert.deepEqual(parsed.warnings,[]);
 assert.equal(new Set(parsed.rows.map(row=>row.id)).size,8);assert.match(parsed.rows[0].id,/^[0-9a-f-]{36}$/i);assert.deepEqual(parsed.rows.map(row=>row.ordinal),[0,1,2,3,4,5,6,7]);
});

test('a leading BOM matches without altering original audit lines and day padding preserves source time',()=>{
 const original='\uFEFF'+verified,parsed=parseChatLootSources(source(original));
 assert.equal(parseLootChannelLine(original).items.length,4);assert.equal(parsed.totalPieces,4);assert.equal(parsed.sources[0].text,original);assert.equal(parsed.rows[0].rawLines[0].text,original);
 // Day padding variations are synthetic compatibility fixtures; raw timestamp text is retained.
 for(const day of ['1','01',' 1','9','09',' 9','12','31']){
  const time=`Thu Nov ${day} 00:28:32 2026`;assert.equal(parseLootChannelLine(message('Item',{time})).sourceTime,time);
 }
 for(const day of ['0','00','32',' 01','  1'])assert.throws(()=>parseLootChannelLine(message('Item',{time:`Thu Nov ${day} 00:28:32 2026`})),error=>error.code==='invalid_chat_time');
});

test('unrelated guild, say, achievements, other channels and similar channel names are ignored',()=>{
 for(const line of ["[Thu Nov 12 00:28:32 2026] You say, 'Item'","[Thu Nov 12 00:28:32 2026] You tell your guild, 'Item'",'[Thu Nov 12 00:28:32 2026] You have completed an achievement!',message('Item',{channel:'abfloot2'}),message('Item',{channel:'raid'}),'Spell: Thrall of Bones'])assert.equal(parseLootChannelLine(line),null);
 const text=["[Thu Nov 12 00:28:32 2026] You say, 'Not Loot'",verified,message('Other channel',{channel:'guild'})].join('\n');
 assert.equal(parseChatLootSources(source(text)).totalPieces,4);
});

test('sender allowlist is exact case insensitive and empty allows participants; named syntax is explicitly unverified',()=>{
 // Named-sender syntax is synthetic, not claimed as a captured EverQuest source line.
 const named=message('Axe of Testing',{sender:'Testranger'});
 assert.equal(parseLootChannelLine(named,{channelName:'ABFLOOT',allowedSenders:['TESTranger']}).sender,'Testranger');
 assert.match(parseLootChannelLine(named).warnings.join(' '),/unverified format/);
 assert.equal(parseLootChannelLine(named,{allowedSenders:['Test']}),null);assert.equal(parseLootChannelLine(verified,{allowedSenders:['Testranger']}),null);assert.equal(parseLootChannelLine(verified,{allowedSenders:['you']}).sender,'You');
});

test('concatenated fragments remain intact and block automatic matching rather than guessing splits',()=>{
 const names=["Hierophant's CloakBalanced Shan`Tok",'Kylong GreavesIndium Ore'];
 const result=parseChatLootSources(source(message(names.join(' | '))));
 assert.deepEqual(result.rows.map(row=>row.name),names);assert.ok(result.rows.every(row=>row.matchStatus==='needs_review'&&/no split was guessed/.test(row.note)));assert.equal(result.totalPieces,2);assert.match(result.warnings.join(' '),/concatenated/);
});

test('identical repeated messages and legitimate repeated names are counted, never silently deduplicated',()=>{
 const first=message("Tatrinek's Curse | Tatrinek's Curse | "),second=message("Tatrinek's Curse | Tatrinek's Curse | ",{time:'Thu Nov 12 00:29:33 2026'});
 const result=parseChatLootSources(source(first+'\n'+second));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].quantity,4);assert.equal(result.totalPieces,4);assert.equal(result.rows[0].rawLines.length,4);assert.match(result.warnings.join(' '),/counted again/);assert.equal(result.rows[0].rawLines[2].lineNumber,2);
});

test('unsupported controls, oversized fragments and malformed targeted messages fail closed with safe errors',()=>{
 const cases=[message('Item\u0001Name'),message('Item\tName'),message('Item\u202eName'),message('x'.repeat(251)),message('x'.repeat(17000)),verified.slice(0,-1),message('Item',{number:0}),message('Item',{time:'not a timestamp'})];
 for(const line of cases)assert.throws(()=>parseLootChannelLine(line),error=>error instanceof ChatLootError&&error.status===400&&typeof error.code==='string');
 assert.throws(()=>parseLootChannelLine(verified,{channelName:'abfloot.*'}),/channel name/);
 assert.throws(()=>parseChatLootSources(source('No matching channel')),error=>error.code==='empty_loot');
});

test('batch limits enforce 200 matched messages, 1000 pieces and 50 copies while ignoring unrelated log volume',()=>{
 const ignored=Array(500).fill('Some unrelated line').join('\n');assert.equal(parseChatLootSources(source(ignored+'\n'+message('Item'))).totalPieces,1);
 assert.equal(parseChatLootSources(source(Array.from({length:200},(_,i)=>message('Item '+i)).join('\n'))).totalPieces,200);
 assert.throws(()=>parseChatLootSources(source(Array.from({length:201},(_,i)=>message('Item '+i)).join('\n'))),error=>error.code==='too_many_messages');
 assert.equal(parseChatLootSources(source(message(Array.from({length:1000},(_,i)=>'Item '+i).join('|')))).totalPieces,1000);
 assert.throws(()=>parseChatLootSources(source(message(Array.from({length:1001},(_,i)=>'Item '+i).join('|')))),error=>error.code==='too_many_pieces');
 assert.equal(parseChatLootSources(source(message(Array(50).fill('Item').join('|')))).rows[0].quantity,50);
 assert.throws(()=>parseChatLootSources(source(message(Array(51).fill('Item').join('|')))),error=>error.code==='too_many_copies');
 assert.throws(()=>parseChatLootSources(source('x'.repeat(1024*1024+1))),error=>error.status===413&&error.code==='too_large');
});

test('source configuration and original lines remain auditable across files and pasted chat',()=>{
 const result=parseChatLootSources({chatCapture:{channelName:'ABFLOOT',allowedSenders:[' You ']},text:message(' Item   of Testing '),files:[{name:'eqlog.txt',text:message('item of testing'),format:'log'}]});
 assert.equal(result.sources.length,2);assert.equal(result.rows.length,1);assert.equal(result.rows[0].quantity,2);assert.equal(result.rows[0].normalizedName,'item of testing');assert.equal(result.rows[0].rawLines[1].sourceName,'eqlog.txt');assert.deepEqual(result.sources[0].chatCapture,{channelName:'ABFLOOT',allowedSenders:['you']});
 assert.throws(()=>parseChatLootSources({files:[{name:'eqlog.txt',text:verified,format:'names'}]}),/log sources/);
});
test('long empty delimiter runs produce one bounded warning and preserve the real item',()=>{
 const line="[Thu Nov 12 00:28:33 2026] You tell abfloot:4, '"+'|'.repeat(12000)+"Sample Ring'";
 const parsed=parseLootChannelLine(line);
 assert.equal(parsed.items.length,1);assert.equal(parsed.items[0].name,'Sample Ring');assert.equal(parsed.warnings.length,1);
 assert.ok(JSON.stringify(parsed).length<14000);
});
