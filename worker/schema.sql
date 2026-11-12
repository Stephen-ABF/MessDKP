PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE characters (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, level INTEGER NOT NULL, class_name TEXT NOT NULL, guild_rank TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unclassified' CHECK(kind IN ('unclassified','main','alt')), owner_id TEXT REFERENCES users(id), approved_at TEXT);
CREATE TABLE claims (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), kind TEXT CHECK(kind IN ('main','alt')), created_at TEXT NOT NULL, approved_at TEXT, approval_op TEXT, rejected_at TEXT, rejected_by TEXT REFERENCES users(id), rejection_reason TEXT, UNIQUE(character_id,user_id));
CREATE TABLE raids (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, rate INTEGER NOT NULL CHECK(rate>0), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE import_scope (id INTEGER PRIMARY KEY CHECK(id=1), guild_key TEXT NOT NULL, server_key TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE ticks (id TEXT PRIMARY KEY, raid_id TEXT NOT NULL REFERENCES raids(id), source_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, source_time TEXT NOT NULL, content_hash TEXT NOT NULL, raw_text TEXT NOT NULL, row_count INTEGER NOT NULL, created_at TEXT NOT NULL, operation_id TEXT NOT NULL);
CREATE TABLE attendance (id TEXT PRIMARY KEY, tick_id TEXT NOT NULL REFERENCES ticks(id), character_id TEXT NOT NULL REFERENCES characters(id), class_name TEXT NOT NULL, zone TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','credited','ineligible')), dkp INTEGER NOT NULL CHECK(dkp>0), UNIQUE(tick_id,character_id));
CREATE TABLE ledger (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id), attendance_id TEXT UNIQUE REFERENCES attendance(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, operation_id TEXT NOT NULL);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX attendance_character ON attendance(character_id,status);
CREATE INDEX ledger_character ON ledger(character_id,created_at);
CREATE INDEX claims_pending ON claims(status);
CREATE TRIGGER ledger_exact_total BEFORE INSERT ON ledger
WHEN NOT EXISTS (SELECT 1 FROM ledger WHERE id=NEW.id OR (NEW.attendance_id IS NOT NULL AND attendance_id=NEW.attendance_id))
 AND (NEW.amount NOT BETWEEN -9007199254740991 AND 9007199254740991
 OR (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE character_id=NEW.character_id) + NEW.amount NOT BETWEEN -9007199254740991 AND 9007199254740991)
BEGIN
 SELECT RAISE(ABORT, 'DKP_RANGE');
END;
CREATE UNIQUE INDEX characters_one_main_per_owner ON characters(owner_id) WHERE kind='main' AND owner_id IS NOT NULL;
