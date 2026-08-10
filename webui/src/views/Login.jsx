import React, { useState } from 'react'
import { api, ApiError } from '../api.js'

export default function Login({ onSuccess, theme, setTheme }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await api.login(password)
      setPassword('')
      onSuccess?.(r)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null
      if (err?.status === 429 || code === 'rate_limited') {
        setError('Too many failed attempts — wait a minute and try again.')
      } else if (err?.status === 401 || code === 'invalid_password') {
        setError('Incorrect password.')
      } else {
        setError(err?.message || 'Login failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <span style={{ color: 'var(--primary)' }}>Vo</span>WiFi
          <span style={{ color: 'var(--text-mute)', fontWeight: 500 }}> gateway</span>
        </div>
        <p className="login-hint">Enter the Web access password to continue.</p>
        <form onSubmit={submit}>
          <label htmlFor="web-password">Password</label>
          <input
            id="web-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          {error && (
            <div className="login-error" role="alert">{error}</div>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !password}
            style={{ width: '100%', marginTop: 16, minHeight: 44 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {setTheme && (
          <div className="theme-toggle-group login-theme" role="group" aria-label="Theme">
            {[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([t, label]) => (
              <button
                key={t}
                type="button"
                className="btn btn-sm theme-toggle-btn"
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
