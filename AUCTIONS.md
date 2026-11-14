## Inline list bidding (0.15.0)

Guild auctions shows the accepted amount under Your Bid and a separate blank Place bid field. Enter a whole amount and press Bid or Update; Enter also submits. The same authenticated PUT endpoint and current approved-main limits apply. The saved amount changes only after acceptance. Item details, comparison, withdrawal and officer controls remain available. Other visible draft amounts survive list refreshes; drafts are not persisted across hidden pages or reloads.

## Officer controls and slot filtering (0.8)

Auction-management writers can cancel an OPEN auction or complete it early for testing from Guild auctions. Auction details also cancel a named character bid. Reason, explicit confirmation and retry-safe receipts are required. Cancellation creates no awards/charges and cannot reverse a closed auction. Early completion preserves the original deadline and runs normal settlement; only separate award confirmation charges DKP. Sealed participation/amount privacy is retained until settlement, including cancelled auctions. The bid cancellation picker lists all approved mains rather than revealing bidders. Slot filters use publication-time item slots and support multi-slot items. See PUBLIC_RELEASE.md.

# Guild Desk sealed auctions API

Backend export: `handleAuctionApi(request, env, {user, csrfToken})` from `worker/auctions.mjs`. A `createAuctionApi({clock})` factory is also exported solely for deterministic server-side tests. Parent middleware supplies the authenticated user and session CSRF token. Unmatched routes return `null`. Responses are JSON, `Cache-Control: no-store`. Errors are `{error,code}`. Every mutation requires same-origin Origin and X-CSRF-Token. Admin is the officer role.

| Method and route | Body | Response |
|---|---|---|
| GET /api/auctions | Optional query `q`, `class`, `slot`, `status=open|closed|cancelled|all`, `sort`, `direction`, `limit=1..100` (default100), `offset=0..1000000` | `{auctions:[Auction],total,limit,offset,activeBidSummary,slots}`. The UI requests25 per page; filtering and sorting apply before paging. No other bidder identities, amounts, counts, totals or participation are disclosed while open. |
| POST /api/auctions | Officer: `{itemId,quantity,minimumBid?:number,title?:string,idempotencyKey?:string}` | 201 `{auction:Auction}`; an identical keyed retry returns the original auction200. Requires cached item reference. Known item name is authoritative; unresolved name requires explicit title. Quantity1-50; whole-DKP minimum1 or greater. Omitted minimum snapshots persisted guild settings, defaulting to1 only when settings have not been saved. Publishes immediately for exactly24h. |
| GET /api/auctions/:id | None | `{auction:Auction,bids:null|[Bid],awards:[Award]}`. Lazily settles expired auction, without charging DKP. |
| PUT /api/auctions/:id/bid | `{amount:positive integer}` | `{auction:Auction,ownBid:OwnBid}`. Approved owned main required. Each submitted amount must be no greater than that main's current DKP balance. Other auction bids do not reserve or reduce this maximum. |
| DELETE /api/auctions/:id/bid | None | `{auction:Auction,withdrawn:boolean}`. Before deadline only. Repeated withdrawal is harmless. |
| POST /api/auctions/:id/close | None | `{auction:Auction,bids:[Bid],awards:[Award]}`. Requires auction-management write access and settles after the server deadline. The separate complete-early endpoint provides the explicit testing override. Idempotent. |
| POST /api/auctions/:id/awards/:characterId/confirm | None | Officer: `{award:Award,alreadyConfirmed:boolean,balance:number}`. Exactly one ledger charge per award; balance may become negative. |
| GET /api/auctions/:id/audit | None | `{entries:[BidEvent]}`. While open even officers see only their own events; after deadline/close all guild members see complete bid events. |

`Auction`: `{id,itemId,itemName,classes:null|[classCode],sourceUrl,metadataStatus,quantity,minimumBid,mode:"sealed",status:"open"|"closed",publishedAt,closesAt,closedAt:null|string,createdBy:{id,name},ownBid:null|OwnBid,resultsReady:boolean,awardCount:null|number,confirmedAwardCount:null|number,ownEligibility:{eligible:boolean,characterId:null|string,balance:null|number,maxBid:number,reason:null|string}}`. `eligible` describes approved ownership independently of balance; an owner with zero/negative DKP can still withdraw an existing bid. `maxBid` is the nonnegative current balance, or zero with unknown ownership. These fields are specific to the authenticated viewer and never disclose another bidder's balance. `publishedAt`, `closesAt`, and event dates are UTC ISO timestamps. Expired summaries report closed with `resultsReady:false` until detail/close performs settlement. No winning or losing status is published before deadline. Price increments are fixed at1 whole DKP.

