# Character ownership correction v0.4

Officers may detach a mistaken character assignment without deleting or moving historical guild records. This requires the ownership feature flag and the additive ownership migration; prior migrations remain unchanged.

## Claim history

GET /api/claims remains officer-only and returns current claims plus immutable assignments history. Current claims retain their existing fields and add approvedBy (actor ID or null), assignedBy (name or null), ownerId and boolean currentlyAssigned. The approval actor is taken from the matching audit evidence, never guessed.

Each assignments row contains id,claimId,characterId,characterName,userId,userName,userEmail,kind,outcome,resolvedAt,reason,assignedBy,actorId,actorName,ownerId,currentlyAssigned. Outcome is approved,detached,or rejected. Kind is main/alt for actual assignments and can be null for a rejected unclassified request. AssignedBy is the original approving officer; actorName is the officer performing this event. A detachment therefore retains its original assigner and separately identifies who detached it. Unknown legacy actors remain null.

Only a current approved event has currentlyAssigned:true. Old approval events become false after detach, even if the same member later reclaims the same character. Immutable insert-only event records retain the history when the current claim row is reopened. Database triggers reject update/delete of assignment history.

## Detach

POST /api/characters/:characterId/detach accepts JSON:

    {reason, expectedOwnerId, expectedAssignmentId}

Reason is3-1000 characters. ExpectedAssignmentId is the immutable approved history event ID displayed with the current assignment. An authenticated administrator/officer, exact same-origin Origin and session X-CSRF-Token are required. The database rechecks the specific assignment, current owner/type/timestamp, and auction lifecycle in one atomic batch.

Success returns {character,alreadyDetached:false}. It clears current ownership and main/alt classification, marks the current approved claim rejected with the reason, and writes one immutable detachment event and one audit entry. The character becomes available to claim again. A matching retry returns {character,alreadyDetached:true}; it never detaches a later assignment, including a later assignment to the same account. A stale different assignment returns409 assignment_conflict.

The original character ledger and all existing attendance statuses are unchanged. No DKP is deleted, moved, reserved, reversed or charged by detachment. Future main earnings require an approved main; prior credited attendance cannot earn again because attendance ledger keys remain unique. Pending records remain pending. The same or another member may submit a new claim after detach; an existing rejected claim is reopened while its historical events remain immutable.

## Auction lifecycle

An active bid in a database-open auction or any pending item award blocks detachment with409 assignment_in_use. Withdraw active bids and resolve pending awards first. This prevents changing recipient identity mid-award; it does not impose an affordability cap or reserve DKP. After withdrawal, a corrected owner may bid in the same open auction. Only inactive current-state bid rows are replaced; immutable bid events retain the old account and withdrawal, and the new bid gets fresh tie priority. Active account/character conflicts remain blocked. Closed historical bids and confirmed awards are retained.

## Migration and verification

worker/ownership.sql adds claims.approved_by and assignment_events. Current approved/rejected records are backfilled; actors are identified only from stored officer evidence. No user, attendance, ledger, auction or bid is seeded or erased.

The ownership tests cover assigning-officer history, immutable events, retained credits, same-member reclaim without duplicate credit, stale same-owner retries, officer/auth/Origin/CSRF validation, concurrent detachment, a later different owner, active bids/pending awards, and honest unknown legacy actors. The existing account/attendance suite is also retained.
