"""
userbot.py - the control plane's window into the userbot call sidecar.

The userbot runs in its own container with its own dependencies and its own
Telegram session, deliberately not sharing the manager's settings. The one thing
the two do share is the data directory: the sidecar mounts <data>/userbot at
/data/userbot and already looks for its config there, so the WebUI can configure
it by writing a file rather than by talking to the container.

Status flows back the same way. The sidecar rewrites status.json every few
seconds; a timestamp older than STALE_AFTER means the container is not running,
which is the only "is it alive" signal we need and costs no cross-container call.

Lifecycle goes through the Docker socket the manager already holds, so the
container is the manager's to create rather than something the user runs by hand.
Starting is a recreate, as with engine containers: config and session both live on
the volume, so nothing is lost and one code path covers start, restart and
"apply the settings I just saved".
"""
from __future__ import annotations

import json
import logging
import os
import time

import docker

from . import config as cfg
from . import engine

log = logging.getLogger("vowifi.userbot")

CONTAINER = "vowifi-userbot"
IMAGE = os.environ.get("VOWIFI_USERBOT_IMAGE", "vowifi/userbot")


class NotReady(Exception):
    """A precondition the user has to fix before the container can run."""

# Anything older than this and we call the sidecar offline. Comfortably above the
# sidecar's own write interval so a slow board doesn't look dead.
STALE_AFTER = 30

DEFAULTS = {
    "api_id": 0,
    "api_hash": "",
    "phone": "",
    # Inside the container. Telethon appends .session; the file grants full
    # control of the account, which is why it lives on the mounted volume.
    "session_name": "/data/userbot/userbot",
    "owner_id": 0,
    "gateway_url": "https://127.0.0.1:8443",
    "gateway_verify_tls": False,
    "sip_user": "tgbridge",
    "sip_password": "",     # blank = take it from the line's external account
    "sip_line": "",         # blank = the first configured line
    "dial_allowlist": [],
}


def _dir() -> str:
    return os.path.join(cfg.DATA_DIR, "userbot")


def config_path() -> str:
    return os.path.join(_dir(), "config.json")


def status_path() -> str:
    return os.path.join(_dir(), "status.json")


def load() -> dict:
    out = dict(DEFAULTS)
    try:
        with open(config_path(), encoding="utf-8") as f:
            saved = json.load(f) or {}
        out.update({k: v for k, v in saved.items() if not k.startswith("_")})
    except FileNotFoundError:
        pass
    except Exception as e:  # noqa
        log.warning("unreadable userbot config: %r", e)
    return out


def public() -> dict:
    """For the WebUI: the api_hash is a credential for a whole Telegram account,
    so report only whether one is set. An empty one on save means unchanged,
    the same rule the bot token and the SIM PIN follow."""
    out = load()
    out["api_hash_set"] = bool((out.get("api_hash") or "").strip())
    out["sip_password_set"] = bool((out.get("sip_password") or "").strip())
    out["api_hash"] = ""
    out["sip_password"] = ""
    out["config_path"] = config_path()
    return out


def update(patch: dict) -> dict:
    current = load()
    patch = {k: v for k, v in (patch or {}).items()
             if k in DEFAULTS and not k.startswith("_")}
    if not str(patch.get("api_hash") or "").strip():
        patch.pop("api_hash", None)          # blank means keep
    if not str(patch.get("sip_password") or "").strip():
        patch.pop("sip_password", None)
    for key in ("api_id", "owner_id"):
        if key in patch:
            try:
                patch[key] = int(str(patch[key]).strip() or 0)
            except ValueError:
                raise ValueError(f"{key} must be a number")
    if "dial_allowlist" in patch:
        raw = patch["dial_allowlist"]
        if isinstance(raw, str):
            raw = raw.split(",")
        patch["dial_allowlist"] = [str(n).strip() for n in (raw or []) if str(n).strip()]

    merged = {**current, **patch}
    os.makedirs(_dir(), exist_ok=True)
    tmp = config_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, sort_keys=True)
    os.replace(tmp, config_path())
    # The sidecar re-reads only at startup, so say so rather than let the user
    # wonder why nothing changed.
    log.info("userbot config written to %s", config_path())
    return public()


def status() -> dict:
    """What the sidecar last reported. `running` is derived from the timestamp:
    the sidecar has no way to tell us it died, so silence is the signal."""
    try:
        with open(status_path(), encoding="utf-8") as f:
            st = json.load(f) or {}
    except FileNotFoundError:
        return {"running": False, "reason": "the userbot container has never started"}
    except Exception as e:  # noqa
        return {"running": False, "reason": f"unreadable status file: {e}"}
    age = time.time() - float(st.get("ts") or 0)
    st["age"] = int(age)
    st["running"] = age < STALE_AFTER
    if not st["running"]:
        st["reason"] = f"no report for {int(age)}s — the container is probably stopped"
    return st


