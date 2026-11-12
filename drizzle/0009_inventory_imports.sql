CREATE TABLE inventory_imports (
 id TEXT PRIMARY KEY,
 character_id TEXT NOT NULL REFERENCES characters(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 file_name TEXT NOT NULL,
 file_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 operation_nonce TEXT NOT NULL UNIQUE,
 applied_count INTEGER NOT NULL CHECK(applied_count BETWEEN 1 AND 23),
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE inventory_equipment_augments (
 character_id TEXT NOT NULL REFERENCES characters(id),
 slot_key TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 augments_json TEXT NOT NULL,
 PRIMARY KEY(character_id,slot_key)
);
