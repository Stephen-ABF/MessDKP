# Guild Desk 0.12.2

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

## New in 0.12.2

Click Item ID, Item name, Copies, Your Bid or Time left to sort. Click again to reverse. Your Bid starts highest first, name starts A-Z, and blank bids stay last. Sorting happens on the server before the100-row display limit and preserves filters. Phone-width screens have Sort by/Direction controls.

## Your Bid column (0.12.1)

Your Bid replaces the minimum-bid list column. It shows only your own recorded amount, and is blank when you have no bid. The compact layout and all0.11 improvements remain included.

## Compact layout (0.12.0)

The approved Compact table layout uses larger Item ID, Item, Copies, Min. bid, Time left and Actions headings. Matching cached item icons precede names; copy counts and minimum DKP are prominent. Controls pills beside View / bid open the chosen officer action in a reason-and-confirmation dialog. Every0.11 improvement below is included. No new migration is needed.

## Previous imports and bid overview (0.11)

Wish lists accept reviewed item-name imports from paste/TXT/CSV/TSV, with exact uploaded-catalog matching, row removal and explicit approval. Auction filters update in place; green rows identify your open bids and a private summary totals their full bid amounts across all current auctions. Weapon details show base and elemental-inclusive ratios using uploaded data. See WISHLIST.md, AUCTIONS.md and CATALOG.md. No new migration after0015 is required.

## Previous raid deletion and wish lists (0.10)

Officers can preview and permanently delete an erroneous raid with a reason, exact typed name and confirmation. The single atomic deletion removes linked attendance/ticks/clones, earned DKP and loot charges, requests, drafts/auctions and imported custody, while retaining officer audit and protecting other raids. Custom permissions for linked loot, auction and capture workspaces are enforced.

Overview > Wish list organizes desired items by Underfoot, House of Thule or a custom expansion label. Search uses the uploaded item file; expansion is a planning list, not a claim about item origin. Active wishes on approved own characters highlight matching open auctions in gold. A later account win plus saving the item in a base equipment slot crosses the wish off permanently, across later gear changes. Want again begins a new generation needing a new win; stale retries cannot undo a later completion. Installed augment auto-fulfilment is not included. See WISHLIST.md and RAID_DELETION.md.

## Previous archive and comparison (0.9)

Guild-wide Loot history lists settled winners, prices, boss/raid provenance and filters for class, slot, recorded item type, winner and raid date. Auctions has Guild auctions, Won and Lost views. Personal outcomes show only your final active bids; Won includes recorded holding looters from retained imports, and Lost compares against the lowest winning bid with tie-break/ineligible labels. Live/cancelled auctions are excluded.

Click an item to compare it on the left against your own saved equipment on the right, with character and paired-slot selectors and recorded numeric differences. Unknown stats are not zero; base stats exclude installed augments and do not rank effects. Officer controls have separated reason/confirmation/action sections. Imported loot/draft rows show available icons and reversible Remove from auction / Restore actions.

## Previous auction controls (0.8)

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

CI is configured to build and run the test suite on Windows and Linux with Node.js 24. Tags matching v* invoke a release build and package an allowlisted tracked-source snapshot plus the generated Worker. Release assets exclude databases, environment files, live logs, local companion state and private host configuration. See PUBLIC_RELEASE.md for version 0.12.2 and release instructions.

API contracts: API.md, AUCTIONS.md, ADMIN.md, ITEMS.md, REPORTS.md, LOOT.md, CAPTURES.md, EQRESOURCE.md, OWNERSHIP.md and EQUIPMENT.md, ACCESS.md and AUDIT.md. Features and limitations should be reviewed before production use.
