# Guild Desk Administration API v0.1

The parent Worker authenticates the session and calls `handleAdminApi(request, env, {user, csrfToken})`. The module returns `null` for routes outside its namespace. All responses are JSON and no-store. All mutations require matching Origin plus X-CSRF-Token. The officer role is `admin` in this test build. Errors use `{error,code}`.

## Attendance corrections

| Method and path | Input | Response |
|---|---|---|
| GET /api/attendance-requests | None | `{requests:[AttendanceRequest]}`. Members see their own; officers see all. |
| POST /api/attendance-requests | `{tickId,characterId,reason}` | 201 `{request:AttendanceRequest,duplicate:false}`. Identical retries return 200 with `duplicate:true`. |
| POST /api/attendance-requests/:id/approve | Officer: `{reason}` | `{request:AttendanceRequest,creditedDkp:number,duplicate:boolean}`. |
| POST /api/attendance-requests/:id/reject | Officer: `{reason}` | `{request:AttendanceRequest,creditedDkp:0,duplicate:boolean}`. |

`AttendanceRequest` is `{id,tickId,characterId,characterName,requesterId,requesterName,raidId,raidName,sourceTime,reason,status:'pending'|'approved'|'rejected',tickRate,createdAt,decisionReason:null|string,decidedBy:null|string,decidedByName:null|string,decidedAt:null|string}`.

Members can request a specific existing tick only for their own approved main. An officer's approval credits the original tick rate once and preserves the original dump. Added attendance is explicitly marked `Officer correction` as its zone, with a correction ledger reason and audit entry. Existing attendance/ledger records are reused; already-credited attendance resolves with zero additional DKP. Rejection does not change attendance or the ledger. Repeated matching decisions are idempotent. A different decision or reason after resolution returns 409. This slice keeps one request per character/tick; reopening or replacing a rejected request is not implemented. Original tick rates come from the immutable attendance snapshot, with the unchanged raid rate as a fallback for an empty tick. Credits that would exceed exact JavaScript integer balance precision return `400 balance_range` and leave the decision pending with no attendance or ledger changes; this is a numeric storage boundary, not an affordability rule.

## Reward settings

| Method and path | Input | Response |
|---|---|---|
| GET /api/settings | Signed-in user | `{settings:Settings,appliesTo:'new_raids_and_auctions_only'}` |
| PUT /api/settings | Officer: full `{defaultTickRate,minimumBid,presets:[{expansion,raidType,rate}]}` | `{settings:Settings,appliesTo:'new_raids_and_auctions_only',changed:boolean}` |

`Settings` is `{defaultTickRate:number,minimumBid:number,presets:[{expansion,raidType,rate}],updatedAt:null|string,updatedBy:null|string}`. Defaults are 5 DKP per tick, a 1-DKP minimum bid, and no presets. Expansion and raid-type names are entered by officers; no expansion is inferred. Preset keys are case-insensitive expansion/raid-type pairs. Rates/minimums are positive whole numbers up to 1000000; at most 100 presets. Settings changes apply to new records only and never recalculate existing raid, attendance, request, auction, or ledger history. Parent creation handlers must read these settings to select defaults for new raids/auctions.

## Officer adjustments

| Method and path | Input | Response |
|---|---|---|
| POST /api/adjustments | Officer: `{characterId,amount,reason,idempotencyKey}` | 201 `{adjustment:Adjustment,duplicate:false,balance:number}`; matching retry returns 200 with `duplicate:true`. |

`Adjustment` is `{id,characterId,characterName,amount,reason,actorId,actorName,idempotencyKey,createdAt}`. Amount is a nonzero signed safe integer. Negative amounts and negative resulting balances are permitted. The resulting balance must remain within exact JavaScript integer precision. A repeated key with different payload or actor returns 409. Each new adjustment creates one separate ledger entry with no attendance link and one audit entry; source attendance ledger entries are never edited or removed. Keys are 8-128 characters; reasons are 1-1000 characters.

## Schema and boundaries

Apply `worker/admin.sql` with the parent schema before serving these routes. It adds `correction_requests`, `guild_settings`, and `dkp_adjustments`. Schema changes are not performed during requests. All posting/decision operations use D1 batch transactions and uniqueness guards. This module does not add role promotion, password resets, main changes, ownership transfers, negative-balance forgiveness, new source ticks, or automatic attendance inference.

## Production access profiles

The central Worker requires settings.write for settings changes, ledger.write for adjustments, corrections.write for own requests, and correctionReview.read/write for guild review/decisions. Legacy role checks are adapted only after the corresponding server permission gate. Each business transaction checks current permissions atomically. Corrections preserve the original tick rate and ledger idempotency.
