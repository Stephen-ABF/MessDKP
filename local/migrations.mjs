import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LOCAL_MIGRATIONS_TABLE = '__guild_desk_migrations';
const hash = value => createHash('sha256').update(value).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
const contains = (parent, file) => { const relative = path.relative(parent, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

export function loadMigrations(directory) {
 const root = realpathSync(directory);
 const journalPath = realpathSync(path.join(root, 'meta', '_journal.json'));
 if (!contains(root, journalPath) || !statSync(journalPath).isFile()) throw new Error('Migration journal must be a file inside the migration directory.');
 let journal;
 try { journal = JSON.parse(decode(readFileSync(journalPath))); } catch { throw new Error('The migration journal is not valid UTF-8 JSON.'); }
 if (journal?.dialect !== 'sqlite' || !Array.isArray(journal.entries) || !journal.entries.length) throw new Error('A nonempty ordered SQLite migration journal is required.');
 const seen = new Set();
 return journal.entries.map((entry, index) => {
  if (!entry || entry.idx !== index || typeof entry.tag !== 'string' || !/^[A-Za-z0-9_-]+$/.test(entry.tag) || seen.has(entry.tag) || typeof entry.version !== 'string' || !Number.isSafeInteger(entry.when) || entry.when < 0 || (entry.breakpoints !== undefined && typeof entry.breakpoints !== 'boolean')) throw new Error('Migration journal entries must have unique safe tags and consecutive ordered indexes.');
  seen.add(entry.tag);
  const file = realpathSync(path.join(root, entry.tag + '.sql'));
  if (!contains(root, file) || !statSync(file).isFile()) throw new Error('Migration SQL must be a file inside the migration directory.');
  const bytes = readFileSync(file);
  let sql;
  try { sql = decode(bytes); } catch { throw new Error('Migration ' + entry.tag + ' is not valid UTF-8 SQL.'); }
  const statements = sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
  if (!statements.length) throw new Error('Migration ' + entry.tag + ' contains no statements.');
  return { index, tag: entry.tag, sha256: hash(bytes), entryHash: hash(JSON.stringify({idx:entry.idx,tag:entry.tag,version:entry.version,when:entry.when,breakpoints:entry.breakpoints ?? false})), statements };
 });
}

export function validateAppliedMigrations(db, migrations) {
 const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger','index') AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
 if (!tables.includes(LOCAL_MIGRATIONS_TABLE)) {
  if (tables.length) throw new Error('This existing database is not a migration-managed Guild Desk database. It was not adopted or overwritten.');
  return [];
 }
 let applied;
 try { applied = db.prepare('SELECT migration_index,tag,sql_sha256,entry_sha256 FROM ' + LOCAL_MIGRATIONS_TABLE + ' ORDER BY migration_index').all(); }
 catch { throw new Error('The local migration journal is not compatible with this build.'); }
 if (applied.length > migrations.length) throw new Error('The database has migrations missing from this build. Use the matching or newer application files.');
 if (!applied.length && tables.some(name => name !== LOCAL_MIGRATIONS_TABLE)) throw new Error('The database contains schema changes not recorded in its migration journal.');
 applied.forEach((row, index) => {
  const expected = migrations[index];
  if (row.migration_index !== index || row.tag !== expected.tag || row.sql_sha256 !== expected.sha256 || row.entry_sha256 !== expected.entryHash) throw new Error('Applied migration ' + row.tag + ' has changed or was reordered. Restore the original migration files; applied history cannot be rewritten.');
 });
 return applied;
}

function statementKeyword(sql) {
 return sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '').match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
}

export function applyMigrations(db, migrations) {
 if (!Array.isArray(migrations) || !migrations.length) throw new Error('Refusing to start without migrations.');
 db.exec('BEGIN IMMEDIATE');
 try {
  const applied = validateAppliedMigrations(db, migrations);
  db.exec('CREATE TABLE IF NOT EXISTS ' + LOCAL_MIGRATIONS_TABLE + ' (migration_index INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, sql_sha256 TEXT NOT NULL, entry_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const migration of migrations.slice(applied.length)) {
   for (const sql of migration.statements) {
    if (['BEGIN','COMMIT','END','ROLLBACK','SAVEPOINT','RELEASE','ATTACH','DETACH','VACUUM'].includes(statementKeyword(sql))) throw new Error('Migration ' + migration.tag + ' cannot control transactions or attach another database.');
    const prepared = db.prepare(sql);
    if (prepared.sourceSQL.trim() !== sql.trim()) throw new Error('Separate complete migration statements with a statement-breakpoint marker.');
    if (prepared.columns().length) prepared.all(); else prepared.run();
   }
   db.prepare('INSERT INTO ' + LOCAL_MIGRATIONS_TABLE + '(migration_index,tag,sql_sha256,entry_sha256,applied_at) VALUES(?,?,?,?,?)').run(migration.index,migration.tag,migration.sha256,migration.entryHash,new Date().toISOString());
  }
  db.exec('COMMIT');
  return { appliedNow: migrations.slice(applied.length).map(value => value.tag), totalApplied: migrations.length };
 } catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  throw error;
 }
}
