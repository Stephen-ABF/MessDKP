# Guild Desk API v0.6

Private owner-only test deployment. The first successful registration atomically becomes administrator; this bootstrap is safe only while the Sites access gate is owner-only. Do not widen access before the owner has registered. Subsequent registrations are members. Passwords use PBKDF2 SHA-256 with 100000 iterations and an independent 256-bit salt, compatible with the Workers WebCrypto iteration limit. No password recovery or email delivery in this slice.

All responses are JSON with `Cache-Control: no-store`. Errors: `{error: string, code: string}` with appropriate HTTP status. Mutations require an exact same-origin `Origin` header. Authenticated mutations additionally require `X-CSRF-Token` from `/api/me`. Session cookies are HttpOnly, Secure, SameSite=Strict. Registration/login return a session and fresh CSRF token. All timestamps are UTC ISO except dump `sourceTime`, which is a timezone-unconfirmed local time from its filename.

| Method and path | Input | Response |
|---|---|---|
| GET /api/me | None | `{user: null}` or `{user:{id,email,name,role},csrfToken}` |
| POST /api/register | `{email,password,name}` | 201 `{user,csrfToken}`. Password 12-128 characters. |
| POST /api/login | `{email,password}` | `{user,csrfToken}` |
| POST /api/logout | None | `{ok:true}` |
| GET /api/dashboard | None | `{user,characters:[Character],balance:number,pendingTicks:number,raidCount:number,tickRate:number,auctionStatus:"live"|"not_implemented"}`. Tick rate is the current new-raid default when administration is bundled; auction status is live when the auction module is enabled. |
| GET /api/characters | None | `{characters:[Character]}`. Members see the character registry for claims; ownerEmail only supplied for own records or officers. |
| POST /api/characters | `{name,level,className}` | 201 `{character:Character,claim:Claim}`. Creates an unclassified, unowned registry record and the caller's pending claim atomically; ownership and main DKP still require officer approval. |
| POST /api/claims | `{characterId}` | 201 `{claim:Claim}` |
| GET /api/claims | Claims read permission | `{claims:[Claim],assignments:[Assignment]}` |
| POST /api/claims/:id/approve | `{kind:"main" or "alt"}` | `{claim:Claim,creditedDkp:number}`. Idempotent for matching repeated approval. |
| GET /api/raids | None | `{raids:[Raid]}` |
| POST /api/raids | Officer: `{name,date:"YYYY-MM-DD",rate?:positive integer,expansion?:string,raidType?:string}` | 201 `{raid:Raid}`. Explicit rate wins; otherwise use a configured expansion/raid-type preset or the current default. Supply both preset names together; an unknown preset without an explicit rate returns 400. |
| POST /api/raids/:id/import | Officer: `{files:[{name,text}],commit?:false}` | `{preview:true,files:[ImportPreview],totalRows:number}` |
| POST /api/raids/:id/import | Officer: same plus `commit:true` | `{preview:false,files:[ImportPreview],importedTicks:number,duplicateTicks:number,creditedDkp:number}` |
| GET /api/raids/:id | None | `{raid:Raid,ticks:[Tick],attendance:[Attendance]}` |
| GET /api/ledger | None | `{entries:[LedgerEntry]}` own main characters; officers see all |
| GET /api/audit | Officer only | `{entries:[AuditEntry]}` |

`role` retains the legacy bootstrap identity. Production authorization uses the current database access profile and overrides from ACCESS.md; `/api/me`, registration and login return an `access` object with effective permissions. Legacy roles cannot bypass the central route gate.

`Character`: `{id,name,level,className,rank,kind:"unclassified"|"main"|"alt",ownerId:null|string,ownerName:null|string,ownerEmail?:string,balance:number,pendingTicks:number,claimStatus:null|"pending"|"approved"|"rejected"}`.

`Claim`: `{id,characterId,characterName,userId,userName,userEmail,status:"pending"|"approved"|"rejected",kind:null|"main"|"alt",createdAt,approvedAt:null|string,rejectedAt:null|string,rejectedBy:null|string,rejectionReason:null|string}`. Approving a character assignment atomically rejects other pending claims for that character as superseded. Each rejection records the approving officer, timestamp, reason, and winning claim in the audit log. Retrying the winning approval does not duplicate credits or rejection audit entries. A claim request racing after assignment cannot create a new pending claim. `Character.claimStatus` can also be `"rejected"`.

