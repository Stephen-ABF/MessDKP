import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItemName, discoverNameSearchForm, parseSearchCandidates, searchItemsByName, parseItemDetails, fetchItemDetails, SourceError } from '../worker/eqresource.mjs';

// The forms below are synthetic protocol fixtures, NOT captured EQResource HTML.
// They prove field discovery/security behavior without claiming the current site's markup was verified.
const form='<form action="/itemsearch.php" method="post"><label for="n">Item Name:</label><input id="n" name="discovered_name_control" type="text"><input type="hidden" name="form_version" value="public"><input type="submit" name="go" value="Search"></form>';
const result='<div>Total results: 2</div><a href="/items.php?id=44354">Ancient Pearlescent Mask</a><a href="https://items.eqresource.com/items.php?id=123">Ancient Mask</a>';

// Primary-source indexed item text from https://items.eqresource.com/items.php?id=44354.
// This excerpt is factual item data; synthetic HTML wrappers are only parser test containers.
const mask=`Ancient Pearlescent Mask
Magic, No Trade
Class: Monk
Race: Drakkin, Froglok, Human, Iksar
Slot: Face
Size:
Weight:
SMALL
0.1
AC:
5
Agility:
5
Magic:
10
Effect: Serpent Sight - Worn
Item Lore: Ancient Pearlescent Mask
Misc Item Values
Advanced Loot: 44354^772^Ancient Pearlescent Mask
Merchant Buys For: Not Sellable
Merchant Sells For: Not Buyable
Stack Size: 1
Checked: Nov 2, 2016, 03:37 AM
Updated: Sep 3, 2014, 06:26 AM
No known sources for this item.`;
const page=body=>'<html><head><title>EQ Resource</title></head><body><nav>Site navigation and unrelated text</nav><article>'+body.replace(/\n/g,'<br>')+'</article><h2>Questions? Comments? Post them here!</h2><p>Forum comment not part of item</p><footer>Copyright unrelated site footer</footer></body></html>';
const response=(body,status=200,headers={})=>new Response(body,{status,headers:{'Content-Type':'text/html',...headers}});

// Basic Item Search form DOM excerpt observed in the live browser at
// https://items.eqresource.com/itemsearch.php on November 12, 2026.
// This is the actual form contract, unlike the synthetic compatibility forms.
const observedBasicForm='<form method="post" action="dosearch.php"><input type="text" id="name" name="name" style="width:150px;"><input type="hidden" id="searched" name="searched"><input type="Submit" value="Submit" name="Submit"></form>';

test('name normalization preserves punctuation and discovery uses actual labeled controls rather than guessed search parameters',()=>{
 assert.equal(normalizeItemName(' Ancient   Pearlescent Mask '),'ancient pearlescent mask');
 assert.notEqual(normalizeItemName("A's Ring"),normalizeItemName('As Ring'));
 const discovered=discoverNameSearchForm(form);assert.equal(discovered.nameField,'discovered_name_control');assert.equal(discovered.method,'POST');assert.equal(discovered.action,'https://items.eqresource.com/itemsearch.php');assert.deepEqual(discovered.params,[['form_version','public'],['go','Search']]);
 assert.throws(()=>discoverNameSearchForm(form+form),/could not be identified safely/);
 assert.equal(discoverNameSearchForm('<!--'+form+'--><script>'+form+'</script>'+form).nameField,'discovered_name_control');
 assert.throws(()=>discoverNameSearchForm(form.replace('/itemsearch.php','https://other.example/search')),/could not be identified safely/);
});

