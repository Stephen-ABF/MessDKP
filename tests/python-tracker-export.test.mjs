import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {parseRaidLootImport} from '../worker/raid-loot-import.mjs';

const helper=fileURLToPath(new URL('../companion/guild_desk_export.py',import.meta.url));
function findPython(){
 const candidates=[process.env.GUILD_DESK_TEST_PYTHON,process.env.CODEX_PRIMARY_RUNTIME_PYTHON,'python3','python'].filter(Boolean).map(command=>({command,args:[]}));
 candidates.push({command:'py',args:['-3']});
 for(const candidate of candidates){const check=spawnSync(candidate.command,[...candidate.args,'-c','import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)'],{encoding:'utf8',timeout:5000,windowsHide:true});if(check.status===0)return candidate;}
 return null;
}
const python=findPython();
const options=python?{}:{skip:'Python 3.8+ unavailable; set GUILD_DESK_TEST_PYTHON to run tracker export checks.'};
const preamble=String.raw`
import sys, ast, importlib.util, json, copy, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
helper_path = Path(sys.argv[1])
ast.parse(helper_path.read_text(encoding='utf-8'), feature_version=(3, 8))
spec = importlib.util.spec_from_file_location('guild_desk_export_test', str(helper_path))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert 'tkinter' not in sys.modules
def row(**overrides):
    value = {'id':1,'timestamp':'20:15:16','looter':'HolderOne','item':'Fixture Ring','qty':2,'source':'Fixture Boss','selected':True,'status':''}
    value.update(overrides)
    return value
def bind(bindings):
    for value, identity in bindings:
        value[m.ROW_ID_KEY] = identity
`;
function run(code){assert.ok(python);const result=spawnSync(python.command,[...python.args,'-c',preamble+'\n'+code,helper],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);return result.stdout.trim()?JSON.parse(result.stdout):null;}

test('published Windows launcher version probes contain valid Python without caret escaping',options,()=>{
 const launcher=readFileSync(new URL('../companion/Start-Python-Tracker-Guild-Desk.cmd',import.meta.url),'utf8');const probes=[...launcher.matchAll(/(?:py -3|python) -c "([^"]+)"/g)].map(match=>match[1]);assert.equal(probes.length,2);
 for(const probe of probes){assert.ok(!probe.includes('^'));run('compile('+JSON.stringify(probe)+', "launcher-probe", "exec")');}
});

test('UI adapter preserves original clipboard methods and tags live, manual and loaded rows without running Tk',options,()=>{
 run(String.raw`
import types
fake_tk = types.ModuleType('tkinter')
fake_tk.filedialog = types.SimpleNamespace()
fake_tk.messagebox = types.SimpleNamespace()
fake_tk.simpledialog = types.SimpleNamespace()
sys.modules['tkinter'] = fake_tk
class Original:
    def _export_opendkp(self): return 'original-opendkp'
    def _export_excel(self): return 'original-excel'
    def _mark_exported(self, rows): raise AssertionError('Guild Desk must not call original export marking')
    def _add_loot_row(self, looter, qty, item_name, source, source_tag='new'):
        self.loot_rows.append(row(looter=looter,qty=qty,item=item_name,source=source))
    def _load_log_range(self, hours=24):
        self._add_loot_row('Holder',1,'History Ring','Boss')
        self.loot_rows[-1]['timestamp'] = '2026-11-12 20:15:16' if hours is None else '20:15:16'
wrapped = m.create_wrapped_tracker_class(types.SimpleNamespace(EQLootTracker=Original), Path('private-state'), Path('original.py'))
assert wrapped._export_opendkp is Original._export_opendkp
assert wrapped._export_excel is Original._export_excel
app = object.__new__(wrapped); app.loot_rows = []
app._add_loot_row('Holder', 1, 'Live Ring', 'Boss')
app._add_loot_row('Holder', 1, 'Manual Ring', 'Boss', source_tag='pending')
app._load_log_range(hours=24)
app._load_log_range(hours=None)
assert [value['_guild_desk_time_kind'] for value in app.loot_rows] == ['tracker-clock','manual','log-history','log-history']
assert app.loot_rows[0]['_guild_desk_new_event'] is True
assert app.loot_rows[1]['_guild_desk_new_event'] is True
assert '_guild_desk_new_event' not in app.loot_rows[2]
assert app._export_opendkp() == 'original-opendkp' and app._export_excel() == 'original-excel'
`);
});

