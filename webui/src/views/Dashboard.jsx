import React, { useState } from 'react'
import { api } from '../api.js'
import ProvisionModal from './ProvisionModal.jsx'
import SipInfoModal from './SipInfoModal.jsx'

function Kv({ k, children, mono, title, truncate = true, onCopy }) {
  const text = (title || (typeof children === 'string' ? children : '') || '').trim()
  const copyable = !!(mono && text && text !== '—')
  const doTruncate = truncate && !mono

  const copy = async (e) => {
    if (!copyable) return
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      onCopy?.(k, text)
    } catch {
      onCopy?.(k, null)
    }
  }

  return (
    <>
      <span className="kv-k">{k}</span>
      <span
        className={[
          'kv-v',
          mono ? 'mono' : '',
          doTruncate ? 'truncate' : '',
          copyable ? 'is-copyable' : '',
        ].filter(Boolean).join(' ')}
        title={copyable ? `${text} — tap to copy` : title}
        role={copyable ? 'button' : undefined}
        tabIndex={copyable ? 0 : undefined}
        onClick={copyable ? copy : undefined}
        onKeyDown={copyable ? (e) => { if (e.key === 'Enter' || e.key === ' ') copy(e) } : undefined}
      >
        {children}
      </span>
    </>
  )
}

function StateBadge({ st }) {
  const state = st?.state || 'STOPPED'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
      <span className={`dot st-${state}`} />
      {st?.label || 'Unknown'}
    </span>
  )
}

const STEPS = [
  ['NO_CARD', 'SIM'],
  ['EPDG_UNRESOLVED', 'ePDG DNS'],
  ['TUNNEL_DOWN', 'Tunnel'],
  ['REGISTERING', 'IMS reg'],
  ['OK', 'Working'],
]
const RANK = { STOPPED: -1, NO_CARD: 0, PIN_PROBLEM: 0, EPDG_UNRESOLVED: 1, TUNNEL_DOWN: 2, REGISTERING: 3, OK: 4 }