test('live observed Basic Item Search posts name, empty searched and Submit to its dedicated dosearch action',async()=>{
 // The text label sits outside the source form; the unambiguous observed name
 // control is accepted only on this dedicated landing/action contract.
 const landing='<h2>Basic Item Search</h2><table><tr><td>Item Name:</td><td>'+observedBasicForm+'</td></tr></table>';
 const calls=[],query="Froglok Bonecaster's Robe";
 // Result identities/destination observed after that live form submission. The
 // wrapper and 302 status simulate the ordinary redirect protocol; a raw HTTP
 // response/redirect-status capture is not claimed by this DOM regression.
 const observedResults='<p>Total results: 3</p><a href="/items.php?id=146278">Darkened Froglok Bonecaster\'s Robe</a><a href="/items.php?id=82707">Fabled Froglok Bonecaster\'s Robe</a><a href="/items.php?id=1608">Froglok Bonecaster\'s Robe</a>';
 const found=await searchItemsByName(query,{fetchImpl:async(url,options)=>{calls.push({url,options});if(calls.length===1)return response(landing);if(calls.length===2){assert.equal(url,'https://items.eqresource.com/dosearch.php');assert.equal(options.method,'POST');assert.deepEqual([...new URLSearchParams(options.body)],[['searched',''],['Submit','Submit'],['name',query]]);return response('',302,{Location:'/itemsearch.php?searchid=164526'});}assert.equal(url,'https://items.eqresource.com/itemsearch.php?searchid=164526');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return response(observedResults);}});
 assert.equal(calls[0].url,'https://items.eqresource.com/itemsearch.php');assert.equal(found.status,'matched');assert.equal(found.exactMatch.name,query);assert.equal(found.exactMatch.itemId,1608);assert.deepEqual(found.candidates.map(c=>c.itemId),[146278,82707,1608]);
 assert.throws(()=>discoverNameSearchForm(landing.replace('dosearch.php','https://other.example/dosearch.php')),/could not be identified safely/);
 assert.throws(()=>discoverNameSearchForm(landing.replace('dosearch.php','search.php')),/could not be identified safely/);
 assert.throws(()=>discoverNameSearchForm(landing.replace('method="post"','method="get"')),/could not be identified safely/);
});
test('only one exact complete name match is automatically selected; ambiguous, conflicting, or paginated results require review',()=>{
 const parsed=parseSearchCandidates(result,'Ancient Pearlescent Mask');assert.equal(parsed.exactMatch.itemId,44354);assert.equal(parsed.candidates.length,2);
 assert.equal(parseSearchCandidates(result+'<a href="/items.php?id=456">Ancient Pearlescent Mask</a>','Ancient Pearlescent Mask').exactMatch,null);
 assert.equal(parseSearchCandidates(result.replace('Total results: 2','Total results: 500'),'Ancient Pearlescent Mask').exactMatch,null);
 assert.equal(parseSearchCandidates(result+'<a href="/items.php?id=44354">Different Name</a>','Ancient Pearlescent Mask').exactMatch,null);
 const unsafe='<a href="https://evil.example/items.php?id=44354">Ancient Pearlescent Mask</a><a href="javascript:alert(1)">bad</a><a href="/items.php?id=5&id=6">bad</a><a href="/items.php?id=1">Previous Item ID</a>';
 assert.deepEqual(parseSearchCandidates(unsafe,'bad').candidates,[]);
 assert.deepEqual(parseSearchCandidates('<script>'+result+'</script><!--'+result+'-->','Ancient Pearlescent Mask').candidates,[]);
});
test('search submits the discovered public form, follows only same-source redirects, and handles anonymous source cookies',async()=>{
 const calls=[];
 const found=await searchItemsByName('Ancient Pearlescent Mask',{fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(calls.length===1)return response(form,200,{'Set-Cookie':'public_search=abc; Path=/; Secure'});
  if(calls.length===2){assert.equal(options.method,'POST');const data=new URLSearchParams(options.body);assert.equal(data.get('discovered_name_control'),'Ancient Pearlescent Mask');assert.equal(data.get('form_version'),'public');assert.equal(options.headers.Cookie,'public_search=abc');return response('',303,{Location:'/itemsearch.php?searchid=42'});}
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);return response(result);
 }});
 assert.equal(found.status,'matched');assert.equal(found.exactMatch.itemId,44354);assert.equal(calls.length,3);
});
test('GET forms use only observed controls and incomplete or missing forms fail closed',async()=>{
 const calls=[];const getForm=form.replace('method="post"','method="get"');
 const found=await searchItemsByName('Ancient Pearlescent Mask',{fetchImpl:async(url)=>{calls.push(url);return response(calls.length===1?getForm:result);}});
 assert.equal(found.status,'matched');assert.equal(new URL(calls[1]).searchParams.get('discovered_name_control'),'Ancient Pearlescent Mask');
 const unknown=await searchItemsByName('Example',{fetchImpl:async()=>response('<p>No recognized public form</p>')});assert.equal(unknown.status,'unavailable');assert.equal(unknown.code,'source_layout_unrecognized');
 assert.equal(unknown.message,unknown.reason);
 let count=0;const empty=await searchItemsByName('Example',{fetchImpl:async()=>response(++count===1?form:'<p>Total results: 0</p>')});assert.equal(empty.status,'not_found');
 count=0;const changed=await searchItemsByName('Example',{fetchImpl:async()=>response(++count===1?form:'<p>Service temporarily unavailable</p>')});assert.equal(changed.status,'unavailable');assert.equal(changed.code,'source_layout_unrecognized');
});

