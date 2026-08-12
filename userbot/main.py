"""
main.py - the userbot sidecar entry point.

Runs a Telegram user account (not a bot account - bot accounts cannot be in a
voice call) that bridges Telegram calls to a SIM line, and takes /call, /dtmf
and /hangup from its owner over the same account's private chat.

Commands are deliberately re-checked here rather than trusted from the main bot:
this process can dial arbitrary numbers, so it enforces its own owner check and
its own dial allow-list. Being a separate container from the control plane is
part of that - it keeps the native ntgcalls and PJSIP dependencies, and their
crash surface, away from the gateway.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import requests
from telethon import TelegramClient, events

from bridge import CallBridge
from sip_leg import SipLeg
from telegram_call import TelegramCallLeg

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("userbot")

HELP = """VoWiFi userbot

/call <number> - I ring you, you answer, then I dial the number
/dtmf <digits> - send tones during a call (e.g. /dtmf 1234)
/hangup - end the current call

Calls to this account are bridged out to the SIM line automatically."""


def load_config() -> dict:
    for path in (Path(__file__).parent / "config.json", Path("/data/userbot/config.json")):
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    log.error("no config.json (looked next to main.py and in /data/userbot)")
    sys.exit(1)


def sip_params(cfg: dict) -> tuple[str, int, str]:
    """Ask the control plane where this line's SIP service lives, and what our own
    account's password is. Read-only, and the only thing the sidecar needs from the
    gateway - calls themselves are pure SIP, so nothing here is needed at runtime."""
    base = cfg["gateway_url"].rstrip("/")
    verify = bool(cfg.get("gateway_verify_tls", False))
    line = str(cfg.get("sip_line") or "")
    if not line:
        r = requests.get(f"{base}/api/instances", timeout=10, verify=verify)
        r.raise_for_status()
        instances = r.json().get("instances", [])
        if not instances:
            raise RuntimeError("the gateway has no configured lines")
        line = str(instances[0]["id"])
    r = requests.get(f"{base}/api/instances/{line}/sipinfo", timeout=10, verify=verify)
    r.raise_for_status()
    info = r.json()

    host = info.get("host") or info.get("domain") or "127.0.0.1"
    port = int(info.get("port") or 5060)
    if info.get("transport") == "tls":
        # The endpoint reports the TLS port for a TLS line, and registering to it
        # over UDP just times out. Fail loudly rather than mysteriously.
        raise RuntimeError("this line uses SIP/TLS; the userbot only speaks UDP so far")
    if not info.get("running"):
        log.warning("line %s is not running — SIP registration will fail until it is", line)

    # The gateway already knows our password: it is the external account the user
    # created in the WebUI. Taking it from here means one less secret to copy, and
    # it cannot go stale behind our back.
    user = cfg["sip_user"]
    accounts = {a.get("username"): a.get("password") for a in (info.get("accounts") or [])}
    if user not in accounts:
        raise RuntimeError(
            f"line {line} has no external SIP account called {user!r} "
            f"(it has: {', '.join(accounts) or 'none'}). Create one in the WebUI under "
            f"SIM Config -> External SIP accounts.")
    password = cfg.get("sip_password") or accounts[user] or ""
    if not password:
        raise RuntimeError(f"external SIP account {user!r} has no password set")

    log.info("line %s speaks SIP at %s:%s as %s", line, host, port, user)
    return host, port, password


class UserBot:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.owner = int(cfg["owner_id"])
        self.allow = [str(n).strip() for n in (cfg.get("dial_allowlist") or []) if str(n).strip()]
        self.client = TelegramClient(cfg["session_name"], cfg["api_id"], cfg["api_hash"])
        self.bridge: CallBridge | None = None
        self.sip: SipLeg | None = None
        self.last_error = ""

    # ---------- status ----------

    def _status_path(self) -> Path:
        """Next to the session, i.e. in the directory the control plane shares with
        us. It reads this file to show the sidecar in the WebUI."""
        return Path(self.cfg["session_name"]).parent / "status.json"

    async def _write_status(self):
        path = self._status_path()
        try:
            tg = self.bridge.tg if self.bridge else None
            payload = {
                "ts": int(time.time()),
                "telegram_connected": bool(self.client.is_connected()),
                "sip_registered": bool(self.sip and self.sip.registered),
                "in_call": bool(tg and tg.active),
                "owner_id": self.owner,
                "sip_user": self.cfg.get("sip_user", ""),
                "last_error": self.last_error,
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            tmp.replace(path)
        except Exception as e:  # noqa
            log.debug("status write failed: %s", e)

    async def _report_status(self):
        """Rewrite status.json on a timer. The control plane treats a stale
        timestamp as 'not running' — we have no way to announce our own death,
        so a heartbeat is the signal."""
        while True:
            await self._write_status()
            await asyncio.sleep(5)

    def _may_dial(self, number: str) -> bool:
        return not self.allow or number in self.allow

    async def run(self):
        # Never client.start(phone=): that calls input() for the login code, and a
        # detached container has no stdin (EOFError crash loop). Login happens in
        # the WebUI; we only accept an already-authorized session.
        await self.client.connect()
        if not await self.client.is_user_authorized():
            self.last_error = "not signed in — enter the login code in Settings"
            log.error("%s", self.last_error)
            await self._write_status()
            await asyncio.sleep(300)
            return
        me = await self.client.get_me()
        log.info("signed in as %s (id=%s)", me.first_name, me.id)

        heartbeat = asyncio.create_task(self._report_status())
        try:
            # sip_params is blocking HTTP. Run it off the loop so the heartbeat
            # can actually write last_error / "not yet registered" while we wait.
            host, port, password = await asyncio.to_thread(sip_params, self.cfg)
        except Exception as e:  # noqa
            # Setup mistakes land here: no such external account, the line is stopped,
            # the line is TLS. Publish them so the WebUI can show what to fix instead
            # of leaving them in this container's log. The pause is what gives the
            # heartbeat a turn to write before we exit, and doubles as restart backoff.
            self.last_error = str(e)
            log.error("%s", e)
            await asyncio.sleep(30)
            heartbeat.cancel()
            raise

        self.sip = SipLeg(self.cfg["sip_user"], password, host, port)
        self.sip.start()

        loop = asyncio.get_running_loop()
        tg = TelegramCallLeg(self.client, self.owner)
        tg.install(loop)
        self.bridge = CallBridge(tg, self.sip, loop)

        self.client.add_event_handler(self._on_message, events.NewMessage(incoming=True))
        log.info("userbot ready — owner is %s", self.owner)
        try:
            await self.client.run_until_disconnected()
        finally:
            heartbeat.cancel()
            self.sip.stop()

    async def _on_message(self, event):
        # Only the owner, in their own private chat. Anyone else is ignored
        # without a reply, same as the control-plane bot.
        if event.chat_id != self.owner or not event.raw_text:
            return
        text = event.raw_text.strip()
        cmd, _, arg = text.partition(" ")
        cmd, arg = cmd.split("@", 1)[0].lower(), arg.strip()
        if cmd not in ("/start", "/help", "/call", "/dtmf", "/hangup"):
            return
        try:
            reply = await self._run_command(cmd, arg)
        except Exception as e:  # noqa
            # Telethon would swallow this into the container log, leaving the
            # owner staring at a command that answered nothing at all.
            log.exception("%s failed", cmd)
            reply = f"{cmd} failed: {type(e).__name__}: {e}"
        await event.reply(reply)

    async def _run_command(self, cmd: str, arg: str) -> str:
        if cmd in ("/start", "/help"):
            return HELP
        if cmd == "/call":
            number = arg.split()[0] if arg else ""
            if not number:
                return "Usage: /call <number>"
            if not self._may_dial(number):
                return f"{number} is not in this userbot's dial allow-list."
            return await self.bridge.place_call(number)
        if cmd == "/dtmf":
            return self.bridge.send_dtmf(arg)
        return await self.bridge.hangup()


if __name__ == "__main__":
    asyncio.run(UserBot(load_config()).run())
