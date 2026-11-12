# Guild Desk 0.10.0

Adds officer raid deletion, per-character expansion wish lists and gold wishlist auctions. See RAID_DELETION.md and WISHLIST.md for complete usage and limits.

Open Attendance > Open raid > Delete this raid night to preview affected records and exact balance changes. Supply a reason, type the raid name exactly and confirm. Deletion permanently removes only linked raid records/transactions in one transaction, with immutable officer audit, concurrency/retry protection, conditional workspace permissions and numeric-range guards. Shared data and unrelated raids stay intact. No actual owner raids were deleted during development.

Overview > Wish list lets owners select Underfoot, House of Thule or another planning label, search the uploaded item catalog and add wishes. Active wishes highlight open auction items in gold. A later own-account win plus saving the item in a base gear slot crosses it off; winning alone does not. Later gear changes keep it completed. Want again requires a new distinct win and current generation. Installed augments are not automatically matched. Wishes neither bid nor reserve/charge DKP.

Applied migrations0000-0013 are unchanged;0014/0015 apply on the owner's next startup. Back up the stopped database before upgrading and preserve data, companion/state, original tracker/settings and any custom GUILD_DESK_DB path. Owner localhost preview and live databases were not touched.

Private/public test results accompany the test ZIP. New coverage checks complete linked-raid removal, audit/other-raid preservation, shared custody, exact retries and concurrent completion, prewrite permission revocation, rollback, missing/cross-raid child guards, migration preservation, owner-only wish writes, bounded requests, stale generations, gold matching, win/equip completion and raid-deletion reopening. Browser checks use a disposable database; permanent deletion itself is validated by API tests, not claimed as a browser click. Hosting remains unpublished; original Windows Python/Tk behavior is not newly claimed.