`OwnBid`: `{amount,firstSubmittedAt,lastUpdatedAt}` active bid only. Raising or lowering changes firstSubmittedAt; saving the unchanged amount retains it. Withdrawal followed by bidding receives new priority. If accepted in the same millisecond, an atomic database sequence records acceptance order.

`Bid`: `{characterId,characterName,userName,amount,firstSubmittedAt,eligible:boolean}` final active bids after closing. `Award`: `{characterId,characterName,userName,winningBid,rank,price,status:"pending"|"confirmed",confirmedAt:null|string,confirmedBy:null|string,currentBalance:null|number}` returned in winning rank order. Others' current balances are shown only to officers; a member may see their own. Later balance changes do not retroactively disqualify an accepted bid or alter settlement prices.

`BidEvent`: `{sequence,characterId,characterName,userName,action:"place"|"unchanged"|"withdraw",amount:null|number,acceptedAt}`. `sequence` is display order within the authorized visible event list, not the internal global acceptance counter; counter gaps must not reveal other sealed bidding activity. No bid event or bid amount is written into the existing global audit before closing. Closing and award confirmation append global audit entries after closing.

Settlement ranks final eligible main bids by amount descending, then earliest time the current amount was submitted, then atomic database acceptance sequence. Top quantity distinct people win at most one copy each. Each pays the next-ranked eligible bid plus1 capped at their own bid. A final winner without a lower bid pays the configured minimum, even if copies remain unsold. Examples: four copies with100/80/60/50/30 bids charge81/61/51/31; four copies with100/80 bids charge81/1. Closing records proposals and final bid visibility, never a DKP charge. Officer confirmation is the only charging operation. Open-auction and named-bid cancellation are available through audited officer controls. Reassignment, reversal and alternative bidding modes are not in this slice.

Creation idempotency keys are optional strings of8-128 characters, scoped to the creating officer. The client should generate one key per intended publication and retain it after a network-uncertain response. Matching creator/key and normalized creation fields returns the original item/minimum/deadline snapshot without a second audit entry. This remains true if guild settings or cached item metadata change before retry. Changed creation fields with the same key return409 `idempotency_conflict`; use a new key for an intentional new auction. Concurrent matching retries create exactly one auction and one publication audit. Existing auctions never inherit later guild minimum changes.

Auction charges use the central `ledger_exact_total` database trigger. A `DKP_RANGE` rejection returns409 `balance_range` with a friendly explanation and rolls back award confirmation, ledger charge, and audit together. This rejects only values outside the exact technical numeric range; negative balances remain allowed.

## Production access profiles

Auctions.read/write permit auction viewing and own main bids/withdrawals. AuctionAdmin.read/write separately permit management reads and publishing/confirmation. Default Member has auction bidding access and no management rights. Open bid secrecy applies to every profile, including administrators. The auction manager can read its workspace without unrelated Characters permission. Read-time settlement still does not charge DKP.

## Per-bid maximum, version 0.6

The owner's updated rule caps each newly submitted or edited bid at the approved main's current exact ledger balance. An amount above that maximum returns409 `bid_exceeds_balance` with viewer-only `balance` and `maxBid` fields. The database checks the balance again atomically before accepting the bid event; a raced adjustment or award cannot admit an over-limit bid. A rejected save does not replace a prior bid, reset its priority, append a bid event or change DKP.

There are no reservations and no sum across auctions: a main with35 DKP can bid35 on several separate items. Existing accepted bids remain eligible if another transaction subsequently reduces the balance. They may still win and officer confirmation may create a negative balance. Zero and negative balances permit withdrawal but cannot place a positive bid. An unchanged save is a new submission check, so it is rejected if the already accepted amount now exceeds the current balance; the old bid remains unchanged.

## Personal outcomes and guild archive (0.9)