test('UI export rejects the active log and helper itself as output destinations',options,()=>{
 run(String.raw`
import types
fake_tk = types.ModuleType('tkinter')
failures = []
fake_tk.messagebox = types.SimpleNamespace(showerror=lambda title, message, **kwargs: failures.append(message), showinfo=lambda *args, **kwargs: None)
fake_tk.simpledialog = types.SimpleNamespace(askstring=lambda *args, **kwargs: '2026-11-12')
sys.modules['tkinter'] = fake_tk
class Original: pass
with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary); source_log = folder/'active-eq.log'
    source_log.write_text('original game log',encoding='utf-8')
    fake_tk.filedialog = types.SimpleNamespace(asksaveasfilename=lambda **kwargs: str(source_log))
    wrapped = m.create_wrapped_tracker_class(types.SimpleNamespace(EQLootTracker=Original),folder/'private-state',folder/'original.py')
    app = object.__new__(wrapped); app.loot_rows = [row()]
    app._selected_rows = lambda: app.loot_rows
    app.log_path_var = types.SimpleNamespace(get=lambda: str(source_log))
    app._export_guild_desk()
    assert failures and source_log.read_text(encoding='utf-8') == 'original game log'
    assert not (folder/'private-state'/'python-tracker-identities.json').exists()
    before = helper_path.read_bytes()
    fake_tk.filedialog.asksaveasfilename = lambda **kwargs: str(helper_path)
    app._export_guild_desk()
    assert len(failures) == 2 and helper_path.read_bytes() == before
`);
});

test('Python helper is 3.8-compatible and headless; statuses, settings and source evidence remain honest',options,()=>{
 run(String.raw`
rows = [row(), row(id=2, timestamp='2026-11-12 20:15:17', item='Fixture Cloak', status='Exported'), row(id=3, timestamp='20:16:18', item='Manual Ring', _guild_desk_time_kind='manual')]
before = copy.deepcopy(rows)
payload, state, bindings = m.build_export(rows, '2026-11-12')
assert rows == before
assert payload['format'] == 'guild-desk-loot-events' and payload['version'] == 1
assert payload['events'][0]['observedAt'] is None
assert payload['events'][0]['timeKind'] == 'tracker-clock'
assert payload['events'][1]['observedAt'] == '2026-11-12T20:15:17'
assert payload['events'][1]['timeKind'] == 'log-history'
assert payload['events'][1]['trackerStatus'] == 'Exported'
assert payload['events'][2]['timeKind'] == 'manual'
assert all(event['rawLine'] is None for event in payload['events'])
assert all(not (event['observedAt'] or '').endswith('Z') for event in payload['events'])
`);
});

test('all-row occurrence identities survive repeat, overlap, deleted duplicate and mutable tracker counters/statuses',options,()=>{
 run(String.raw`
rows = [row(), row(id=2)]
payload, state, bindings = m.build_export(rows, '2026-11-12', scope='same-log')
bind(bindings)
first, second = [event['id'] for event in payload['events']]
assert first != second
rows[0]['id'] = 99; rows[0]['status'] = 'Exported'; rows[0]['selected'] = False
overlap, state, bindings = m.build_export(rows, '2026-11-12', state, 'same-log', [rows[1]])
assert overlap['events'][0]['id'] == second
repeat, state, bindings = m.build_export(rows, '2026-11-12', state, 'same-log', [rows[0]])
assert repeat['events'][0]['id'] == first
after_delete, state, bindings = m.build_export([rows[1]], '2026-11-12', state, 'same-log')
assert after_delete['events'][0]['id'] == second
new_live = row(id=3, _guild_desk_new_event=True)
new_export, state, bindings = m.build_export([new_live], '2026-11-12', state, 'same-log')
assert new_export['events'][0]['id'] not in (first, second)
bind(bindings)
same_live, state, bindings = m.build_export([new_live], '2026-11-12', state, 'same-log')
assert same_live['events'][0]['id'] == new_export['events'][0]['id']
`);
});

test('durable history replay recovers occurrence IDs while changed date/log context creates separate evidence',options,()=>{
 run(String.raw`
rows = [row(timestamp='2026-11-12 20:15:16'), row(id=2, timestamp='2026-11-12 20:15:16')]
original, state, bindings = m.build_export(rows, '2026-11-12', scope='log-A')
state = json.loads(json.dumps(state))
replay = [row(id=300, timestamp='2026-11-12 20:15:16'), row(id=301, timestamp='2026-11-12 20:15:16')]
again, state, bindings = m.build_export(replay, '2026-11-12', state, 'log-A')
assert [event['id'] for event in original['events']] == [event['id'] for event in again['events']]
bind(bindings)
different_date, state, bindings = m.build_export(replay, '2026-11-13', state, 'log-A')
different_log, state, bindings = m.build_export(replay, '2026-11-12', state, 'log-B')
assert {event['id'] for event in original['events']}.isdisjoint(event['id'] for event in different_date['events'])
assert {event['id'] for event in original['events']}.isdisjoint(event['id'] for event in different_log['events'])
`);
});

