import {HttpError as ReportError,readJson,requireCsrf,constantTimeEqual} from './http.mjs';
// Guild-wide approved-main DKP and dump-tick attendance. Read-only.
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const fail = (status, code, message) => { throw new ReportError(status, code, message); };
const sql = (db, query, ...params) => db.prepare(query).bind(...params);
const compare = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b, 'en');
const CLASS_NAMES = Object.freeze({
 warrior:'Warrior',war:'Warrior',cleric:'Cleric',clr:'Cleric',paladin:'Paladin',pal:'Paladin',ranger:'Ranger',rng:'Ranger',
 shadowknight:'Shadow Knight',shd:'Shadow Knight',druid:'Druid',dru:'Druid',monk:'Monk',mnk:'Monk',bard:'Bard',brd:'Bard',
 rogue:'Rogue',rog:'Rogue',shaman:'Shaman',shm:'Shaman',necromancer:'Necromancer',nec:'Necromancer',wizard:'Wizard',wiz:'Wizard',
 magician:'Magician',mag:'Magician',enchanter:'Enchanter',enc:'Enchanter',beastlord:'Beastlord',bst:'Beastlord',berserker:'Berserker',ber:'Berserker'
});
function className(value) { const original = String(value || '').trim(); return CLASS_NAMES[original.toLowerCase().replace(/\s+/g, '')] || original || 'Unknown class'; }
function dateInput(url) {
 if (url.searchParams.getAll('asOf').length > 1) fail(400, 'invalid_date', 'Supply one attendance as-of date.');
 const value = url.searchParams.has('asOf') ? url.searchParams.get('asOf') : new Date().toISOString().slice(0, 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') fail(400, 'invalid_date', 'Use an actual YYYY-MM-DD attendance as-of date.');
 const parsed = new Date(value + 'T00:00:00.000Z');
 if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, 'invalid_date', 'Use an actual YYYY-MM-DD attendance as-of date.');
 return value;
}
function windowBounds(asOf) {
 const bounds = {};
 for (const days of [30, 60, 90]) {
  const first = new Date(asOf + 'T00:00:00.000Z'); first.setUTCDate(first.getUTCDate() - days + 1);
  const startDate = first.getUTCFullYear() < 1 ? '0001-01-01' : first.toISOString().slice(0, 10);
  bounds['days' + days] = { days, startDate, endDate: asOf };
 }
 bounds.allTime = { days: null, startDate: null, endDate: asOf };
 return bounds;
}
function checkedCount(value) { if (!Number.isSafeInteger(value) || value < 0) fail(500, 'report_range', 'Attendance totals exceed the supported exact reporting range.'); return value; }
function fraction(attendedTicks, totalTicks) {
 checkedCount(attendedTicks); checkedCount(totalTicks);
 if (attendedTicks > totalTicks) fail(500, 'attendance_inconsistent', 'Attendance counts need officer review.');
 return { attendedTicks, totalTicks, percentage: totalTicks === 0 ? null : Math.round(attendedTicks / totalTicks * 10000) / 100 };
}
const tickTime = "r.date||'T'||substr(t.source_time,12,8)";
const mainSelect = `SELECT c.id,c.name,c.class_name AS sourceClassName,u.name AS ownerName,e.start_at AS attendanceStartAt,e.source AS attendanceStartSource,COALESCE((SELECT SUM(l.amount) FROM ledger l WHERE l.character_id=c.id),0) AS balance FROM characters c JOIN users u ON u.id=c.owner_id LEFT JOIN character_attendance_eligibility e ON e.character_id=c.id WHERE c.kind='main' AND c.owner_id IS NOT NULL`;
async function reportData(db, asOf, characterId = null) {
 const windows = windowBounds(asOf);
 const starts = [windows.days30.startDate, windows.days60.startDate, windows.days90.startDate];
 const statements = [
  sql(db, `SELECT COUNT(CASE WHEN r.date>=? THEN 1 END) AS days30,COUNT(CASE WHEN r.date>=? THEN 1 END) AS days60,COUNT(CASE WHEN r.date>=? THEN 1 END) AS days90,COUNT(*) AS allTime FROM ticks t JOIN raids r ON r.id=t.raid_id WHERE r.date<=?`, ...starts, asOf),
  sql(db, `SELECT e.character_id AS characterId,COUNT(DISTINCT CASE WHEN r.date>=? THEN t.id END) AS days30,COUNT(DISTINCT CASE WHEN r.date>=? THEN t.id END) AS days60,COUNT(DISTINCT CASE WHEN r.date>=? THEN t.id END) AS days90,COUNT(DISTINCT t.id) AS allTime,COUNT(DISTINCT CASE WHEN a.status='credited' AND r.date>=? THEN t.id END) AS days30Attended,COUNT(DISTINCT CASE WHEN a.status='credited' AND r.date>=? THEN t.id END) AS days60Attended,COUNT(DISTINCT CASE WHEN a.status='credited' AND r.date>=? THEN t.id END) AS days90Attended,COUNT(DISTINCT CASE WHEN a.status='credited' THEN t.id END) AS allTimeAttended FROM character_attendance_eligibility e JOIN ticks t JOIN raids r ON r.id=t.raid_id LEFT JOIN attendance a ON a.character_id=e.character_id AND a.tick_id=t.id WHERE r.date<=? AND (${tickTime})>=e.start_at${characterId===null?'':' AND e.character_id=?'} GROUP BY e.character_id`, ...starts, ...starts, asOf, ...(characterId===null?[]:[characterId])),
  sql(db, mainSelect + (characterId===null?'':' AND c.id=?'), ...(characterId===null?[]:[characterId]))
 ];
 if (characterId !== null) statements.push(sql(db, `SELECT r.id,r.name,r.date,r.rate,COUNT(DISTINCT t.id) AS totalTicks,COUNT(DISTINCT CASE WHEN a.status='credited' THEN t.id END) AS attendedTicks FROM raids r JOIN ticks t ON t.raid_id=r.id JOIN character_attendance_eligibility e ON e.character_id=? AND (${tickTime})>=e.start_at LEFT JOIN attendance a ON a.tick_id=t.id AND a.character_id=e.character_id WHERE r.date<=? GROUP BY r.id,r.name,r.date,r.rate,r.created_at ORDER BY r.date DESC,r.created_at DESC,r.id`, characterId, asOf));
 // D1 batches are transactions: an import/correction cannot split the report's snapshot.
 const results = await db.batch(statements);
 const totals = results[0].results[0], attendance = results[1].results, records = results[2].results;
 for (const key of Object.keys(windows)) windows[key].totalTicks = checkedCount(totals[key]);
 const attendanceByMain = new Map(attendance.map(row => [row.characterId, row]));
 const mains = records.map(row => {
  if (!Number.isSafeInteger(row.balance)) fail(500, 'report_range', 'A DKP balance exceeds the supported exact reporting range.');
  const counts = attendanceByMain.get(row.id), measured = {};
  for (const key of Object.keys(windows)) measured[key] = fraction(counts?.[key+'Attended'] || 0, counts?.[key] || 0);
  return { ...row, className: className(row.sourceClassName), windows: measured };
 }).sort((a, b) => compare(a.className, b.className) || compare(a.name, b.name) || compare(a.id, b.id));
 return { windows, mains, raids: characterId === null ? null : results[3].results.map(row => ({ ...row, ...fraction(row.attendedTicks, row.totalTicks) })) };
}
export async function handleReportsApi(request, env, auth = {}) {
 const url = new URL(request.url), path = url.pathname;
 const detail = /^\/api\/reports\/mains\/([^/]+)\/attendance$/.exec(path);
 if (path !== '/api/reports/mains' && !detail) return null;
 try {
  if (!auth.user?.id) fail(401, 'unauthorized', 'Sign in to view guild main attendance.');
  if (request.method !== 'GET') return json({ error: 'Attendance reports are read-only.', code: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.DB) fail(503, 'database_unavailable', 'The reporting database is unavailable.');
  const asOf = dateInput(url), data = await reportData(env.DB, asOf, detail ? detail[1] : null);
  const common = { asOf, attendanceUnit: 'dump_tick', denominator: 'eligible_guild_ticks_in_window' };
  if (!detail) {
   const groups = new Map();
   for (const main of data.mains) { if (!groups.has(main.className)) groups.set(main.className, []); groups.get(main.className).push(main); }
   return json({ ...common, windows: data.windows, mains: data.mains, classGroups: Array.from(groups, ([name, mains]) => ({ className: name, mains })) });
  }
  const main = data.mains.find(row => row.id === detail[1]);
  if (!main) fail(404, 'main_not_found', 'This character is not an approved main.');
  return json({ ...common, main, windows: data.windows, raids: data.raids });
 } catch (error) {
  if (error instanceof ReportError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: 'Attendance reports could not be loaded. Please try again.', code: 'report_error' }, 500);
 }
}
