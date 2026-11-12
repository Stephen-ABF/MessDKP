# Guild Desk sealed auctions API

Backend export: `handleAuctionApi(request, env, {user, csrfToken})` from `worker/auctions.mjs`. A `createAuctionApi({clock})` factory is also exported solely for deterministic server-side tests. Parent middleware supplies the authenticated user and session CSRF token. Unmatched routes return `null`. Responses are JSON, `Cache-Control: no-store`. Errors are `{error,code}`. Every mutation requires same-origin Origin and X-CSRF-Token. Admin is the officer role.

| Method and route | Body | Response |
|---|---|---|
| GET /api/auctions | Optional query `q`, `class`, `status=open|closed|all` | `{auctions:[Auction]}` newest100. No other bidder identities, amounts, counts, totals or participation are disclosed while open. |
| POST /api/auctions | Officer: `{itemId,quantity,minimumBid?:number,title?:string,idempotencyKey?:string}` | 201 `{auction:Auction}`; an identical keyed retry returns the original auction200. Requires cached item reference. Known item name is authoritative; unresolved name requires explicit title. Quantity1-50; whole-DKP minimum1 or greater. Omitted minimum snapshots persisted guild settings, defaulting to1 only when settings have not been saved. Publishes immediately for exactly24h. |
| GET /api/auctions/:id | None | `{auction:Auction,bids:null|[Bid],awards:[Award]}`. Lazily settles expired auction, without charging DKP. |
| PUT /api/auctions/:id/bid | `{amount:positive integer}` | `{auction:Auction,ownBid:OwnBid}`. Approved owned main required. No reservations or balance limit. |
| DELETE /api/auctions/:id/bid | None | `{auction:Auction,withdrawn:boolean}`. Before deadline only. Repeated withdrawal is harmless. |
| POST /api/auctions/:id/close | None | `{auction:Auction,bids:[Bid],awards:[Award]}`. May be requested by a signed-in member only after the server deadline; never closes early. Idempotent. |
| POST /api/auctions/:id/awards/:characterId/confirm | None | Officer: `{award:Award,alreadyConfirmed:boolean,balance:number}`. Exactly one ledger charge per award; balance may become negative. |
| GET /api/auctions/:id/audit | None | `{entries:[BidEvent]}`. While open even officers see only their own events; after deadline/close all guild members see complete bid events. |

`Auction`: `{id,itemId,itemName,classes:null|[classCode],sourceUrl,metadataStatus,quantity,minimumBid,mode:"sealed",status:"open"|"closed",publishedAt,closesAt,closedAt:null|string,createdBy:{id,name},ownBid:null|OwnBid,resultsReady:boolean,awardCount:null|number,confirmedAwardCount:null|number,ownEligibility:{eligible:boolean,characterId:null|string,reason:null|string}}`. `publishedAt`, `closesAt`, and event dates are UTC ISO timestamps. Expired summaries report closed with `resultsReady:false` until detail/close performs settlement. No winning or losing status is published before deadline. Price increments are fixed at1 whole DKP.

`OwnBid`: `{amount,firstSubmittedAt,lastUpdatedAt}` active bid only. Raising or lowering changes firstSubmittedAt; saving the unchanged amount retains it. Withdrawal followed by bidding receives new priority. If accepted in the same millisecond, an atomic database sequence records acceptance order.

`Bid`: `{characterId,characterName,userName,amount,firstSubmittedAt,eligible:boolean}` final active bids after closing. `Award`: `{characterId,characterName,userName,winningBid,rank,price,status:"pending"|"confirmed",confirmedAt:null|string,confirmedBy:null|string,currentBalance:null|number}` returned in winning rank order. Others' current balances are shown only to officers; a member may see their own. No balance affects eligibility or price.

`BidEvent`: `{sequence,characterId,characterName,userName,action:"place"|"unchanged"|"withdraw",amount:null|number,acceptedAt}`. `sequence` is display order within the authorized visible event list, not the internal global acceptance counter; counter gaps must not reveal other sealed bidding activity. No bid event or bid amount is written into the existing global audit before closing. Closing and award confirmation append global audit entries after closing.

Settlement ranks final eligible main bids by amount descending, then earliest time the current amount was submitted, then atomic database acceptance sequence. Top quantity distinct people win at most one copy each. Each pays the next-ranked eligible bid plus1 capped at their own bid. A final winner without a lower bid pays the configured minimum, even if copies remain unsold. Examples: four copies with100/80/60/50/30 bids charge81/61/51/31; four copies with100/80 bids charge81/1. Closing records proposals and final bid visibility, never a DKP charge. Officer confirmation is the only charging operation. Cancellation, reassignment, reversal and alternative bidding modes are not in this slice.

Creation idempotency keys are optional strings of8-128 characters, scoped to the creating officer. The client should generate one key per intended publication and retain it after a network-uncertain response. Matching creator/key and normalized creation fields returns the original item/minimum/deadline snapshot without a second audit entry. This remains true if guild settings or cached item metadata change before retry. Changed creation fields with the same key return409 `idempotency_conflict`; use a new key for an intentional new auction. Concurrent matching retries create exactly one auction and one publication audit. Existing auctions never inherit later guild minimum changes.

Auction charges use the central `ledger_exact_total` database trigger. A `DKP_RANGE` rejection returns409 `balance_range` with a friendly explanation and rolls back award confirmation, ledger charge, and audit together. This rejects only values outside the exact technical numeric range; negative balances remain allowed.

## Production access profiles

Auctions.read/write permit auction viewing and own main bids/withdrawals. AuctionAdmin.read/write separately permit management reads and publishing/confirmation. Default Member has auction bidding access and no management rights. Open bid secrecy applies to every profile, including administrators. The auction manager can read its workspace without unrelated Characters permission. Read-time settlement still does not charge DKP.
