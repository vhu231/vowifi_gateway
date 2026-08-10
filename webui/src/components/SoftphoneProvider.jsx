import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { api } from '../api.js'
import Dialog from './Dialog.jsx'
import Icon from './Icon.jsx'

const SoftphoneCtx = createContext(null)

const GREEN = 'var(--success)'
const RED = 'var(--danger)'

export function SoftphoneProvider({ selected, setView, children }) {
  const id = selected?.id
  const [prov, setProv] = useState(null)
  const [reg, setReg] = useState('idle')
  const [call, setCall] = useState(null)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [keypad, setKeypad] = useState(false)
  const [dtmfSeq, setDtmfSeq] = useState('')
  const [recording, setRecording] = useState(false)
  const phone = useRef(null)
  const audioRef = useRef(null)
  const SoftphoneClass = useRef(null)

  const clearCallSoon = useCallback((endCause) => {
    setCall((c) => (c ? { ...c, state: 'ended', endCause } : null))
    setKeypad(false); setMuted(false); setRecording(false)
    setTimeout(() => setCall(null), 2500)
  }, [])

  // Load Softphone class lazily (pulls JsSIP chunk only when a line is selected).
  useEffect(() => {
    let alive = true
    if (!id) return undefined
    import('../softphone.js').then((m) => {
      if (alive) SoftphoneClass.current = m.Softphone
    }).catch(() => {})
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    if (!id) {
      setProv(null); setReg('idle'); setCall(null)
      if (phone.current) { phone.current.stop(); phone.current = null }
      return undefined
    }
    let alive = true
    setReg('idle'); setCall(null)
    api.softphone(id).then((p) => { if (alive) setProv(p) }).catch(() => { if (alive) setProv(null) })
    return () => {
      alive = false
      if (phone.current) { phone.current.stop(); phone.current = null }
    }
  }, [id])

  const connect = useCallback(() => {
    if (!prov?.enabled || phone.current || !SoftphoneClass.current) return
    const Phone = SoftphoneClass.current
    const ph = new Phone((type, data) => {
      if (type === 'registered') setReg(data ? 'registered' : 'unregistered')
      else if (type === 'ws') setReg((r) => (data === 'connected' ? (r === 'registered' ? r : 'connecting') : 'disconnected'))
      else if (type === 'regfail') setReg('failed')
      else if (type === 'incoming') setCall({ dir: 'in', number: data.from || 'Unknown', state: 'incoming' })
      else if (type === 'calling') setCall({ dir: 'out', number: data.to, state: 'calling' })
      else if (type === 'progress') setCall((c) => (c && c.dir === 'out' && (c.state === 'calling' || c.state === 'ringing') ? { ...c, state: 'ringing' } : c))
      else if (type === 'active') setCall((c) => (c ? { ...c, state: 'active', startedAt: Date.now() } : c))
      else if (type === 'ended') clearCallSoon(data && data.cause)
      else if (type === 'failed') clearCallSoon(data && data.cause)
    }, audioRef.current)
    ph.start(prov, prov.host || location.hostname)
    phone.current = ph
    setReg('connecting')
  }, [prov, clearCallSoon])

  useEffect(() => {
    if (prov?.enabled && SoftphoneClass.current && !phone.current) connect()
    // Re-try connect once class finishes loading
    if (prov?.enabled && !SoftphoneClass.current) {
      const t = setInterval(() => {
        if (SoftphoneClass.current && !phone.current) { connect(); clearInterval(t) }
      }, 200)
      return () => clearInterval(t)
    }
    return undefined
  }, [prov, connect])

  useEffect(() => {
    if (phone.current && audioRef.current) phone.current.setAudioEl(audioRef.current)
  })

  useEffect(() => {
    if (call?.state !== 'active' || !call.startedAt) { setDur(0); return undefined }
    const t = setInterval(() => setDur(Math.floor((Date.now() - call.startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [call?.state, call?.startedAt])

  useEffect(() => {
    if (!(keypad && call?.state === 'active')) return undefined
    setDtmfSeq('')
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      if (/^[0-9*#]$/.test(k)) {
        e.preventDefault()
        phone.current?.sendDTMF(k)
        setDtmfSeq((s) => (s + k).slice(-32))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keypad, call?.state])

  useEffect(() => {
    if (!call || call.state === 'active' || call.state === 'ended') return undefined
    const ms = call.state === 'incoming' ? 60000 : 65000
    const t = setTimeout(() => {
      try { phone.current?.hangup() } catch {}
      setCall(null); setKeypad(false); setMuted(false); setRecording(false)
    }, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when call.state changes
  }, [call?.state])

  const actions = useMemo(() => ({
    dialKey: (k) => {
      if (call?.state === 'active') { phone.current?.sendDTMF(k); }
      else { /* dialer number owned by Softphone view */ }
    },
    pressDTMF: (k) => { phone.current?.sendDTMF(k); setDtmfSeq((s) => (s + k).slice(-32)) },
    placeCall: (num) => {
      if (phone.current && num) { phone.current.unlockAudio(); phone.current.call(num) }
    },
    answer: () => { phone.current?.unlockAudio(); phone.current?.answer() },
    hangup: () => {
      phone.current?.hangup()
      setCall((c) => (c && c.state !== 'ended' ? { ...c, state: 'ended', endCause: c.endCause } : c))
      setKeypad(false); setMuted(false); setRecording(false)
      setTimeout(() => setCall((c) => (c && c.state === 'ended' ? null : c)), 2500)
    },
    decline: () => {
      phone.current?.reject()
      setCall((c) => (c && c.state !== 'ended' ? { ...c, state: 'ended', endCause: 'Rejected' } : c))
      setKeypad(false); setMuted(false); setRecording(false)
      setTimeout(() => setCall((c) => (c && c.state === 'ended' ? null : c)), 2500)
    },
    toggleMute: () => {
      setMuted((m) => {
        const next = !m
        phone.current?.setMuted(next)
        return next
      })
    },
    toggleKeypad: () => setKeypad((v) => !v),
    toggleRecord: async () => {
      if (!phone.current) return
      if (recording) {
        const blob = await phone.current.stopRecording(); setRecording(false)
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `call-${call?.number || 'rec'}-${Date.now()}.webm`; a.click()
          setTimeout(() => URL.revokeObjectURL(url), 10000)
        }
      } else {
        const ok = await phone.current.startRecording(); setRecording(ok)
      }
    },
    unlockAudio: () => phone.current?.unlockAudio(),
    callPeer: (peer) => { phone.current?.unlockAudio(); phone.current?.call(peer) },
  }), [call, recording])

  const value = {
    id, prov, reg, call, dur, muted, keypad, dtmfSeq, recording, actions, phone,
  }

  const incoming = call?.state === 'incoming'

  return (
    <SoftphoneCtx.Provider value={value}>
      <audio
        autoPlay
        style={{ display: 'none' }}
        ref={(el) => {
          audioRef.current = el
          if (el) el.setAttribute('playsinline', '')
        }}
      />
      {children}
      <Dialog
        open={!!incoming}
        title="Incoming call"
        onClose={() => {}}
        dismissible={false}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', letterSpacing: 1, textTransform: 'uppercase' }}>Incoming call</div>
          <div style={{
            width: 96, height: 96, borderRadius: '50%', margin: '22px auto',
            background: 'color-mix(in srgb, var(--success) 14%, transparent)',
            border: '2px solid color-mix(in srgb, var(--success) 40%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: GREEN, fontSize: 36,
          }} aria-hidden><Icon name="phone" size={40} /></div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 800 }}>{call?.number || 'Unknown'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 6 }}>{selected?.name || 'VoWiFi line'}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 48, marginTop: 28 }}>
            <button type="button" className="btn" aria-label="Decline"
              onClick={actions.decline}
              style={{ width: 68, height: 68, borderRadius: '50%', border: 'none', background: RED, color: '#fff' }}>
              <Icon name="decline" size={26} />
            </button>
            <button type="button" className="btn" aria-label="Answer"
              onClick={() => { actions.answer(); setView?.('softphone') }}
              style={{
                width: 68, height: 68, borderRadius: '50%', border: 'none', background: GREEN, color: '#fff',
                animation: 'ringpulse 1.4s infinite',
              }}>
              <Icon name="answer" size={26} />
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 56, marginTop: 8, fontSize: 13, color: 'var(--text-soft)' }}>
            <span>Decline</span><span>Answer</span>
          </div>
        </div>
      </Dialog>
    </SoftphoneCtx.Provider>
  )
}

export function useSoftphone() {
  return useContext(SoftphoneCtx)
}

export { GREEN, RED }