function Pipeline({ st }) {
  const rank = RANK[st?.state] ?? -1
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      {STEPS.map(([k, label], idx) => {
        const done = rank > idx
        const cur = rank === idx
        const bg = done ? 'var(--success)' : cur ? (st.state === 'OK' ? 'var(--success)' : 'var(--warning)') : 'var(--border-strong)'
        return (
          <div key={k} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ height: 5, borderRadius: 3, background: bg }} />
            <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 4 }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

// Build one row per PHYSICAL reader. Each reader has: {index, name, present, card, instance}.
// - present + matched instance  -> live line status
// - present + unprovisioned card -> provision prompt
// - no card                     -> empty state
// Provisioned lines whose reader is unplugged are NOT shown here — the dashboard
// reflects physical readers only (their config stays available under SIM Config, and
// the line reappears automatically when its reader/card returns).
function buildReaders(cards, instances) {
  return [...cards]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((c) => {
      let inst = null
      if (c.matched) inst = instances.find((i) => String(i.id) === String(c.matched))
      if (!inst && c.iccid) inst = instances.find((i) => i.iccid === c.iccid)
      return { index: c.index, name: c.name, present: !!c.present, card: c, instance: inst }
    })
}

function readerTitle(r) {
  const port = r.index != null ? `Reader ${r.index}` : 'Reader'
  // "Alcor Link AK9563 00 00" — keep the human name after the port label
  return r.name ? `${port} · ${r.name}` : port
}

const PIN_RE = /^\d{4,8}$/  // basic client-side validity: 4–8 digits, numeric only

// A detected-but-unprovisioned SIM. Two states:
//  - LOCKED (PIN required, IMSI not yet readable): show basic info + a PIN field, no Provision.
//    Entering a correct PIN unlocks IMSI+SMSC on the backend and the card refreshes.
//  - READY (PIN disabled, or unlocked): show identity + SMSC, offer Provision.
function UnprovisionedCard({ card, refresh, onProvision, onCopy }) {
  const [pinInput, setPinInput] = useState('')
  const [pin, setPin] = useState('')          // remembered correct PIN, forwarded to provisioning
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const unlocked = !!card.imsi                  // could read IMSI => PIN satisfied or disabled
  const pinOk = PIN_RE.test(pinInput)

  const unlock = async (e) => {
    e.stopPropagation()
    if (!pinOk) { setErr('PIN must be 4–8 digits.'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.verifyPin(pinInput, card.index, card.name)
      if (r.ok) { setPin(pinInput); await refresh() }   // card entry updates -> re-renders as READY
      else setErr(`${r.error}${r.tries != null ? ` — ${r.tries} tries left` : ''}`)
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  const row = (k, v, mono, opts) => (
    <Kv k={k} mono={mono} truncate={opts?.truncate !== false}
      title={opts?.title ?? (typeof v === 'string' ? v : undefined)} onCopy={onCopy}>{v}</Kv>
  )

  if (!unlocked) {
    // LOCKED
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <div className="kv-grid" style={{ marginTop: 14 }}>
          {row('ICCID', card.iccid || '—', true)}
          {row('Status', <span style={{ color: '#eab308' }}>🔒 SIM locked — PIN required</span>, false, { truncate: false })}
          {card.pin_tries != null && row('PIN tries', card.pin_tries)}
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--text-mute)' }}>Enter SIM PIN (CHV1)</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="password" inputMode="numeric" value={pinInput} maxLength={8}
              onChange={(e) => { setPinInput(e.target.value.replace(/[^0-9]/g, '')); setErr('') }}
              onKeyDown={(e) => { if (e.key === 'Enter' && pinOk) unlock(e) }}
              placeholder="4–8 digits" className="mono" style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !pinOk} onClick={unlock}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
          {pinInput && !pinOk && <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>PIN must be 4–8 digits.</div>}
          {err && <div style={{ fontSize: 12.5, color: '#ef4444', marginTop: 8 }}>{err}</div>}
        </div>
      </div>
    )
  }

  // READY (unlocked or PIN disabled)
  const smscMissing = !card.smsc
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="kv-grid" style={{ marginTop: 14 }}>
        {row('ICCID', card.iccid || '—', true)}
        {row('IMSI', card.imsi || '—', true)}
        {card.mcc && card.mnc && row('Carrier', `${card.mcc}-${card.mnc}`)}
        {row('SMSC', card.smsc
          ? <span>{card.smsc} <span style={{ color: 'var(--text-mute)' }}>· from SIM</span></span>
          : <span style={{ color: '#eab308' }}>⚠ could not read from SIM — enter manually when provisioning</span>,
          !!card.smsc, { truncate: false, title: card.smsc || undefined })}
        {row('PIN', card.pin_enabled === false ? 'disabled' : 'unlocked ✓')}
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 16, width: '100%' }}
        onClick={(e) => { e.stopPropagation(); onProvision(pin) }}>
        Provision this SIM{smscMissing ? ' (enter SMSC)' : ''}
      </button>
    </div>
  )
}

