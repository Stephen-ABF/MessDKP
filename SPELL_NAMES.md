# Friendly spell and focus names

An item dump can contain an effect ID without its friendly name. For example, the verified SODEQ item 105313 has worn effect 3660 and an empty worn name. Guild Desk now resolves missing names from a separate persistent spell-name reference. Uploaded nonempty effect names always take priority, including the current focus name supplied for spell ID 33156. Item stats and restrictions still come exclusively from the uploaded item file.

## Source and provenance

The Raidloot spell parser maintainer's own README at https://github.com/rumstil/eqspellparser links https://s3.amazonaws.com/raidloot/spells.csv.gz as its downloadable data. Ordinary development retrieval returned 200 with 1,957,488 compressed bytes, 19,078,628 expanded bytes, 37 CSV columns and 61,868 spell rows. The source Last-Modified was **2023-07-12 06:15:07 UTC**. This date is retained and must not be presented as a current game-data revision.

The file directly confirms 3660 = Faerune, 9612 = Improved Dodge V and 23395 = Prismatic Ward VIII. The resolver imports all valid spell IDs and names rather than hardcoding those examples. Names absent from this older reference remain unknown; the UI can hide numeric fallback labels while preserving the actual effect IDs in structured data. A nonempty uploaded name is never replaced by an older reference name.

Only names are persisted from this reference. Guild Desk does not fetch item pages or import item statistics from Raidloot, EQResource or another item site. The complete downloaded reference is not bundled in public source or release ZIPs.

## Operation

Migration 0010 adds `spell_name_entries` and one `spell_name_cache` provenance row. When an item first needs a missing effect name and the cache is empty, the service requests the single fixed source URL, validates the entire gzip CSV, and replaces the cache in one atomic batch. All IDs and names are validated, duplicate IDs and malformed CSV are rejected, and SHA-256, Last-Modified, retrieval time and entry count are saved with the rows. A failed refresh leaves the previous cache unchanged.

Requests coalesce within the same service/database binding. Subsequent item reads use the persistent database cache and make no spell-source request. A failed initial download backs off for five minutes in memory; officers can explicitly retry immediately. The default download deadline is 15 seconds. Redirects are rejected. The actual compressed body is limited to 8 MiB and expanded content to 64 MiB, independent of Content-Length; the parser limits rows to 150,000 and a record to 128 KiB. Database inserts use JSON batches whose parameters stay within 256 KiB.

Item rendering fails softly: original item stats remain available and supplied effect names remain visible even if the reference cannot be downloaded or parsed. Unknown effect IDs are retained; names or behavior are never guessed. This module does not supply a current spell-description or effect-calculation catalog.

| Route | Access and behavior |
| --- | --- |
| GET /api/catalog/spell-names | Item read access; returns cache provenance, count, limits and in-memory retry status. Never initiates a download. |
| POST /api/catalog/spell-names/refresh | Item write access, same Origin and X-CSRF-Token; explicitly updates the one fixed source. No arbitrary URL option is accepted or followed. |

The module exports `enrichItem(db,item,{cacheKey=db})`, `enrichItems(db,items,{cacheKey=db})` for efficient list reads, `getSpellNamesStatus(db)` and `handleSpellNamesApi(request,env,context)`. Request-specific guarded database wrappers use the stable original database binding as `cacheKey` (and `env.SPELL_CACHE_KEY` for API calls), so coalescing and backoff span those wrappers while all SQL still goes through the guarded database. Retained legacy item DTOs can reconstruct effect IDs and supplied names from exact raw header fields. Tests use `createSpellNamesService({fetchImpl,clock,timeoutMs})` for controlled source failures without calling external hosts.

## Verification

Twelve permanent unit regressions cover quoted CSV fields, incremental UTF-8 record limits before an unterminated quote reaches EOF, malformed and duplicate records, provided-name priority, persistent cache reuse, concurrent first reads across guarded wrappers, database isolation, legacy DTO reconstruction, timeout/redirect/size failures, backoff and officer retry, atomic rollback, route authorization and bounded JSON inserts. A disposable local SQLite run imported the real 61,868-row reference using one atomic batch of 14 statements, with maximum JSON parameter 262,141 bytes. It then resolved worn effect 3660 as Faerune with no additional source call. This used the previously downloaded source file through an injected fetch adapter; it is not a hosted network or quota test. Independent review confirmed the malformed 8 MiB quoted-record probe now stops at the 128 KiB record guard in 10 ms without the earlier growing-field memory use.
