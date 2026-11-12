# Guild Desk main DKP and attendance reports v0.2

Parent middleware authenticates the session and calls `handleReportsApi(request, env, {user, csrfToken})`. These read-only routes require a signed-in guild member. They do not expose email addresses, auction bids, or mutate DKP. Unmatched routes return null. Responses are JSON with no-store; errors are `{error,code}`.

## Main summary

`GET /api/reports/mains?asOf=YYYY-MM-DD`

Response:

```json
{
  "asOf": "2026-11-11",
  "attendanceUnit": "dump_tick",
  "denominator": "all_guild_ticks_in_window",
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

Each class group's `mains` contains the same Main-shaped rows as the flat `mains` array. Groups and mains are sorted by class/name. Known class abbreviations and spacing variants are normalized; unknown stored class names are retained rather than inferred from notes.

Each response's totals, credited counts, balances, and per-raid rows are read within one D1 batch transaction. Concurrent imports or correction postings cannot split its reporting snapshot.

Current DKP always sums the complete current ledger, independent of the attendance `asOf` date. Zero and negative balances are included. Only current classified mains with an assigned owner are included; alts/unclassified/unowned records are excluded.

Every committed dump is one tick/check-in. Attendance is the count of distinct credited ticks divided by all committed guild ticks in that calendar window. A corrected credited tick counts once. Pending and ineligible rows do not count; empty raid drafts add no ticks. Percentages are rounded to two decimal places and are null when there are no eligible denominator ticks. Counts remain authoritative. Window totals are weighted by ticks, never averaged from raid percentages.

`asOf` is optional; default is the current UTC calendar date. The browser should pass its selected local YYYY-MM-DD date explicitly. The 30-day window includes `asOf` and the preceding29 dates; the others include59/89 preceding dates. Future raids are excluded. Filtering uses the officer-selected `raid.date`, not the timezone-unconfirmed filename capture time. The all-time window includes all raid dates through `asOf`. No join-date proration or attendance-based bidding restriction is imposed.

## Main raid breakdown

`GET /api/reports/mains/:characterId/attendance?asOf=YYYY-MM-DD`

Response is `{asOf,attendanceUnit,denominator,main,windows,raids}`. `main` is the Main-shaped row above. `windows` uses the summary definitions. `raids` lists every guild raid with at least one committed tick through the selected date, newest first: `{id,name,date,rate,attendedTicks,totalTicks,percentage}`. A main attending3 of6 ticks reports50;6 of6 reports100. An approved main absent from a raid reports0 of its actual ticks. A character outside the approved-main summary returns404.

Dates must be actual calendar dates with four-digit years from0001 through9999; malformed/repeated `asOf` is rejected. Methods other than GET return405. No schema migration is required.
