# Guild Desk 0.7.0

This build cleans up item hover/details and adds manual raid-night imports from the existing Python loot tracker. Item panes hide zero-valued stats/levels and technical effect fields, retain augment slots, and show named Click, Worn and Focus effects. Missing names resolve through a separate persistent spell-name reference; nonempty names in the uploaded item file always take priority. Item statistics remain sourced only from uploaded EQItems/SODEQ files.

## Manual tracker workflow

Keep using the original tracker to monitor corpse loot and designated holding looters. The new companion/Start-Python-Tracker-Guild-Desk.cmd launcher loads your own Python script and adds a Guild Desk JSON export. Original OpenDKP and Excel exports keep their behavior. Your original application, settings and logs are not included in this public build.

In Officer workspace > Boss loot preparation > Raid-night import, select or paste the export and preview it. Supported data: new structured Guild Desk JSON, existing Excel TSV (Item/Qty/Looter), or selected EQ corpse-loot log text. Optional tracker settings supply filters and your character name; the configured private log path is not uploaded. The settings JSON alone contains no loot events.

Review holding looter, boss/source, quantity, available local timestamp, exclusions and possible overlap. Import the reviewed selection, then prepare each included group into an ordinary boss draft. Publishing its sealed 24-hour auctions stays separate. Holding looters are custodians, not automatic winners. Import never creates characters, attendance, awards or DKP transactions. Identical retries and overlapping stable events do not create a second custody event or handoff draft; conflicting evidence rejects atomically. Legacy TSV lacks cross-file identity and needs explicit overlap review.

Saving an export does not acknowledge website receipt or gear delivery. Clock-only tracker rows are not presented as recovered log timestamps or UTC. Automatic winner notifications, delivery confirmation, Excel writeback and outgoing API synchronization are future work. See COMPANION_IMPORT.md for the transcribed workflow, limits and recommended next changes.

## Reconstruct a missed attendance capture

Attendance writers can clone a dump into another tick on the same raid. Choose **Clone dump**, supply the intended time and a reason, review the original roster count and raid rate, then confirm. The original evidence stays intact and the new tick is marked as cloned with its source, officer and reason. Identical retries cannot earn twice. Later attendance corrections are not silently copied into the exported roster. Normal current main/alt and pending-credit rules apply. See ATTENDANCE.md.

Custom attendance-only profiles can open the raid workspace without needing Overview access. Missing-attendance shortcuts remain available only when their own permissions allow them.

## Item data and images

The separate names-only reference is linked by the Raidloot parser maintainer. Its available file is dated July 12, 2023; that provenance is shown honestly. Missing newer names remain unknown, and current uploaded names win over older reference labels. Names are cached atomically; downloads are bounded, coalesced and fail softly. See SPELL_NAMES.md.

Online icon fetching is not enabled. This build preserves the existing source restrictions and does not manufacture item pictures. Item data continues to come from uploaded files and EQResource remains manual hyperlinks. Artwork needs a separately approved image source or local client icon files.

## Install and preserve data

Requires Node.js 24 or later. Stop the current application and companion before updating. Extract into a new folder, copy your existing data and companion/state folders into the matching locations, then run Start-Guild-Desk.cmd and open http://localhost:4173. The optional Python tracker adapter requires Python 3.8 or later with Tkinter. Retain your original tracker and its settings in their existing private location.

If you set GUILD_DESK_DB, keep using the same database path rather than creating a fresh default database. Back up the database while the server is stopped before the first upgraded launch. Seeing a new first-administrator registration screen instead of your existing accounts usually means a different database path was opened; stop and check the path before creating new data.

Additive migrations 0010 through 0012 create the spell cache, raid-loot custody tables and immutable clone provenance without rewriting existing guild records. The 0.6.1 large-upload identity-check fix is retained. No owner preview or live database was altered during development.

## Validation and release scope

Run node build.mjs --local followed by node --test. Exact passing results and source identity are in the test artifact. Bounded independent reviews cover spell-cache parsing/memory limits, source-name priority, current ACL, zero/technical-field presentation, immutable custody evidence, overlap/identity conflicts, interrupted handoffs and stale-operation fencing. The Python original application is not executed during headless tests; GUI and platform coverage are described in artifact metadata.

The public snapshot contains synthetic fixtures and the generic Python adapter only. It excludes private Git history, real rosters/inventory, original Python/config files, game logs, databases, state, credentials, hosting identity, and full downloaded item/spell datasets. A source push is distinct from a GitHub tag/Release or production deployment. Existing hosting remains unpublished and hosted capacity remains unverified. Public source: https://github.com/Stephen-ABF/MessDKP.
