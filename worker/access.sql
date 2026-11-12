CREATE TABLE access_profiles (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 template_key TEXT UNIQUE CHECK(template_key IS NULL OR template_key IN('admin','officer','member')),
 permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json) AND json_type(permissions_json)='object'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_by TEXT REFERENCES users(id),
 updated_at TEXT,
 operation_id TEXT UNIQUE
);
CREATE TABLE access_user_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 profile_id TEXT NOT NULL REFERENCES access_profiles(id),
 overrides_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides_json) AND json_type(overrides_json)='object'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE
);
INSERT INTO access_profiles(id,name,template_key,permissions_json) VALUES
 ('admin','Administrator','admin','{"overview":3,"characters":3,"mains":3,"corrections":3,"correctionReview":3,"auctions":3,"auctionAdmin":3,"attendance":3,"ledger":3,"items":3,"captures":3,"loot":3,"claims":3,"settings":3,"audit":3,"access":3}'),
 ('officer','Officer','officer','{"overview":3,"characters":3,"mains":3,"corrections":3,"correctionReview":3,"auctions":3,"auctionAdmin":3,"attendance":3,"ledger":3,"items":3,"captures":3,"loot":3,"claims":3,"settings":3,"audit":3,"access":0}'),
 ('member','Member','member','{"overview":3,"characters":3,"mains":2,"corrections":3,"correctionReview":0,"auctions":3,"auctionAdmin":0,"attendance":0,"ledger":0,"items":0,"captures":0,"loot":0,"claims":0,"settings":0,"audit":0,"access":0}');
CREATE INDEX access_users_profile ON access_user_profiles(profile_id);
CREATE VIEW access_effective_managers AS
 SELECT u.id AS user_id,
 CASE WHEN typeof(COALESCE(json_extract(a.overrides_json,'$.access'),json_extract(p.permissions_json,'$.access'),0))='integer'
 THEN COALESCE(json_extract(a.overrides_json,'$.access'),json_extract(p.permissions_json,'$.access'),0) ELSE 0 END AS access_level
 FROM users u LEFT JOIN access_user_profiles a ON a.user_id=u.id
 JOIN access_profiles p ON p.id=COALESCE(a.profile_id,CASE WHEN u.role='admin' THEN 'admin' ELSE 'member' END);
CREATE TRIGGER access_profile_last_writer AFTER UPDATE ON access_profiles
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_managers WHERE access_level=3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_LAST_WRITER'); END;
CREATE TRIGGER access_assignment_insert_last_writer AFTER INSERT ON access_user_profiles
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_managers WHERE access_level=3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_LAST_WRITER'); END;
CREATE TRIGGER access_assignment_update_last_writer AFTER UPDATE ON access_user_profiles
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_managers WHERE access_level=3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_LAST_WRITER'); END;
CREATE TRIGGER access_assignment_delete_last_writer AFTER DELETE ON access_user_profiles
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_managers WHERE access_level=3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_LAST_WRITER'); END;
CREATE TRIGGER access_builtin_profile_retained BEFORE DELETE ON access_profiles WHEN OLD.template_key IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'ACCESS_BUILTIN_PROFILE'); END;
CREATE VIEW access_effective_permissions AS
 SELECT u.id AS user_id,json_patch(p.permissions_json,COALESCE(a.overrides_json,'{}')) AS permissions_json
 FROM users u LEFT JOIN access_user_profiles a ON a.user_id=u.id
 JOIN access_profiles p ON p.id=COALESCE(a.profile_id,CASE WHEN u.role='admin' THEN 'admin' ELSE 'member' END);
CREATE TABLE access_operation_guards (
 operation_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 area TEXT NOT NULL CHECK(area IN('overview','characters','mains','corrections','correctionReview','auctions','auctionAdmin','attendance','ledger','items','captures','loot','claims','settings','audit','access')),
 minimum_level INTEGER NOT NULL CHECK(minimum_level BETWEEN 1 AND 3)
);
CREATE TRIGGER access_operation_permission BEFORE INSERT ON access_operation_guards
 WHEN NOT EXISTS(SELECT 1 FROM access_effective_permissions WHERE user_id=NEW.user_id
  AND json_type(permissions_json,'$.'||NEW.area)='integer'
  AND json_extract(permissions_json,'$.'||NEW.area) BETWEEN NEW.minimum_level AND 3)
 BEGIN SELECT RAISE(ABORT,'ACCESS_DENIED'); END;
