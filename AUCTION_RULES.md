# Auction proposal engine

`worker/auction-rules.mjs` is an independent pure proposal engine. The separate `worker/auctions.mjs` live adapter applies the Owner's confirmed policies and handles persisted auctions and officer-confirmed awards. The proposal engine itself performs no reservations, charges, ledger writes, balance filtering, or automatic awards. Results remain private until the sealed auction closes. Officer-confirmed charges may make a balance negative.

Call `proposeAuction({quantity,bids,money,maxAwardsPerBidder,noLowerBidPrice})`. Every bid supplies a stable `bidderId`, a decimal `bid`, the UTC `amountFirstSubmittedAt` when the current amount became active, and an explicitly approved Boolean `eligible` flag. Optional `acceptanceSequence` is the atomic database sequence used when acceptance timestamps share a millisecond. Balances are ignored. Invalid records are rejected even when marked ineligible; duplicate identities and duplicate acceptance sequences are rejected.

`money.precision` and `money.bidIncrement` are required. `money.minimumBid` defaults to the approved 1 DKP. Monetary values are exact decimal strings; safe integer numbers are accepted only with precision zero. Arithmetic uses scaled BigInt units and rejects more than six decimal places or scaled inputs above the safe-integer range. The increment constrains submitted bids relative to the minimum. The confirmed charge remains next-ranked bid plus exactly 1 DKP, capped at the winning bid; it is never silently rounded to a bid increment.

The Owner confirmed whole DKP, bid increments of 1, a default minimum of 1, and minimum pricing for every winner without a next-ranked bid, including auctions with unsold copies. The live adapter therefore passes `money:{precision:0,bidIncrement:'1',minimumBid:...}`, `maxAwardsPerBidder:1`, and `noLowerBidPrice:'minimum'`. The pure engine retains explicit configuration for reuse: an omitted multi-copy no-lower-bid policy still produces officer review rather than a hidden default. Zero eligible bids returns `no_bids` and leaves every copy unawarded.

`maxAwardsPerBidder` is mandatory. The currently supported approved shape is one bid and one potential award per distinct bidder. Explicit values greater than one return `officer_review`: requested quantities and per-copy pricing must be defined before support is added. They never silently award extra copies to a person.

Identical amounts rank by the earliest time the current amount was submitted, then atomic acceptance sequence. The Owner approved bid increases, decreases, and withdrawals until the exact deadline. An actual amount change resets priority; saving an unchanged amount preserves priority; a bid following withdrawal receives new priority. Canonical timestamps are UTC ISO strings with seconds and optional three-digit milliseconds. Missing acceptance evidence for an identical timestamp still produces officer review instead of using input order, random rolls, or an invented identity order.

Successful output has `status: proposed`, `proposedAwards`, `unawardedCopies`, `eligibleCount`, `excludedBidders`, and `issues`. Monetary outputs are decimal strings formatted to the configured precision. `officer_review` returns no allocations to avoid partial settlement before a material decision. This is a proposal, never an actual charge.

# Confirmed live policies

1. One approved main per website account; approved owned mains alone may bid.
2. Whole DKP and increment 1; default minimum 1. Each newly submitted or edited bid is capped at the main's current DKP balance. No points are reserved and bids across separate auctions are not summed.
3. Top quantity distinct people receive at most one copy each. Each pays next-ranked eligible bid plus 1 capped at their bid; a winner without a lower bid pays minimum. Four copies and bids100/80 yield charges81/1.
4. Bids may be raised, lowered, or withdrawn until exactly24 hours after publishing. Changes at the deadline are rejected using the database clock.
5. Current-amount first-submission priority resets only on an actual change or rebid following withdrawal. Atomic database order breaks same-millisecond ties.
6. Before closing, members and officers see only their own bids and bid events. After closing, guild members see all final bids, results and full auction bid history.
7. Officers confirm each award individually. Only confirmation deducts DKP; negative balances remain permitted.
8. Classes are search filters and reference metadata, not automatic bid restrictions. Source metadata is snapshotted on auction creation.

Version0.6 updates the earlier unlimited-per-bid policy. The live adapter checks current balance atomically when accepting a new/edited bid; the pure proposal engine settles already accepted bids and intentionally ignores later balance changes. A main with35 DKP may bid35 on several items independently. Confirmed awards may subsequently make the balance negative; existing bids are not retroactively reduced or disqualified. Withdrawal remains available at zero or negative balances.

# Remaining backlog decisions

Officers may cancel a named active bid or an open auction, and complete an open auction early for testing, with explicit confirmation and an audit reason. Normal winner pricing and separate officer charge confirmation apply. Disqualification, reopening, reversal, reassignment, alternative bidding modes, alt DKP and loot sales remain outside this live slice. Additional class or guild-standing restrictions must be explicitly approved before being introduced. No further Owner decision is required for the confirmed live policies above.

Run `node --test tests/auction-rules.test.mjs tests/auctions.test.mjs`. The pure engine is independently testable; integration details are in `AUCTIONS.md`.
