CREATE TABLE loot_parcels (
 auction_id TEXT NOT NULL,
 character_id TEXT NOT NULL,
 holder_event_id TEXT,
 holder_name TEXT,
 parceled_by TEXT NOT NULL REFERENCES users(id),
 parceled_at TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(auction_id,character_id),
 FOREIGN KEY(auction_id,character_id) REFERENCES auction_awards(auction_id,character_id) ON DELETE CASCADE
);