test('file export preserves original settings/status, keeps durable IDs and fails closed on locks or corrupt metadata',options,()=>{
 run(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary)
    state_path, destination, config = folder/'private-identities.json', folder/'export.json', folder/'original-settings.json'
    config.write_text('original settings remain unchanged', encoding='utf-8')
    rows = [row()]
    first = m.export_to_file(rows, '2026-11-12', destination, state_path, 'same-log', protected_paths=[config])
    assert config.read_text(encoding='utf-8') == 'original settings remain unchanged'
    assert rows[0]['status'] == '' and rows[0]['selected'] is True
    assert json.loads(destination.read_text(encoding='utf-8')) == first
    again = m.export_to_file(rows, '2026-11-12', folder/'overlap.json', state_path, 'same-log')
    assert first['events'][0]['id'] == again['events'][0]['id']
    lock_path = state_path.with_name(state_path.name+'.lock')
    lock_path.write_text('existing process', encoding='utf-8')
    try:
        m.export_to_file(rows, '2026-11-12', folder/'blocked.json', state_path, 'same-log')
        raise AssertionError('lock must block')
    except ValueError: pass
    assert not (folder/'blocked.json').exists() and lock_path.read_text() == 'existing process'
    lock_path.unlink()
    state_path.write_text('{broken', encoding='utf-8')
    try:
        m.export_to_file(rows, '2026-11-12', folder/'corrupt.json', state_path, 'same-log')
        raise AssertionError('corrupt metadata must block')
    except ValueError: pass
    assert not (folder/'corrupt.json').exists() and state_path.read_text() == '{broken'
    assert not lock_path.exists()
`);
});

test('failed output write retries safely and protected paths are never overwritten',options,()=>{
 run(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary); state_path = folder/'state.json'; rows = [row()]
    destination = folder/'existing-directory'; destination.mkdir()
    try:
        m.export_to_file(rows, '2026-11-12', destination, state_path, 'log')
        raise AssertionError('directory output must fail')
    except OSError: pass
    identifier = rows[0][m.ROW_ID_KEY]['id']
    result = m.export_to_file(rows, '2026-11-12', folder/'retry.json', state_path, 'log')
    assert result['events'][0]['id'] == identifier
    before = state_path.read_bytes()
    for protected in [state_path, state_path.with_name(state_path.name+'.lock')]:
        try:
            m.export_to_file(rows, '2026-11-12', protected, state_path, 'log')
            raise AssertionError('metadata path must be protected')
        except ValueError: pass
    assert before == state_path.read_bytes()
`);
});

test('invalid dates, quantities, fields and bounded selections reject before changing input data',options,()=>{
 run(String.raw`
for bad in [row(qty=0),row(qty=True),row(qty=100001),row(item='x'*251),row(looter='x'*65),row(timestamp='25:10:10'),row(timestamp='2026-02-30 12:00:00'),row(source='bad\nsource')]:
    before = copy.deepcopy(bad)
    try:
        m.build_export([bad], '2026-11-12')
        raise AssertionError('invalid event must fail')
    except ValueError: pass
    assert bad == before
for date in ['2026-02-30','2026-2-03','0000-01-01','2026-11-12T00:00:00Z']:
    try:
        m.build_export([row()], date)
        raise AssertionError('invalid date must fail')
    except ValueError: pass
try:
    m.build_export([row(id=n) for n in range(5001)], '2026-11-12')
    raise AssertionError('event cap must fail')
except ValueError: pass
try:
    m.build_export([row(id=n, qty=100000) for n in range(11)], '2026-11-12')
    raise AssertionError('unit cap must fail')
except ValueError: pass
good, state, bindings = m.build_export([row(qty=0, selected=False),row(id=2)], '2026-11-12')
assert len(good['events']) == 1
`);
});