Each website account may have exactly one approved main and any number of approved alts. The database enforces the main limit with a partial unique index on character owner. Approving a second main returns `409 main_exists` with a friendly explanation. A losing concurrent main approval rolls back completely: it does not assign ownership, post DKP, change that pending claim, or reject its competing claims. The character can still be approved as an alt. Audited ownership correction is available through officer detachment and a new claim; see OWNERSHIP.md.

Character creation accepts names matching `[A-Za-z][A-Za-z'-]{1,63}`, numeric whole levels 1-255, and class text 1-80 characters, with surrounding whitespace trimmed. New records use rank `Website request`, `kind:"unclassified"`, no owner, and no attendance or DKP credit. The caller receives a pending claim for officer review. Existing case-insensitive names return `409 character_exists` and must use the existing registry claim flow; creation never overwrites or hijacks an imported, approved, or unowned character. Concurrent duplicate creations leave exactly one character, its winning pending claim, and one `character_requested` audit entry. Duplicate submissions do not create extra credit. The creation endpoint does not accept ownership, main status, balances, or guild-rank grants from the request body.

`Raid`: `{id,name,date,rate,createdAt,tickCount:number}`. `Tick`: `{id,raidId,fileName,sourceTime,rowCount,createdAt}`.

`ImportPreview`: `{name,sourceTime,rowCount,status:"new"|"duplicate",eligibleMains:number,unclaimed:number,alts:number,warnings:[string]}`. Parse/conflict errors reject the complete request before write. `Attendance`: `{id,tickId,characterId,characterName,className,zone,status:"pending"|"credited"|"ineligible",dkp:number}`.

Attendance imports seed a registry character's name, level, class and guild rank only when that name first enters the registry. Later captures do not change those fields, approved ownership, main/alt status or identity, including when an EverQuest persona reports another class. A manually requested character is already registered and likewise retains its chosen metadata on its first import. Persona class differences produce no warning. New attendance rows display the canonical registry class; each immutable tick's raw text retains the actual class, level, rank and zone observed in the capture. This does not edit historical rows or recalculate DKP. Officer-directed character metadata changes are separate future work.

`LedgerEntry`: `{id,characterId,characterName,amount,reason,createdAt,actorName,raidName:null|string,sourceTime:null|string}`. `AuditEntry`: `{id,actorName,action,details,createdAt}`. Ledger/audit lists are capped at the newest 500 entries for this initial slice.

No cross-item DKP reservations or automatic main/alt inference from guild rank/notes are implemented. Main classification and account assignment occur together on officer claim approval. Source files are retained in the database but not exposed to members. A snapshot capture identity is guild/server/filename time, globally unique across raids. Upload suffixes such as `(1)` are ignored; repeated equivalent contents do not duplicate points. Same capture with conflicting contents or another raid assignment is rejected for officer review. Separate filename times remain distinct ticks even when roster content matches. Imports accept 1-10 dumps, each with 1-500 rows and at most 1 MiB text; complete JSON bodies are capped at 5 MiB. Original trailing tab fields must be preserved. Source times remain timezone-unconfirmed. Claims can refer to an imported character or an explicitly requested new character. Officers may correct ownership by audited detachment and reapproval (OWNERSHIP.md). Access profiles are configured through ACCESS.md; password recovery remains unavailable.

The integrated private build also includes auction routes in [AUCTIONS.md](AUCTIONS.md), attendance requests/settings/adjustments in [ADMIN.md](ADMIN.md), item details in [ITEMS.md](ITEMS.md), main attendance reports in [REPORTS.md](REPORTS.md), and boss loot preparation/history in [LOOT.md](LOOT.md). Source enrichment is documented in [EQRESOURCE.md](EQRESOURCE.md). Module availability does not imply completed deployment or live source verification.

This is a single-guild site. Its first committed attendance batch atomically binds the normalized guild and server from the source filenames. Read-only previews do not bind the site. Mixed-guild or mixed-server batches, later foreign sources, and losing concurrent first imports return `409 scope_conflict` without importing rows, creating characters, or posting DKP. Duplicate imports from the bound source remain idempotent. Changing a site's guild/server binding is not exposed in this slice.

