"""
messages_txt.py - Fallback ingest from Asterisk dialplan FILE() log.

The dialplan always appends inbound SMS to /logs/messages.txt before TrySystem(notify).
If notify.py cannot exec (bind-mounted host file without +x → Permission denied), the
FILE line still lands while events.jsonl / SQLite stay empty — UI shows send-only.

This module parses host-side instances/*/logs/messages.txt and inserts missing inbound
rows (empty-body signalling dropped, same as apply_engine_event).
"""
from __future__ import annotations

import calendar
import logging
import os
import re
import time
from typing import Any, Callable

from . import config as cfg

log = logging.getLogger("vowifi.messages_txt")

_CHUNK_RE = re.compile(
    r"^IN SMS from (.*) at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\n?(.*)$",
    re.S,
)


def messages_path(iid: str) -> str:
    return os.path.join(cfg.DATA_DIR, "instances", str(iid), "logs", "messages.txt")


def _parse_ts(ts_str: str) -> int:
    """Asterisk STRFTIME of EPOCH is usually container local (UTC in our images)."""
    try:
        t = time.strptime(ts_str.strip(), "%Y-%m-%d %H:%M:%S")
        return int(calendar.timegm(t))
    except Exception:
        return int(time.time())


def iter_inbound(path: str) -> list[dict[str, Any]]:
    if not os.path.isfile(path):
        return []
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        log.debug("read messages.txt %s: %r", path, e)
        return []
    out: list[dict[str, Any]] = []
    for chunk in re.split(r"\n=====\n?", text):
        chunk = chunk.strip("\n")
        if not chunk.startswith("IN SMS from "):
            continue
        m = _CHUNK_RE.match(chunk)
        if not m:
            continue
        peer, ts_str, body = m.group(1), m.group(2), (m.group(3) or "").rstrip("\n")
        out.append({
            "peer": peer.strip(),
            "body": body,
            "ts": _parse_ts(ts_str),
        })
    return out


def backfill_once(process: Callable[[dict[str, Any]], Any]) -> int:
    """Hand each inbound SMS with body to process(row). Returns rows handed off.

    process receives {"instance","peer","body","ts"} — caller dedupes via store.has_message.
    """
    n = 0
    for inst in cfg.list_instances():
        iid = str(inst["id"])
        path = messages_path(iid)
        for row in iter_inbound(path):
            if not (row.get("body") or "").strip():
                continue
            try:
                process({
                    "instance": iid,
                    "peer": row["peer"],
                    "body": row["body"],
                    "ts": row["ts"],
                })
                n += 1
            except Exception as e:  # noqa
                log.warning("messages_txt process failed iid=%s: %r", iid, e)
    return n
