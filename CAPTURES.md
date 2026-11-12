# Live loot capture v0.3

The native Node24 companion reads one selected EverQuest log file. It filters the dedicated abfloot chat locally and sends only matching complete messages to Guild Desk. No game injection, packet capture, account-password collection or automatic auctions are involved. All guild DKP rules remain unchanged.

## User flow

1. Run Start-Guild-Desk.cmd for persistent local storage, or open an authorized hosted deployment.
2. Sign in as an officer. Choose Live loot capture, enter the boss and optional raid, and create a capture.
3. Copy the one-time pairing JSON. Run companion/Start-Companion.cmd and paste it at the hidden prompt, then enter the EQ log path. Dragging a quoted path is supported. The token is kept in memory only.
4. Enable game logging with /log on. Post item links to abfloot separated by a literal | character. The channel number can change; the name is matched exactly. A new watcher starts at EOF, so connect before posting.
5. Refresh the capture to review messages and quantities. Exclude reposts/non-loot messages if necessary. Repeated item names count as copies; repeated entire messages are warned about and counted until reviewed.
6. Finish capture and prepare its single boss draft. Match item IDs, resolve malformed fragments, review quantities and publish auctions using the existing manager flow.

Synthetic example: three abfloot messages produce9 pieces in8 name groups, including Tatrinek's Curse quantity2. Apostrophes, backticks and Spell: prefixes are preserved. Log names carry no item IDs or full stats. Concatenated fragments remain intact and need review; the parser never guesses a split. Named-sender syntax is supported but marked unverified until a real named-sender sample is supplied.

## Web API

All /api/captures routes require an authenticated officer. Mutations require exact Origin and the session X-CSRF-Token.

| Route | Input / result |
|---|---|
| GET /api/captures | {sessions} newest100; no tokens/hashes |
| POST /api/captures | {bossName,raidId?,channelName:'abfloot',allowedSenders:[]};201 {session,pairing:{version:1,siteUrl,captureId,token}}. Pairing plaintext appears only once. |
| GET /api/captures/:id | {session,events,warnings}; raw selected messages and parsed item names |
| PUT /api/captures/:id/events/:eventId | {ignore:boolean}; retains raw evidence and audits the review |
| POST /api/captures/:id/prepare | Freezes input, creates one idempotent boss draft and returns {session,draftId}. Retry a preparing capture safely. |
| POST /api/captures/:id/pair | Rotates the one-time token for an open capture while preserving its identity, watcher and events. Reconnect an expired/lost pairing and retain the local pending queue. Old tokens stop working. |
| POST /api/captures/:id/revoke | Stops an open connection without deleting its evidence; revoked captures cannot prepare drafts |

Session fields: id,bossName,raidId,channelName,allowedSenders,status,createdAt,expiresAt,eventCount,ignoredCount,itemCount,warningCount,draftId. itemCount means included occurrences, not unique names. Event fields: id,eventId,sender,sourceTime,fileName,offset,line,ignored,items,warnings.

## Companion API

GET /api/companion/session and POST /api/companion/events require Authorization:Bearer with the capture token and no Origin header. They grant no account session, bid access, draft publication, awards or DKP changes. Tokens are random256-bit values stored only as SHA-256 hashes in the server database, expire after24 hours, and are checked against current creator officer access. One stable watcher ID is bound per capture.

POST body: {watcherId,events:[{eventId,offset,fileName,line}]}. Event IDs are stable SHA-256 keys from the watcher; byte offsets and basenames preserve provenance without sending the local directory. Same-key matching retries are acknowledged as duplicates; conflicting payloads fail. The server rechecks channel/sender parsing rather than trusting the companion's item claims. Unrelated chat is neither saved nor accepted as loot.

Limits:50 events and256KiB JSON per upload;200 messages,1000 occurrences and512KiB raw selected log text per capture. Raw-size and state guards are transactional. Limits/frozen/revoked/expired captures pause the companion with queued events retained, never silently discarded. A prepared draft supports50 copies maximum per item; excess/reposts need review/exclusion before preparing.

Apply immutable migration0002 after0000 and0001. No accounts or guild data are seeded. Preparation captures a fixed preparer identity and stable capture key so concurrent different-officer retries cannot make two drafts. Only manager publication starts24-hour auctions; only confirmed awards deduct DKP.

## Hosting compatibility

The persistent local server accepts the capture-scoped native API directly. Hosted authentication gates may redirect native requests before the application receives them. Native requests do not have browser cookies and never forward capture tokens across redirects. Verify an authorized reachable hosted API before claiming hosted companion compatibility. No authentication-gate bypass is provided.