// A PIN prompt shown when starting a line whose card needs a PIN we don't have (deleted,
// or the saved one no longer verifies). Verifies + saves the PIN, then starts the line.
function StartPinModal({ inst, tries, error, onClose, onDone }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error || '')
  const ok = PIN_RE.test(pin)

  const submit = async () => {
    if (!ok) { setErr('PIN must be 4–8 digits.'); return }
    setBusy(true); setErr('')
    try {
      await api.start(inst.id, { pin })
      onDone && await onDone()
      onClose()
    } catch (e) {
      const code = e?.data?.detail?.code
      if (code === 'pin_invalid' || /PIN error/i.test(e.message)) {
        const t = e?.data?.detail?.tries
        setErr(`Wrong PIN${t != null ? ` — ${t} tries left` : ''}.`)
      } else if (code === 'no_card') setErr('SIM card is not present in the reader.')
      else setErr(e.message)
      setPin('')
    }
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}>
      <div className="card" style={{ padding: 24, width: 380, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Enter SIM PIN</h2>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
          {inst?.name || `Line ${inst?.id}`} needs its SIM PIN to start (no valid saved PIN).
          The PIN is verified against the card, saved, and used to bring the line up.
        </div>
        <input type="password" inputMode="numeric" className="mono" value={pin} maxLength={8} autoFocus
          onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, '')); setErr('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) submit() }}
          placeholder="4–8 digits" style={{ width: '100%' }} />
        {tries != null && !err && <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>{tries} tries left.</div>}
        {err && <div style={{ fontSize: 12.5, color: '#ef4444', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !ok} onClick={submit}>
            {busy ? 'Starting…' : 'Unlock & start'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ instances, cards = [], noReaders, cardsKnown, refresh, setSelected, setView, showToast }) {
  const [busy, setBusy] = useState(null)
  const [provision, setProvision] = useState(null)
  const [sipInfo, setSipInfo] = useState(null)
  const [pinPrompt, setPinPrompt] = useState(null)   // {inst, tries, error} when a start needs a PIN

  const copyField = (label, text) => {
    if (text == null) {
      showToast?.(`Could not copy ${label}`, 'err')
      return
    }
    showToast?.(`Copied ${label}`)
  }
  // A start/reprovision may be refused (409) because the card needs a PIN we don't have
  // (deleted, or the saved one is now wrong). Surface that as a PIN prompt instead of an
  // opaque error; anything else is shown as an alert.
  const pinError = (e) => {
    const code = e?.data?.detail?.code
    return (code === 'pin_required' || code === 'pin_invalid')
      ? { code, tries: e.data.detail.tries } : null
  }

  const act = async (id, fn) => {
    setBusy(id)
    try { await fn(); await refresh() }
    catch (e) {
      const pe = pinError(e)
      if (pe) setPinPrompt({ inst: instances.find((i) => String(i.id) === String(id)), tries: pe.tries,
                             error: pe.code === 'pin_invalid' ? 'Saved PIN was wrong — enter it again.' : '' })
      else alert(e.message)
    }
    setBusy(null)
  }

  const rows = buildReaders(cards, instances)

  // Nothing known yet (first /api/cards still in flight) — render nothing instead of
  // flashing a wrong "no readers" message.
  if (!cardsKnown && rows.length === 0) {
    return <div style={{ color: 'var(--text-mute)', fontSize: 13 }}>Detecting card readers…</div>
  }

  return (
    <div>
      {/* No PC/SC reader connected at all — friendly hint; the reader monitor updates
          this live, so the banner disappears the moment a reader is plugged in. */}
      {noReaders && (
        <div className="card" style={{ padding: '32px 28px', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36 }}>🔌</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>No PC/SC smart-card reader found</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 8, lineHeight: 1.6, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
            Connect a USB smart-card reader with your SIM inserted — it is detected automatically
            and this page updates in real time. Softphone, Messages and SIM Config are disabled
            until a reader is present.
          </div>
        </div>
      )}
      <div className="cards-fill">
        {!noReaders && rows.length === 0 && (
          <div className="card" style={{ padding: 24, color: 'var(--text-dim)' }}>
            No card readers detected. Plug in a PC/SC reader and insert a SIM.
          </div>
        )}
        {rows.map((r) => {
          const inst = r.instance
          const d = inst?.status?.detail || {}
          return (
            <div key={`rdr-${r.name || r.index}`} className="card" style={{ padding: 20 }}>

              {/* ---- Header: reader as the identity ---- */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, minWidth: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="truncate" style={{ fontSize: 15, fontWeight: 700 }} title={readerTitle(r)}>
                    {readerTitle(r)}
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}
                    title={inst ? (inst.name || `Line ${inst.id}`) : undefined}>
                    {inst ? (inst.name || `Line ${inst.id}`) : r.present ? 'Unprovisioned SIM' : 'Empty'}
                  </div>
                </div>
                {inst
                  ? <StateBadge st={inst.status} />
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap', color: r.present ? '#eab308' : 'var(--text-mute)' }}>
                      <span className={`dot st-${r.present ? 'REGISTERING' : 'NO_CARD'}`} />
                      {r.present ? 'SIM detected' : 'No SIM card'}
                    </span>}
              </div>

              {/* ---- Provisioned line: pipeline + reason + details ---- */}
              {inst && (
                <>
                  <Pipeline st={inst.status} />
                  {inst.status?.state !== 'OK' && inst.status?.state !== 'STOPPED' && inst.status?.reason && (
                    <div style={{
                      marginTop: 12, padding: '8px 11px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.4,
                      color: 'var(--text-soft)',
                      background: inst.status.state === 'ERROR' ? 'rgba(239,68,68,.12)' : 'rgba(234,179,8,.12)',
                      border: '1px solid ' + (inst.status.state === 'ERROR' ? 'rgba(239,68,68,.45)' : 'rgba(234,179,8,.4)'),
                    }}>
                      {inst.status.reason}
                      {inst.status.retry && inst.status.retry.count > 0 && inst.status.state !== 'ERROR' &&
                        <span style={{ color: 'var(--text-mute)' }}> · attempt {inst.status.retry.count}/{inst.status.retry.max}</span>}
                      {inst.status.state === 'ERROR' && setView &&
                        <span> · <a onClick={() => { setSelected(inst.id); setView('logs') }}
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}>view logs</a></span>}
                    </div>
                  )}
                  <div className="kv-grid">
                    <Kv k="Carrier" onCopy={copyField}>{`${inst.mcc}-${inst.mnc}`}</Kv>
                    <Kv k="Number" mono onCopy={copyField} title={d.msisdn || inst.msisdn || undefined}>{d.msisdn || inst.msisdn || '—'}</Kv>
                    <Kv k="IMSI" mono onCopy={copyField} title={inst.imsi || undefined}>{inst.imsi || '—'}</Kv>
                    <Kv k="ICCID" mono onCopy={copyField} title={r.card?.iccid || inst.iccid || undefined}>{r.card?.iccid || inst.iccid || '—'}</Kv>
                    <Kv k="SMSC" mono onCopy={copyField} title={d.smsc || inst.smsc || undefined}>{d.smsc || inst.smsc || '—'}</Kv>
                    <Kv k="P-CSCF" mono onCopy={copyField} title={d.pcscf || undefined}>{d.pcscf || '—'}</Kv>
                    <Kv k="IMS reg">{d.registration || '—'}</Kv>
                    <Kv k="PIN">{d.pin?.state || '—'}{d.pin?.tries_left != null ? ` (${d.pin.tries_left} tries)` : ''}</Kv>
                  </div>
                  <div className="card-actions">
                    {inst.status?.state === 'STOPPED' ? (
                      <button className="btn btn-primary btn-sm btn-span" disabled={busy === inst.id}
                        onClick={() => act(inst.id, () => api.start(inst.id))}>Start</button>
                    ) : inst.status?.state === 'ERROR' ? (
                      <button className="btn btn-primary btn-sm btn-span" disabled={busy === inst.id}
                        onClick={() => act(inst.id, () => api.reprovision(inst.id))}>Re-provision</button>
                    ) : (
                      <button className="btn btn-ghost btn-sm btn-span" disabled={busy === inst.id}
                        onClick={() => act(inst.id, () => api.stop(inst.id))}>Stop</button>
                    )}
                    {inst.status?.state !== 'STOPPED' && inst.status?.state !== 'ERROR' && (
                      <>
                        <button className="btn btn-ghost btn-sm" disabled={busy === inst.id}
                          onClick={() => act(inst.id, () => api.register(inst.id))}>Re-register</button>
                        <button className="btn btn-ghost btn-sm" disabled={busy === inst.id}
                          onClick={() => act(inst.id, () => api.reprovision(inst.id))}>Re-provision</button>
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setSipInfo(inst)}>SIP info</button>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { setSelected(inst.id); setView && setView('sims') }}>Configure</button>
                  </div>
                </>
              )}

              {/* ---- Unprovisioned card in this reader (PIN-gated flow) ---- */}
              {!inst && r.present && (
                <UnprovisionedCard card={r.card} refresh={refresh} onCopy={copyField}
                  onProvision={(pin) => setProvision({ card: r.card, pin })} />
              )}

              {/* ---- Empty reader ---- */}
              {!inst && !r.present && (
                <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-mute)' }}>
                  No SIM card inserted in this reader.
                </div>
              )}
            </div>
          )
        })}
      </div>
      {provision && <ProvisionModal card={provision.card} pin={provision.pin}
        onClose={() => setProvision(null)} onDone={refresh} />}
      {sipInfo && <SipInfoModal instance={sipInfo} onClose={() => setSipInfo(null)}
        setView={setView} setSelected={setSelected} />}
      {pinPrompt && <StartPinModal inst={pinPrompt.inst} tries={pinPrompt.tries} error={pinPrompt.error}
        onClose={() => setPinPrompt(null)} onDone={refresh} />}
    </div>
  )
}
