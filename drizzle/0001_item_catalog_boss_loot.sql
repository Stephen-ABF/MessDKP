ALTER TABLE item_references ADD COLUMN full_details_json TEXT;
--> statement-breakpoint
ALTER TABLE item_references ADD COLUMN icon_url TEXT;
--> statement-breakpoint
ALTER TABLE item_references ADD COLUMN metadata_complete INTEGER NOT NULL DEFAULT 0 CHECK(metadata_complete IN (0,1));
--> statement-breakpoint
ALTER TABLE item_references ADD COLUMN source_status_json TEXT;
--> statement-breakpoint
CREATE TABLE loot_drafts (id TEXT PRIMARY KEY, raid_id TEXT REFERENCES raids(id), boss_name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')), revision INTEGER NOT NULL DEFAULT 1, sources_json TEXT NOT NULL, warnings_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, creation_key TEXT, creation_signature TEXT, publish_op TEXT UNIQUE, published_at_ms INTEGER, UNIQUE(created_by,creation_key));
--> statement-breakpoint
CREATE TABLE loot_draft_items (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES loot_drafts(id), ordinal INTEGER NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50), item_id INTEGER REFERENCES item_references(item_id), match_status TEXT NOT NULL CHECK(match_status IN ('unmatched','ambiguous','matched','manual_verified','needs_review','ignored')), candidates_json TEXT NOT NULL DEFAULT '[]', raw_lines_json TEXT NOT NULL, note TEXT, auction_id TEXT UNIQUE REFERENCES auctions(id), UNIQUE(draft_id,ordinal));
--> statement-breakpoint
CREATE INDEX loot_drafts_created ON loot_drafts(created_at);
--> statement-breakpoint
CREATE INDEX loot_items_reference ON loot_draft_items(item_id,draft_id);
