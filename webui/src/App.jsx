import React, { useEffect, useState, useCallback, useRef } from 'react'
import { api, connectWs, setAuthRequiredHandler } from './api.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Icon from './components/Icon.jsx'
import { SoftphoneProvider } from './components/SoftphoneProvider.jsx'
import Dashboard from './views/Dashboard.jsx'
import Softphone from './views/Softphone.jsx'
import Messages from './views/Messages.jsx'
import SimConfig from './views/SimConfig.jsx'
import Settings from './views/Settings.jsx'
import Logs from './views/Logs.jsx'
import Esim from './views/Esim.jsx'
import Login from './views/Login.jsx'

// [key, label, icon, alwaysAvailable]
const NAV = [
  ['dashboard', 'Dashboard', 'dashboard', true],
  ['softphone', 'Softphone', 'phone', false],
  ['messages', 'Messages', 'mail', false],
  ['sims', 'SIM Config', 'sim', false],
  ['esim', 'eSIM', 'chip', false],
  ['settings', 'Settings', 'settings', true],
  ['logs', 'Logs', 'logs', true],
]

const VIEW_MAP = {
  dashboard: Dashboard,
  softphone: Softphone,
  messages: Messages,
  sims: SimConfig,
  esim: Esim,
  settings: Settings,
  logs: Logs,
}

