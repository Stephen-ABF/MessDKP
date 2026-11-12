CREATE TABLE raid_loot_imports (id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, source_hash TEXT NOT NULL, file_name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN('tracker-json','tracker-tsv','eq-log')), raid_id TEXT REFERENCES raids(id), raid_date TEXT NOT NULL, context_json TEXT NOT NULL, warnings_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE raid_loot_import_groups (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES raid_loot_imports(id), group_key TEXT NOT NULL, boss_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'review' CHECK(status IN('review','preparing','prepared')), prepare_user_id TEXT REFERENCES users(id), prepare_snapshot_json TEXT, prepare_signature TEXT, draft_id TEXT REFERENCES loot_drafts(id), handoff_op TEXT UNIQUE, created_at TEXT NOT NULL, UNIQUE(import_id,group_key));
--> statement-breakpoint
CREATE TABLE raid_loot_import_events (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, evidence_signature TEXT NOT NULL, item_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000), holder TEXT NOT NULL, source TEXT NOT NULL, observed_at TEXT, time_text TEXT NOT NULL, raw_line TEXT, provenance_json TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN(0,1)), exclusion_reason TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, handoff_group_id TEXT REFERENCES raid_loot_import_groups(id), created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE raid_loot_import_links (import_id TEXT NOT NULL REFERENCES raid_loot_imports(id), event_id TEXT NOT NULL REFERENCES raid_loot_import_events(id), group_id TEXT NOT NULL REFERENCES raid_loot_import_groups(id), ordinal INTEGER NOT NULL, PRIMARY KEY(import_id,event_id));
--> statement-breakpoint
CREATE INDEX raid_loot_import_events_handoff ON raid_loot_import_events(handoff_group_id,excluded);
--> statement-breakpoint
CREATE INDEX raid_loot_import_links_group ON raid_loot_import_links(group_id,ordinal);
--> statement-breakpoint
CREATE TRIGGER raid_loot_event_evidence_immutable BEFORE UPDATE OF event_key,evidence_signature,item_name,quantity,holder,source,observed_at,time_text,raw_line,provenance_json ON raid_loot_import_events BEGIN SELECT RAISE(ABORT,'LOOT_IMPORT_EVIDENCE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER raid_loot_event_identity_conflict BEFORE INSERT ON raid_loot_import_events WHEN EXISTS(SELECT 1 FROM raid_loot_import_events prior WHERE prior.event_key=NEW.event_key AND prior.evidence_signature<>NEW.evidence_signature) BEGIN SELECT RAISE(ABORT,'LOOT_IMPORT_EVENT_CONFLICT'); END;
--> statement-breakpoint
CREATE TABLE raid_loot_handoff_guards (operation_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, handoff_op TEXT NOT NULL, actor_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER raid_loot_handoff_current BEFORE INSERT ON raid_loot_handoff_guards WHEN NOT EXISTS(SELECT 1 FROM raid_loot_import_groups g WHERE g.id=NEW.group_id AND g.status='preparing' AND g.handoff_op=NEW.handoff_op AND g.prepare_user_id=NEW.actor_id) BEGIN SELECT RAISE(ABORT,'LOOT_IMPORT_HANDOFF_CHANGED'); END;
