ALTER TABLE claims ADD COLUMN approved_by TEXT REFERENCES users(id);
--> statement-breakpoint
UPDATE claims SET approved_by=(SELECT a.actor_id FROM audit a WHERE a.action='claim_approved' AND json_valid(a.details) AND json_extract(a.details,'$.claimId')=claims.id AND a.created_at=claims.approved_at ORDER BY a.id LIMIT 1) WHERE status='approved';
--> statement-breakpoint
CREATE TABLE assignment_events (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claims(id), character_id TEXT NOT NULL REFERENCES characters(id), user_id TEXT NOT NULL REFERENCES users(id), kind TEXT CHECK(kind IN ('main','alt')), action TEXT NOT NULL CHECK(action IN ('approved','detached','rejected')), resolved_at TEXT NOT NULL, reason TEXT, actor_id TEXT REFERENCES users(id), assigned_by TEXT REFERENCES users(id), related_assignment_id TEXT REFERENCES assignment_events(id));
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_detachment_once ON assignment_events(related_assignment_id) WHERE action='detached';
--> statement-breakpoint
CREATE INDEX assignment_character_history ON assignment_events(character_id,resolved_at);
--> statement-breakpoint
INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,reason,actor_id,assigned_by) SELECT 'legacy-'||id,id,character_id,user_id,kind,'approved',approved_at,NULL,approved_by,approved_by FROM claims WHERE status='approved' AND kind IN('main','alt') AND approved_at IS NOT NULL;
--> statement-breakpoint
INSERT INTO assignment_events(id,claim_id,character_id,user_id,kind,action,resolved_at,reason,actor_id) SELECT 'legacy-rejected-'||id,id,character_id,user_id,kind,'rejected',rejected_at,rejection_reason,rejected_by FROM claims WHERE status='rejected' AND rejected_at IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER assignment_events_immutable_update BEFORE UPDATE ON assignment_events BEGIN SELECT RAISE(ABORT,'ASSIGNMENT_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER assignment_events_immutable_delete BEFORE DELETE ON assignment_events BEGIN SELECT RAISE(ABORT,'ASSIGNMENT_HISTORY_IMMUTABLE'); END;
