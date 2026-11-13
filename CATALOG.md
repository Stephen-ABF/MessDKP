# Uploaded SODEQ item data

## Officer workflow

Download the main item text dump from https://items.sodeq.org/download.php, keep it compressed, and upload it under Officer workspace → Item references. An optional source dump date can be recorded separately from the actual upload time. Guild Desk makes no item-site requests while importing, searching, showing details or matching loot. EQResource links open only when the user follows them.

The primary route is `POST /api/catalog/import`, multipart fields `file`, `expectedRevision` and optional `sourceDate` (YYYY-MM-DD). `GET /api/catalog` supplies the current revision, active import, recent imports and limits. A valid import returns this status plus `itemCount` and `alreadyImported`. Repeating the exact active file is idempotent. A stale catalog revision returns 409; reload before replacing another officer's import. An interrupted staging import can be discarded with `POST /api/catalog/imports/:id/discard` and retried.

Errors are `{error,code,lineNumber?}`. Malformed data is 400, conflicting imports 409 and exceeded limits 413. Uploads require the items write permission, exact same Origin and X-CSRF-Token. Reads require items read permission. No import grants access to guild accounts, creates auctions or changes DKP.

## Verified format and limits

The main SODEQ download retrieved during development on 2026-11-12 was gzip, 8,076,697 bytes compressed, 126,861,406 bytes expanded, **315 header fields and 144,712 item rows**. This is format verification, not a claim that every live-game item or progression variant exists in the file. The downloaded dataset remains private and is excluded from public source/release packages.

The parser uses the original header names rather than assumed column positions. Fields are pipe-separated; escaped `\|` is a literal pipe, empty fields and other literal backslashes are preserved. Three records in the verified file contain escaped pipes. UTF-8 is decoded strictly. IDs, known masks and normalized numeric stats are validated, duplicate IDs are rejected, and every supplied field is retained verbatim for details and future mappings.

| Limit | Value |
| --- | --- |
| Selected file | 32 MiB, gzip or plain text |
| Actual multipart request body | 32 MiB + 64 KiB overhead, counted before form parsing |
| Expanded bytes | 256 MiB |
| Items | 500,000 |
| One item record | 64 KiB |
| Supported header fields | 10–1,024, including required identity/mask/stat fields |
| Staging batch target | 256 KiB of raw rows plus bounded serialization overhead |

The selected compressed upload is hashed using SHA-256. Decompression and validation stream through bounded row batches; the complete expanded dump and all normalized objects are never retained together in JavaScript. The API rejects oversized bodies even when Content-Length is absent or false. Normal API routes retain their smaller request-body limits.

## Atomic activation and recovery

Migration 0008 stores import metadata, raw catalog rows and one revisioned active pointer. Rows stage under an attempt ID. Only a completely validated import with the expected count can become active, and activation compares the current revision atomically. Concurrent retries cannot delete active rows: archived imports reactivate immutable validated rows, and failed retries must first own their staging attempt. A discarded or failed attempt cannot keep writing or activate. A malformed later row leaves the previous active catalog usable.

Each successful activation creates an audit entry with uploader, filename, file hash, optional source date, counts and previous catalog ID. Archived imports remain available for exact-file reactivation; they consume database space until an explicit future retention policy is added. Catalog import does not delete guild data or rewrite existing auction snapshots. Only selected IDs hydrate the legacy reference table for equipment and auction foreign keys.

## Field interpretation

Class, race and slot masks follow the provider's search controls, checked against the source header and actual records. Full item names and prefixes are preserved. No prefix removal, fuzzy substitution or cross-ID variant merging occurs. Multiple exact names with different IDs require officer selection.

Normalized stats include AC, resources, attributes, heroics, saves, regeneration, attack, healing, spell damage and other supplied fields. Slot flags include Power Source 2,097,152 and Ammo 4,194,304. The provider race bit 65,536 is retained as Shroud rather than replaced with an assumed playable-race restriction. All source fields remain visible even if not yet normalized.

Effects retain kind, spell ID, supplied name and available level/type fields; the interface shows friendly Click/Worn/Focus names and hides unresolved numeric labels and technical effect fields. A separate names-only reference can resolve missing names; uploaded names take priority. Six augmentation slots retain type, visibility and unknown values. Source timestamps are distinct from upload time. Following the owner's icons-only approval, the interface uses uploaded icon IDs to load PNG images from EQResource's verified numeric itemimages path. Item statistics are still file-only, and missing images leave the item name usable. The main dump does not contain a complete spell-description dataset, so no effect behavior is fabricated and metadata completeness remains false.

## Runtime boundary

This release implements a single-upload workflow for the local Node/SQLite server. Disposable tests cover malformed data, immutable archived retry and failed-retry races, multipart bounds, exact-name variants, and file-only item/loot paths. Hosted Worker/D1 CPU, request-duration, query/subrequest and storage quotas have **not** been validated for the full 144,712-row file. A resumable client-chunked import path is a future hosting requirement if the selected provider's limits do not permit one import request. Do not represent a local import result as a hosted deployment test.

An independent disposable in-memory SQLite run imported the real 144,712-row gzip in 2.477 seconds, with 315 fields, all three escaped-pipe names correct, 596 batch calls plus four single statements, about 37 MiB peak JavaScript heap and 375 MiB process RSS including SQLite. Local search took 19 ms. No item references, DKP rows or dataset files were created by that benchmark. These are measurements on the development machine, not guaranteed performance or hosted quota validation; SQLite held the full catalog in memory for the test.
# Weapon presentation (0.11.0)

Weapon details and comparison panes show Damage, Delay and base Ratio (damage / delay) first. Elemental damage appears below AC/HP/mana/endurance and above levels, with a separately labeled ratio including elemental damage: (base damage + elemental damage) / delay. These are displayed to three decimal places; they are arithmetic references, not resistance-adjusted DPS estimates. Missing/zero delay never produces a ratio. Nonzero elemental fields come from elemdmgamt/elemdmgtype in the uploaded file; old cached raw fields are supported. Elemental type IDs are labels, not numeric stat differences. See the EQEmu item-element-types enum documentation for the 1=Magic, 2=Fire, 3=Cold, 4=Poison, 5=Disease mapping; unknown types remain explicitly numbered. No remote item statistics are fetched.

## Compact search (0.13)

GET /api/items searches the entire active upload and returns compact item identity, class, slot, icon/reference and source-status summaries. It omits stats, raw fields, effects and augments. GET /api/items/:id retains the full item data for hover/detail views. Internal matching APIs retain their full-data contract. Searching never scrapes an item website or changes DKP.
