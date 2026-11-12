# Guild Desk 0.6.1

Patch 0.6.1 fixes false session-expiry errors when uploading catalogs larger than 5 MiB. Internal identity checks now forward only the session cookie, and genuine server errors retain their status. Cookies, CSRF, access checks and upload limits remain enforced. Four regression cases use actual serialized large multipart bodies; see TEST_RESULTS.tap.

This release adds an officer-uploaded EQItems/SODEQ catalog and owner-only character inventory imports. Item lookup, hover details and boss-loot matching use uploaded files. EQResource is an external hyperlink only: no remote item search, page retrieval or images. New catalog versions activate atomically without rewriting past auction snapshots. See CATALOG.md.

On your own character Overview, open Inventory, select an EverQuest `/outputfile inventory` text export, preview equipped locations and installed augments, then import selected slots. Empty saved slots are selected initially; replacing gear requires an explicit choice. Bags, bank and key rings stay out of equipped locations. Only the approved owner can import, including when an administrator views someone else's character. Equipment never awards loot or changes DKP. See INVENTORY.md.

Other changes: blank audit-date filters now load, partial attendance has request links, persona imports retain registry class, and new/edited bids are capped at current main DKP without reservations across auctions. Accepted bids survive later balance changes; officer-confirmed awards can produce negatives. The graphical companion remembers its log and scoped device connection between bosses. Review actions preserve position and focus.

## Run and update

Requires Node.js 24 or later. On Windows extract and run `Start-Guild-Desk.cmd`, then open http://localhost:4173. Keep the existing `data` folder and `companion/state` during upgrades. Stop the running server yourself before replacing application files. Additive migrations through 0009 preserve existing records. No owner preview or live database was changed during development.

For live loot run `companion/Start-Companion.cmd`, choose the log once, use Connect companion in Guild Desk and confirm the displayed site in the graphical window. Select that saved computer for each boss and wait for Watching. Prepare the reviewed draft and publish auctions separately. Manual pairing JSON remains an advanced fallback. See companion/README.md and CAPTURES.md.

## Data and verification

Public attendance fixtures are artificial: 26 and 29 rows, 29 distinct fictional characters. Catalog and inventory test inputs are synthetic. Original attendance, inventory exports, the downloaded full game database, accounts, databases, logs, credentials, companion state, hosting identity and private Git history are excluded.

Run `node build.mjs --local` then `node --test`. Exact test evidence is included with the artifact. Disposable browser verification exercised the website file chooser, preview, import of all 23 equipment slots, unchanged DKP and installed augment disclosure. The supplied inventory text parsed into 23 equipped items and 34 installed augments. Independent local full-catalog verification imported 144,712 records with 315 fields; three escaped-pipe names were preserved. Bounded review found and fixed concurrent retry data loss and unbounded multipart buffering.

Hosted Worker/D1 full-file capacity and outer login-gate compatibility remain unverified; the full import exceeds some free-tier invocation limits. Class portraits and effect-specific spell-description hover remain future work. The companion's actual Windows log-picker dialog remains unverified; the website inventory file chooser was exercised.

## Release process

Prepare a fresh sanitized snapshot with `node scripts/prepare-public-source.mjs --destination ../outputs/public-guild-desk-v0.6.1-N`. Never publish private Git history. Public source: https://github.com/Stephen-ABF/MessDKP. The version-tag workflow builds/tests, packages safe tracked source plus Worker, and creates a GitHub release. A source push does not itself create a tag/Release or deploy a database. Artifact metadata records actual delivery state. Existing hosting remains unpublished.
