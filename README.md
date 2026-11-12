# Guild Desk 0.7.1

Guild Desk is a standalone EverQuest guild DKP test application with accounts and approved mains/alts, attendance ticks, an exact DKP ledger, sealed auctions, boss loot drafts, item references, and a local log companion.

This public source snapshot contains artificial attendance data and item-only chat protocol examples. It contains no private guild roster, account database, live game-log file, pairing token, hosting identity or prior Git history. The two artificial 15-column attendance files contain 26 and 29 rows, with 29 distinct fictional characters. Mainhero appears in both; Secondhero appears only in the second. Ranks, dates, notes, locations and numeric roster fields are synthetic and do not establish character ownership or DKP.

## Run locally

Requires Node.js 24 or later. No third-party runtime package installation is needed.

```sh
node build.mjs --local
node --test
node server.mjs
```

On Windows, double-click Start-Guild-Desk.cmd to build and start the saved local application. Open http://localhost:4173. Accounts, attendance, DKP and drafts are saved in a local SQLite database between restarts. Create the first administrator account, create a raid, and import the artificial files under tests/fixtures. Approve a main before receiving DKP. No sample passwords or users are seeded.

See local/README.md for database paths, backup and restore. Live database files are never included in public source or release assets. For a disposable preview instead, run `node dev-server.mjs`; its in-memory data resets when stopped.

The server bundles to dist/server/index.js. A production host must supply a persistent DB binding and apply the numbered schema-only SQL migrations in drizzle in order. Host configuration and credentials are supplied separately. This snapshot makes no claim that a public repository, hosted deployment, outside security audit or cross-platform GitHub Actions run has already succeeded.

## New in 0.7.1

Equipment slots and item hover/details show approved EQResource icons using the uploaded icon identity. Only the verified numeric HTTPS PNG path is accepted remotely. Missing images preserve the item name and details. Item statistics remain file-only; no image dataset is bundled and no item pages are scraped.

## New in 0.7

Item panes hide zero-valued stats and technical effect fields, display friendly Click/Worn/Focus names, and preserve augment slots. Missing spell names use a separate bounded persistent names-only reference; uploaded effect names always take priority. Item stats still come from uploaded files.

Raid-night imports accept the existing Python tracker Excel TSV, new structured Guild Desk JSON, or selected raw EQ loot-log text. Holders are custodians, never automatic auction winners. Preview first, retain source/time/exclusions and prepare each boss into one reviewed draft. No automatic auctions, awards, DKP or external notifications. The additive Python launcher loads your own tracker script without including its private source/config in this package; OpenDKP and Excel exports remain. See COMPANION_IMPORT.md and SPELL_NAMES.md.

Attendance writers can reconstruct a missed capture using Clone dump on the same raid. Review the target time, original roster and rate, supply a reason and confirm. Cloned ticks retain their original source and officer attribution; retries cannot earn twice. Custom attendance-only access works without Overview permissions. See ATTENDANCE.md.

## DKP and loot behavior

Attendance uses each committed data dump as a tick. The mains report groups by class, shows current DKP and negative balances, and reports 30/60/90-day/all-time tick attendance. Each new or edited bid is capped at the current main DKP balance. DKP is not reserved across items; existing accepted bids can still produce negative balances after other awards. Officers confirm awards before charges; negative balances remain visible for officer handling. Auctions use a shared 24-hour window and sealed bids. Each winner pays the next eligible bid plus one, capped at their bid; without a lower bid the published minimum applies.

For native loot capture, run companion/Start-Companion.cmd to open the local graphical window. Choose the EverQuest log once. In Guild Desk, use Connect companion, open its one-time connection link and confirm the displayed site in the local window. Create each boss capture with the saved computer selected, then wait for Watching before linking loot. Prepare the reviewed boss draft and publish its auctions separately. Advanced-Manual-Companion.cmd retains the older troubleshooting console. Keep companion/state private and preserve it during upgrades. See companion/README.md and CAPTURES.md for recovery.

Upload an items.txt.gz or items.txt dump in Item references. Use Inventory on your own character Overview to preview and import an EverQuest inventory export. Selected item details come from the uploaded catalog; EQResource item pages remain manual hyperlinks; approved icon images load separately from its numeric itemimages PNG path. Item statistics are never fetched from EQResource. See CATALOG.md and INVENTORY.md. The full game dataset is not redistributed in this source snapshot.

## Verification and releases

CI is configured to build and run the test suite on Windows and Linux with Node.js 24. Tags matching v* invoke a release build and package an allowlisted tracked-source snapshot plus the generated Worker. Release assets exclude databases, environment files, live logs, local companion state and private host configuration. See PUBLIC_RELEASE.md for version 0.7.1 and release instructions.

API contracts: API.md, AUCTIONS.md, ADMIN.md, ITEMS.md, REPORTS.md, LOOT.md, CAPTURES.md, EQRESOURCE.md, OWNERSHIP.md and EQUIPMENT.md, ACCESS.md and AUDIT.md. Features and limitations should be reviewed before production use.
