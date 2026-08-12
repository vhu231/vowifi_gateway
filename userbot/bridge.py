"""
bridge.py - wires the Telegram leg to the SIP leg and orchestrates a call.

Both legs are plain 48 kHz mono int16 pipes by the time they get here, so the
bridge itself is only ordering and teardown. The ordering is the interesting part.

Outbound (/call 12345):
  ring the owner on Telegram first, and only send the SIP INVITE once they have
  answered. Doing it the other way round would make the callee's phone ring while
  the owner is still reaching for theirs, and the first thing the callee hears
  would be silence.

Inbound (someone dials the SIM):
  the dialplan rings every local extension at once, us included. We reply 180
  Ringing and call the owner on Telegram; only when they answer do we send 200 OK
  on the SIP leg. Answering first would cancel the other extensions - the browser
  softphone and any desk phone would stop ringing the moment the userbot picked
  up, which is not what "ring my phones" means.

Either leg ending tears down the other.
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("userbot.bridge")


class CallBridge:
    def __init__(self, tg_leg, sip_leg, loop: asyncio.AbstractEventLoop):
        self.tg = tg_leg
        self.sip = sip_leg
        self.loop = loop
        self._pending_outbound: str | None = None   # number to dial once TG answers
        self._inbound_peer: str | None = None       # caller waiting on 180 Ringing
        self._tearing_down = False

        self.tg.on_pcm = self._tg_to_sip
        self.tg.on_connected = self._tg_connected
        self.tg.on_ended = self._tg_ended
        self.sip.on_pcm = self._sip_to_tg
        self.sip.on_incoming = self._sip_incoming
        self.sip.on_ended = self._sip_ended

    # ---------- audio ----------
    # Straight copies. Both sides are already 48 kHz mono int16, and both sides
    # tolerate being fed nothing (each inserts its own silence).

    def _tg_to_sip(self, pcm: bytes):
        self.sip.push_pcm(pcm)

    def _sip_to_tg(self, pcm: bytes):
        self.tg.push_pcm(pcm)

    # ---------- outbound ----------

    async def place_call(self, number: str) -> str:
        if self.tg.active:
            return "A call is already in progress."
        self._pending_outbound = number
        log.info("outbound: ringing the owner before dialling %s", number)
        if not await self.tg.place_call():
            self._pending_outbound = None
            return "Could not ring you on Telegram."
        return f"Calling you now — answer, and I'll dial {number}."

    # ---------- inbound ----------

    def _sip_incoming(self, peer: str):
        """Runs on a PJSIP thread; hop back onto the loop to touch Telethon."""
        self._inbound_peer = peer
        asyncio.run_coroutine_threadsafe(self._ring_owner(peer), self.loop)

    async def _ring_owner(self, peer: str):
        if self.tg.active:
            log.info("inbound call from %s while busy — leaving it to ring elsewhere", peer)
            return
        log.info("inbound call from %s — ringing the owner on Telegram", peer)
        if not await self.tg.place_call():
            log.warning("could not reach the owner; other extensions keep ringing")

    # ---------- joins ----------

    async def _tg_connected(self):
        """The owner picked up. Now, and only now, involve the SIP side."""
        if self._pending_outbound:
            number, self._pending_outbound = self._pending_outbound, None
            try:
                self.sip.dial(number)
            except Exception as e:  # noqa
                log.error("SIP dial failed: %s", e)
                await self.tg.hangup()
            return
        if self._inbound_peer:
            self.sip.answer()
            self._inbound_peer = None

    async def _tg_ended(self):
        if self._tearing_down:
            return
        self._tearing_down = True
        try:
            self._pending_outbound = None
            self._inbound_peer = None
            self.sip.hangup()
        finally:
            self._tearing_down = False

    def _sip_ended(self):
        if self._tearing_down:
            return
        self._tearing_down = True
        try:
            asyncio.run_coroutine_threadsafe(self._hangup_tg(), self.loop)
        finally:
            self._tearing_down = False

    async def _hangup_tg(self):
        self._pending_outbound = None
        self._inbound_peer = None
        await self.tg.hangup()

    # ---------- commands ----------

    def send_dtmf(self, digits: str) -> str:
        clean = "".join(c for c in digits if c in "0123456789*#ABCD")
        if not clean:
            return "Digits must be 0-9, * or #."
        try:
            self.sip.send_dtmf(clean)
        except Exception as e:  # noqa
            return f"Could not send DTMF: {e}"
        return f"Sent {clean}."

    async def hangup(self) -> str:
        if not self.tg.active:
            return "No call in progress."
        await self.tg.hangup()
        return "Hung up."
