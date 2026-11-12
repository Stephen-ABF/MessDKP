# Guild Desk 0.4.0

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

## New in 0.4

Source captures open individual tick attendance. Characters opens the registry first with a separate creation tab. Main profiles include linked loot awards and a member-maintained equipment overview, with saved item references and shared EQ-style hover details. Claim history identifies the assigning officer and supports audited detach corrections. Equipment selections do not change awards or DKP; only known cached item details are displayed.

## DKP and loot behavior

Attendance uses each committed data dump as a tick. The mains report groups by class, shows current DKP and negative balances, and reports 30/60/90-day/all-time tick attendance. DKP is not reserved for bids. Officers confirm awards before charges; negative balances remain visible for officer handling. Auctions use a shared 24-hour window and sealed bids. Each winner pays the next eligible bid plus one, capped at their bid; without a lower bid the published minimum applies.

For native loot capture, open Live loot capture in Guild Desk, enter the boss and optional raid, and create a capture. Run companion/Start-Companion.cmd (or `node companion/start.mjs`), paste the pairing JSON and select the EverQuest log file. Post item names on the configured loot channel, then finish capture and prepare its boss draft in Guild Desk. Review item matches, quantities, repeated payloads and concatenated fragments before publishing. The companion forwards only the configured channel. See companion/README.md and CAPTURES.md for pairing, local state and recovery. Item-only protocol examples do not imply generic game-log support. Manual boss drafts can also be prepared from item names.

EQResource links and explicitly sourced partial item references are retained. Source access can fail; no full game-item database, complete metadata, fabricated icon or access-control bypass is supplied. See EQRESOURCE.md for adapter limits.

## Verification and releases

CI is configured to build and run the test suite on Windows and Linux with Node.js 24. Tags matching v* invoke a release build and package an allowlisted tracked-source snapshot plus the generated Worker. Release assets exclude databases, environment files, live logs, local companion state and private host configuration. See PUBLIC_RELEASE.md for version 0.4.0 and release instructions.

API contracts: API.md, AUCTIONS.md, ADMIN.md, ITEMS.md, REPORTS.md, LOOT.md, CAPTURES.md, EQRESOURCE.md, OWNERSHIP.md and EQUIPMENT.md. Features and limitations should be reviewed before production use.
