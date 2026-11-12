# Character wish lists

Your Overview has Overview, Inventory and Wish list tabs. Select Underfoot, House of Thule or type another expansion label and Open wish list. Search the uploaded item catalog by name/ID and add desired items. Items retain their detail/compare popups and equipment-slot metadata. Expansion is your planning grouping; the application does not guess expansion origin from incomplete catalog data.

Only the approved character owner with Overview.write or Mains.write can add, remove or reopen wishes; officer status never bypasses ownership. Lists can be read under the same character/profile permissions as equipment. Duplicate adds are harmless. Removes and Want again use the current item operation ID; late stale actions cannot replace a newer generation. Account/character state stays isolated across sessions.

Open auctions whose exact item IDs match an active wish on any approved character you own are marked gold and On your wish list. Sealed bid amounts/participation remain private. No bid, reservation or DKP operation is created by wishing.

After a new settled account win, saving that same item to the character's base equipment slot crosses the wish off as Won and equipped. This applies to normal selections and inventory equipment imports. Winning alone does not cross it off. Completion survives later gear changes so later copies stop highlighting. A main-funded win can fulfil that account's alt wish. Other people's awards never qualify. Installed augment wishes are not automatically fulfilled in this release.

Want again snapshots existing owned award IDs and requires a later distinct win; refreshing equipment cannot reuse an old win. Add/remove/reopen/completion actions are audited. Deleting the source raid reopens wishes completed from its removed auction. Wishes remain separate from item delivery confirmation or the DKP ledger.

GET /api/characters/:id/wishlist?expansion=House%20of%20Thule; GET .../wishlist/search?q=ring; POST .../wishlist {itemId,expansion}; DELETE .../wishlist {itemId,expansion,expectedOperationId}; reopening POST adds wantedAgain:true and expectedOperationId. GET /api/wishlist/auction-matches returns current account active itemIds under auction read permission. Same Origin/CSRF and transactional ownership/ACL guards protect all writes. Migration0015 is additive.