## Character profile equipment

Authenticated character equipment reads and owner/officer loadout changes are documented in EQUIPMENT.md. These selections are profile information, not authoritative in-game equipment, award confirmation or DKP transactions.

## Access and filtered audit

See ACCESS.md for profiles, overrides, revisions and last-manager protection, and AUDIT.md for database-filtered historical audit queries. The generated Worker enforces permissions and atomic revocation guards. Shared profile item hovers are separate from officer catalog management. Narrow dependency routes include GET /api/raid-options (loot/capture/attendance readers), /api/ledger/characters (ledger writers), /api/attendance-requests/options (own eligible missing ticks), and /api/characters/:id/equipment/references (own profile writers). These do not expose raw attendance dumps or grant management rights.

## Version0.6 rules

Each newly accepted bid or edit must be at most the current approved main ledger balance inside the acceptance transaction. Other auction commitments do not reserve points. Accepted bids survive later balance changes and remain chargeable into a negative balance. Canonical character class/level/rank are seeded once, while source captures preserve observed persona details. Optional blank audit dates mean no filter. Persistent companion device routes and the graphical setup are documented in CAPTURES.md and companion/README.md.


## Uploaded catalog and inventory (0.6)

GET /api/catalog requires items.read. POST /api/catalog/import requires items.write, same origin and CSRF, multipart file/expectedRevision/optional sourceDate. The upload is capped at 32 MiB compressed/plain and 256 MiB expanded; activation is atomic. POST /api/catalog/imports/:id/discard cancels incomplete staging only.

POST /api/characters/:id/inventory/preview accepts JSON {fileName,text}; POST .../inventory/import accepts {importId,fileName,text,selections:[{slotKey,expectedItemId}]}. Both require approved ownership and overview.write or mains.write, same origin and CSRF. Text is capped at 2 MiB. The server reparses on commit, atomically guards selected slots, caches selected uploaded details and stores installed augments; no DKP/award writes.


## Raid-night tracker imports (0.7)

Attendance reconstruction: POST /api/raids/:raidId/ticks/:sourceTickId/clone/preview with {targetTime,reason} returns a review token, original roster, current main/alt counts and projected DKP. POST the matching /clone endpoint with the same values plus previewToken and a reusable idempotencyKey to confirm. Both require attendance.write, same origin and CSRF. Clones stay in the same raid and preserve source attribution; occupied times and stale previews return409. Normal GET raid/tick responses include origin metadata for cloned ticks. See ATTENDANCE.md.

GET /api/loot-imports and GET /api/loot-imports/:id require loot.read. POST /api/loot-imports/preview validates the selected tracker-json, tracker-tsv or eq-log file and context without committing. POST /api/loot-imports commits the exact expectedPreviewHash. PUT /api/loot-imports/:id/events/:eventId changes reviewed exclusions with expectedRevision and a reason. POST /api/loot-imports/:id/groups/:groupId/prepare makes one officer-reviewed boss draft, without publishing it. Mutations require loot.write, same origin and CSRF. Item holders remain separate from auction recipients; no attendance/award/DKP writes occur. See COMPANION_IMPORT.md.

GET /api/catalog/spell-names reads spell-cache provenance; POST .../refresh requires items.write, same origin and CSRF. The fixed spell reference supplies missing effect names only. Item statistics remain uploaded-file data. See SPELL_NAMES.md.

## Auction controls (0.8)

POST /api/auctions/:id/cancel, /complete-early and /bids/:characterId/cancel accept {reason,confirm:true,idempotencyKey}, require auctionAdmin.write, same Origin and CSRF, and act only before the current open deadline. Receipts are immutable and exact retries cannot repeat a withdrawal or completion. Cancelled auctions keep other sealed bid events private. GET auction details includes an independent approved-main registry list for authorized management writers. GET /api/auctions accepts slot and cancelled status filters and returns the recorded slot choices. Slots snapshot from saved item data on publication. Early completion changes the effective deadline, retains scheduledClosesAt and still requires normal award confirmation.