test('basic item search excludes a general site form and submits observed selected defaults without dropping name prefixes',async()=>{
 const basic='<form action="/itemsearch.php" method="post"><label for="item">Item Name:</label><input id="item" name="observed_name" type="text"><input type="checkbox" name="unchecked" value="yes"><input type="checkbox" name="include" value="all" checked><select name="mode"><option value="normal">Normal</option><option value="exact" selected>Exact</option></select><button type="submit" name="search_button" value="Search">Search</button></form>';
 const general='<form action="/search.php"><label for="site">Item Name:</label><input id="site" name="general_query" type="text"></form>';
 const name="Darkened Tolan's Helm",calls=[];
 const found=await searchItemsByName(name,{fetchImpl:async(url,options)=>{calls.push(url);if(calls.length===1)return response(general+basic);const data=new URLSearchParams(options.body);assert.equal(data.get('observed_name'),name);assert.equal(data.has('general_query'),false);assert.equal(data.has('unchecked'),false);assert.equal(data.get('include'),'all');assert.equal(data.get('mode'),'exact');assert.equal(data.get('search_button'),'Search');return response('<p>Total results: 3</p><a href="/items.php?id=1001">Tolan\'s Helm</a><a href="/items.php?id=1002">Darkened Tolan\'s Helm</a><a href="/items.php?id=1003">Fabled Tolan\'s Helm</a>');}});
 assert.equal(new URL(calls[0]).pathname,'/itemsearch.php');assert.equal(new URL(calls[1]).pathname,'/itemsearch.php');assert.equal(found.exactMatch.itemId,1002);
 assert.notEqual(normalizeItemName("Fabled Tolan's Helm"),normalizeItemName("Tolan's Helm"));assert.notEqual(normalizeItemName(name),normalizeItemName("Tolan's Helm"));
 assert.throws(()=>discoverNameSearchForm(general),/could not be identified safely/);
});
test('403, network errors, oversized pages, unexpected types and unsafe redirects never produce fake item matches',async()=>{
 for(const fetchImpl of [async()=>response('Forbidden',403),async()=>{throw new Error('DNS unavailable');},async()=>response('',200,{'Content-Length':String(1024*1024+1)}),async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),async()=>response('',302,{Location:'https://evil.example/collect'})]){
  const found=await searchItemsByName('Ancient Pearlescent Mask',{fetchImpl});assert.equal(found.status,'unavailable');assert.deepEqual(found.candidates,[]);assert.equal(found.exactMatch,null);
 }
});
test('detail extraction preserves actual source fields and effects while excluding navigation, comments and executable content',()=>{
 const html=page(mask)+'<script>stolenCredentials()</script>';
 const item=parseItemDetails(html,44354,{retrievedAt:'2026-11-12T00:00:00Z'});
 assert.equal(item.name,'Ancient Pearlescent Mask');assert.deepEqual(item.classes,['MNK']);assert.deepEqual(item.races,['Drakkin','Froglok','Human','Iksar']);assert.deepEqual(item.slots,['FACE']);assert.equal(item.stats.ac,5);assert.equal(item.stats.agility,5);assert.equal(item.stats.magicResist,10);assert.equal(item.stats.weight,.1);assert.deepEqual(item.details.effects,['Effect: Serpent Sight - Worn']);assert.equal(item.details.lore,'Ancient Pearlescent Mask');assert.equal(item.sourceCheckedAt,'Nov 2, 2016, 03:37 AM');assert.equal(item.metadataComplete,false);
 assert.match(item.details.sourceText,/Advanced Loot: 44354\^772/);assert.doesNotMatch(item.details.sourceText,/navigation|Forum comment|Copyright|stolenCredentials/);assert.equal(item.iconUrl,null);
});

