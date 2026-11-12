PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE characters (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, level INTEGER NOT NULL, class_name TEXT NOT NULL, guild_rank TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unclassified' CHECK(kind IN ('unclassified','main','alt')), owner_id TEXT REFERENCES users(id), approved_at TEXT);
--> statement-breakpoint
CREATE TABLE claims (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), kind TEXT CHECK(kind IN ('main','alt')), created_at TEXT NOT NULL, approved_at TEXT, approval_op TEXT, rejected_at TEXT, rejected_by TEXT REFERENCES users(id), rejection_reason TEXT, UNIQUE(character_id,user_id));
--> statement-breakpoint
CREATE TABLE raids (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, rate INTEGER NOT NULL CHECK(rate>0), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE import_scope (id INTEGER PRIMARY KEY CHECK(id=1), guild_key TEXT NOT NULL, server_key TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE ticks (id TEXT PRIMARY KEY, raid_id TEXT NOT NULL REFERENCES raids(id), source_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, source_time TEXT NOT NULL, content_hash TEXT NOT NULL, raw_text TEXT NOT NULL, row_count INTEGER NOT NULL, created_at TEXT NOT NULL, operation_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE attendance (id TEXT PRIMARY KEY, tick_id TEXT NOT NULL REFERENCES ticks(id), character_id TEXT NOT NULL REFERENCES characters(id), class_name TEXT NOT NULL, zone TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','credited','ineligible')), dkp INTEGER NOT NULL CHECK(dkp>0), UNIQUE(tick_id,character_id));
--> statement-breakpoint
CREATE TABLE ledger (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id), attendance_id TEXT UNIQUE REFERENCES attendance(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, operation_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_user ON sessions(user_id);
--> statement-breakpoint
CREATE INDEX attendance_character ON attendance(character_id,status);
--> statement-breakpoint
CREATE INDEX ledger_character ON ledger(character_id,created_at);
--> statement-breakpoint
CREATE INDEX claims_pending ON claims(status);
--> statement-breakpoint
CREATE TRIGGER ledger_exact_total BEFORE INSERT ON ledger
WHEN NOT EXISTS (SELECT 1 FROM ledger WHERE id=NEW.id OR (NEW.attendance_id IS NOT NULL AND attendance_id=NEW.attendance_id))
 AND (NEW.amount NOT BETWEEN -9007199254740991 AND 9007199254740991
 OR (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE character_id=NEW.character_id) + NEW.amount NOT BETWEEN -9007199254740991 AND 9007199254740991)
BEGIN
 SELECT RAISE(ABORT, 'DKP_RANGE');
END;
--> statement-breakpoint
CREATE UNIQUE INDEX characters_one_main_per_owner ON characters(owner_id) WHERE kind='main' AND owner_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS item_references (
  item_id INTEGER PRIMARY KEY CHECK (item_id > 0),
  name TEXT,
  classes_json TEXT,
  races_json TEXT,
  slots_json TEXT,
  stats_json TEXT,
  flags_json TEXT,
  advanced_loot TEXT,
  source_url TEXT NOT NULL,
  source_checked_at TEXT,
  source_updated_at TEXT,
  retrieved_at TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  metadata_status TEXT NOT NULL CHECK (metadata_status IN ('verified_reference', 'unresolved'))
);
--> statement-breakpoint
CREATE TABLE auctions (
 id TEXT PRIMARY KEY,
 item_id INTEGER NOT NULL REFERENCES item_references(item_id),
 item_name TEXT NOT NULL,
 classes_json TEXT,
 source_url TEXT NOT NULL,
 metadata_status TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
 minimum_bid INTEGER NOT NULL CHECK(minimum_bid>=1),
 mode TEXT NOT NULL DEFAULT 'sealed' CHECK(mode='sealed'),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 published_at_ms INTEGER NOT NULL,
 closes_at_ms INTEGER NOT NULL,
 closed_at_ms INTEGER,
 created_by TEXT NOT NULL REFERENCES users(id),
 creation_key TEXT,
 creation_signature TEXT,
 settlement_op TEXT UNIQUE
);
--> statement-breakpoint
CREATE TABLE auction_bid_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL UNIQUE,
 auction_id TEXT NOT NULL REFERENCES auctions(id),
 character_id TEXT NOT NULL REFERENCES characters(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('place','unchanged','withdraw')),
 amount INTEGER CHECK(amount IS NULL OR amount>=1),
 accepted_at_ms INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE auction_bids (
 auction_id TEXT NOT NULL REFERENCES auctions(id),
 character_id TEXT NOT NULL REFERENCES characters(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount>=1),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 priority_at_ms INTEGER NOT NULL,
 priority_sequence INTEGER NOT NULL REFERENCES auction_bid_events(sequence),
 updated_at_ms INTEGER NOT NULL,
 eligible_at_close INTEGER CHECK(eligible_at_close IN (0,1)),
 PRIMARY KEY(auction_id,character_id),
 UNIQUE(auction_id,user_id)
);
--> statement-breakpoint
CREATE TABLE auction_awards (
 auction_id TEXT NOT NULL REFERENCES auctions(id),
 character_id TEXT NOT NULL REFERENCES characters(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 winning_bid INTEGER NOT NULL CHECK(winning_bid>=1),
 award_rank INTEGER NOT NULL CHECK(award_rank>=1),
 price INTEGER NOT NULL CHECK(price>=1 AND price<=winning_bid),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
 ledger_id TEXT NOT NULL UNIQUE,
 confirmation_op TEXT UNIQUE,
 confirmed_at_ms INTEGER,
 confirmed_by TEXT REFERENCES users(id),
 PRIMARY KEY(auction_id,character_id),
 UNIQUE(auction_id,award_rank)
);
--> statement-breakpoint
CREATE INDEX auctions_deadline ON auctions(status,closes_at_ms);
--> statement-breakpoint
CREATE UNIQUE INDEX auctions_creator_creation_key ON auctions(created_by,creation_key);
--> statement-breakpoint
CREATE INDEX auction_events_history ON auction_bid_events(auction_id,sequence);
--> statement-breakpoint
CREATE TABLE correction_requests (id TEXT PRIMARY KEY, tick_id TEXT NOT NULL REFERENCES ticks(id), character_id TEXT NOT NULL REFERENCES characters(id), requester_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), tick_rate INTEGER NOT NULL CHECK(tick_rate>0), created_at TEXT NOT NULL, decision_reason TEXT, decided_by TEXT REFERENCES users(id), decided_at TEXT, decision_op TEXT, UNIQUE(tick_id,character_id));
--> statement-breakpoint
CREATE INDEX correction_requests_pending ON correction_requests(status,created_at);
--> statement-breakpoint
CREATE TABLE guild_settings (id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL, operation_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE dkp_adjustments (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, character_id TEXT NOT NULL REFERENCES characters(id), amount INTEGER NOT NULL CHECK(amount<>0), reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, operation_id TEXT NOT NULL);
