# Guild Desk 0.12.2

Guild auction columns are sortable: Item ID, Item name, Copies, Your Bid and Time left. Click a heading again to reverse direction. Name starts A-Z, Your Bid and Copies start highest first, and blank bid cells always stay last. Selected headings show an arrow and accessible sort state. Phone screens offer Sort by and Direction selectors.

Sorting is applied on the server before the100-row list limit, with filters retained and stable tie-breaks. Your Bid uses only the authenticated member's own active/final bid; other sealed bids never affect this order. Fast sorting/filter changes are guarded against stale replies and retain the active control's focus. Unsaved auction publication fields stay intact. No writes or DKP changes occur when sorting.

Includes the0.12.1 Your Bid column with completely blank unbid/cancelled cells, the0.12 compact layout and officer Controls pills, and every0.11 import/filter/bid-summary/weapon-ratio feature. Minimum bid rules remain in bidding details. No reservation, pricing, fairness or schema change; no new migration after0015.

Preserve data,companion/state,original Python/settings and custom GUILD_DESK_DB. Back up the stopped database before upgrading. Owner preview/live database remain untouched. Tests and verification metadata accompany the ZIP. No hosting deployment, GitHub tag or Release is claimed.
