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
CREATE INDEX auctions_deadline ON auctions(status,closes_at_ms);
CREATE UNIQUE INDEX auctions_creator_creation_key ON auctions(created_by,creation_key);
CREATE INDEX auction_events_history ON auction_bid_events(auction_id,sequence);
