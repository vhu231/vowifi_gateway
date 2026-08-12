# Telegram userbot: calls in and out

Bridges a Telegram 1-on-1 voice call to a SIM line. You dial `/call 12345`, the
userbot rings **you** on Telegram, and once you answer it dials the number over
the gateway. Incoming calls to the SIM ring your Telegram at the same time as
every other extension.

A **bot** account cannot be in a voice call — only a real user account can, over
MTProto. That is the whole reason this is a separate thing from the Telegram bot
built into the control plane.

## Status: none of this has been run against Telegram yet

The code is written, syntax-checked and structured, but **no part of the call
path has been exercised on real hardware**. The Telegram half follows a working
third-party implementation closely (see below); the SIP half and the outbound
call path have no such reference. Treat this as a first draft to debug, not as
something that works.

Start with `spike_echo.py`. If that does not pass, nothing else can.

## Step 0: prove Telegram audio works

```bash
cd userbot
pip install -r requirements.txt          # ntgcalls + telethon; PJSIP not needed yet
cp config.example.json config.json       # api_id, api_hash, phone, owner_id
python spike_echo.py
```

If the config was saved from **Settings → Telegram calls**, it already lives on
the data volume. Login with that file instead of a local copy:

```bash
docker run --rm -it -v /path/to/data/userbot:/data/userbot \
  vowifi/userbot python spike_echo.py
```