export default function App() {
  const [auth, setAuth] = useState(null) // null = bootstrapping
  const [view, setView] = useState('dashboard')
  const [instances, setInstances] = useState([])
  const [cards, setCards] = useState([])
  const [cardsKnown, setCardsKnown] = useState(false)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto')
  const [navOpen, setNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1')
  const [wsStatus, setWsStatus] = useState('connecting')
  const [apiError, setApiError] = useState(null)
  const wsEvents = useRef({ handlers: new Set() })
  const bootstrapped = useRef(false)
  const toastTimer = useRef(null)
  const showToastRef = useRef(() => {})
  const authed = !!auth && (!auth.enabled || auth.authenticated)

  const showToast = useCallback((m, variant) => {
    clearTimeout(toastTimer.current)
    const text = typeof m === 'string' ? m : String(m)
    setToast({ text, variant })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])
  showToastRef.current = showToast

  const dropToLogin = useCallback(() => {
    setAuth((a) => ({
      enabled: true,
      authenticated: false,
      managed_by_env: !!(a && a.managed_by_env),
    }))
    setInstances([])
    setCards([])
    setCardsKnown(false)
    setWsStatus('closed')
    setApiError(null)
    bootstrapped.current = false
  }, [])

  useEffect(() => {
    setAuthRequiredHandler(() => { dropToLogin() })
    return () => setAuthRequiredHandler(null)
  }, [dropToLogin])

  useEffect(() => {
    let cancelled = false
    api.authStatus()
      .then((s) => { if (!cancelled) setAuth(s) })
      .catch((e) => {
        if (!cancelled) {
          // If status itself fails (control down), show open-shell error via apiError path
          // by treating auth as disabled so the offline banner can appear after refresh tries.
          setAuth({ enabled: false, authenticated: true, managed_by_env: false, _bootError: e.message })
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  const refresh = useCallback(async () => {
    if (!authed) return
    try {
      const r = await api.instances()
      setInstances(r.instances)
      setSelected((s) => s || (r.instances[0] && r.instances[0].id))
      setApiError(null)
    } catch (e) {
      if (e?.code === 'auth_required' || e?.status === 401) return
      setApiError(e.message || 'Cannot reach control plane')
    }
    try {
      const c = await api.cards()
      setCards(c.cards)
      setCardsKnown(true)
    } catch {
      /* readers optional during boot */
    }
  }, [authed])

  useEffect(() => {
    if (authed) refresh()
  }, [authed, refresh])

  // WebSocket: only after auth bootstrap succeeds. No cookie / unauthenticated → no WS.
  useEffect(() => {
    if (!authed) return undefined
    let wasClosed = false
    const off = connectWs((msg) => {
      if (msg.type === 'status') {
        const { type: _t, instance, ...status } = msg
        setInstances((list) => list.map((i) => (i.id === instance ? { ...i, status } : i)))
      }
      if (msg.type === 'cards') { setCards(msg.cards); setCardsKnown(true) }
      if (msg.type === 'engine' && ['card_removed', 'reader_lost', 'reader_added', 'reader_removed'].includes(msg.event)) {
        const name = msg.args?.[0]
        showToastRef.current({
          card_removed: 'SIM removed — line stopped',
          reader_lost: 'Reader unplugged — line stopped',
          reader_added: `Card reader connected${name ? `: ${name}` : ''}`,
          reader_removed: `Card reader disconnected${name ? `: ${name}` : ''}`,
        }[msg.event])
        refresh()
      }
      wsEvents.current.handlers.forEach((h) => h(msg))
      if (msg.type === 'sms' && msg.message?.direction === 'in') {
        showToastRef.current(`SMS from ${msg.message.peer}`)
      }
      if (msg.type === 'call' && msg.call?.direction === 'in') {
        showToastRef.current(`Incoming call from ${msg.call.peer}`)
      }
    }, (st) => {
      setWsStatus(st)
      if (st === 'auth') {
        dropToLogin()
        return
      }
      if (st === 'closed') wasClosed = true
      if (st === 'open') {
        if (bootstrapped.current && wasClosed) refresh()
        bootstrapped.current = true
        wasClosed = false
      }
    })
    return off
  }, [authed, refresh, dropToLogin])

  const subscribe = useCallback((h) => {
    wsEvents.current.handlers.add(h)
    return () => wsEvents.current.handlers.delete(h)
  }, [])

  const onLoginSuccess = useCallback((s) => {
    setAuth({
      enabled: !!s.enabled,
      authenticated: true,
      managed_by_env: !!s.managed_by_env,
    })
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* still drop locally */ }
    dropToLogin()
  }, [dropToLogin])

  const noReaders = cardsKnown && cards.length === 0
  useEffect(() => {
    if (noReaders && !NAV.find(([k]) => k === view)?.[3]) setView('dashboard')
  }, [noReaders, view])

  useEffect(() => { setNavOpen(false) }, [view])
  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  if (auth === null) {
    return (
      <div className="login-shell">
        <div style={{ color: 'var(--text-dim)' }} role="status">Loading…</div>
      </div>
    )
  }

  if (auth.enabled && !auth.authenticated) {
    return (
      <Login
        onSuccess={onLoginSuccess}
        theme={theme}
        setTheme={setTheme}
      />
    )
  }

  const sel = instances.find((i) => i.id === selected)
  const View = VIEW_MAP[view]
  const viewLabel = NAV.find(([k]) => k === view)?.[1] || view

  const connBanner = (() => {
    if (apiError) {
      return (
        <div className="conn-banner err" role="status">
          <Icon name="alert" size={16} />
          <span style={{ flex: 1 }}>API offline: {apiError}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={refresh}>Retry</button>
        </div>
      )
    }
    if (wsStatus === 'closed' || wsStatus === 'connecting') {
      return (
        <div className={`conn-banner ${wsStatus === 'closed' ? 'err' : 'warn'}`} role="status">
          <Icon name="alert" size={16} />
          <span>{wsStatus === 'closed' ? 'Live updates disconnected — reconnecting…' : 'Connecting live updates…'}</span>
        </div>
      )
    }
    return null
  })()

  const nav = (
    <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      {NAV.map(([k, label, icon, always]) => {
        const disabled = noReaders && !always
        return (
          <button
            key={k}
            type="button"
            className="app-nav-btn"
            onClick={() => { if (!disabled) setView(k) }}
            disabled={disabled}
            aria-current={view === k ? 'page' : undefined}
            title={disabled ? 'No PC/SC reader detected — connect a card reader to enable' : label}
          >
            <Icon name={icon} size={18} />
            {!sidebarCollapsed && <span>{label}</span>}
            {sidebarCollapsed && <span className="sr-only">{label}</span>}
          </button>
        )
      })}
    </nav>
  )

  return (
    <SoftphoneProvider selected={sel} setView={setView}>
      <div className="app-shell">
        {navOpen && (
          <button type="button" className="app-drawer-backdrop" aria-label="Close navigation"
            onClick={() => setNavOpen(false)} />
        )}

        <aside
          className={`app-sidebar${navOpen ? ' is-open' : ''}${sidebarCollapsed ? ' is-collapsed' : ''}`}
          aria-label="Sidebar"
        >
          <div className="app-brand" style={{ fontWeight: 800, fontSize: sidebarCollapsed ? 15 : 18, padding: '4px 8px 16px', letterSpacing: .5 }}>
            {sidebarCollapsed
              ? <span style={{ color: 'var(--primary)' }} title="VoWiFi gateway">Vo</span>
              : <><span style={{ color: 'var(--primary)' }}>Vo</span>WiFi<span style={{ color: 'var(--text-mute)', fontWeight: 500 }}> gateway</span></>}
          </div>
          {nav}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div className="sidebar-collapse-desktop">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%' }}
                onClick={() => setSidebarCollapsed((v) => !v)}
                aria-pressed={sidebarCollapsed}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <Icon name={sidebarCollapsed ? 'menu' : 'chevronLeft'} size={16} />
                {!sidebarCollapsed && <span>Collapse</span>}
              </button>
            </div>
            {auth.enabled && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%' }}
                onClick={logout}
                title="Sign out on this device"
                aria-label="Sign out"
              >
                <Icon name="close" size={16} />
                {!sidebarCollapsed && <span>Sign out</span>}
              </button>
            )}
            <div className="theme-toggle-group" style={{ display: 'flex', gap: 6, minWidth: 0 }} role="group" aria-label="Theme">
              {[['auto', 'auto', 'Auto'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([t, icon, label]) => (
                <button
                  key={t}
                  type="button"
                  className="btn btn-sm theme-toggle-btn"
                  aria-pressed={theme === t}
                  aria-label={`${label} theme`}
                  title={`${label} theme`}
                  onClick={() => setTheme(t)}
                  style={{
                    flex: sidebarCollapsed ? undefined : 1,
                    minHeight: 40,
                    minWidth: 0,
                  }}
                >
                  <Icon name={icon} size={16} />
                  {!sidebarCollapsed && <span style={{ fontSize: 11 }}>{t}</span>}
                </button>
              ))}
            </div>
            {!sidebarCollapsed && (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '0 8px 8px' }}>
                {instances.length} SIM{instances.length !== 1 ? 's' : ''} configured
              </div>
            )}
          </div>
        </aside>

        <div className="app-main">
          <header className="app-topbar">
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Open navigation"
              aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={20} />
            </button>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>{viewLabel}</h1>
          </header>

          {connBanner}

          <header style={{
            display: 'flex', alignItems: 'center', marginBottom: 0, gap: 16, flexShrink: 0,
            padding: '20px 24px 0',
          }} className="desktop-page-title">
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{viewLabel}</h1>
          </header>

          <main style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 24px calc(24px + var(--safe-bottom))' }}>
            <ErrorBoundary key={view}>
              {View && (
                <View
                  instances={instances}
                  cards={cards}
                  noReaders={noReaders}
                  cardsKnown={cardsKnown}
                  selected={sel}
                  setSelected={setSelected}
                  refresh={refresh}
                  subscribe={subscribe}
                  showToast={showToast}
                  setView={setView}
                  apiError={apiError}
                  auth={auth}
                  onAuthChange={setAuth}
                />
              )}
            </ErrorBoundary>
          </main>
        </div>

        <div className="toast-region" aria-live="polite" aria-atomic="true">
          {toast && (
            <div className={`toast${toast.variant ? ` ${toast.variant}` : ''}`} role="status">
              {toast.text}
            </div>
          )}
        </div>
      </div>
      <style>{`
        .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0 }
        @media (max-width: 860px) {
          .desktop-page-title { display: none !important; }
          .sidebar-collapse-desktop { display: none !important; }
        }
        @media (min-width: 861px) {
          .app-topbar { display: none !important; }
        }
      `}</style>
    </SoftphoneProvider>
  )
}
