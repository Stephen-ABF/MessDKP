# Guild Desk 0.8.0

Officers can now test the full auction lifecycle immediately, cancel open auctions and cancel a named character's bid. Guild auctions also filter by equipment slot. The Python tracker adapter provides Copy JSON and Save JSON, and Boss loot preparation opens directly on Raid-night import. The built-in live log companion page is hidden from navigation and direct page access; its stored records and backend are retained.

## Auction controls

Open Auctions. Expand Officer auction controls under an open auction to Cancel auction or Complete now (testing). Open the auction details for Cancel a character bid. Each action requires auction-management write access, an officer reason and explicit confirmation. Default officer and administrator profiles have this permission; read-only users and ordinary members do not.

Cancellation applies only while bidding is open, before its deadline. It withdraws active bids, retains their original evidence and creates no awards or DKP charges. Settled/charged auctions cannot be silently reversed through this control. A named bid cancellation does not ban a later bid; retrying the same cancellation cannot remove a later rebid. The character picker contains all approved mains, not a list of participants. Other sealed bids and amounts stay private. Cancelled auctions have a separate status/filter, retain their cancellation reason, and do not expose other bidders' events or count as loot won.

Complete now (testing) ends bidding at the server clock and calculates the same results as normal closing. The original scheduled deadline is retained and displayed. Closing alone does not charge DKP: an officer must still confirm each item award. Normal auctions are initially published for24hours. Per-bid balance caps, no reservations or combined affordability limits, and possible negative balances after officer-confirmed charges remain unchanged.

Equipment-slot filters use the item slots captured at publication, including every applicable slot for multi-slot items. Slot options come from the recorded item data. Older auctions use the known cached item slots at migration time; unknown slots stay unknown.

## Python copy/paste or file import

Run companion/Start-Python-Tracker-Guild-Desk.cmd and select the owner's existing original tracker .py file. The original script/config are not included in public source. The adapter adds a Guild Desk menu and a visible top export bar:

- Copy JSON puts selected structured loot into the clipboard after confirming the raid date.
- Save JSON saves the same structured loot to a file.

Both paths preserve stable event identities in companion/state, keep duplicate real loot events distinct, and leave the original OpenDKP/Excel exports, selections and tracker statuses unchanged. A failed clipboard operation retains identity metadata for a safe retry. Copying or saving does not mean the website received the data or that loot was delivered.

On the website, open Boss loot preparation > Raid-night import. Paste copied JSON into Paste JSON from Python, or choose a saved file with Upload JSON or loot file. Use one input at a time, confirm the raid/date, preview, save the reviewed import and prepare each boss draft. Publishing auctions remains separate. The settings JSON alone has no loot events. The holding looter is a custodian, not automatically the winner. API push, notifications, delivery confirmation and Excel writeback remain future work.

The native live log companion is hidden while the guild uses its Python tracker. This does not delete existing capture evidence, queues or pairing data. Do not delete companion/state. The previously reported native Windows file-picker issue is deferred with that hidden workflow; no fix for it is claimed in this release.

## Upgrade and validation

Requires Node.js24 or later; the Python adapter requires Python3.8+ with Tkinter. Stop the application before backing up or copying its database. Extract into a new folder, preserve data, companion/state, original tracker/config and any GUILD_DESK_DB path, then launch Start-Guild-Desk.cmd. Additive migration0013 adds auction-control receipts/cancellation metadata and slot snapshots without changing existing bids, deadlines or ledger charges. Earlier applied migrations remain unchanged.

Private and sanitized-public test counts and exact source identity are in the artifact metadata. Independent bounded reviews cover sealed privacy, cancellation/rebid retries, late bids, actual current-ACL revocation, normal award confirmation, slot identity, Python clipboard failure/corruption and UI submission safety. Disposable browser checks exercised slot filtering, early completion, award confirmation, auction/bid cancellation and pasted JSON preview/import. The actual original Python Windows GUI and OS clipboard are not claimed as automated desktop validation; headless UI and cross-language parser checks passed.

Item stats remain uploaded-file only. Explicitly approved EQResource icon PNGs are retained from0.7.1; source item pages are manual links, with no stat scraping. Private guild records, original tracker/config, logs, databases, state, credentials, hosting identity, datasets and private Git history remain excluded from public source and artifacts. No owner preview or live database was altered. A public source push is distinct from a GitHub tag/Release or hosting deployment. Existing hosting remains unpublished and host access/capacity limitations are unchanged.
