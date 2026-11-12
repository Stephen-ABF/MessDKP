# Guild Desk EverQuest companion

This small Node.js24+ console application reads one selected native EverQuest client log and forwards only item-bearing messages from the capture's dedicated loot channel. It does not install an extension, alter game files, inject code, or read other log files. Keep the console open while capturing; a browser tab cannot watch your local game log by itself.

## Start a capture

1. In Guild Desk's officer menu, open Live loot capture, enter the boss, create a capture, and copy its pairing JSON. The token grants access only to that capture, not to member accounts or bidding.
2. On Windows, double-click `companion/Start-Companion.cmd`. Alternatively run `node companion/start.mjs` from the project root. Node.js24 or later must already be available.
3. Paste the JSON configuration and press Enter. Compact single-line JSON and formatted multiline JSON are supported. Input is hidden so the token does not enter terminal scrollback. Never put tokens or account passwords on the command line.
4. Enter the exact EverQuest character log file path, for example the chosen character's file inside the game's Logs directory. Quoted paths copied from Explorer are accepted. The companion does not search the directory or choose a different file.
5. In EverQuest, enable native logging with `/log on`. Join the dedicated `abfloot` channel and send the item-name messages there using the guild's capture procedure. Channel numbers such as `abfloot:4` may differ; channel name and the capture's optional sender allowlist control selection. A message containing several item names separated by `|` is sent intact, including repeated item names.
6. Keep the console open. A new capture starts at the current end of the selected log, excluding existing history. If it starts halfway through a line, that old line's continuation is skipped through its newline. Complete subsequent messages are captured. The companion forwards the original full line without its CRLF/LF terminator, together with only the basename and byte offset; no full filesystem path or unrelated chat is uploaded.
7. Refresh the capture, review messages/copies, and finish it to prepare a boss draft. Match item IDs and publish only after manager review. This companion does not create item statistics, resolve ambiguous names, award loot, deduct DKP, or bid.

## Restart and recovery

If the one-time pairing was lost or expired, open that SAME capture in Guild Desk and choose Reconnect companion. Copy the new pairing and restart with the original companion/state directory. Only the latest pairing works. The capture identity, saved queue and event retry keys are retained; do not create a new boss capture merely to recover an old queue.

The capture stores a stable watcher identity, generation, byte cursor, bounded file identity/anchors, and pending selected messages under `companion/state/<captureId>.json`. This directory is ignored by Git. It contains no pairing token, password, full log path, or unrelated chat. Selected loot-channel lines remain plaintext while pending; protect this directory as you protect guild records.

Paste pairing JSON for the same capture and choose the same log to resume. Do not delete its state file to fix a connection problem: a replacement watcher is a different source identity, and the server deliberately prevents two concurrent watchers from binding to one capture. Only one console should watch a capture.

An exclusive `<captureId>.json.lock` is acquired before any checkpoint is read or initialized and held until the watcher closes. A second console fails closed without touching the first console's state or lock. A crash or forced window close can leave a stale lock. There is deliberately no automatic stale takeover: first close every companion process for that capture, preserve the JSON state file, and remove only the corresponding `.json.lock` before restarting. Never delete a lock while a companion might still be running. The lock contains only process/instance metadata, never a pairing token.

Each selected line is durably queued in an atomic state replacement before its cursor advances. Failed or uncertain requests retry the same SHA-256 event IDs. A complete acknowledgement removes only the acknowledged batch. The companion sends at most50 events and256 KiB of encoded JSON per request. Network failures use bounded retry delays and retain the queue. The default queue holds up to1000 messages or8 MiB; at its limit reading pauses at the next selected line without skipping it, and resumes after acknowledged uploads free capacity. Keep the source log until recovery.

HTTP403,409,410 and other nontransient client errors pause capture rather than discarding selected messages. A closed, expired, changed, full or source-conflicting capture must be reviewed in Guild Desk. Pending records stay on disk; restart with the same capture only if an officer restores it. Do not repurpose an old pending queue for a different boss. A malformed matching line, oversized line, unsupported encoding or unwritable/corrupt checkpoint also pauses without advancing past the affected source data. Restore the state/source or ask for help; there is no automatic skip or historical replay switch.

Reads are bounded to256 KiB per poll and incomplete lines are buffered until a newline. Reads poll once a second when network operations permit. A rotated file's existing open handle is drained before the replacement is read from byte0. Truncation and replacement, including same-sized overwrites detected by file identity or checkpoint anchors, start a new generation while retaining queued messages. An unfinished fragment at the end of a rotated file is not invented into a complete event; the console reports it for manual inspection. If the process was stopped during rotation, unread bytes in an old renamed file cannot be recovered automatically without selecting that source explicitly; other paths are never searched.

UTF-8 is decoded strictly first, with a Windows1252 fallback for legacy single-byte logs. This covers ordinary Latin-1-range text and Windows punctuation. UTF-16 logs are rejected. Keep the original game log and inspect unusual encoding in the web draft. The shared server/client loot parser determines whether a dedicated-channel line contains item names; empty or unrelated messages are not queued.

## Connection security

Pairing accepts only an HTTPS site root, or HTTP `localhost`/`127.0.0.1` for local tests, without URL credentials, paths, queries or fragments. The token is held only in process memory and sent in the Authorization header. Requests reject redirects, so credentials are not forwarded to a new URL, and time out after15 seconds. Stopping the process releases its in-memory token. Pairing tokens should be revoked or replaced through Guild Desk when needed.

If pairing credentials were accidentally pasted into the dedicated game channel, the companion pauses before queuing or uploading that matching line. Review the original locally and revoke the exposed token. It does not rewrite or delete the game log.

This is a native log reader using supported file access. It does not bypass game protections, automate gameplay, or inspect game process memory. No installer or browser extension is included or needed beyond Node.js24+.

Run companion verification from the project root with `node --test tests/companion.test.mjs`.
