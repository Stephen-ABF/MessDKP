import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\nstart\(\);\s*$/,'\n');
function presentation(){
 const element=()=>({addEventListener(){},querySelectorAll(){return[];},querySelector(){return element();}});
 const context=vm.createContext({document:{querySelector:element,querySelectorAll(){return[];},addEventListener(){}},window:{location:{origin:'https://guild.test'},addEventListener(){}},URL,URLSearchParams,Date,Map,Set,WeakMap,crypto,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}});
 vm.runInContext(source,context,{filename:'guild-desk-presentation.js'});
 return vm.runInContext('({itemMetadata,itemStatSections,itemEffects,safeItemImage})',context);
}
const item=(overrides={})=>({itemId:900001,name:'Fixture equipment',classes:['CLR'],races:['ALL'],slots:['HEAD'],flags:['LORE','NO TRADE'],stats:{ac:20},metadataComplete:false,sourceUrl:'https://items.eqresource.com/items.php?id=900001',details:{effects:[],effectRecords:[],augments:['Type 7'],fields:[]},...overrides});

test('zero stats and levels are hidden independently while negatives, nonzero heroics and spell damage remain',()=>{
 const view=presentation();
 const html=view.itemStatSections({ac:0,hp:'0',mana:'15',endurance:'0.00',requiredLevel:0,recommendedLevel:' 0 ',strength:0,heroicStrength:7,stamina:8,heroicStamina:'0',magicResist:-15,fireResist:'-4',healAmount:'0',spellDamage:13,clairvoyance:0,haste:'-0',zeroExtra:'0e0',positiveExtra:9});
 for(const label of ['AC','HP','END','Required level','Recommended level','STR','Heroic STA','Heal amount','Clairvoyance','haste','zero Extra'])assert.doesNotMatch(html,new RegExp(`<dt>${label}:<\\/dt>`));
 assert.match(html,/<dt>Heroic STR:<\/dt><dd>7<\/dd>/);assert.match(html,/<dt>STA:<\/dt><dd>8<\/dd>/);
 assert.match(html,/<dt>MAGIC:<\/dt><dd>-15<\/dd>/);assert.match(html,/<dt>FIRE:<\/dt><dd>-4<\/dd>/);
 assert.match(html,/<dt>Spell damage:<\/dt><dd>13<\/dd>/);assert.match(html,/<dd>9<\/dd>/);assert.doesNotMatch(html,/<dd>0(?:\.0+)?<\/dd>/);
 });

