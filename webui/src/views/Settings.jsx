import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import PushInfoModal from './PushInfoModal.jsx'

export default function Settings({ auth, onAuthChange }) {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  const [loadErr, setLoadErr] = useState(null)
  const [info, setInfo] = useState('')   // '' | 'webhook' | 'telegram'
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const load = () => {
    setLoadErr(null)
    api.settings().then(setS).catch((e) => setLoadErr(e.message || 'Failed to load settings'))
  }
  useEffect(() => { load() }, [])
  if (loadErr && !s) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ color: 'var(--danger)', marginBottom: 12 }} role="alert">{loadErr}</div>
        <button type="button" className="btn btn-primary" onClick={load}>Retry</button>
      </div>
    )
  }
  if (!s) return <div style={{ color: 'var(--text-dim)' }} role="status">Loading…</div>

  const upd = (patch) => setS((x) => ({ ...x, ...patch }))
  const updTls = (patch) => setS((x) => ({ ...x, tls: { ...x.tls, ...patch } }))
  const updDebug = (patch) => setS((x) => ({ ...x, debug: { ...x.debug, ...patch } }))
  const wh = s.webhook || { enabled: false, url: '', events: {} }
  const tg = s.telegram || { enabled: false, bot_token: '', chat_id: '', events: {} }
  const updWh = (patch) => setS((x) => ({ ...x, webhook: { ...wh, ...patch } }))
  const updWhEv = (k, v) => setS((x) => ({ ...x, webhook: { ...wh, events: { ...(wh.events || {}), [k]: v } } }))
  const updTg = (patch) => setS((x) => ({ ...x, telegram: { ...tg, ...patch } }))
  const updTgEv = (k, v) => setS((x) => ({ ...x, telegram: { ...tg, events: { ...(tg.events || {}), [k]: v } } }))

  const authInfo = s.auth || auth || { enabled: false, managed_by_env: false }
  const pwEnabled = !!authInfo.enabled
  const pwEnv = !!authInfo.managed_by_env

  const save = async () => {
    try {
      const next = await api.saveSettings(s)
      setS(next)
      setMsg('Saved. Restart the control surface for TLS/port changes, and re-provision a line for ring-timeout changes, to take effect.')
    } catch (e) {
      setMsg('Error: ' + e.message)
    }
  }

  const applyPassword = async ({ clear = false } = {}) => {
    if (pwBusy || pwEnv) return
    setPwBusy(true)
    setPwMsg('')
    try {
      if (!clear) {
        if (!pwNew.trim()) {
          setPwMsg('Error: Enter a new password.')
          return
        }
        if (pwNew !== pwConfirm) {
          setPwMsg('Error: New password and confirmation do not match.')
          return
        }
      }
      if (pwEnabled && !pwCurrent) {
        setPwMsg('Error: Enter the current password.')
        return
      }
      const body = clear
        ? { clear: true, current_password: pwCurrent }
        : { password: pwNew, current_password: pwCurrent }
      const r = await api.setPassword(body)
      setPwCurrent('')
      setPwNew('')
      setPwConfirm('')
      setPwMsg(clear
        ? 'Password cleared — WebUI is open without login.'
        : 'Password saved. Other devices were signed out.')
      const nextAuth = {
        enabled: !!r.enabled,
        authenticated: true,
        managed_by_env: !!r.managed_by_env,
      }
      onAuthChange?.(nextAuth)
      setS((x) => ({ ...x, auth: { enabled: nextAuth.enabled, managed_by_env: nextAuth.managed_by_env } }))
    } catch (e) {
      setPwMsg('Error: ' + (e.message || 'Failed'))
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Web access</h3>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
          Optional single password for the WebUI, REST API, and live WebSocket.
          Leave unset for open access (default). Sessions last 30 days; changing or clearing
          the password signs out every device immediately. Sign-out on one device only clears
          that device.
        </div>
        {pwEnv ? (
          <div style={{ fontSize: 13, color: 'var(--warning)' }} role="status">
            Password is managed by the <code>VOWIFI_WEB_PASSWORD</code> environment variable.
            Clear or change that env and restart the control plane to manage it here.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Status:{' '}
              <b style={{ color: pwEnabled ? 'var(--success)' : 'var(--text-mute)' }}>
                {pwEnabled ? 'Password enabled' : 'No password (open access)'}
              </b>
            </div>
            {pwEnabled && (
              <div style={{ marginBottom: 10 }}>
                <label htmlFor="web_pw_current">Current password</label>
                <input id="web_pw_current" type="password" autoComplete="current-password"
                  value={pwCurrent} disabled={pwBusy}
                  onChange={(e) => setPwCurrent(e.target.value)} />
              </div>
            )}
            <div className="form-grid">
              <div>
                <label htmlFor="web_pw_new">{pwEnabled ? 'New password' : 'Password'}</label>
                <input id="web_pw_new" type="password" autoComplete="new-password"
                  value={pwNew} disabled={pwBusy}
                  onChange={(e) => setPwNew(e.target.value)} />
              </div>
              <div>
                <label htmlFor="web_pw_confirm">Confirm</label>
                <input id="web_pw_confirm" type="password" autoComplete="new-password"
                  value={pwConfirm} disabled={pwBusy}
                  onChange={(e) => setPwConfirm(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={pwBusy}
                onClick={() => applyPassword({ clear: false })}>
                {pwEnabled ? 'Change password' : 'Set password'}
              </button>
              {pwEnabled && (
                <button type="button" className="btn btn-ghost" disabled={pwBusy}
                  onClick={() => applyPassword({ clear: true })}>
                  Clear password
                </button>
              )}
            </div>
            {pwMsg && (
              <div style={{
                marginTop: 10, fontSize: 13,
                color: pwMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)',
              }} role="status">{pwMsg}</div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Control surface (WebUI)</h3>
        <div className="form-grid">
          <div><label htmlFor="bind">Bind address</label><input id="bind" value={s.bind || ''} onChange={(e) => upd({ bind: e.target.value })} /></div>
          <div><label htmlFor="http_port">HTTPS port</label><input id="http_port" type="number" value={s.http_port || 8443} onChange={(e) => upd({ http_port: +e.target.value })} /></div>
        </div>
        <h4>TLS</h4>
        <label><input type="checkbox" checked={!!s.tls.self_signed} onChange={(e) => updTls({ self_signed: e.target.checked })} />Use self-signed certificate</label>
        <div className="form-grid" style={{ marginTop: 10, opacity: s.tls.self_signed ? .5 : 1 }}>
          <div><label htmlFor="tls_domain">Domain</label><input id="tls_domain" value={s.tls.domain || ''} onChange={(e) => updTls({ domain: e.target.value })} placeholder="gw.example.com" /></div>
          <div />
          <div><label htmlFor="tls_cert">Cert path</label><input id="tls_cert" className="mono" value={s.tls.cert_path || ''} onChange={(e) => updTls({ cert_path: e.target.value })} placeholder="/path/fullchain.pem" /></div>
          <div><label htmlFor="tls_key">Key path</label><input id="tls_key" className="mono" value={s.tls.key_path || ''} onChange={(e) => updTls({ key_path: e.target.value })} placeholder="/path/privkey.pem" /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Engine / debug defaults</h3>
        <label><input type="checkbox" checked={!!s.debug?.asterisk} onChange={(e) => updDebug({ asterisk: e.target.checked })} />Asterisk verbose/debug logging</label>
        <label style={{ marginTop: 8 }}><input type="checkbox" checked={!!s.debug?.charon} onChange={(e) => updDebug({ charon: e.target.checked })} />SWu tunnel (IKE) high logging</label>
        <label style={{ marginTop: 8 }}><input type="checkbox" checked={!!s.debug?.pcap} onChange={(e) => updDebug({ pcap: e.target.checked })} />Capture ESP/SIP pcap</label>
        <div style={{ marginTop: 14 }}><label>Manager URL (for engine event callbacks; auto if blank)</label>
          <input className="mono" value={s.manager_url || ''} onChange={(e) => upd({ manager_url: e.target.value })} placeholder="auto (e.g. https://gateway-host:8443)" /></div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Auto-retry</h3>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
          If the VoWiFi tunnel or IMS registration drops while the SIM is still present, the line
          auto-retries. After the retry budget is exhausted it stops and shows the failure reason.
          With network auto-recover enabled, a network/DNS freeze will re-provision the line once
          connectivity returns (SIM-auth and other permanent faults still stay stopped).
        </div>
        <div className="form-grid">
          <div><label htmlFor="retry_max">Max retries</label><input id="retry_max" type="number" min="1" value={s.retry?.max ?? 3}
            onChange={(e) => upd({ retry: { ...(s.retry || {}), max: +e.target.value } })} /></div>
          <div><label htmlFor="retry_interval">Seconds per attempt</label><input id="retry_interval" type="number" min="5" value={s.retry?.interval ?? 40}
            onChange={(e) => upd({ retry: { ...(s.retry || {}), interval: +e.target.value } })} /></div>
        </div>
        <label style={{ marginTop: 12 }}>
          <input type="checkbox"
            checked={s.retry?.auto_recover !== false}
            onChange={(e) => upd({ retry: { ...(s.retry || {}), auto_recover: e.target.checked } })} />
          Auto re-provision when network recovers
        </label>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Calls</h3>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
          How long an outgoing call rings before the gateway gives up and cancels it. Most
          carriers roll an unanswered call to voicemail by ~30s. A shorter value also reduces
          how many times the callee is re-alerted when they don&apos;t answer. Applies to new calls
          after the line is re-provisioned/restarted.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label>Ring timeout (seconds)</label><input type="number" min="5" max="180" value={s.ring_timeout ?? 35}
            onChange={(e) => upd({ ring_timeout: +e.target.value })} /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Tunnel</h3>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
          How often the gateway proactively rekeys the IPsec (ESP) security association with the
          carrier&apos;s ePDG. IKEv2 does not put a lifetime on the wire, so this is a local policy: the
          SA is refreshed (seamless make-before-break) before it silently ages out and the carrier
          stops accepting traffic. <b>0 disables</b> proactive rekey (the SA is only refreshed if
          the carrier initiates it). Applies after the line is re-provisioned/restarted.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label>SA rekey interval (minutes, 0 = off)</label>
            <input type="number" min="0" max="1440" value={s.rekey?.minutes ?? 30}
              onChange={(e) => upd({ rekey: { ...(s.rekey || {}), minutes: +e.target.value } })} /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Webhook push</h3>
          <button className="btn btn-ghost btn-sm"
            title="Payload format & notes" onClick={() => setInfo('webhook')}>ⓘ Format</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0 12px' }}>
          POST a JSON body to your URL when an incoming SMS or call arrives. Click <b>ⓘ Format</b> for
          the exact payload.
        </div>
        <label><input type="checkbox" checked={!!wh.enabled}
          onChange={(e) => updWh({ enabled: e.target.checked })} />Enable webhook push</label>
        <div style={{ marginTop: 12, opacity: wh.enabled ? 1 : .5 }}>
          <label>Webhook URL</label>
          <input className="mono" value={wh.url || ''} disabled={!wh.enabled}
            onChange={(e) => updWh({ url: e.target.value })} placeholder="https://example.com/hook" />
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-mute)' }}>Events to push</div>
          <div className="choice-row" style={{ marginTop: 6 }}>
            <label><input type="checkbox" disabled={!wh.enabled}
              checked={wh.events?.incoming_call !== false} onChange={(e) => updWhEv('incoming_call', e.target.checked)} />Incoming call</label>
            <label><input type="checkbox" disabled={!wh.enabled}
              checked={wh.events?.incoming_sms !== false} onChange={(e) => updWhEv('incoming_sms', e.target.checked)} />Incoming SMS</label>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Telegram push</h3>
          <button className="btn btn-ghost btn-sm"
            title="Message format & setup" onClick={() => setInfo('telegram')}>ⓘ Format</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0 12px' }}>
          Send incoming SMS/calls to a Telegram chat or channel via a bot. Click <b>ⓘ Format</b> for
          setup and the message layout.
        </div>
        <label><input type="checkbox" checked={!!tg.enabled}
          onChange={(e) => updTg({ enabled: e.target.checked })} />Enable Telegram push</label>
        <div style={{ marginTop: 12, opacity: tg.enabled ? 1 : .5 }}>
          <div className="form-grid">
            <div><label htmlFor="tg_token">Bot token</label>
              <input id="tg_token" className="mono" value={tg.bot_token || ''} disabled={!tg.enabled}
                onChange={(e) => updTg({ bot_token: e.target.value })} placeholder="123456:ABC-DEF..." /></div>
            <div><label htmlFor="tg_chat">Chat / Channel ID</label>
              <input id="tg_chat" className="mono" value={tg.chat_id || ''} disabled={!tg.enabled}
                onChange={(e) => updTg({ chat_id: e.target.value })} placeholder="-1001234567890 or 12345678" /></div>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-mute)' }}>Events to push</div>
          <div className="choice-row" style={{ marginTop: 6 }}>
            <label><input type="checkbox" disabled={!tg.enabled}
              checked={tg.events?.incoming_call !== false} onChange={(e) => updTgEv('incoming_call', e.target.checked)} />Incoming call</label>
            <label><input type="checkbox" disabled={!tg.enabled}
              checked={tg.events?.incoming_sms !== false} onChange={(e) => updTgEv('incoming_sms', e.target.checked)} />Incoming SMS</label>
          </div>
        </div>
      </div>

      <div>
        <button className="btn btn-primary" onClick={save}>Save settings</button>
        {msg && <span style={{ marginLeft: 12, color: msg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontSize: 13 }} role="status">{msg}</span>}
      </div>
      {info && <PushInfoModal channel={info} onClose={() => setInfo('')} />}
    </div>
  )
}