test('Copy JSON and Save JSON share durable event identities without changing selected statuses',options,()=>{
 run(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    folder=Path(temporary); rows=[row(),row(id=2,selected=False)]; before=[(r['selected'],r['status']) for r in rows]; copied=[]
    payload=m.export_to_clipboard(rows,'2026-11-12',copied.append,folder/'state.json','fixture-log')
    assert len(copied)==1 and json.loads(copied[0])==payload and len(payload['events'])==1
    assert not list(folder.glob('*.json.tmp-*'))
    saved=m.export_to_file(rows,'2026-11-12',folder/'loot.json',folder/'state.json','fixture-log')
    assert saved['events']==payload['events']
    assert json.loads((folder/'loot.json').read_text(encoding='utf-8'))==saved
    assert [(r['selected'],r['status']) for r in rows]==before
`);
});

test('clipboard failures retain stable identity and corrupt metadata never clears the clipboard',options,()=>{
 run(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    folder=Path(temporary); rows=[row()]; calls=[]
    def unavailable(value):
        raise RuntimeError('Clipboard unavailable')
    try:
        m.export_to_clipboard(rows,'2026-11-12',unavailable,folder/'state.json','fixture-log')
        raise AssertionError('clipboard failure required')
    except RuntimeError: pass
    identifier=rows[0][m.ROW_ID_KEY]['id']
    copied=m.export_to_clipboard(rows,'2026-11-12',calls.append,folder/'state.json','fixture-log')
    assert copied['events'][0]['id']==identifier and len(calls)==1
    (folder/'state.json').write_text('invalid metadata',encoding='utf-8')
    try:
        m.export_to_clipboard(rows,'2026-11-12',calls.append,folder/'state.json','fixture-log')
        raise AssertionError('corruption must fail closed')
    except ValueError: pass
    assert len(calls)==1
`);
});

test('Copy JSON UI skips the save dialog and preserves original export methods',options,()=>{
 run(String.raw`
import types
fake_tk=types.ModuleType('tkinter'); infos=[]
fake_tk.messagebox=types.SimpleNamespace(showerror=lambda *a,**k: (_ for _ in ()).throw(AssertionError(a)),showinfo=lambda *a,**k: infos.append(a))
fake_tk.simpledialog=types.SimpleNamespace(askstring=lambda *a,**k:'2026-11-12')
fake_tk.filedialog=types.SimpleNamespace(asksaveasfilename=lambda **k: (_ for _ in ()).throw(AssertionError('Copy must not open Save')))
sys.modules['tkinter']=fake_tk
class Original:
    def _export_excel(self): return 'excel-original'
    def _export_opendkp(self): return 'opendkp-original'
with tempfile.TemporaryDirectory() as temporary:
    wrapped=m.create_wrapped_tracker_class(types.SimpleNamespace(EQLootTracker=Original),Path(temporary),Path(temporary)/'original.py')
    app=object.__new__(wrapped); app.loot_rows=[row()]; app._selected_rows=lambda:app.loot_rows
    copied=[];app.clipboard_clear=lambda:None;app.clipboard_append=copied.append;app.update_idletasks=lambda:None
    app._export_guild_desk('copy')
    assert len(copied)==1 and json.loads(copied[0])['events'][0]['itemName']=='Fixture Ring'
    assert app._export_excel()=='excel-original' and app._export_opendkp()=='opendkp-original'
    assert infos and infos[0][0]=='Copied for Guild Desk'
`);
});

test('Python structured export round-trips through the actual JavaScript tracker import parser',options,async()=>{
 const out=run(String.raw`
rows = [row(), row(id=2), row(id=3, timestamp='2026-11-12 20:16:17', item='Fabled Fixture Cloak')]
full, state, bindings = m.build_export(rows, '2026-11-12', scope='cross-language')
bind(bindings)
overlap, state, bindings = m.build_export(rows, '2026-11-12', state, 'cross-language', [rows[1]])
print(json.dumps({'full':full,'overlap':overlap}))
`);
 const parse=payload=>parseRaidLootImport({format:'tracker-json',fileName:'synthetic-guild-desk.json',raidDate:'2026-11-12',text:JSON.stringify(payload)});
 const full=await parse(out.full),overlap=await parse(out.overlap);
 assert.equal(full.events.length,3);assert.equal(full.events[0].holder,'HolderOne');assert.equal(full.events[0].source,'Fixture Boss');assert.equal(full.events[0].quantity,2);assert.equal(full.events[0].observedAt,null);assert.equal(full.events[0].timeKind,'tracker-clock');assert.equal(full.events[0].rawLine,null);
 assert.equal(full.events[2].observedAt,'2026-11-12T20:16:17');assert.equal(full.events[2].timeKind,'log-history');assert.notEqual(full.events[0].eventKey,full.events[1].eventKey);assert.equal(overlap.events[0].eventKey,full.events[1].eventKey);
});