test('hover and full item panes retain identity, eligibility and augment data without zero or technical effect fields',()=>{
 const view=presentation(),fixture=item({stats:{ac:25,requiredLevel:'0',heroicStrength:0},details:{effects:[],augments:['Type 7','Type 3'],fields:[{label:'clicklevel',value:80},{label:'clicktype',value:3},{label:'wornlevel2',value:5},{label:'focusunk1',value:7},{label:'procrate',value:-1},{label:'focuseffect',value:3660},{label:'Zero field',value:'0'},{label:'_unk012',value:-1},{label:'UNKNOWN007',value:42},{label:'Negative value',value:-2}]}});
 for(const compact of [true,false]){const html=view.itemMetadata(fixture,compact);for(const text of ['Fixture equipment','LORE, NO TRADE','Slot:','HEAD','Class:','CLR','Race:','All (verified)','Augment slots','Type 7','Type 3'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/clicklevel|clicktype|wornlevel|focusunk|procrate|focuseffect|3660|Zero field|_unk012|UNKNOWN007|<dd>0<\/dd>/i);}
 assert.match(view.itemMetadata(fixture,false),/Negative value<\/dt><dd>-2/);assert.doesNotMatch(view.itemMetadata(fixture,true),/All available item fields/);
 });

test('structured effects show friendly Click, Worn and Focus names only, ignoring technical fields and stale legacy values',()=>{
 const view=presentation(),fixture=item({details:{effectRecords:[{kind:'click',name:'Fixture Ward',resolvedName:'Wrong cached name',spellId:101,type:5,level:80,level2:90},{kind:'worn',name:'Fixture Dodge',spellId:102},{kind:'focus',name:'Fixture Preservation',spellId:103},{kind:'proc',name:'Unwanted Proc',spellId:104},{kind:'scroll',name:'Unwanted Scroll',spellId:105},{kind:'bard',name:'Unwanted Bard',spellId:106}],effects:['Focus: Stale Legacy Name'],fields:[],augments:[]}});
 for(const compact of [true,false]){const html=view.itemMetadata(fixture,compact);for(const [kind,name]of[['Click','Fixture Ward'],['Worn','Fixture Dodge'],['Focus','Fixture Preservation']])assert.match(html,new RegExp(`${kind}:<\\/span> ${name}`));assert.doesNotMatch(html,/Unwanted|Stale Legacy|Wrong cached name|Spell #|level2|clicktype|clicklevel/i);}
 });

test('legacy effect fallback keeps clean named allowed effects, strips cast metadata and deduplicates repeated names',()=>{
 const view=presentation(),fixture=item({details:{effects:['Click: Fixture Ward (Casting Time: 3.0)','Worn: Fixture Dodge','Focus: Fixture Preservation','Focus: Fixture Preservation','Proc: Unwanted Proc','clicklevel: 80','worn type: 3','Focus Unk: 5','Focus: Spell #3660','Click: 0','Worn: 123 (Level: 10)'],fields:[],augments:[]}});
 const html=view.itemMetadata(fixture,true);for(const name of ['Fixture Ward','Fixture Dodge','Fixture Preservation'])assert.ok(html.includes(name));assert.equal((html.match(/Fixture Preservation/g)||[]).length,1);assert.doesNotMatch(html,/Casting Time|Unwanted Proc|clicklevel|worn type|Focus Unk|3660|Level:|Click:<\/span> 0/i);
 });

test('unresolved effect IDs are never fabricated as friendly names and irrelevant proc-only effects stay absent',()=>{
 const view=presentation();let html=view.itemMetadata(item({details:{effectRecords:[{kind:'focus',name:null,spellId:3660}],effects:['Focus: Spell #3660'],fields:[],augments:[]}}),true);assert.match(html,/Effect name unavailable in current reference/);assert.doesNotMatch(html,/3660|Spell #|<section class="eq-effects"/);
 html=view.itemMetadata(item({details:{effectRecords:[{kind:'proc',name:'Unwanted weapon effect',spellId:900}],fields:[],augments:[]}}),false);assert.doesNotMatch(html,/Unwanted weapon effect|Effect name unavailable|<section class="eq-effects"/);
 });

test('presentation escapes friendly names and preserves the immutable source object while excluding raw source dumps',()=>{
 const view=presentation(),fixture=item({name:'Fixture <script>',stats:{ac:0,heroicStrength:4},details:{effectRecords:[{kind:'focus',name:'Preservation <img src=x onerror=bad>'}],effects:[],fields:[{label:'clicklevel',value:75}],augments:['Type 7'],sourceText:'clicklevel:75; procrate:12; raw source fixture'}}),before=JSON.stringify(fixture);
 const html=view.itemMetadata(fixture,false);assert.match(html,/Fixture &lt;script&gt;/);assert.match(html,/Preservation &lt;img/);assert.doesNotMatch(html,/<script>|<img src=x|raw source fixture|clicklevel|procrate/);assert.equal(JSON.stringify(fixture),before);
 });

test('an all-zero item has no empty numeric sections and retains its augment slots',()=>{
 const view=presentation(),html=view.itemMetadata(item({stats:{ac:0,hp:'0',requiredLevel:0,heroicDexterity:'0'}}),true);assert.doesNotMatch(html,/eq-stat-section|<dt>AC:|<dt>HP:|Required level|Heroic DEX/);assert.match(html,/Augment slots/);assert.match(html,/Type 7/);
 });


test('resolved spell names render without their numeric IDs and image URLs remain local until an icon provider is approved',()=>{
 const view=presentation(),html=view.itemMetadata(item({details:{effectRecords:[{kind:'worn',spellId:3660,name:'Faerune',nameSource:'Fixture spell-name cache'}],fields:[],augments:[]}}),true);
 assert.match(html,/Worn:<\/span> Faerune/);assert.doesNotMatch(html,/3660|Spell #/);
 assert.equal(view.safeItemImage('/assets/item-icons/100.png'),'https://guild.test/assets/item-icons/100.png');
 for(const url of ['https://items.eqresource.com/icons/100.png','https://evil.test/100.png','javascript:alert(1)','data:image/png;base64,AAAA','https://name:password@guild.test/assets/item.png'])assert.equal(view.safeItemImage(url),null);
});
