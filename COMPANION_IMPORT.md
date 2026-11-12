# Import a raid night from the Python loot tracker

The Python tracker can continue recording who picked up each corpse item. Guild Desk imports those **holding-looter custody records** for officer review, then prepares one ordinary boss draft per source group. Importing does not award gear, create a character, grant DKP, deduct DKP, or publish an auction. The holding looter can differ from the eventual auction winner.

The built-in live log companion is hidden in the current website. This Python workflow uses manual clipboard/file import and needs no device pairing.

## Normal workflow

Windows Python setup: install the Python Install Manager from https://www.python.org/downloads/, open a new PowerShell window and run `py install default`. Then run `py -m tkinter`; a small demo window confirms Tcl/Tk works. Close it before launching the tracker. Python 3.8 is the minimum supported version, not a requirement to install that old release. Tkinter is provided by the normal official Windows runtime rather than a separate pip package. See https://docs.python.org/3/using/windows.html and https://docs.python.org/3/library/tkinter.html.

1. With Python 3.8 or later and Tk installed, launch `companion/Start-Python-Tracker-Guild-Desk.cmd`. On first run choose your existing original tracker `.py` file, rather than its settings or the export helper. Its location is remembered privately for later launches. Keep the original script and settings on your computer; they are not included in Guild Desk's public source. To select a different original script, run `.\Start-Python-Tracker-Guild-Desk.cmd --choose` from a terminal in the `companion` folder.
2. Monitor the raid and check the rows to export. Use **Copy JSON** or **Save JSON** in the top Guild Desk export bar, confirm the raid date, and copy or save the structured selection. The existing OpenDKP and Excel exports keep their original behavior.
3. In Guild Desk, open **Officer workspace > Boss loot preparation > Raid-night import**, paste the copied JSON or choose the exported JSON file and confirm the same raid date. Select an existing raid if the resulting drafts should be linked to it. Review the date/time range, source groups, item quantities and holding looters.
4. Preview first. Optional holding-looter and ignored-item lists mark rows excluded for review. A tracker settings file can supply those lists and `my_character`; the website does not upload the configured local log path or monitoring setting.
5. Import the reviewed preview. Open the retained import to include or exclude a custody event with a reason. The original item, quantity, holder, source and selected raw evidence remain immutable.
6. Choose **Prepare boss draft** for each included source group. An unknown source requires an officer-supplied boss name. The resulting draft uses the existing item matching and officer publishing workflow. Auction publishing remains a separate action.

Keep the exported file until the website confirms the import. Saving an export is not confirmation that the website received it. The original tracker's `Exported` label describes its clipboard-export operation; it does not mean delivered to an auction winner.

## Supported inputs and time accuracy

| Input | Retained information | Required review |
| --- | --- | --- |
| Guild Desk structured JSON | Stable event ID, item, quantity, holding looter, corpse/source, available local time and its provenance | The original live tracker records the processing clock, rather than retaining the original log timestamp. Verify the raid date, especially around midnight. |
| Tracker Excel TSV | `Item`, `Qty`, `Looter`, and each selected TSV record | Supply the boss/source and raid date. TSV contains no corpse/source, original time or stable cross-file event identity. |
| EverQuest corpse-loot log | Selected raw loot lines, game-log local timestamp, holding looter, quantity and corpse/source | Select the correct local date/time window. Set **My character** to resolve `You have looted` lines. Unrelated chat is not retained. |

Times have no confirmed timezone and are not labeled UTC. Full dated history rows retain a local timestamp. Short `HH:mm:ss` rows retain their time text with `observedAt` left null, even after the officer confirms a raid date. The structured export identifies live table clocks as `tracker-clock`, loaded history as `log-history`, and wrapper-added manual rows as `manual`. Missing evidence remains missing. The original tracker does not retain a raw log line for each table row, so the adapter does not invent one.

An end time earlier than the start time selects a range crossing into the following day. Events with no timestamp cannot be placed within that time range automatically; the preview warns about them. Check the source date rather than assuming it matches the file's save date.

For legacy TSV, the tracker expands a quantity into repeated rows with `Qty` equal to one. Guild Desk retains those separate rows and sums quantities only when preparing a draft. OpenDKP pipe-separated name exports do not retain enough custody information for this import; use the new structured export or the tracker Excel TSV instead.

## Retries, overlap and corrections

An exact source/settings retry returns the existing import. Structured exports retain stable event IDs across repeated selections; overlapping exports link to the same retained event instead of making a second custody event. Reusing an ID with different evidence rejects the entire import. Different events with identical names, holders and timestamps remain separate when they have distinct stable IDs.

The helper keeps private event identity metadata under `companion/state`, assigns identities across the complete valid table before filtering the selected rows, and retains row-attached IDs across overlapping exports. Keep this metadata for repeat history exports. The explicitly confirmed raid date and tracker/log identity are significant; changing the date creates a new identity context. Cleared or reordered indistinguishable history rows, and a live row later reloaded as history, cannot always be proven to be the same real event. Review those selections rather than treating stable IDs as proof of identity the original tracker never retained.

Raw logs retain repeated identical same-second lines by occurrence order within the supplied source. A cropped overlapping log cannot prove which of several identical occurrences it contains. Prefer a complete raid selection or structured stable IDs. TSV also cannot prove cross-file identity: a possible overlap requires explicit officer confirmation that the rows are distinct. Legacy identity includes the officer-selected raid date and boss so that identical exports on separate nights remain distinct. Changing that context does not correct an earlier retained import; review and exclude incorrect custody records before proceeding. Changing a filename does not establish that the underlying loot is new.

Exclusion decisions use revisions, so an outdated review cannot overwrite a newer decision. Existing decisions survive overlapping reimports. Once an event enters a prepared handoff it cannot be changed through the import screen. Make later draft corrections through the existing draft review controls.

Preparing a group is retry-safe. A failed attempt with no retained draft releases the group for review. Another currently authorized officer can resume an interrupted handoff; the earlier operation is fenced before it can create a second draft. A draft that was retained before an interrupted response is recovered by its stable handoff key. Groups exceeding the draft limits are rejected before reservation: at most 200 item names, 1,000 pieces, and 50 copies of one item per boss draft.

## Limits and privacy

Each source is at most 3 MiB, with at most 5,000 selected events, 200 source groups and one million total units. The JSON request is at most 4 MiB. Extremely detailed selections may need splitting further to stay within the hosted database's atomic batch limits. For a long raid log, export or select one bounded raid-night range rather than uploading the complete account history.

Only users with the corresponding loot read/write access can view or change imports. Changes require the current website session and CSRF protection. Import history retains a source hash, selected-event provenance, custody review reasons and officer audit entries; it does not retain unrelated chat or the original local log path.

The companion state folder, original Python application, actual settings, log files and exported raid records remain private and are excluded from public release packaging. Use synthetic samples when reporting a problem.

## Current scope and later integration

This release provides a manual file export/import handoff. It does not send automatic winner notifications, write auction results back into Excel, or push events from the original Python tracker through an outgoing API. Those steps need a separate reviewed delivery protocol, scoped credentials and durable retry acknowledgements. The original tracker's partial-line handling and live timestamp collection are also separate from this additive export adapter.

The adapter was checked with headless tests and synthetic tracker objects, including its JSON passing the website parser. Launching the original tracker window and the actual Windows file picker still require a user setup check; automated tests did not open either on the owner's computer.