test('observed item post structure isolates the collector tables from its duplicate page H1 and later comments',()=>{
 // Compact structure/value excerpt from live browser DOM of item1608 on
 // November12,2026: outer H1, .postcontent, nested gold item table, adjacent
 // label/value columns, then separate Misc Item Values and Item Updates tables.
 // Omitted unrelated source fields are not implied to be absent in the game.
 const post='<div class="postcontent"><center><table width="600" border="1" bordercolor="#FFCC00"><tr><td><table width="580"><tr><td colspan="3"><font size="+1"><b><center>Froglok Bonecaster\'s Robe<br><br></center></b></font></td></tr><tr><td><img src="itemimages/929.png" loading="lazy"></td><td colspan="2">Magic, Lore<br>Class: Enchanter, Magician, Necromancer, Wizard<br>Race: All<br>Slot: Chest<br><br></td></tr></table><div><table><tr><td>Size:<br>Weight:<br>Tribute:<br></td><td>MEDIUM<br>3.5<br>1950<br></td><td>AC:<br>Mana:<br></td><td>10<br>40<br></td></tr><tr><td>Strength:<br>Intelligence:<br></td><td>8<br>8<br></td><td>Magic:<br>Fire:<br></td><td>10<br>10<br></td></tr></table></div>Type 21 (Armor: Ornamentation)<br>Type 7 (General: Group) - Find an Aug<br>Item Lore: Froglok Bonecaster\'s Robe<br></td></tr></table><table width="600"><tr><td>Misc Item Values<br>Advanced Loot: 1608^929^Froglok Bonecaster\'s Robe<br>Merchant Buys For: 3.333p<br>Merchant Sells For: 106.575p<br>Stack Size: 1<br></td></tr></table><table width="600"><tr><td>Item Updates<br>Checked: Nov 16, 2025, 04:26 PM<br>Updated: Apr 21, 2022, 10:27 PM<br></td></tr></table></center></div>';
 const comment='<div class="postcontent">A later public comment<br>Class: Warrior<br>AC: 99999<br>Froglok Bonecaster\'s Robe</div>';
 const item=parseItemDetails('<h1>FROGLOK BONECASTER\'S ROBE</h1>'+post+comment,1608);
 assert.equal(item.name,"Froglok Bonecaster's Robe");assert.deepEqual(item.classes,['ENC','MAG','NEC','WIZ']);assert.deepEqual(item.races,['ALL']);assert.deepEqual(item.slots,['CHEST']);assert.equal(item.stats.ac,10);assert.equal(item.stats.mana,40);assert.equal(item.stats.strength,8);assert.equal(item.stats.intelligence,8);assert.equal(item.stats.magicResist,10);assert.equal(item.stats.fireResist,10);assert.equal(item.stats.weight,3.5);assert.equal(item.stats.tribute,1950);assert.equal(item.iconUrl,'https://items.eqresource.com/itemimages/929.png');assert.equal(item.sourceCheckedAt,'Nov 16, 2025, 04:26 PM');assert.equal(item.sourceUpdatedAt,'Apr 21, 2022, 10:27 PM');assert.deepEqual(item.details.augments,['Type 21 (Armor: Ornamentation)','Type 7 (General: Group)']);assert.doesNotMatch(item.details.sourceText,/99999|later public comment|FROGLOK/);
 assert.throws(()=>parseItemDetails(post.replace('1608^929','999^929')+comment,1608),/requested item safely/);
 assert.throws(()=>parseItemDetails(post.replace(/<\/div>$/,'')+comment,1608),/post boundary/);
});

