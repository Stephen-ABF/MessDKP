"""Add a manual Guild Desk export to a user-selected local Python loot tracker.

Python 3.8+, standard library only. Importing this module opens no GUI, imports
no original tracker, and makes no network requests. Private state is separate
from the original tracker's settings. Exporting never marks loot delivered.
"""

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime

MAX_EVENTS = 5000
MAX_EXPORT_BYTES = 3 * 1024 * 1024
MAX_STATE_BYTES = 20 * 1024 * 1024
ID_RE = re.compile(r"^[-A-Za-z0-9_.:]{8,128}$")
ROW_ID_KEY = "_guild_desk_export_identity"


def _text(value, label, maximum, required=True):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError("{} must be text up to {} characters.".format(label, maximum))
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("{} contains an unsupported control character.".format(label))
    if required and not value.strip():
        raise ValueError("{} is required.".format(label))
    return value


def validate_raid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Use YYYY-MM-DD for the raid date.")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError("The raid date must be a real calendar date.")
    return value


def _time(row):
    text = _text(row.get("timestamp", ""), "Tracker time", 100)
    kind = row.get("_guild_desk_time_kind")
    if kind not in (None, "manual", "log-history", "tracker-clock"):
        raise ValueError("Unsupported tracker time kind.")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}", text):
        normalized = text.replace(" ", "T")
        datetime.strptime(normalized, "%Y-%m-%dT%H:%M:%S")
        return text, normalized, kind or "log-history"
    if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", text):
        raise ValueError("Tracker time must be HH:mm:ss or a full local date and time.")
    datetime.strptime(text, "%H:%M:%S")
    # A raid date is context only. It does not turn a processing clock into a
    # recovered game timestamp, timezone, or source log line.
    return text, None, kind or "tracker-clock"


def _facts(row):
    if not isinstance(row, dict):
        raise ValueError("Each tracker row must be an object.")
    quantity = row.get("qty")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 100000:
        raise ValueError("Loot quantity must be a whole number from 1 to 100000.")
    time_text, observed_at, kind = _time(row)
    raw_line = row.get("rawLine")
    if raw_line is not None:
        _text(raw_line, "Raw source line", 10000, required=False)
    facts = {
        "itemName": _text(row.get("item", ""), "Item name", 250),
        "quantity": quantity,
        "holder": _text(row.get("looter", ""), "Loot holder", 64),
        "source": _text(row.get("source") or "Unknown", "Loot source", 250),
        "observedAt": observed_at,
        "timeText": time_text,
        "timeKind": kind,
        "rawLine": raw_line,
    }
    return facts


def _new_state():
    return {"version": 1, "namespace": uuid.uuid4().hex, "groups": {}}


def _validate_state(state):
    if not isinstance(state, dict) or state.get("version") != 1:
        raise ValueError("The private export identity file has an unsupported format.")
    if not isinstance(state.get("namespace"), str) or not re.fullmatch(r"[a-f0-9]{32}", state["namespace"]):
        raise ValueError("The private export identity namespace is invalid.")
    if not isinstance(state.get("groups"), dict):
        raise ValueError("The private export identity groups are invalid.")
    seen = set()
    for scope, groups in state["groups"].items():
        if not re.fullmatch(r"[a-f0-9]{64}", scope) or not isinstance(groups, dict):
            raise ValueError("The private export identity scope is invalid.")
        for fingerprint, identifiers in groups.items():
            if not re.fullmatch(r"[a-f0-9]{64}", fingerprint) or not isinstance(identifiers, list):
                raise ValueError("The private export identity record is invalid.")
            for identifier in identifiers:
                if not isinstance(identifier, str) or not ID_RE.fullmatch(identifier) or identifier in seen:
                    raise ValueError("The private export identities contain an invalid or repeated ID.")
                seen.add(identifier)


