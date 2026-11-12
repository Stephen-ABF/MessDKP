import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { loadMigrations, validateAppliedMigrations, applyMigrations } from './migrations.mjs';

const exact = value => { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error('SQLite metadata exceeds the exact supported integer range.'); return number; };
export function openPersistentD1(filename, { migrationsDirectory } = {}) {
 if (typeof filename !== 'string' || !filename.trim() || filename === ':memory:') throw new Error('A real persistent SQLite filename is required.');
 if (!migrationsDirectory) throw new Error('An ordered migration directory is required.');
 const migrations = loadMigrations(migrationsDirectory);
 const databasePath = path.resolve(filename);
 if (existsSync(databasePath) && (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink())) throw new Error('The database path must name a regular SQLite file.');
 mkdirSync(path.dirname(databasePath), { recursive: true });
 const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
 let closed = false;
 const ensureOpen = () => { if (closed) throw new Error('The local database is closed.'); };
 let migrationState;
 try {
  db.exec('PRAGMA busy_timeout=5000');
  validateAppliedMigrations(db, migrations);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=FULL');
  db.exec('PRAGMA foreign_keys=ON');
  migrationState = applyMigrations(db, migrations);
 } catch (error) { db.close(); throw error; }
 const changes = () => exact(db.prepare('SELECT total_changes() AS count').get().count);
 const metadata = before => {
  const count = changes() - before;
  return { changes: count, last_row_id: count ? exact(db.prepare('SELECT last_insert_rowid() AS id').get().id) : 0, changed_db: count !== 0 };
 };
 class Statement {
  constructor(query, params = []) { if (typeof query !== 'string' || !query.trim()) throw new TypeError('SQL must be a nonempty string.'); this.query=query;this.params=params;this.database=db; }
  bind(...params) { return new Statement(this.query,params); }
  async first(column) {
   ensureOpen();const row=db.prepare(this.query).get(...this.params);
   if (!row) return null;
   if (column !== undefined) { if (!Object.hasOwn(row,column)) throw new Error('SQLite result column was not found.');return row[column]; }
   return {...row};
  }
  async all() { ensureOpen();const before=changes();return {success:true,results:db.prepare(this.query).all(...this.params).map(row=>({...row})),meta:metadata(before)}; }
  async run() {
   ensureOpen();const before=changes(),prepared=db.prepare(this.query);
   const results=prepared.columns().length?prepared.all(...this.params).map(row=>({...row})):(prepared.run(...this.params),[]);
   return {success:true,results,meta:metadata(before)};
  }
 }
 return {
  prepare(query) { ensureOpen();return new Statement(query); },
  async batch(statements) {
   ensureOpen();if(!Array.isArray(statements)||statements.some(s=>!(s instanceof Statement)||s.database!==db))throw new TypeError('A batch must contain statements from this database.');
   if(!statements.length)return [];
   db.exec('BEGIN IMMEDIATE');
   try {
    const result=[];
    for(const statement of statements){const before=changes(),prepared=db.prepare(statement.query);const rows=prepared.columns().length?prepared.all(...statement.params).map(row=>({...row})):(prepared.run(...statement.params),[]);result.push({success:true,results:rows,meta:metadata(before)});}
    db.exec('COMMIT');return result;
   }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  },
  raw:db,
  path:databasePath,
  migrationState,
  close() { if(!closed){db.close();closed=true;} }
 };
}
