# Guild Desk 0.9.0

November 12, 2026. Add guild loot history, personal auction outcomes, equipment comparisons and clearer loot preparation.

## New views

Loot history is a member navigation section using Auctions read permission (or Auction management read permission). It lists only settled, noncancelled auctions, with one row per winner and unsold rows when there is no award. Filters: item name, usable class, equipment slot, recorded item type, winner, boss, raid dates and award status. Pending awards are distinct from confirmed awards. Original holding looters stay out of the guild archive. Boss/raid fields are unknown when no linked boss draft exists.

Auctions has Guild auctions, Won and Lost tabs. Won/Lost are tied to the signed-in account's final active bids across its characters, excluding no-bid, withdrawn, live, cancelled and unsettled auctions. Won shows recorded holding looters and quantities from the retained raid-night import. When multiple looters held copies, all are shown; no arbitrary per-winner copy assignment or delivery confirmation is invented. Lost shows your bid and the lowest winning bid; the gap is zero for a tie-break, unknown for an ineligible bid. Award price is separate from winning bid.

Click any item link for selected-item-left / saved-equipment-right comparison. Choose your approved main/alt and the matching paired slot. Empty or unknown slots remain explicit. Numeric differences require both values to be recorded; base item stats exclude installed augments and do not score effects. Equipment remains read-only in this comparison; only the owner can change gear through the existing Overview. Item stats remain uploaded-file data, with approved EQResource icons only and manual source links.

Officer auction controls now separate action descriptions, reasons, confirmation checkboxes and buttons. Reasons, write permissions, CSRF and retry protections remain required. Auction closing and officer-confirmed DKP deductions remain separate.

Raid-night import preview/review and matched draft rows show icons for unique exact item names. Ambiguous names do not acquire a guessed identity or icon. Duplicate-name counts are evaluated before raw catalog records load, in bounded 50-name chunks. Remove from auction and Restore actions exclude unwanted source rows before handoff or draft items before publication while retaining original evidence and revision checks. Published rows cannot be silently removed.

## Verification

Full private/public test results and build metadata are included in the test ZIP. New coverage includes multiwinner history, literal filters, ownership and atomic ACL revocation, cross-account and late-response races, paired slots, missing stats, bounded icon decoding with escaped pipes, production import exclusions, draft removal, holder provenance, Won/Lost/ties, and no DKP writes during these read/review operations.

No new schema migration: applied migrations0000-0013 remain unchanged. Preserve data, companion/state, original tracker/settings and any custom GUILD_DESK_DB location. Stop the owner app before backing up its SQLite data and upgrading. The development session never restarts the owner preview or modifies live data. Native log companion UI remains hidden; use the Python import workflow. Hosting deployment and original Windows tracker/clipboard interaction are not newly claimed.
