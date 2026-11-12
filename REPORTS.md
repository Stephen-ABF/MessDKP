# Guild Desk main DKP and attendance reports v0.5

Parent middleware authenticates the session and calls `handleReportsApi(request, env, {user, csrfToken})`. These read-only routes require a signed-in guild member. They do not expose email addresses, auction bids, or mutate DKP. Unmatched routes return null. Responses are JSON with no-store; errors are `{error,code}`.

## Main summary

`GET /api/reports/mains?asOf=YYYY-MM-DD`

Response:

```json
{
  "asOf": "2026-11-11",
  "attendanceUnit": "dump_tick",
  "denominator": "eligible_guild_ticks_in_window",
  "windows": {
    "days30": {"days":30,"startDate":"2026-10-13","endDate":"2026-11-11","totalTicks":6},
    "days60": {"days":60,"startDate":"2026-09-13","endDate":"2026-11-11","totalTicks":6},
    "days90": {"days":90,"startDate":"2026-08-14","endDate":"2026-11-11","totalTicks":6},
    "allTime": {"days":null,"startDate":null,"endDate":"2026-11-11","totalTicks":6}
  },
  "mains": [{"id":"character-id","name":"Example","className":"Cleric","sourceClassName":"Cleric","ownerName":"Example member","balance":-15,"windows":{"days30":{"attendedTicks":3,"totalTicks":6,"percentage":50},"days60":{"attendedTicks":3,"totalTicks":6,"percentage":50},"days90":{"attendedTicks":3,"totalTicks":6,"percentage":50},"allTime":{"attendedTicks":3,"totalTicks":6,"percentage":50}}}],
  "classGroups": [{"className":"Cleric","mains":[]}]
}
```

Each class group's `mains` contains the same Main-shaped rows as the flat `mains` array. Main rows also include `attendanceStartAt` and `attendanceStartSource`; these are null when legacy membership evidence is unavailable. Groups and mains are sorted by class/name. Known class abbreviations and spacing variants are normalized; unknown stored class names are retained rather than inferred from notes. Top-level `windows.totalTicks` remains the complete guild total for context. Each main's `windows.totalTicks` is its own eligible denominator and can differ from the guild total and from other members.

Each response's totals, credited counts, balances, and per-raid rows are read within one D1 batch transaction. Concurrent imports or correction postings cannot split its reporting snapshot.

Current DKP always sums the complete current ledger, independent of the attendance `asOf` date. Zero and negative balances are included. Only current classified mains with an assigned owner are included; alts/unclassified/unowned records are excluded.

Every committed dump is one tick/check-in. Attendance is the count of distinct credited ticks divided by committed guild ticks that the character could have attended in that calendar window. A character's eligibility starts at its first known registry creation/request or observed attendance capture, whichever is earlier. Ticks before that boundary are excluded from both counts, including earlier ticks on the same raid night. Officer approval and account claiming never move the start later. A corrected credited tick counts once. Pending and ineligible rows do not count as check-ins; empty raid drafts add no ticks. Percentages are rounded to two decimal places and are null when there are no eligible denominator ticks. Counts remain authoritative. Window totals are weighted by ticks, never averaged from raid percentages.

`asOf` is optional; default is the current UTC calendar date. The browser should pass its selected local YYYY-MM-DD date explicitly. The 30-day window includes `asOf` and the preceding29 dates; the others include59/89 preceding dates. Future raids are excluded. Calendar filtering uses the officer-selected `raid.date`, not the filename date. For ordering captures against the start boundary, the effective tick timestamp is the selected raid date plus the filename's HH:mm:ss. The all-time window includes eligible raid ticks through `asOf`. Attendance reporting does not restrict bidding or change DKP.

## Membership evidence and migration

Apply the additive `worker/attendance-eligibility.sql` migration after the existing schema. It creates `character_attendance_eligibility(character_id,start_at,source)` and transaction-local insert triggers. Attendance inserts record `attendance_capture` evidence; manual character creation's pending claim records `registry_request` evidence. The boundary is stored as a canonical 19-character timestamp. Request creation timestamps use the existing UTC server clock; filename clock timezone remains unconfirmed, so no unverified timezone conversion is invented. Existing captures retain raid-calendar authority.

Existing attendance and dated claim records are backfilled using the earliest evidenced timestamp. Unclaimed imported characters acquire evidence before they are claimed. Backdated imports may establish an earlier observed start; later uploads or claims cannot postpone it. Legacy characters with no usable creation/request/capture timestamp retain unknown eligibility and zero opportunities instead of being penalized for arbitrary guild history. The migration and its triggers do not edit ownership, attendance statuses, ledger entries, raid dumps or award records. A failed source transaction also rolls back its eligibility evidence.

## Main raid breakdown

`GET /api/reports/mains/:characterId/attendance?asOf=YYYY-MM-DD`

Response is `{asOf,attendanceUnit,denominator,main,windows,raids}`. `main` is the Main-shaped row above. `windows` uses the summary definitions. `raids` lists guild raids with at least one eligible committed tick for this character through the selected date, newest first: `{id,name,date,rate,attendedTicks,totalTicks,percentage}`. A main attending3 of6 eligible ticks reports50;6 of6 reports100. A raid before the character's start is excluded; a partially eligible first night uses only its remaining eligible ticks. An approved main absent from a later eligible raid reports0 of its actual eligible ticks. A character outside the approved-main summary returns404.

Dates must be actual calendar dates with four-digit years from0001 through9999; malformed/repeated `asOf` is rejected. Methods other than GET return405. The additive eligibility migration is required for version0.5 reporting.

## Source capture details and won loot

GET /api/raids/:raidId/ticks/:tickId returns {raid,tick,attendance}, constrained to that exact raid and tick. The source time and filename identify the capture; raw uploaded text remains private. Authenticated members may read this view.

GET /api/reports/mains/:characterId/loot returns {characterId,loot}, with each closed award containing auctionId,itemId,itemName,sourceUrl,winningBid,price,status,confirmedAt,closedAt. Open or future-deadline results are excluded. Pending awards label price as proposed; confirmed awards show the actual charge. Item links open cache details and existing guild appearances/bids history. These reads never charge DKP.

## Version0.6 overview table

The profile table separates Raid, Date, Total dumps and Attendance. Zero-check-in nights are omitted from this table but remain in eligible denominator percentages. A member may jump from a partially attended own raid to the Missing attendance request choices; fully attended nights and other characters have no request control.