GET /api/my-auctions?outcome=won|lost&offset=0 returns only the signed-in account final active settled bids. Lost uses the lowest winning bid, not award price, with eligible=false/gap=null for ineligible bids and zero gap for ties. Won includes holdingLooters from retained imported custody; multiple holders are not assigned arbitrarily to recipients. GET /api/loot-history is read-only under Auctions/Auction management read permission, with q,class,slot,type,winner,boss,from,to,status and offset filters. Live/cancelled outcomes and custody are excluded from this guild archive.
# Live filters and your active bids (0.11.0)

Guild auctions updates after class/slot/status selection and after a short typing pause in Item name. The results refresh in place, preserving keyboard focus and unsaved officer publication fields. Failed updates keep the previous results with an error; stale requests cannot replace a newer filter or account session.

Green rows and a You have bid label identify your active open bids. A gold On your wish list badge remains when both apply. The top summary counts your active auction items and sums full bid amounts across all currently open auctions, even when filters or the 100-row display limit hide them. Withdrawn, cancelled, closed and expired auctions do not contribute. GET /api/auctions returns activeBidSummary {count,totalDkp}; totalDkp is an exact decimal string. These values are scoped to the signed-in account and never reveal other live bidders.

The total is potential full-price spending, not a reservation, combined bid cap or prediction of final charges. Individual bids still cannot exceed current main DKP; officers confirm final charges separately and balances may become negative.

## Compact auction list (0.12.0)

The Guild auctions list uses larger column headings and aligned item ID/name, copies, minimum bid, compact time remaining and action columns. Actual icons derive from the matching cached advanced-loot reference (same item ID, bounded numeric icon ID, approved EQResource PNG host only). No server item scraping or icon dataset is added. Missing/failed icons fall back to EQ without removing the item button. Uploaded item statistics remain the sole stats source. Slots/classes, own bid/wish badges and closed result status remain readable; narrow screens show labels and reflow actions.

An officer Controls pill sits beside View / bid for open auctions only. Its action menu opens a fresh server-checked single-action dialog; required reason, confirmation, character selection, guarded write, retry identity and separate award confirmation retain existing semantics. Close/Escape restores focus. Dialog results are session/page/version guarded, and automatic filter refresh does not clear officer input. Members/read-only profiles have no management pill. Every0.11 import/filter/summary/weapon feature remains included.

## Your Bid column (0.12.1)

The former Min. bid column is now Your Bid. It displays only the signed-in member's recorded bid amount. Rows without an active/final own bid are blank; cancelled auctions are blank. No zero, dash, DKP unit or mobile label appears in an empty cell. Green highlighting still applies to your open bids. Auction minimums and per-bid rules remain available in the bidding details and publication form. No backend, pricing, reservation or DKP policy changed.

## Sorting (0.12.2)

Click Item ID, Item, Copies, Your Bid or Time left to sort; click the same heading to reverse direction. First click uses A-Z for name, ascending for ID/deadline, and highest first for copies/Your Bid. Blank own bids stay last in either direction. Actions is not a sortable data column. Mobile has Sort by and Direction selectors. Selected headers expose aria-sort and retain keyboard focus after the response when focus has not moved elsewhere.

GET /api/auctions accepts sort=publishedAt|itemId|itemName|quantity|ownBid|closesAt and direction=asc|desc. Default remains newest published. Sort expressions/directions are strictly allowlisted; ownBid is bound to the authenticated user and excludes inactive/cancelled bids. Case-insensitive item-name ordering and deterministic publication/ID tie-breaks precede LIMIT100. Filters and global own active-bid totals are retained; stale responses cannot replace a newer request or account. Sorting performs no writes.

## Usability (0.13)

Publishing searches GET /api/items with name or ID and a20-result compact limit. Selecting a result calls POST /api/items/lookup to hydrate that uploaded reference; auctionAdmin write access suffices for this one cache action. General item administration remains separately protected. No auction is created until Publish is submitted. A pending publication locks selection until the request finishes.

List controls preserve unsaved publication fields. Wide tables have sortable headings; constrained content uses readable rows and explicit Sort by/Direction selectors. Previous/Next traverse every result, not just the first100. Personal spending totals stay independent of filters and paging. Page/detail hashes support refresh, sign-in return, Back/Forward and sharing. Detail Controls opens only the chosen officer action in a dialog.

## Slot options (0.14)

Distinct slot options are computed only for includeSlots=1, requested when the auction/filter page is first opened. Normal paging/sort/live-filter requests omit that query. Each auction still carries its own publication slots.
