# Current workflow: Python tracker

Run Start-Python-Tracker-Guild-Desk.cmd and select your original tracker .py. Its Guild Desk menu/top bar provides Copy JSON and Save JSON. In the website use Boss loot preparation > Raid-night import to paste or upload, preview and prepare boss drafts. No device pairing is needed. See ../COMPANION_IMPORT.md.

The native live log companion below is retained for future work but hidden in the website. Its original Windows picker issue is deferred; no fix is claimed here. Existing states/queues are retained.

## Retained native companion documentation

# Guild Desk loot companion

The normal launcher opens a small graphical companion at http://127.0.0.1:4831. It reads only the EverQuest log you choose and forwards matching loot-channel messages. It does not inject game code or change game files, auctions or DKP.

## First setup

1. Run Start-Companion.cmd with Node.js 24 or later installed.
2. Click Choose log file and select your EverQuest eqlog text file. The native Windows picker is used; Advanced also accepts a path.
3. In Guild Desk, open Live loot capture, create a named companion connection, and click its connection link.
4. The local window displays the proposed Guild Desk site. Check the address, then click Connect and monitor. It never connects merely because a link was opened.

The selected log and scoped connection are saved in companion/state. There is no JSON to copy in the normal workflow. If you connected before choosing the log, choose it and click Start monitoring.

## Each boss

Create a capture in Guild Desk and select your saved companion. Wait until Watching appears before posting loot on abfloot. New captures start at the log's end so old chat is not reimported. The website receives a readiness acknowledgement only after the watcher initializes; being paired alone is not readiness. The companion remembers the log and connects to the next assigned boss without another pairing or file selection.

Review received loot in Guild Desk, finish the capture, and prepare its boss draft. Capturing never publishes an auction or charges points.

Keep EverQuest /log enabled. Pause stops monitoring; Exit companion stops the local background process. Closing only the browser tab leaves the companion running. Opening the launcher again reopens the existing companion rather than creating another writer. No Windows startup entry, scheduled task, or recurring automation is installed.

## Connection and privacy

The one-time connection link expires after ten minutes. The device credential is scoped to the current assigned capture and expires after thirty days or revocation. Keep companion/state private: it contains the chosen path, device credential and durable selected-message queues. Server storage retains credential hashes rather than raw tokens. Web passwords and session cookies are never copied to the companion.

Remote requests use HTTPS, except HTTP localhost/127.0.0.1 for local testing. Redirects are rejected, so a hosted login redirect does not silently become a successful connection. Hosted outer-login compatibility remains unverified. Connection origin replacement requires an explicit confirmation.

The local web interface binds only to 127.0.0.1. Mutations require its exact Origin and per-process CSRF token; Host validation prevents DNS rebinding and cross-site API requests are rejected. Website links may navigate to the local page, but the fragment is cleared and staged for a deliberate Connect action. No token is sent automatically from a navigation.

## Retained queues and recovery

Every queue remains bound to its original capture. Stable watcher/event IDs and server acknowledgement checks make uncertain retries safe. Exact channel matching is independent of numeric channel slot; unrelated chat is not uploaded.

If a previous boss has queued messages when another boss becomes active, monitoring stops for review. Reactivate the old capture while it is still open to retry its queue. If the old capture was already finished, save its queued text for manual officer review, confirm the review responsibility, and choose Hold this queue and continue. This retains the original queue file and records it in Held for review; it does not copy those events into the next boss or delete them. Held queues can be exported individually after restart, even across later connections. Exported text must be reviewed before manual import.

A corrupt state or ambiguous capture lock fails closed. Do not delete queue JSON files to get past an error. If a saved GUI lock remains after a crash, verify every companion process is stopped before removing only gui.lock. Capture locks use the existing strict recovery procedure; never remove a lock owned by another running process.

## Advanced manual capture mode

Advanced-Manual-Companion.cmd (or node companion/legacy-start.mjs) retains the older per-capture hidden JSON pairing console for troubleshooting. The normal graphical workflow uses node companion/start.mjs. Do not place tokens or passwords in command-line arguments.

## Verification

Tests use disposable directories, injected file pickers and local test ports. They cover local Origin/Host/CSRF controls, explicit connection consent, saved settings, claim durability through failed writes, readiness retries, slow-poll coalescing, real-file offline queues, isolated boss handoff, held exports and restart recovery. No test opens the owner's real file picker or running preview. The graphical setup and remembered selection were also checked in a desktop browser using a disposable log and injected picker. The native Windows file-picker interaction still requires first-run user testing.