def _digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def build_export(rows, raid_date, identity_state=None, scope="default", selected_rows=None):
    """Return (payload, next_private_state, row_bindings), with no file or GUI I/O.

    Identity assignment considers all valid rows before selecting the export.
    Selected rows must be the same row objects held by the tracker. The caller
    applies returned bindings only after safely saving the private state.
    """
    validate_raid_date(raid_date)
    if not isinstance(rows, list):
        raise ValueError("Tracker rows must be a list.")
    selected_rows = [row for row in rows if row.get("selected")] if selected_rows is None else selected_rows
    if not isinstance(selected_rows, list) or not selected_rows or len(selected_rows) > MAX_EVENTS:
        raise ValueError("Select from 1 to 5000 loot rows.")
    selected = {id(row) for row in selected_rows}
    if len(selected) != len(selected_rows) or not selected.issubset({id(row) for row in rows}):
        raise ValueError("Selected loot must refer to distinct current tracker rows.")
    state = copy.deepcopy(identity_state) if identity_state is not None else _new_state()
    _validate_state(state)
    scope_key = _digest([state["namespace"], scope])
    groups = state["groups"].setdefault(scope_key, {})
    used = set()
    bindings = []
    events = []
    for row in rows:
        try:
            facts = _facts(row)
        except (ValueError, TypeError):
            if id(row) in selected:
                raise
            continue
        fingerprint = _digest([raid_date, facts])
        identifiers = groups.setdefault(fingerprint, [])
        attached = row.get(ROW_ID_KEY, {})
        identifier = attached.get("id") if attached.get("fingerprint") == fingerprint and attached.get("scope") == scope_key else None
        if identifier not in identifiers or identifier in used:
            identifier = None
        # Wrapper-observed new live/manual rows must not reuse a cleared row's
        # identity. Replayed history can reuse its fact+occurrence mapping.
        if identifier is None and not row.get("_guild_desk_new_event"):
            identifier = next((value for value in identifiers if value not in used), None)
        if identifier is None:
            identifier = "gdpy-" + uuid.uuid4().hex
            identifiers.append(identifier)
        used.add(identifier)
        bindings.append((row, {"id": identifier, "fingerprint": fingerprint, "scope": scope_key}))
        if id(row) in selected:
            event = {"id": identifier}
            event.update(facts)
            event["trackerStatus"] = _text(row.get("status", ""), "Tracker status", 40, required=False)
            if row.get("excluded") is not None:
                if not isinstance(row["excluded"], bool):
                    raise ValueError("Excluded must be true or false.")
                event["excluded"] = row["excluded"]
                if row.get("exclusionReason") is not None:
                    event["exclusionReason"] = _text(row["exclusionReason"], "Exclusion reason", 500, required=False)
            events.append(event)
    payload = {"format": "guild-desk-loot-events", "version": 1, "exportId": "gdpy-export-" + uuid.uuid4().hex, "raidDate": raid_date, "events": events}
    if sum(event["quantity"] for event in events) > 1000000:
        raise ValueError("Use at most one million total loot units per export.")
    if len(_json_bytes(payload)) > MAX_EXPORT_BYTES:
        raise ValueError("The selected export exceeds 3 MiB. Export fewer rows.")
    if len(_json_bytes(state)) > MAX_STATE_BYTES:
        raise ValueError("The private identity metadata is full. Keep it intact and contact your officer.")
    return payload, state, bindings


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as stream:
            stream.write(_json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(str(temporary), str(path))
    finally:
        if temporary.exists():
            temporary.unlink()


def export_to_file(rows, raid_date, destination, state_path, scope, selected_rows=None, protected_paths=()):
    """Save an export atomically without changing checkbox/status/delivery data."""
    destination, state_path = Path(destination).resolve(), Path(state_path).resolve()
    protected = {state_path, state_path.with_name(state_path.name + ".lock")}
    protected.update(Path(path).resolve() for path in protected_paths)
    if destination in protected:
        raise ValueError("Choose a new export file, not the tracker or its settings.")
    return _persist_export(rows, raid_date, state_path, scope, selected_rows, lambda payload: _atomic_json(destination, payload))


def export_to_clipboard(rows, raid_date, copy_text, state_path, scope, selected_rows=None):
    """Copy the same durable structured export without creating a loot file."""
    if not callable(copy_text):
        raise ValueError("Clipboard writer is required.")
    return _persist_export(rows, raid_date, Path(state_path).resolve(), scope, selected_rows, lambda payload: copy_text(_json_bytes(payload).decode("utf-8")))


def _persist_export(rows, raid_date, state_path, scope, selected_rows, write_output):
    state_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = state_path.with_name(state_path.name + ".lock")
    try:
        descriptor = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError("Another Guild Desk export owns the identity lock. Close the other tracker before retrying; stale locks require review.")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as lock:
            lock.write(str(os.getpid()))
        if state_path.exists():
            if state_path.stat().st_size > MAX_STATE_BYTES:
                raise ValueError("The private identity metadata exceeds its size limit.")
            with state_path.open("r", encoding="utf-8") as stream:
                state = json.load(stream)
        else:
            state = _new_state()
        payload, next_state, bindings = build_export(rows, raid_date, state, scope, selected_rows)
        # Persist IDs first: a failed destination write can safely retry using
        # the same IDs, and never produces an export without durable metadata.
        _atomic_json(state_path, next_state)
        for row, binding in bindings:
            row[ROW_ID_KEY] = binding
        write_output(payload)
        return payload
    finally:
        lock_path.unlink()


def create_wrapped_tracker_class(original, state_dir, tracker_path):
    """Construct the UI adapter only when the user launches their tracker."""
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog

    class GuildDeskTracker(original.EQLootTracker):
        def __init__(self):
            super().__init__()
            original_widgets = list(self.winfo_children())
            self.title(self.title() + " - Guild Desk")
            bar = tk.Menu(self)
            menu = tk.Menu(bar, tearoff=0)
            menu.add_command(label="Copy selected loot as JSON", command=lambda: self._export_guild_desk("copy"))
            menu.add_command(label="Save selected loot as JSON...", command=self._export_guild_desk)
            bar.add_cascade(label="Guild Desk", menu=menu)
            self.config(menu=bar)
            panel = tk.Frame(self)
            placement = {"before": original_widgets[0]} if original_widgets else {}
            panel.pack(side="top", fill="x", **placement)
            tk.Label(panel, text="Guild Desk loot export:").pack(side="left", padx=8)
            tk.Button(panel, text="Copy JSON", command=lambda: self._export_guild_desk("copy")).pack(side="left", padx=8, pady=5)
            tk.Button(panel, text="Save JSON", command=self._export_guild_desk).pack(side="left", padx=8, pady=5)

        def _add_loot_row(self, looter, qty, item, source, source_tag="new"):
            before = len(self.loot_rows)
            result = super()._add_loot_row(looter, qty, item, source, source_tag=source_tag)
            for row in self.loot_rows[before:]:
                row["_guild_desk_time_kind"] = "manual" if source_tag == "pending" else "tracker-clock"
                row["_guild_desk_new_event"] = True
            return result

        def _load_log_range(self, hours=24):
            existing = {id(row) for row in self.loot_rows}
            result = super()._load_log_range(hours=hours)
            for row in self.loot_rows:
                if id(row) not in existing:
                    row["_guild_desk_time_kind"] = "log-history"
                    row.pop("_guild_desk_new_event", None)
            return result

        def _export_guild_desk(self, mode="save"):
            selected = self._selected_rows()
            if not selected:
                messagebox.showinfo("Nothing selected", "Check one or more loot rows first.", parent=self)
                return
            raid_date = simpledialog.askstring("Raid date", "Raid date (YYYY-MM-DD). Short tracker times remain unknown game timestamps.", initialvalue=datetime.now().strftime("%Y-%m-%d"), parent=self)
            if raid_date is None:
                return
            try:
                if mode not in ("copy", "save"):
                    raise ValueError("Choose Copy JSON or Save JSON.")
                validate_raid_date(raid_date)
                destination = None
                if mode == "save":
                    destination = filedialog.asksaveasfilename(parent=self, title="Save Guild Desk loot events", defaultextension=".json", initialfile="guild-desk-loot-" + raid_date + ".json", filetypes=[("Guild Desk loot JSON", "*.json")])
                    if not destination:
                        return
                log_path = self.log_path_var.get().strip() if hasattr(self, "log_path_var") else ""
                scope = [os.path.normcase(str(Path(tracker_path).resolve())), os.path.normcase(os.path.abspath(log_path)) if log_path else "no-log-selected"]
                protected = [tracker_path, Path(__file__), Path(tracker_path).parent / "eq_loot_config.json", Path(state_dir) / "python-tracker-settings.json"]
                if log_path:
                    protected.append(Path(log_path))
                if mode == "copy":
                    def copy_text(value):
                        self.clipboard_clear()
                        self.clipboard_append(value)
                        self.update_idletasks()
                    payload = export_to_clipboard(self.loot_rows, raid_date, copy_text, Path(state_dir) / "python-tracker-identities.json", scope, selected)
                    messagebox.showinfo("Copied for Guild Desk", "Copied {} loot events. Paste the JSON in Guild Desk > Boss loot preparation > Raid-night import. Copying does not publish auctions or mark loot delivered.".format(len(payload["events"])), parent=self)
                else:
                    payload = export_to_file(self.loot_rows, raid_date, destination, Path(state_dir) / "python-tracker-identities.json", scope, selected, protected_paths=protected)
                    messagebox.showinfo("Saved for Guild Desk", "Saved {} loot events. Import this JSON in Guild Desk > Boss loot preparation > Raid-night import. Tracker export status and delivery status were not changed.".format(len(payload["events"])), parent=self)
            except Exception as error:
                messagebox.showerror("Guild Desk export failed", str(error), parent=self)

    return GuildDeskTracker


def main(argv=None):
    parser = argparse.ArgumentParser(description="Launch your existing Python loot tracker with an additional Guild Desk export.")
    parser.add_argument("--tracker", help="Path to your existing Python tracker script")
    parser.add_argument("--choose", action="store_true", help="Choose a different tracker script")
    parser.add_argument("--state-dir", help="Private settings/identity directory")
    arguments = parser.parse_args(argv)
    import tkinter as tk
    from tkinter import filedialog, messagebox
    state_dir = Path(arguments.state_dir) if arguments.state_dir else Path(__file__).resolve().parent / "state"
    settings_path = state_dir / "python-tracker-settings.json"
    settings = {}
    if settings_path.exists():
        try:
            if settings_path.stat().st_size > 16384:
                raise ValueError("The private launcher settings are too large.")
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            settings = {}
    tracker = arguments.tracker or (None if arguments.choose else settings.get("trackerPath"))
    chooser = None
    try:
        if not tracker or not Path(tracker).is_file():
            chooser = tk.Tk()
            chooser.withdraw()
            tracker = filedialog.askopenfilename(parent=chooser, title="Choose your existing Python loot tracker (.py)", filetypes=[("Python tracker", "*.py")])
            if not tracker:
                return 0
        tracker_path = Path(tracker).resolve()
        if tracker_path.suffix.lower() != ".py" or tracker_path == Path(__file__).resolve():
            raise ValueError("Choose your original tracker Python script, not this Guild Desk helper or its JSON settings.")
        spec = importlib.util.spec_from_file_location("_guild_desk_selected_tracker", str(tracker_path))
        if spec is None or spec.loader is None:
            raise ValueError("The selected tracker could not be loaded.")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        sys.path.insert(0, str(tracker_path.parent))
        try:
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
        if not hasattr(module, "EQLootTracker"):
            raise ValueError("The selected script does not define EQLootTracker.")
        _atomic_json(settings_path, {"trackerPath": str(tracker_path)})
        if chooser is not None:
            chooser.destroy()
            chooser = None
        app = create_wrapped_tracker_class(module, state_dir, tracker_path)()
        app.mainloop()
        return 0
    except Exception as error:
        if chooser is None:
            chooser = tk.Tk()
            chooser.withdraw()
        messagebox.showerror("Guild Desk tracker launcher", str(error), parent=chooser)
        return 1
    finally:
        if chooser is not None:
            chooser.destroy()


if __name__ == "__main__":
    sys.exit(main())
