import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleItemApi, parseEqItemReference, ITEM_REFERENCE_SCHEMA_SQL } from '../worker/items.mjs';

class D1TestDatabase {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(ITEM_REFERENCE_SCHEMA_SQL); }
  prepare(sql) {
    const database = this.db;
    function prepared(values = []) {
      return {
        bind(...next) { return prepared(next); },
        async all() { return { results: database.prepare(sql).all(...values) }; },
        async first() { return database.prepare(sql).get(...values) || null; },
        async run() { const r = database.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
    }
    return prepared();
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const admin = { user: { id: 'officer-1', role: 'admin' }, csrfToken: 'session-csrf' };
const member = { user: { id: 'member-1', role: 'member' }, csrfToken: 'member-csrf' };
const origin = 'https://guild.example';
function get(path = '/api/items') { return new Request(origin + path); }
function lookup(itemId, headers = {}) {
  return new Request(origin + '/api/items/lookup', {
    method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': admin.csrfToken, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ itemId }),
  });
}
function fixture(t) { const DB = new D1TestDatabase(); t.after(() => DB.db.close()); return { DB }; }

test('normalizes numeric IDs, exact source URLs, and actual Advanced Loot references', () => {
  assert.deepEqual(parseEqItemReference(81773), { itemId: 81773, sourceUrl: 'https://items.eqresource.com/items.php?id=81773', suppliedName: null, iconId: null });
  assert.equal(parseEqItemReference(' 00044354 ').itemId, 44354);
  assert.equal(parseEqItemReference('https://items.eqresource.com/items.php?id=44354').itemId, 44354);
  assert.deepEqual(parseEqItemReference('81773^1557^Blood of the Dhampyre'), { itemId: 81773, sourceUrl: 'https://items.eqresource.com/items.php?id=81773', suppliedName: 'Blood of the Dhampyre', iconId: 1557 });
});

test('rejects unexpected origins, duplicate URL parameters, malformed IDs, and executable references', () => {
  for (const value of [null, {}, -1, 0, 1.5, NaN, Infinity, '', '1e2', 'javascript:alert(1)', '81773^1557^', 'https://evil.example/items.php?id=81773', 'http://items.eqresource.com/items.php?id=81773', 'https://items.eqresource.com/items.php?id=1&id=2', 'https://items.eqresource.com/items.php?id=1#fragment', 'https://items.eqresource.com/items.php?id=1&other=2', 'https://items.eqresource.com/other.php?id=1', 'https://user@items.eqresource.com/items.php?id=1', '9007199254740992']) {
    assert.throws(() => parseEqItemReference(value), undefined, String(value));
  }
});

test('requires authentication and leaves unrelated routes for the main handler', async t => {
  const env = fixture(t);
  assert.equal((await handleItemApi(get(), env, {})).status, 401);
  assert.equal(await handleItemApi(get('/api/characters'), env, {}), null);
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM item_references').get().n, 0);
});

test('lists two verified source references with provenance without GET side effects', async t => {
  const env = fixture(t);
  const response = await handleItemApi(get(), env, member);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.catalogComplete, false);
  assert.equal(body.liveSyncAvailable, false);
  assert.equal(body.total, 2);
  const blood = body.items.find(item => item.itemId === 81773);
  assert.equal(blood.name, 'Blood of the Dhampyre');
  assert.equal(blood.stats.ac, 104);
  assert.equal(blood.stats.hp, 2006);
  assert.equal(blood.stats.requiredLevel, 90);
  assert.deepEqual(blood.classes, ['ALL']);
  assert.equal(blood.sourceUrl, 'https://items.eqresource.com/items.php?id=81773');
  assert.equal(blood.metadataStatus, 'verified_reference');
  assert.match(blood.retrievedAt, /^2026-11-12T/);
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM item_references').get().n, 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('class and slot filters distinguish explicit ALL from unknown metadata', async t => {
  const env = fixture(t);
  assert.equal((await (await handleItemApi(get('/api/items?class=Monk'), env, member)).json()).total, 2);
  const cleric = await (await handleItemApi(get('/api/items?class=CLR'), env, member)).json();
  assert.deepEqual(cleric.items.map(item => item.itemId), [81773]);
  const face = await (await handleItemApi(get('/api/items?slot=face'), env, member)).json();
  assert.deepEqual(face.items.map(item => item.itemId), [44354]);
  assert.equal((await (await handleItemApi(get('/api/items?class=CLR&slot=FACE'), env, member)).json()).total, 0);
});

test('lookup enforces officer role, Origin, CSRF, and content validation before writes', async t => {
  const env = fixture(t);
  assert.equal((await handleItemApi(lookup(81773), env, member)).status, 403);
  assert.equal((await handleItemApi(lookup(81773, { Origin: 'https://evil.example' }), env, admin)).status, 403);
  assert.equal((await handleItemApi(lookup(81773, { 'X-CSRF-Token': 'wrong' }), env, admin)).status, 403);
  assert.equal((await handleItemApi(lookup(81773, { 'Content-Type': 'text/plain' }), env, admin)).status, 415);
  assert.equal((await handleItemApi(lookup('https://evil.example/items.php?id=81773'), env, admin)).status, 400);
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM item_references').get().n, 0);
});

test('known lookup persists only verified facts and is idempotent', async t => {
  const env = fixture(t);
  const first = await handleItemApi(lookup(44354), env, admin);
  const second = await handleItemApi(lookup('44354^772^Untrusted injected name'), env, admin);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.item.name, 'Ancient Pearlescent Mask');
  assert.equal(body.item.stats.agility, 5);
  assert.equal(body.item.stats.magicResist, 10);
  assert.deepEqual(body.item.classes, ['MNK']);
  assert.equal(body.mode, 'verified_reference');
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM item_references').get().n, 2);
});

test('unknown IDs create honest unresolved references and never fabricate metadata or fetch', async t => {
  const env = fixture(t);
  let fetched = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; throw new Error('No live retrieval is allowed in this adapter'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await handleItemApi(lookup('123456^555^Unverified name'), env, admin);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.mode, 'reference_only');
  assert.equal(body.item.itemId, 123456);
  assert.equal(body.item.sourceUrl, 'https://items.eqresource.com/items.php?id=123456');
  for (const field of ['name', 'classes', 'races', 'slots', 'stats', 'flags', 'advancedLoot', 'sourceCheckedAt', 'sourceUpdatedAt']) assert.equal(body.item[field], null, field);
  assert.equal(body.item.metadataStatus, 'unresolved');
  assert.equal(fetched, 0);
  const all = await (await handleItemApi(get('/api/items'), env, member)).json();
  assert.equal(all.total, 3);
  const filtered = await (await handleItemApi(get('/api/items?class=MNK'), env, member)).json();
  assert.equal(filtered.total, 2);
  const exactId = await (await handleItemApi(get('/api/items?q=123456'), env, member)).json();
  assert.equal(exactId.total, 1);
  assert.equal(exactId.items[0].metadataStatus, 'unresolved');
});

test('search is parameterized, validates filters, and respects result limits', async t => {
  const env = fixture(t);
  const search = await (await handleItemApi(get('/api/items?q=PEARLESCENT'), env, member)).json();
  assert.deepEqual(search.items.map(item => item.itemId), [44354]);
  const limited = await (await handleItemApi(get('/api/items?limit=1'), env, member)).json();
  assert.equal(limited.items.length, 1);
  assert.equal(limited.total, 2);
  assert.equal((await (await handleItemApi(get('/api/items?q=%27%20OR%201%3D1%20--'), env, member)).json()).total, 0);
  for (const query of ['?class=NOTACLASS', '?slot=NOTASLOT', '?limit=0', '?limit=101', '?limit=NaN']) assert.equal((await handleItemApi(get('/api/items' + query), env, member)).status, 400);
  const wrong = await handleItemApi(new Request(origin + '/api/items', { method: 'DELETE' }), env, admin);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('Allow'), 'GET');
});
