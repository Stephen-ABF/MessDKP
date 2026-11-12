ALTER TABLE auctions ADD COLUMN slots_json TEXT;
--> statement-breakpoint
ALTER TABLE auctions ADD COLUMN cancelled_at_ms INTEGER;
--> statement-breakpoint
ALTER TABLE auctions ADD COLUMN cancelled_by TEXT REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE auctions ADD COLUMN cancellation_reason TEXT;
--> statement-breakpoint
ALTER TABLE auctions ADD COLUMN original_closes_at_ms INTEGER;
--> statement-breakpoint
UPDATE auctions SET slots_json=(SELECT slots_json FROM item_references WHERE item_id=auctions.item_id);
--> statement-breakpoint
CREATE TRIGGER auction_slots_on_insert AFTER INSERT ON auctions WHEN NEW.slots_json IS NULL BEGIN UPDATE auctions SET slots_json=(SELECT slots_json FROM item_references WHERE item_id=NEW.item_id) WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TABLE auction_admin_actions (
 operation_id TEXT PRIMARY KEY,
 auction_id TEXT NOT NULL REFERENCES auctions(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN('cancel_bid','cancel_auction','complete_early')),
 character_id TEXT REFERENCES characters(id),
 reason TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_signature TEXT NOT NULL,
 accepted_at_ms INTEGER NOT NULL,
 UNIQUE(actor_id,idempotency_key)
);
--> statement-breakpoint
CREATE TRIGGER auction_admin_actions_immutable_update BEFORE UPDATE ON auction_admin_actions BEGIN SELECT RAISE(ABORT,'AUCTION_ADMIN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER auction_admin_actions_immutable_delete BEFORE DELETE ON auction_admin_actions BEGIN SELECT RAISE(ABORT,'AUCTION_ADMIN_IMMUTABLE'); END;
