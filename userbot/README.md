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

Create an external SIP account in the WebUI under **SIM Config → External SIP
accounts** (for example `tgbridge` with a password) and put it in `config.json`.
Nothing in the engine image changes: the inbound dialplan already rings every
external account, and an INVITE from one lands in `from-local`, which hairpins
it to the IMS trunk.

```bash
docker build -f userbot/Dockerfile -t vowifi/userbot .
docker run -d --name vowifi-userbot --network host \
  -v /path/to/data/userbot:/data/userbot \
  vowifi/userbot
```

Host networking is the simple option because the SIP leg needs to reach the
engine's SIP port and receive RTP. The first build compiles PJSIP, which takes a
while on a Pi.

Then, in order: registration comes up (`SIP registration: up` in the log),
`/call <number>` places a call, an inbound call to the SIM rings Telegram, and
`/dtmf 1234` sends tones mid-call.

## Commands

Only the configured `owner_id` is obeyed, in their own private chat. Anything
else is ignored without a reply.

- `/call <number>` — rings you first, dials the number once you answer
- `/dtmf <digits>` — multi-digit, PJSUA2 handles the inter-digit timing
- `/hangup`

`dial_allowlist` in the config restricts what may be dialled. This process can
place calls, so if the set of numbers is predictable, pin it down.

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
