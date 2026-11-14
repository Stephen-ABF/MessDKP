# Guild Desk 0.15.0

- Bid directly from Guild auctions with a separate new-amount field and Bid/Update button. Your Bid continues to show your accepted amount.
- Saved bids stay sortable; item details/comparison and officer Controls remain separate. Open rows show the item ID beside the name to leave more room for readable names and bidding.
- Saving preserves amounts entered in other visible rows and keeps the list on screen. Pending saves cannot be submitted twice, and leaving/returning to auctions releases pending controls correctly.
- Desktop columns adapt to readable rows on smaller screens. Per-item current-DKP limits remain enforced by the existing server; no combined reservations or pricing changes.

No schema change. This test build does not deploy hosting or restart your running preview.

# Guild Desk 0.14.0

- Compact EQ-style hover and side-by-side comparison windows: three stat columns, combined heroic values, effects and augment slots. Source/reference and difference tables expand when needed.
- My account password changes require the current password and sign out other sessions.
- New accounts wait for officer approval. Existing accounts remain active. Officers manage accounts and issue30-minute, single-use reset links; only administrators can reset other privileged accounts. No email is sent.
- Per-user password hashing cost,600000 iterations for new passwords, automatic legacy upgrade at sign-in, trusted-IP registration/login limits and expired-limit cleanup.
- Writes atomically revalidate session/credentials and permissions, including access changes. Read-only queries use SELECT authorization checks without writing guard rows.
- Shared HTTP request/error/CSRF helpers, opt-in auction slot options, strict dev-server Host checks, corrected audit singulars and API docs, package-derived build version. Prettier formatting-only web/app.js commit is separate.

All previous DKP, attendance, item import, wish-list and sealed-auction behavior is retained. No DKP reservations or pricing/fairness changes. Additive migration0016 updates existing data safely. Preserve data, companion/state, original Python/settings and custom GUILD_DESK_DB; make a stopped-database backup before upgrading. Test in a separate folder/database first. This package does not deploy hosting or create a GitHub tag/Release.
