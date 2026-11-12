# Configurable access

Access profiles define an integer level for each area: 0 None, 1 View, 2 Read, 3 Write. Higher levels include lower levels. View permits the area's navigation or shell; protected data endpoints still require Read. Write permits the area's supported mutations in addition to reading it. Object ownership and business rules remain separate checks. In particular, access management or an Administrator profile does not override the rule that equipment may only be changed by its approved owner.

The seeded profiles are Administrator (`admin`), Officer (`officer`), and Member (`member`). Administrator has Write everywhere. Officer has Write everywhere except Access management, which is None. Member defaults are:

| Area | Default level |
|---|---|
| Overview | Write (own equipment/profile actions remain owner checked) |
| Characters | Write (own character requests/claims) |
| Mains and attendance | Read |
| Missing attendance | Write (own requests) |
| Auctions | Write (own bidding) |
| Attendance request review | None |
| Auction management | None |
| Attendance records, DKP ledger, item references, log companion, loot preparation, character claims, settings, audit log, access management | None |

The 16 canonical area keys are `overview`, `characters`, `mains`, `corrections`, `correctionReview`, `auctions`, `auctionAdmin`, `attendance`, `ledger`, `items`, `captures`, `loot`, `claims`, `settings`, `audit`, and `access`. Bidding access never grants auction publication, award confirmation, or settlement. Missing-attendance request access never grants approval/rejection. Those operations require the separate management areas.

Existing and newly registered accounts with no explicit access assignment use their current database legacy role: `admin` selects Administrator, otherwise Member. Caller-supplied role values and cached session access are not trusted by the resolver. An explicit profile assignment overrides that fallback, including for legacy administrators. A per-account overrides object may contain any subset of known areas; omitted keys inherit the selected profile, and 0 explicitly denies the area. Profiles are editable and up to 100 profiles, including templates, may exist. Deletion is not exposed.

`resolveAccess(db, user)` returns the current account DTO, or null if it does not exist: `id`, `name`, `email`, `legacyRole`, `profileId`, `profileName`, `templateKey`, `permissions`, `overrides`, `revision`, `profileRevision`, `updatedAt`, `updatedBy`, and `usesDefault`. `canAccess(access, area, level)` accepts a level of 1–3 or `view`/`read`/`write`. Invalid areas or levels fail closed. `ACCESS_AREAS` and `ACCESS_LEVELS` supply UI labels.

The access editor API requires an authenticated account. `GET /api/access` additionally requires Access management Read and returns `{areas, levels, profiles, users, access}`. Password hashes, salts, sessions and credentials are never returned. Profile DTOs contain `id`, `name`, `templateKey`, full `permissions`, `revision`, `updatedAt`, and `updatedBy`. User DTOs match the resolver shape.

Mutations require Access management Write, exact same Origin, the session's CSRF token, and JSON bodies limited to 8 KiB:

| Endpoint | Body | Response |
|---|---|---|
| `POST /api/access/profiles` | `{name, permissions}` | 201 `{profile, access}`; server generates the profile ID |
| `PUT /api/access/profiles/:id` | `{name, permissions, expectedRevision}` | `{profile, access}` |
| `PUT /api/access/users/:id` | `{profileId, overrides, expectedRevision}` | `{user, access}` |

Profile permission maps require every area and integer levels 0–3. Account overrides are partial maps with the same level rules. Profile names contain 1–80 printable characters. Profile revisions start at 1; an unassigned account has assignment revision 0, with the first explicit assignment becoming 1. A stale revision returns 409 `revision_conflict`. Clients should refresh after saving because a permitted edit may revoke the current editor's access. Identical stale retries are also rejected rather than silently overwriting.

All writes recheck the actor's effective Access management Write within their database transaction. An assignment also checks both old and selected profile revisions, keeping before/after effective-permission audit snapshots accurate if a profile changes concurrently. Audit records identify the actor and preserve before/after names, profiles, overrides, matrices, and revisions as applicable. Audits and changes commit together; audit failure rolls the change back.

Database triggers reject changes that would leave no account with effective Access management Write, including simultaneous attempts to remove the last managers. This returns 409 `last_access_writer` and rolls back the complete transaction. Delegate access management to another account before removing your own access. Builtin templates cannot be deleted. No access operation changes a legacy role, character assignment, DKP balance, attendance, award, or bid.

The additive migration also creates `access_effective_permissions` and transient `access_operation_guards`. Business-feature adapters must wrap each mutation batch with a guard insertion for the real actor, selected area and required level, then remove that guard within the same transaction. The insert raises `ACCESS_DENIED` if access was revoked after HTTP preflight; denied operations roll back all business changes and audits. Successful batches leave no guard rows. This is authorization only: callers still enforce character ownership, sealed-bid privacy, and each feature's normal validations. No affordability limit or DKP reservation is introduced.

Focused verification: `node --test tests/access.test.mjs`. The tests use disposable in-memory SQLite, including default restrictions, delegated profiles and explicit denies, last-manager protection, stale/concurrent changes, revocation races, exact audit snapshots, body/security validation and transaction rollback. Full worker routing and client visibility are tested by the integration layer.

## Shared and narrow routes

The generated Worker permits an own-main Overview to read its component profile records even if the guild-wide Mains list is disabled. Item detail/history remain available through permitted character/overview/auction views; the officer catalog route is separately restricted. Narrow character-equipment reference search requires current ownership and overview/mains write, ledger target selection requires ledger write, raid choices require attendance/loot/capture read, and missing-attendance choices contain only the caller's eligible uncredited main ticks. Bid writes and correction requests never grant auction management or request-review permissions.

Access edits use their own guarded transactions rather than the central business wrapper, allowing a deliberate self-demotion to return its successful updated access result. Native companion ingestion dynamically checks its creator's capture write permission. Gear remains owner-only regardless of administrator or officer profile.