# ----------------------------- the container -----------------------------

def session_file() -> str | None:
    """Where Telethon's cached login lives on our side of the mount, or None if
    session_name was pointed somewhere we cannot see."""
    name = str(load().get("session_name") or "")
    prefix = "/data/userbot/"
    if not name.startswith(prefix):
        return None
    return os.path.join(_dir(), name[len(prefix):] + ".session")


def signed_in() -> bool:
    """Telethon asks for the login code on stdin. A detached container has no
    stdin, so starting one without a cached session buys a crash loop rather than
    a prompt — hence checking before we start it and not after.

    Returning True when we cannot see the session path used to skip this check
    entirely, which is the opposite of safe: a custom session_name off the
    volume would look 'signed in' and then crash-loop in the container.
    """
    path = session_file()
    if path and os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    try:
        for name in os.listdir(_dir()):
            if name.endswith(".session") and os.path.getsize(os.path.join(_dir(), name)) > 0:
                return True
    except FileNotFoundError:
        pass
    return False


def _clear_status():
    """Drop the last heartbeat. Restart would otherwise keep showing the previous
    process as healthy until STALE_AFTER, because the file lives on the volume."""
    try:
        os.remove(status_path())
    except FileNotFoundError:
        pass
    except Exception as e:  # noqa
        log.debug("could not clear userbot status: %s", e)


def _sync_gateway_url(conf: dict) -> dict:
    """Host-network sidecar talks to the manager on loopback. Follow the live
    HTTPS port so a Settings change off 8443 does not leave it calling the old one.
    A non-loopback URL is left alone — that was a deliberate override."""
    port = int((cfg.load() or {}).get("http_port") or 8443)
    live = f"https://127.0.0.1:{port}"
    url = (conf.get("gateway_url") or "").strip().rstrip("/")
    if not url or url.startswith("https://127.0.0.1:") or url.startswith("http://127.0.0.1:"):
        if url != live:
            update({"gateway_url": live})
            return load()
    return conf


def container() -> dict:
    """Docker's view, which answers a different question from status(): the
    container can be up while the sidecar inside it is failing to sign in."""
    try:
        c = engine.client().containers.get(CONTAINER)
    except docker.errors.NotFound:
        return {"exists": False, "state": "absent"}
    except docker.errors.DockerException as e:  # noqa
        engine.reset_client()
        return {"exists": False, "state": "unknown", "error": str(e)}
    return {"exists": True, "state": c.status, "started_at": c.attrs.get("State", {}).get("StartedAt")}


def start_container() -> str:
    """Recreate and start it. Raises NotReady with something the user can act on."""
    conf = load()
    missing = [k for k in ("api_id", "api_hash", "owner_id") if not conf.get(k)]
    if missing:
        raise NotReady(f"the userbot is not configured yet — {', '.join(missing)} still empty")
    host_dir = os.path.join(engine.HOST_DATA_DIR, "userbot")
    if not signed_in():
        raise NotReady(
            "this Telegram account has not logged in yet. Telegram sends the code by SMS "
            "and it has to be typed at a terminal on the gateway, once:\n"
            f"docker run --rm -it -v {host_dir}:/data/userbot {IMAGE} python spike_echo.py")

    client = engine.client()
    # Probe the image BEFORE tearing the old container down. Restarting when the
    # image is gone used to leave the user with nothing running.
    try:
        client.images.get(IMAGE)
    except docker.errors.ImageNotFound:
        raise NotReady(f"the {IMAGE} image is not built yet. On the gateway:\n"
                       f"docker build -f userbot/Dockerfile -t {IMAGE} .") from None

    conf = _sync_gateway_url(conf)
    os.makedirs(_dir(), exist_ok=True)
    try:
        old = client.containers.get(CONTAINER)
        old.remove(force=True)
    except docker.errors.NotFound:
        pass
    _clear_status()

    c = client.containers.run(
        IMAGE,
        name=CONTAINER,
        detach=True,
        # The SIP leg registers to the engine's port on the host and receives RTP
        # on whatever port PJSIP picks, so published ports are not workable.
        network_mode="host",
        volumes={host_dir: {"bind": "/data/userbot", "mode": "rw"}},
        restart_policy={"Name": "unless-stopped"},
    )
    log.info("started userbot container %s", c.name)
    return c.id


def stop_container() -> bool:
    try:
        engine.client().containers.get(CONTAINER).remove(force=True)
        _clear_status()
        return True
    except docker.errors.NotFound:
        _clear_status()
        return False


def logs(tail: int = 200) -> str:
    try:
        return engine.client().containers.get(CONTAINER).logs(tail=tail).decode(errors="replace")
    except docker.errors.NotFound:
        return ""
    except Exception as e:  # noqa
        return f"error: {e}"
