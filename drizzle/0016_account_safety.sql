ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(password_iterations BETWEEN 100000 AND 2000000);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN('active','pending'));
--> statement-breakpoint
ALTER TABLE users ADD COLUMN reset_required INTEGER NOT NULL DEFAULT 0 CHECK(reset_required IN(0,1));
--> statement-breakpoint
ALTER TABLE users ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN credential_operation TEXT;
--> statement-breakpoint
CREATE TABLE account_password_resets(user_id TEXT PRIMARY KEY REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,credential_revision INTEGER NOT NULL);
--> statement-breakpoint
DROP TRIGGER access_profile_last_writer;
--> statement-breakpoint
UPDATE access_profiles SET permissions_json=json_set(permissions_json,'$.accounts',CASE WHEN id IN('admin','officer') THEN 3 ELSE 0 END),revision=revision+1;
--> statement-breakpoint
CREATE TRIGGER access_profile_last_writer AFTER UPDATE ON access_profiles WHEN NOT EXISTS(SELECT 1 FROM access_effective_managers WHERE access_level=3) BEGIN SELECT RAISE(ABORT,'ACCESS_LAST_WRITER'); END;
--> statement-breakpoint
DROP TABLE access_operation_guards;
--> statement-breakpoint
CREATE TABLE access_operation_guards (
 operation_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 area TEXT NOT NULL CHECK(area IN('overview','characters','mains','corrections','correctionReview','auctions','auctionAdmin','attendance','ledger','items','captures','loot','claims','settings','audit','access','accounts')),
 session_token_hash TEXT,
 credential_revision INTEGER,
 minimum_level INTEGER NOT NULL CHECK(minimum_level BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TRIGGER access_operation_permission BEFORE INSERT ON access_operation_guards
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_permissions WHERE user_id=NEW.user_id
  AND json_type(permissions_json,'$.'||NEW.area)='integer'
  AND json_extract(permissions_json,'$.'||NEW.area) BETWEEN NEW.minimum_level AND 3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_DENIED'); END;
--> statement-breakpoint
CREATE TRIGGER access_operation_session BEFORE INSERT ON access_operation_guards
 WHEN NEW.session_token_hash IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=NEW.user_id AND s.token_hash=NEW.session_token_hash AND s.expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) AND u.account_status='active' AND u.reset_required=0 AND u.credential_revision=NEW.credential_revision
 ) BEGIN SELECT RAISE(ABORT,'ACCESS_DENIED'); END;
--> statement-breakpoint
CREATE INDEX auth_limits_expiry ON auth_limits(expires_at);
