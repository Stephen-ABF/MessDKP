CREATE TABLE attendance_tick_clones (
 tick_id TEXT PRIMARY KEY REFERENCES ticks(id),
 source_tick_id TEXT NOT NULL REFERENCES ticks(id),
 raid_id TEXT NOT NULL REFERENCES raids(id),
 source_file_name TEXT NOT NULL,
 source_capture_time TEXT NOT NULL,
 source_content_hash TEXT NOT NULL,
 target_time TEXT NOT NULL,
 reason TEXT NOT NULL,
 effective_rate INTEGER NOT NULL CHECK(effective_rate>0),
 summary_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_signature TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE,
 UNIQUE(created_by,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX attendance_tick_clone_source ON attendance_tick_clones(source_tick_id);
--> statement-breakpoint
CREATE TRIGGER attendance_tick_clones_immutable_update BEFORE UPDATE ON attendance_tick_clones BEGIN SELECT RAISE(ABORT,'ATTENDANCE_CLONE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER attendance_tick_clones_immutable_delete BEFORE DELETE ON attendance_tick_clones BEGIN SELECT RAISE(ABORT,'ATTENDANCE_CLONE_IMMUTABLE'); END;