test('item eligibility is scoped after the requested heading and never taken from page navigation',()=>{
 // Synthetic auditor regression: these are layout controls, not the item's eligibility.
 const chrome='<header>Class: Warrior<br>Slot: Head</header><nav>Class: All<br>Slot: Range</nav>';
 const item=parseItemDetails(chrome+page(mask)+'<footer>Class: All<br>Slot: Range</footer>',44354);
 assert.deepEqual(item.classes,['MNK']);assert.deepEqual(item.slots,['FACE']);
 assert.doesNotMatch(item.details.sourceText,/Class: All|Class: Warrior|Slot: Range|Slot: Head/);
 assert.throws(()=>parseItemDetails(page(mask.replace('Ancient Pearlescent Mask\nMagic','Missing heading\nMagic')),44354),/heading/);
 assert.throws(()=>parseItemDetails(page(mask.replace('Magic, No Trade','Ancient Pearlescent Mask\nMagic, No Trade')),44354),/heading/);
 assert.throws(()=>parseItemDetails(page(mask.replace('Class: Monk','Class: All\nClass: Monk')),44354),/ambiguous/);
 assert.throws(()=>parseItemDetails(page(mask.replace('Advanced Loot:','Questions? Comments?\nAdvanced Loot:')),44354),/panel boundary/);
});
test('label/value groups and heroic stats stay exact, unknown fields remain present, and images require an actual matching same-source src',()=>{
 // Synthetic layout around numerical facts verified on source item81773; not claimed as captured markup.
 const text=`Blood of the Dhampyre\nMagic, Lore, No Trade, Placeable\nClass: All\nRace: All\nSlot: Range\nAC:\nHP:\nMana:\nEnd:\n104\n2006\n1984\n1984\nStrength:\n21 + 7\nUnknown Future Field: preserved source value\nFocus: Corrupted Sylvan's Rot II\nType 7 (General: Group) - Find an Aug\nAdvanced Loot: 81773^1557^Blood of the Dhampyre`;
 const item=parseItemDetails(page(text)+'<img src="https://evil.example/1557.png"><img src="/itemimages/1557.png">',81773);
 assert.deepEqual(item.classes,['ALL']);assert.equal(item.stats.hp,2006);assert.equal(item.stats.mana,1984);assert.equal(item.stats.endurance,1984);assert.equal(item.stats.strength,21);assert.equal(item.stats.heroicStrength,7);assert.equal(item.iconUrl,'https://items.eqresource.com/itemimages/1557.png');assert.ok(item.details.fields.some(f=>f.label==='Unknown Future Field'&&f.value==='preserved source value'));assert.deepEqual(item.details.augments,['Type 7 (General: Group)']);
});
test('mismatched item IDs and unrecognized classes do not fabricate eligibility or wrong-item metadata',async()=>{
 assert.throws(()=>parseItemDetails(page(mask),81773),/requested item safely/);
 assert.throws(()=>parseItemDetails(mask,44354),/panel boundary/);
 const unknown=parseItemDetails(page(mask.replace('Class: Monk','Class: Unrecognized future class')),44354);assert.equal(unknown.classes,null);assert.equal(unknown.details.fields.find(f=>f.label==='Class').value,'Unrecognized future class');
 await assert.rejects(fetchItemDetails(44354,{fetchImpl:async()=>response('Forbidden',403)}),error=>error instanceof SourceError&&error.code==='source_access_unavailable'&&error.status===503);
 await assert.rejects(fetchItemDetails('javascript:alert(1)'),error=>error instanceof SourceError&&error.code==='invalid_item_id');
});
test('the live detail adapter returns the canonical item object and surfaces network failure rather than a fabricated cache hit',async()=>{
 const item=await fetchItemDetails(44354,{fetchImpl:async(url,options)=>{assert.equal(url,'https://items.eqresource.com/items.php?id=44354');assert.equal(options.redirect,'manual');return response(page(mask));}});
 assert.equal(item.itemId,44354);assert.equal(item.metadataStatus,'verified_reference');assert.ok(Array.isArray(item.details.fields));
 await assert.rejects(fetchItemDetails(44354,{fetchImpl:async()=>{throw new Error('No network');}}),error=>error.code==='source_unavailable');
});
