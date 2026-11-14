# Character wish lists

## Import a spreadsheet list

Open your own Overview > Wish list, choose the expansion, and paste one full item name per line under Import item names. Copying a spreadsheet column works. Alternatively upload TXT, CSV or TSV (up to 64 KiB / 200 names); Excel workbooks should be copied or exported as CSV first. Multi-column CSV/TSV needs one column headed Item name, Item or Name. CSV quoting preserves commas and quotes inside names. Choose CSV/TSV for pasted exports; .csv/.tsv uploads select their format automatically, while TXT uses the selected format.

Review import looks up exact full names in the current uploaded catalog, ignoring only case and spacing. Prefixes are retained. Unique new matches are selected; duplicate names, missing names, existing/completed wishes and ambiguous IDs are not silently added. Choose an explicit ID for ambiguous names (up to ten displayed candidates); use individual search if there are more. Remove/Restore changes only this preview. Approve and add saves the selected matches to that character and expansion.

Items save sequentially with the normal owner/ACL checks and audit. If the connection fails, saved rows remain marked and retry saves the unsaved remainder; duplicate adds are harmless. Approval verifies the exact previewed ID/name again inside the write transaction. A changed catalog or ownership requires a fresh review. Import does not reopen completed wishes, modify equipment, bid or charge DKP.

POST /api/characters/:id/wishlist/import-preview accepts {expansion,names:[...]} (bounded 64 KiB JSON) and performs no writes. Approval uses ordinary POST .../wishlist with {expansion,itemId,expectedName}; each individual save is atomic. The import as a whole is additive, not one all-or-nothing transaction. No new database migration is needed in 0.11.0.

Your Overview has Overview, Inventory and Wish list tabs. Select Underfoot, House of Thule or type another expansion label and Open wish list. Search the uploaded item catalog by name/ID and add desired items. Items retain their detail/compare popups and equipment-slot metadata. Expansion is your planning grouping; the application does not guess expansion origin from incomplete catalog data.

Only the approved character owner with Overview.write or Mains.write can add, remove or reopen wishes; officer status never bypasses ownership. Lists can be read under the same character/profile permissions as equipment. Duplicate adds are harmless. Removes and Want again use the current item operation ID; late stale actions cannot replace a newer generation. Account/character state stays isolated across sessions.

Open auctions whose exact item IDs match an active wish on any approved character you own are marked gold and On your wish list. Sealed bid amounts/participation remain private. No bid, reservation or DKP operation is created by wishing.

After a new settled account win, saving that same item to the character's base equipment slot crosses the wish off as Won and equipped. This applies to normal selections and inventory equipment imports. Winning alone does not cross it off. Completion survives later gear changes so later copies stop highlighting. A main-funded win can fulfil that account's alt wish. Other people's awards never qualify. Installed augment wishes are not automatically fulfilled in this release.

Want again snapshots existing owned award IDs and requires a later distinct win; refreshing equipment cannot reuse an old win. Add/remove/reopen/completion actions are audited. Deleting the source raid reopens wishes completed from its removed auction. Wishes remain separate from item delivery confirmation or the DKP ledger.

GET /api/characters/:id/wishlist?expansion=House%20of%20Thule; GET .../wishlist/search?q=ring; POST .../wishlist {itemId,expansion}; DELETE .../wishlist {itemId,expansion,expectedOperationId}; reopening POST adds wantedAgain:true and expectedOperationId. GET /api/wishlist/auction-matches returns current account active itemIds under auction read permission. Same Origin/CSRF and transactional ownership/ACL guards protect all writes. Migration0015 is additive.

## Workspace and parcel delivery (0.16.0)

The ledger has aligned adjustment fields, character/recorded-by/UTC date filters, stable sortable headings and50-record pages. The account header shows current approved-main DKP, including negatives. Main lists and profiles omit the account subtitle. Single-item publishing is now Officer workspace > Publish single auction and retains auctionAdmin access checks.

Wish lists use small item icons, name/class/slot/status filters and List or Equipment views. The Equipment view maps wishes to compatible slots, shows alternatives, and opens a slot-scoped catalog search without changing worn gear.

Loot history uses compact item rows and collapsible filters, with raid night, winner, winning bid, award price, holding looter and status. To parcel shows confirmed undelivered awards that the current user may deliver. Imported quantities are allocated to award rank in original export order, skipping excluded source events and retaining original handoff provenance. Only an Administrator template or current approved owning main/alt of the assigned looter may mark parceled; an officer without that identity cannot. Current write access remains necessary. No delivery action deducts DKP. Parcel events are audited and retry safe; delivered items remain in All loot and the member Won view. Migration0017 is additive. Preserve the database and apply numbered migrations in order.
