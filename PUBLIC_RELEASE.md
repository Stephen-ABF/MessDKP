# Guild Desk 0.11.0

Adds reviewed item-name wish-list imports, live auction filters, green own-bid rows and private active bid totals, and weapon/elemental ratios.

Overview > Wish list > Import item names accepts pasted lists/spreadsheet columns and TXT/CSV/TSV files, up to 200 names. Review exact uploaded-catalog matches, remove/restore rows, choose ambiguous item IDs, then Approve and add. Duplicate, missing, existing and completed wishes are not silently added. Each approved row saves atomically and is audited; interrupted batches keep saved rows and allow retry of the remaining names. Exact ID/name and current ownership are rechecked inside each write transaction. This is an additive per-row import, not one all-or-nothing batch. See WISHLIST.md.

Guild auction name/class/slot/status filters now update results in place without a Filter button or page jump. Green rows and You have bid identify your open bids; gold wish-list badges remain when both apply. The top summary shows active auction item count and the exact sum of your full bid amounts, including auctions hidden by filters or the 100-row display limit. Closed, expired, cancelled and withdrawn bids do not contribute. No DKP is reserved and no combined affordability rule is added. See AUCTIONS.md.

Weapon popups and item comparisons put Damage / Delay / base Ratio first. Nonzero elemental damage and its separately labeled elemental-inclusive ratio appear below AC/HP/mana/endurance and above levels. Zero/missing delay produces no ratio. Details come from the uploaded item file, with legacy cached raw-field support. Ratios are arithmetic references, not predicted combat DPS. See CATALOG.md.

No new migration is required beyond existing migrations through 0015. Preserve data, companion/state, original Python tracker/settings and custom GUILD_DESK_DB. Back up the stopped database before upgrading. Owner localhost preview and live databases were not touched.

Tests and packaging results accompany the test ZIP. Coverage includes exact names/prefixes/quoted CSV, owner access, read-only preview, partial-save retry, catalog activation race rollback, stale filter/session responses, private totals beyond filtering and pagination, and weapon zero/ordering/elemental behavior. Browser checks used a disposable database. Original Windows Python/Tk behavior and hosted native companion compatibility remain unverified. The existing Site remains unpublished; no hosting deployment or GitHub tag/Release is claimed.
