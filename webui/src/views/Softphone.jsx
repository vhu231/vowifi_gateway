import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'
import SimSelector from './SimSelector.jsx'
import { useSoftphone, GREEN, RED } from '../components/SoftphoneProvider.jsx'
import Icon from '../components/Icon.jsx'
import { ErrorState } from '../components/Field.jsx'

const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'],
  ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']]

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Avatar({ color = 'var(--primary)', size = 96 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `2px solid color-mix(in srgb, ${color} 40%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, color, margin: '0 auto',
    }} aria-hidden><Icon name="phone" size={size * 0.4} /></div>
  )
}

function RoundBtn({ icon, label, color, bg, onClick, active }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button type="button" className="round-action" onClick={onClick} aria-label={label} aria-pressed={!!active} style={{
        width: 58, height: 58, borderRadius: '50%', cursor: 'pointer', fontSize: 22,
        border: '1px solid ' + (active ? color : 'var(--border-strong)'),
        background: bg || (active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'var(--hover)'),
        color: active ? color : 'var(--text-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{typeof icon === 'string' ? icon : icon}</button>
      <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>{label}</span>
    </div>
  )
}

export default function Softphone({ selected, subscribe, instances, cards, setSelected, showToast }) {
  const id = selected?.id
  const sp = useSoftphone()
  const [num, setNum] = useState('')
  const [calls, setCalls] = useState([])
  const [callSelMode, setCallSelMode] = useState(false)
  const [callSel, setCallSel] = useState(() => new Set())
  const [loadErr, setLoadErr] = useState(null)
  const [mobilePane, setMobilePane] = useState('phone') // phone | history

  const { prov, reg, call, dur, muted, keypad, dtmfSeq, recording, actions } = sp || {}

  const loadCalls = useCallback(() => {
    if (id == null || id === '') return
    api.calls(id).then((r) => { setCalls(r.calls || []); setLoadErr(null) })
      .catch((e) => setLoadErr(e.message))
  }, [id])

  useEffect(() => { loadCalls() }, [loadCalls])
  useEffect(() => { setCallSelMode(false); setCallSel(new Set()) }, [id])
  useEffect(() => { if (!calls.length) { setCallSelMode(false); setCallSel(new Set()) } }, [calls.length])
  useEffect(() => subscribe && subscribe((m) => {
    // Coerce ids: API/YAML may use numbers; WS/notify always send strings.
    if (m.type === 'call' && String(m.instance) === String(id)) loadCalls()
  }), [subscribe, id, loadCalls])
  // Softphone call UI ends before / independently of the engine notify path — refresh
  // history when a local call settles so Recent calls updates even if a WS type-mismatch
  // or a brief notify glitch delayed the broadcast.
  useEffect(() => {
    if (call?.state === 'ended') loadCalls()
  }, [call?.state, loadCalls])

  const toast = (m) => (showToast ? showToast(m) : null)
  const toggleCallSel = (cid) => setCallSel((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n })
  const reloadIfSame = (forId) => { if (forId === id) loadCalls() }

  const deleteSelectedCalls = async () => {
    if (!callSel.size) return
    if (!confirm(`Delete ${callSel.size} selected call${callSel.size > 1 ? 's' : ''}?`)) return
    const forId = id
    try {
      await api.deleteCalls(forId, { ids: [...callSel] })
      setCallSelMode(false); setCallSel(new Set()); reloadIfSame(forId); toast('Calls deleted')
    } catch (e) { toast('Delete failed: ' + e.message) }
  }
  const deleteOneCall = async (cid, e) => {
    if (e) e.stopPropagation()
    const forId = id
    try { await api.deleteCalls(forId, { ids: [cid] }); reloadIfSame(forId) } catch (e2) { toast('Delete failed: ' + e2.message) }
  }
  const clearAllCalls = async () => {
    if (!calls.length) return
    if (!confirm('Clear the entire call history for this line?')) return
    const forId = id
    try {
      await api.deleteCalls(forId, { all: true })
      setCallSelMode(false); setCallSel(new Set()); reloadIfSame(forId); toast('Call history cleared')
    } catch (e) { toast('Delete failed: ' + e.message) }
  }

  const dialKey = (k) => {
    if (call?.state === 'active') actions?.pressDTMF(k)
    else setNum((n) => n + k)
  }

  if (!id) return (
    <div>
      <SimSelector instances={instances} cards={cards} selected={selected} setSelected={setSelected} />
      <div style={{ color: 'var(--text-dim)' }}>Select a SIM / line to use the softphone.</div>
    </div>
  )

  if (!sp) return <div style={{ color: 'var(--text-dim)' }}>Softphone unavailable.</div>

  const regColor = reg === 'registered' ? GREEN : reg === 'failed' || reg === 'disconnected' ? RED : 'var(--warning)'
  const inCall = call && (call.state === 'active' || call.state === 'calling' || call.state === 'ringing' || call.state === 'incoming' || call.state === 'ended')
  const endLabel = (c) => (c === 'Rejected' ? 'Call declined' : c === 'Busy' ? 'Busy' : c === 'Canceled' || c === 'Canceled/Rejected' ? 'Call cancelled' : 'Call ended')

  return (
    <div className="softphone-page" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0 }}>
        <SimSelector instances={instances} cards={cards} selected={selected} setSelected={setSelected} />
      </div>

      <div className="mobile-softphone-tabs" style={{ display: 'none', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
        <button type="button" className={`btn btn-sm ${mobilePane === 'phone' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMobilePane('phone')}>Phone</button>
        <button type="button" className={`btn btn-sm ${mobilePane === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMobilePane('history')}>Recent</button>
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: regColor, minWidth: 0,
        }} title={reg}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: regColor, flexShrink: 0 }} aria-hidden />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reg}</span>
        </div>
      </div>

      <div className={`split-pane softphone ${mobilePane === 'history' ? 'is-detail' : 'is-list'}`}
        data-mobile-pane={mobilePane}>
        <div className="card pane-list" style={{ padding: 24, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="softphone-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Softphone</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: regColor }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: regColor }} aria-hidden />
              <span>{reg}</span>
            </div>
          </div>

          {!prov?.enabled && (
            <div style={{ color: 'var(--warning)', fontSize: 13, margin: '12px 0' }} role="status">
              WebRTC is disabled for this SIM. Enable it in SIM Config (needs HTTPS/TLS) to use the browser phone.
            </div>
          )}

          {(call?.state === 'calling' || call?.state === 'ringing') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 16 }}>
              <Avatar />
              <div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{call.number}</div>
                <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 4 }}>{call.state === 'ringing' ? 'Ringing…' : 'Calling…'}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                <RoundBtn icon={<Icon name="decline" />} label="End" color="#fff" bg={RED} onClick={actions.hangup} />
              </div>
            </div>
          )}

          {call?.state === 'active' && (
            <div style={{
              flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column',
              justifyContent: keypad ? 'flex-start' : 'center', textAlign: 'center', gap: 12, paddingBottom: 8,
            }}>
              {!keypad && <Avatar color={GREEN} size={84} />}
              <div style={{ flexShrink: 0 }}>
                <div className="mono" style={{
                  fontSize: keypad ? 16 : 20, fontWeight: 700, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                }}>{call.number || 'Unknown'}</div>
                <div style={{ fontSize: 15, color: GREEN, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(dur)}</div>
                {recording && <div style={{ fontSize: 12, color: RED, marginTop: 2 }}>● Recording</div>}
              </div>
              {keypad && (
                <div style={{ width: '100%', maxWidth: 240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                  <div className="mono" style={{
                    minHeight: 40, padding: '8px 12px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    fontSize: 20, letterSpacing: 2, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                    direction: 'rtl', color: dtmfSeq ? 'var(--text)' : 'var(--text-mute)',
                  }}>
                    {dtmfSeq || 'Type or tap keys'}
                  </div>
                  <div className="dtmf-pad">
                    {KEYS.map(([k]) => (
                      <button key={k} type="button" className="dial-key"
                        onClick={() => actions.pressDTMF(k)}>{k}</button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 4, flexShrink: 0 }}>
                <RoundBtn icon={<Icon name={muted ? 'mute' : 'mic'} />} label={muted ? 'Unmute' : 'Mute'} color="#60a5fa" onClick={actions.toggleMute} active={muted} />
                <RoundBtn icon={<Icon name="keypad" />} label="Keypad" color="#a78bfa" onClick={actions.toggleKeypad} active={keypad} />
                <RoundBtn icon={<Icon name="record" />} label={recording ? 'Stop' : 'Record'} color={RED} onClick={actions.toggleRecord} active={recording} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2, flexShrink: 0 }}>
                <RoundBtn icon={<Icon name="decline" />} label="Hang up" color="#fff" bg={RED} onClick={actions.hangup} />
              </div>
            </div>
          )}

          {call?.state === 'ended' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
              <Avatar color={call.endCause === 'Rejected' ? RED : 'var(--text-mute)'} />
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{call.number || 'Unknown'}</div>
              <div style={{ fontSize: 14, color: call.endCause === 'Rejected' ? RED : 'var(--text-mute)' }}>{endLabel(call.endCause)}</div>
            </div>
          )}

          {call?.state === 'incoming' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', color: 'var(--text-mute)' }}>
              Incoming call handled by the global overlay…
            </div>
          )}

          {!inCall && (
            <div className="softphone-idle" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Enter a number"
                aria-label="Phone number"
                className="mono softphone-num" style={{
                  fontSize: 24, textAlign: 'center', margin: '10px 0 16px', letterSpacing: 1,
                  border: 'none', background: 'transparent', boxShadow: 'none', minHeight: 48,
                }} />
              <div className="dial-pad">
                {KEYS.map(([k, sub]) => (
                  <button key={k} type="button" className="dial-key" onClick={() => dialKey(k)} style={{
                    padding: '8px 0', borderRadius: 12, cursor: 'pointer', background: 'var(--hover)',
                    border: '1px solid var(--border)', color: 'var(--text)', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{k}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-mute)', letterSpacing: 1, height: 12, lineHeight: '12px' }}>{sub || '\u00a0'}</span>
                  </button>
                ))}
              </div>
              <div className="softphone-actions" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24, marginTop: 16, flexShrink: 0 }}>
                <div style={{ width: 58 }} />
                <button type="button" className="call-fab" onClick={() => { actions.placeCall(num); setNum('') }}
                  disabled={reg !== 'registered' || !num} aria-label="Place call"
                  style={{
                    width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: (reg === 'registered' && num) ? GREEN : 'var(--border-strong)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icon name="answer" size={26} /></button>
                <button type="button" className="icon-action" onClick={() => setNum((n) => n.slice(0, -1))} aria-label="Backspace" style={{
                  width: 58, height: 58, borderRadius: '50%', border: 'none', background: 'transparent',
                  color: 'var(--text-mute)', cursor: 'pointer', fontSize: 22, visibility: num ? 'visible' : 'hidden',
                }}>⌫</button>
              </div>
            </div>
          )}
        </div>

        <div className="card pane-detail" style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Recent calls</div>
            {calls.length > 0 && (
              callSelMode ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>{callSel.size} selected</span>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-ghost" disabled={!callSel.size} onClick={deleteSelectedCalls}>Delete</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCallSelMode(false); setCallSel(new Set()) }}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCallSelMode(true)}>Select</button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-ghost" onClick={clearAllCalls}>Clear all</button>
                </div>
              )
            )}
          </div>
          {loadErr && <ErrorState title="Could not load call history" onRetry={loadCalls}>{loadErr}</ErrorState>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflow: 'auto' }}>
            {calls.length === 0 && !loadErr && <div style={{ fontSize: 13, color: 'var(--text-mute)' }}>No calls yet.</div>}
            {calls.map((c) => {
              const s = (c.status || '').toLowerCase()
              const color = s === 'answered' ? GREEN : (s === 'rejected' || s === 'busy' || s === 'failed') ? RED
                : (s === 'no answer' || s === 'cancelled' || s === 'missed') ? 'var(--warning)' : 'var(--text-dim)'
              const dlabel = c.direction === 'in' ? '↙ Incoming' : '↗ Outgoing'
              const peer = (c.peer || '').trim()
              const peerLabel = peer || 'Private number'
              const checked = callSel.has(c.id)
              const when = c.start_ts ? new Date(Number(c.start_ts) * 1000).toLocaleString() : ''
              return (
                <div key={c.id} className="hover-row"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    fontSize: 13.5, padding: '10px 12px', borderRadius: 10,
                    background: checked ? 'var(--active)' : 'var(--input-bg)',
                  }}>
                  {callSelMode && (
                    <input type="checkbox" checked={checked} aria-label={`Select call with ${peerLabel}`}
                      onChange={() => toggleCallSel(c.id)} style={{ width: 'auto', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontWeight: 600, color: peer ? undefined : 'var(--text-mute)' }}>{peerLabel}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{dlabel}{when ? ` · ${when}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{c.status || 'ringing'}</span>
                    {!callSelMode && <>
                      <button type="button" className="btn btn-ghost btn-sm"
                        disabled={reg !== 'registered' || !peer}
                        onClick={() => actions.callPeer(peer)}>Call</button>
                      <button type="button" className="row-del" title="Delete this call" aria-label="Delete this call"
                        onClick={(e) => deleteOneCall(c.id, e)}><Icon name="trash" size={16} /></button>
                    </>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <style>{`
        @media (max-width: 860px) {
          .mobile-softphone-tabs { display: flex !important; }
          .split-pane.softphone[data-mobile-pane="phone"] .pane-detail { display: none !important; }
          .split-pane.softphone[data-mobile-pane="history"] .pane-list { display: none !important; }
          .split-pane.softphone[data-mobile-pane="history"] .pane-detail { display: flex !important; }
          .split-pane.softphone[data-mobile-pane="phone"] .pane-list { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
