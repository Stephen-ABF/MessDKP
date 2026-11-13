# Audit history filters

`handleAuditLogApi(request,env,auth)` serves authenticated `GET /api/audit`. The parent resolves current access before dispatch. The module requires `auth.access.permissions.audit >= 2` (Read or Write); when no ACL context is supplied, the legacy administrator role is the only fallback. A configured denial never falls back to a legacy role. Other methods return 405 and unknown routes delegate with null. Reads write no records.

Optional query filters: `actorId` (person performing the action), `subjectUserId` (account affected), `characterId`, exact `action`, literal text `q`, inclusive UTC calendar dates `from` and `to`, `limit` (1–100; default50), and `offset` (0–1000000; default0). Filters combine with AND. Each supported parameter may occur once. Search is bounded to120 characters and uses literal substring matching, so SQL wildcard characters do not match arbitrary text. Results are ordered by newest time and audit ID. Invalid dates, repeated/unknown filters or reversed ranges return400.

Response: `{entries,total,limit,offset,filters}`. Entries preserve original `details` and add `actorId`, `characterId`, `characterName`, `subjectUserId`, `subjectUserName`. Options contain `actors:[{id,name}]`, `subjects:[{id,name}]`, `characters:[{id,name}]`, and `actions:[string]`. The filtered count, page and options are read in one database transaction. Account options contain names and IDs, not email addresses.

Target attribution prefers recorded subject IDs, previous owner IDs and the original claim/correction requester. Claim request/creation and login/registration identify their own actor as the subject. For older character events without an explicit subject, a unique latest ownership boundary strictly before the event can identify an approved owner. A boundary at the event's timestamp, or tied latest earlier boundaries, makes that inference ambiguous and leaves the subject null. Random event IDs never establish operation order. Timestamp comparisons handle equivalent ISO precision using SQLite date conversion. Unknown historical subjects remain null; current ownership is never substituted. Historical rows and malformed legacy JSON remain unchanged. New mutation writers should snapshot `subjectUserId` and `characterId` where applicable so later reassignment cannot obscure attribution.

This module never reads `auction_bid_events` or expands sealed bid details. It filters only the existing global audit evidence, whose writers must continue to omit active sealed bid amounts and identities. The API does not imply external security review or browser acceptance.

Optional blank or whitespace-only from/to values mean no date filter. Invalid nonempty calendar dates and repeated filters remain rejected. This prevents the initial empty filter form from hiding all audit records.

## Readable entries (0.13)

Entries add description, raidName and itemName. Descriptions use the action, recorded reasons and safe event-specific values, with character/account names from existing attribution and raid/item metadata when available. The UI escapes and displays the description instead of raw JSON. Missing/deleted metadata uses a generic description; internal identifiers are never substituted for missing names. Original details remain unchanged for evidence and existing filters. No live bid/participation joins are added.