Get `api_id` / `api_hash` from <https://my.telegram.org/apps> and your numeric
`owner_id` from [@userinfobot](https://t.me/userinfobot). The first run asks for
the login code Telegram sends you; after that the session is cached.

Now call that account from your phone and talk. **You should hear yourself.**
On hangup the script prints a verdict with frame counts.

Answer from a phone or the desktop client. Telegram Web A negotiates a protocol
version ntgcalls does not speak, and the call simply will not connect.

### If you hear nothing

That is the expected failure, and it is why this step exists. The call will look
healthy in the logs while carrying no audio. Check in this order:

1. **PLAYBACK attached too early.** It must come *after* `connect_p2p`, not
   before. In `telegram_call.py` that is `_go_live()`.
2. **Wrong slot.** Inbound frames arrive on the microphone device with
   `mode=PLAYBACK`. It reads backwards and it is correct.
3. **Outbound went quiet.** The sender thread must push a frame every 10 ms from
   the moment the call is up, silence included. If it stops, inbound never opens
   and Telegram drops the call after a few seconds. Watch for
   `send_external_frame failed` in the log.
4. **Frame size.** 480 samples = 960 bytes = 10 ms. 20 ms frames are a common
   assumption and they break the sender.

Background: [pytgcalls/ntgcalls#44](https://github.com/pytgcalls/ntgcalls/issues/44).
The ordering and slot rules come from the comment dated 2026-07 there and from
[TxPKev/p2p-offline-ai-telegram-bridge](https://github.com/TxPKev/p2p-offline-ai-telegram-bridge),
which reports bidirectional audio on unpatched ntgcalls 2.1.0. These are
community findings, not documented API — hence this step.

## Step 1: the SIP side

Nothing in the engine image changes: the inbound dialplan already rings every
external account, and an INVITE from one lands in `from-local`, which hairpins
it to the IMS trunk.

**Settings → Telegram calls (userbot)** is the whole setup. Fill API id / hash,
the spare account's phone, and your numeric user id, then press **Start**. That
one action builds `vowifi/userbot` if the image is missing (PJSIP compile; the
page shows the log), creates the `tgbridge` SIP account on the chosen line if
it is missing, sends the Telegram login code, and starts the sidecar once you
type the code (and 2FA password, if asked) in the same card.

Both directions are plain files on the shared volume; the control plane never
talks to this container, it only asks Docker to run it (and, for first login,
uses Telethon in the manager to write the session file). Config is read once at
startup, so Restart is what applies a change. Restart recreates the container,
which costs nothing: the session and the config live on the volume, not in it.

The login code is entered in Settings. A detached container has no stdin, so
Start will not launch the sidecar until a session exists. `spike_echo.py` remains
as a no-SIP audio probe if you want it.

By hand, if you would rather:

```bash
docker run -d --name vowifi-userbot --network host \
  -v /path/to/data/userbot:/data/userbot \
  vowifi/userbot
```

Host networking is the simple option because the SIP leg needs to reach the
engine's SIP port and receive RTP.

Then, in order: registration comes up (`SIP registration: up` in the log),
`/call <number>` places a call, an inbound call to the SIM rings Telegram, and
`/dtmf 1234` sends tones mid-call.

## Commands

`owner_id` plus anything in `owner_ids` is obeyed, each in their own private
chat. Anything else is ignored without a reply. Permissions are flat: everyone
listed may dial on every card, and one call runs at a time.

- `/call <number> [line]` — rings *you* first, dials once you answer
- `/use <line>` — the card your `/call` uses from now on, remembered per account
- `/lines` — the cards, whether each is registered, and who answers it
- `/dtmf <digits>` — multi-digit, PJSUA2 handles the inter-digit timing
- `/hangup`

`dial_allowlist` in the config restricts what may be dialled. This process can
place calls, so if the set of numbers is predictable, pin it down.

## Cards

Each entry in `cards` is one SIM the userbot answers for:

```json
{"line": "1", "sip_user": "tgbridge", "answer_owner": 0}
```

`answer_owner` is who gets rung when that SIM receives a call; `0` means the
primary account. **SIP usernames must differ between lines.** Every account is
registered from one PJSUA2 endpoint, and two accounts sharing a
`sip:user@host` identity make an inbound call ambiguous — PJSIP hands it to
whichever it matches first, which may be the wrong SIM. The control plane
refuses a name another line already uses.

A config from before multi-card, carrying a single `sip_line`/`sip_user` pair,
is read as one card with that same username.

## Why it is built this way

**A normal SIP account, not WebRTC.** The browser softphone's WSS endpoint has
exactly one account; registering there would kick the browser softphone off, and
adding a second endpoint means changing the engine templates. External accounts
are already a supported concept and already ring on inbound.

**PJSUA2 rather than raw RTP.** Setting the endpoint clock to 48 kHz makes PJSIP
hand us 48 kHz PCM directly — the rate Telegram wants — while it transcodes to
ulaw on the wire itself. No resampling code of our own, which matters since
Python 3.13 dropped `audioop`. Nothing is lost: the IMS trunk is
`disallow=all / allow=amr`, so the ceiling is narrowband either way. DTMF comes
free with `dialDtmf`.

**Ring the owner before touching the SIP leg.** Outbound, dialling first would
make the callee hear silence while you are still reaching for your phone.
Inbound, we send 180 Ringing and only answer once you pick up — answering
immediately would stop every other extension ringing and quietly make the
userbot the only phone in the house.

## Risks worth knowing

- **Automated user accounts are a grey area on Telegram.** Use a dedicated
  spare account, not your main one.
- **The session file is the account.** It lives on the mounted volume and never
  in the image. Anyone who takes it has the account.
- **This process can dial.** Hence the separate owner check and allow-list here
  rather than trusting the control-plane bot's switches.
- **Two hops of latency.** Telegram P2P plus the IMS tunnel; expect noticeably
  more delay than an ordinary call.

## What is verified and what is not

| Part | Basis |
| --- | --- |
| ntgcalls call sequence, frame geometry, slot semantics | transcribed from a working implementation |
| Answering an incoming Telegram call | same reference, closely followed |
| Placing an outgoing Telegram call | inferred from the MTProto flow, **no reference** — the caller-side DH (`init_exchange` without a peer hash, then `ConfirmCall`) is the first thing to instrument |
| SIP registration, media, DTMF | standard PJSUA2 usage, not run here |
| Bridge ordering and teardown | design, not run here |
