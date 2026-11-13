# Guild Desk 0.12.0

Implements Stephen's approved Compact auction layout with larger column titles. Includes all features from0.11.0.

Guild auctions now aligns Item ID, Item, Copies, Min. bid, Time left and Actions. Uploaded/cached item icon references show before the item name; missing or failed icons retain a named item-details button and EQ placeholder. Copy counts and minimum DKP use larger numerals. Remaining time is compact, with the exact deadline available on hover and in auction details. Slot/class, own bid, wish-list and outcome metadata remain available; long names retain their full accessible name and item-detail popup. Narrow screens reflow into labeled rows.

Officers see a Controls pill beside View / bid. Choose Cancel a character bid, Cancel auction or Complete now (testing). Guild Desk rechecks the auction's current server state and opens only the chosen reason/confirmation form in a native dialog. Existing write permissions, sealed secrecy, same-origin CSRF, idempotent operations and officer-confirmed award deductions remain unchanged. Escape/Close returns focus. Stale replies cannot reopen a dismissed dialog or cross page/account boundaries. Background filters preserve typed officer input.

Included0.11 features: reviewed item-name wish-list paste/TXT/CSV/TSV imports with remove/restore/ambiguous-ID review; automatic auction filters with focus retention; green own-bid rows and exact private active-bid full-price totals across filters/pagination; and ordered weapon damage/delay/base and elemental ratios. No reservations or combined affordability cap. Single bid still cannot exceed current main DKP; accepted bids survive later balance changes and officer-confirmed charges may go negative.

No new migration after0015. Preserve data,companion/state, original Python tracker/settings and any custom GUILD_DESK_DB. Back up the stopped database before upgrading. Owner localhost preview and live databases were not restarted or modified.

Build/test results accompany the test ZIP. Independent bounded review covered45 tests with no high/medium finding. Browser verification used disposable data only. Original Windows Python/Tk interaction and hosted native companion login-gate compatibility are not newly verified. Existing Site remains unpublished; no hosting deployment or GitHubtag/Release is claimed.
