"""
event_log.py - Reliable ingest of engine notify events from bind-mounted logs.

notify.py always appends to /logs/events.jsonl *before* POSTing /api/engine/event.
When Web-auth lands, that POST can 401 (missing token / Docker NAT) while the JSONL
line is still written — inbound SMS then appears in messages.txt but never in SQLite.

This module tails each instance's host-side events.jsonl and feeds new lines into the
same handler as the HTTP callback (with dedupe), so receive path does not depend on
callback auth succeeding.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Callable, Iterable

from . import config as cfg

log = logging.getLogger("vowifi.event_log")

OFFSETS_NAME = "event_log_offsets.json"
_lock = threading.Lock()


def _offsets_path() -> str:
    return os.path.join(cfg.DATA_DIR, OFFSETS_NAME)


def _load_offsets() -> dict[str, int]:
    path = _offsets_path()
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return {str(k): int(v) for k, v in (raw or {}).items()}
    except Exception:
        return {}


def _save_offsets(offsets: dict[str, int]) -> None:
    path = _offsets_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(offsets, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def events_path(iid: str) -> str:
    return os.path.join(cfg.DATA_DIR, "instances", str(iid), "logs", "events.jsonl")


def _is_ingest_line(obj: dict) -> bool:
    """Skip notify's failure-diagnostic follow-up lines; keep real event payloads."""
    if not isinstance(obj, dict):
        return False
    if "post_status" in obj or "post_error" in obj:
        return False
    return bool(obj.get("event"))


def iter_new_events(iid: str, start_offset: int) -> tuple[list[dict[str, Any]], int]:
    """Return (events, new_offset) for lines after start_offset in this instance's log."""
    path = events_path(iid)
    if not os.path.isfile(path):
        return [], start_offset
    try:
        size = os.path.getsize(path)
    except OSError:
        return [], start_offset
    # File truncated / rotated
    if start_offset > size:
        start_offset = 0
    out: list[dict[str, Any]] = []
    try:
        with open(path, "rb") as f:
            f.seek(start_offset)
            while True:
                raw = f.readline()
                if not raw:
                    break
                start_offset = f.tell()
                try:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    obj = json.loads(line)
                except Exception:
                    continue
                if _is_ingest_line(obj):
                    # Prefer directory instance id over payload (stale VOWIFI_ID edge cases).
                    obj = dict(obj)
                    obj["instance"] = str(iid)
                    out.append(obj)
    except OSError as e:
        log.debug("read events.jsonl %s: %r", iid, e)
        return [], start_offset
    return out, start_offset


def poll_once(process: Callable[[dict[str, Any]], Any], *, backfill_missing: bool = False) -> int:
    """Process new JSONL events for every instance. Returns number of events handed off.

    On first sight of an instance with no saved offset:
      - backfill_missing=True  → start at 0 (replay whole file; used once at startup)
      - backfill_missing=False → jump to EOF (live tail only)
    """
    with _lock:
        offsets = _load_offsets()
        n = 0
        dirty = False
        for inst in cfg.list_instances():
            iid = str(inst["id"])
            path = events_path(iid)
            if not os.path.isfile(path):
                continue
            if iid not in offsets:
                if backfill_missing:
                    offsets[iid] = 0
                else:
                    try:
                        offsets[iid] = os.path.getsize(path)
                    except OSError:
                        offsets[iid] = 0
                dirty = True
            events, new_off = iter_new_events(iid, offsets[iid])
            if new_off != offsets[iid]:
                offsets[iid] = new_off
                dirty = True
            for ev in events:
                try:
                    process(ev)
                    n += 1
                except Exception as e:  # noqa
                    log.warning("event_log process failed iid=%s event=%r: %r",
                                iid, ev.get("event"), e)
        if dirty:
            try:
                _save_offsets(offsets)
            except OSError as e:
                log.warning("save event_log offsets failed: %r", e)
        return n


def known_instance_ids() -> Iterable[str]:
    return [str(i["id"]) for i in cfg.list_instances()]
