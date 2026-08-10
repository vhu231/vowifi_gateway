// Thin REST + WebSocket client for the manager API (same origin).
const base = ''
const DEFAULT_TIMEOUT_MS = 15000
/** Docker recreate / stop can exceed the default fetch budget on slow boards. */
const ENGINE_TIMEOUT_MS = 120000
const GET_RETRIES = 2
const WS_CLOSE_AUTH = 4401

/** Optional listener for auth-required (401 / WS 4401) so App can drop to the login gate. */
let onAuthRequired = null
export function setAuthRequiredHandler(fn) {
  onAuthRequired = typeof fn === 'function' ? fn : null
}

export class ApiError extends Error {
  constructor(message, { status, data, code } = {}) {
    super(message || 'Request failed')
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.code = code || (status === 0 ? 'network' : status >= 500 ? 'server' : 'client')
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function detailCode(data) {
  const d = data?.detail
  if (d && typeof d === 'object') return d.code || null
  return null
}

async function j(method, path, body, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    retries = method === 'GET' ? GET_RETRIES : 0,
    skipAuthHandler = false,
  } = opts
  let attempt = 0
  while (true) {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) {
      if (signal.aborted) ctrl.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const opt = { method, headers: {}, signal: ctrl.signal, credentials: 'same-origin' }
      if (body !== undefined) {
        opt.headers['Content-Type'] = 'application/json'
        opt.body = JSON.stringify(body)
      }
      const r = await fetch(base + path, opt)
      const text = await r.text()
      let data
      try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
      const detailMsg = data.detail && typeof data.detail === 'object' ? data.detail.message : data.detail
      if (!r.ok) {
        const code = detailCode(data) || (r.status === 401 ? 'auth_required' : undefined)
        const err = new ApiError(detailMsg || data.error || r.statusText, {
          status: r.status,
          data,
          code,
        })
        if (!skipAuthHandler && r.status === 401 && (code === 'auth_required' || !detailCode(data))) {
          try { onAuthRequired?.(err) } catch { /* ignore */ }
        }
        throw err
      }
      return data
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      const network = aborted || err instanceof TypeError
      const apiErr = err instanceof ApiError ? err
        : new ApiError(aborted ? 'Request timed out' : (err.message || 'Network error'), {
          status: 0,
          code: aborted ? 'timeout' : 'network',
        })
      const retryable = method === 'GET' && attempt < retries && (network || (apiErr.status >= 500))
      if (!retryable) throw apiErr
      attempt += 1
      await sleep(300 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 120))
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
}

/** Build query string. Prefer reader NAME (stable); index is optional fallback. */
function readerQuery(readerOrIndex, maybeName) {
  const q = new URLSearchParams()
  if (typeof readerOrIndex === 'string' && readerOrIndex) {
    q.set('reader', readerOrIndex)
  } else if (typeof readerOrIndex === 'number') {
    q.set('reader_index', String(readerOrIndex))
    if (maybeName) q.set('reader', maybeName)
  } else if (maybeName) {
    q.set('reader', maybeName)
  } else {
    q.set('reader_index', '0')
  }
  return q
}

function readerBody(readerOrIndex, extra = {}) {
  if (typeof readerOrIndex === 'string' && readerOrIndex) {
    return { reader: readerOrIndex, ...extra }
  }
  if (typeof readerOrIndex === 'number') {
    return { reader_index: readerOrIndex, ...extra }
  }
  if (readerOrIndex && typeof readerOrIndex === 'object') {
    return { ...readerOrIndex, ...extra }
  }
  return { reader_index: 0, ...extra }
}

export const api = {
  authStatus: () => j('GET', '/api/auth/status', undefined, { skipAuthHandler: true, retries: 0 }),
  login: (password) => j('POST', '/api/auth/login', { password }, { skipAuthHandler: true, retries: 0 }),
  logout: () => j('POST', '/api/auth/logout', {}, { skipAuthHandler: true, retries: 0 }),
  setPassword: (body) => j('PUT', '/api/auth/password', body, { retries: 0 }),

  readers: () => j('GET', '/api/readers'),
  detect: (i = 0) => j('GET', `/api/sim/detect?reader_index=${i}`),
  verifyPin: (pin, reader_index = 0, reader) => j('POST', '/api/sim/verify-pin', { pin, reader_index, reader }),
  changePin: (oldp, newp, reader_index = 0) => j('POST', '/api/sim/change-pin', { old: oldp, new: newp, reader_index }),
  setPinEnabled: (pin, enabled, reader_index = 0) => j('POST', '/api/sim/pin-enabled', { pin, enabled, reader_index }),

  settings: () => j('GET', '/api/settings'),
  saveSettings: (patch) => j('PUT', '/api/settings', patch),

  instances: () => j('GET', '/api/instances'),
  cards: () => j('GET', '/api/cards'),
  portsSuggest: () => j('GET', '/api/ports/suggest'),
  provision: (body) => j('POST', '/api/provision', body),
  saveInstance: (inst) => j('POST', '/api/instances', inst, { timeoutMs: ENGINE_TIMEOUT_MS }),
  deleteInstance: (id) => j('DELETE', `/api/instances/${id}`, undefined, { timeoutMs: ENGINE_TIMEOUT_MS }),
  start: (id, body) => j('POST', `/api/instances/${id}/start`, body || {}, { timeoutMs: ENGINE_TIMEOUT_MS }),
  stop: (id) => j('POST', `/api/instances/${id}/stop`, undefined, { timeoutMs: ENGINE_TIMEOUT_MS }),
  reprovision: (id, body) => j('POST', `/api/instances/${id}/reprovision`, body || {}, { timeoutMs: ENGINE_TIMEOUT_MS }),
  clearPin: (id) => j('POST', `/api/instances/${id}/pin/clear`),
  status: (id) => j('GET', `/api/instances/${id}/status`),
  logs: (id, tail = 300) => j('GET', `/api/instances/${id}/logs?tail=${tail}`),
  register: (id) => j('POST', `/api/instances/${id}/register`),

  threads: (id) => j('GET', `/api/instances/${id}/messages/threads`),
  messages: (id, peer) => j('GET', `/api/instances/${id}/messages/${encodeURIComponent(peer)}`),
  sendSms: (id, to, body) => j('POST', `/api/instances/${id}/sms/send`, { to, body }),
  deleteMessages: (id, sel) => j('POST', `/api/instances/${id}/messages/delete`, sel),

  calls: (id) => j('GET', `/api/instances/${id}/calls`),
  deleteCalls: (id, sel) => j('POST', `/api/instances/${id}/calls/delete`, sel),
  call: (id, to, from_endpoint = 'webrtc') => j('POST', `/api/instances/${id}/call`, { to, from_endpoint }),
  hangup: (id) => j('POST', `/api/instances/${id}/hangup`),
  softphone: (id) => j('GET', `/api/instances/${id}/softphone`),
  sipinfo: (id) => j('GET', `/api/instances/${id}/sipinfo`),

  esimStatus: () => j('GET', '/api/esim/status'),
  esimChip: (readerOrIndex, maybeName) => j('GET', `/api/esim/chip?${readerQuery(readerOrIndex, maybeName)}`),
  esimProfiles: (readerOrIndex, maybeName) => j('GET', `/api/esim/profiles?${readerQuery(readerOrIndex, maybeName)}`),
  esimEnable: (iccid, readerOrBody) => j(
    'POST',
    `/api/esim/profiles/${encodeURIComponent(iccid)}/enable`,
    readerBody(readerOrBody),
  ),
  esimDisable: (iccid, readerOrBody) => j(
    'POST',
    `/api/esim/profiles/${encodeURIComponent(iccid)}/disable`,
    readerBody(readerOrBody),
  ),
  esimDelete: (iccid, readerOrBody) => {
    if (readerOrBody && typeof readerOrBody === 'object') {
      const q = readerQuery(readerOrBody.reader ?? readerOrBody.reader_index)
      if (readerOrBody.se_id || readerOrBody.seId) q.set('se_id', readerOrBody.se_id || readerOrBody.seId)
      if (readerOrBody.aid) q.set('aid', readerOrBody.aid)
      return j('DELETE', `/api/esim/profiles/${encodeURIComponent(iccid)}?${q}`)
    }
    return j(
      'DELETE',
      `/api/esim/profiles/${encodeURIComponent(iccid)}?${readerQuery(readerOrBody)}`,
    )
  },
  esimNickname: (iccid, nickname, readerOrBody) => j(
    'POST',
    `/api/esim/profiles/${encodeURIComponent(iccid)}/nickname`,
    readerBody(readerOrBody, { nickname }),
  ),
  esimDownload: (body) => j('POST', '/api/esim/download', body),
  esimDownloadCancel: (readerOrBody) => j('POST', '/api/esim/download/cancel', readerBody(readerOrBody)),
  esimDiscovery: (body) => j('POST', '/api/esim/discovery', body || {}),
  esimNotifications: (readerOrIndex, maybeName) => j(
    'GET',
    `/api/esim/notifications?${readerQuery(readerOrIndex, maybeName)}`,
  ),
  esimProcessNotifications: (readerOrIndex, seq) => j(
    'POST',
    '/api/esim/notifications/process',
    readerBody(readerOrIndex, seq == null ? {} : { seq }),
  ),
  esimNotificationsProcess: (body) => j('POST', '/api/esim/notifications/process', body || {}),
  esimRemoveNotification: (seq, readerOrBody) => {
    if (readerOrBody && typeof readerOrBody === 'object') {
      const q = readerQuery(readerOrBody.reader ?? readerOrBody.reader_index)
      if (readerOrBody.se_id || readerOrBody.seId) q.set('se_id', readerOrBody.se_id || readerOrBody.seId)
      if (readerOrBody.aid) q.set('aid', readerOrBody.aid)
      return j('DELETE', `/api/esim/notifications/${seq}?${q}`)
    }
    return j(
      'DELETE',
      `/api/esim/notifications/${seq}?${readerQuery(readerOrBody)}`,
    )
  },
  esimNotificationRemove: (seq, readerOrBody) => {
    if (readerOrBody && typeof readerOrBody === 'object') {
      const q = readerQuery(readerOrBody.reader ?? readerOrBody.reader_index)
      if (readerOrBody.se_id || readerOrBody.seId) q.set('se_id', readerOrBody.se_id || readerOrBody.seId)
      if (readerOrBody.aid) q.set('aid', readerOrBody.aid)
      return j('DELETE', `/api/esim/notifications/${seq}?${q}`)
    }
    return j(
      'DELETE',
      `/api/esim/notifications/${seq}?${readerQuery(readerOrBody)}`,
    )
  },
}

/**
 * Connect to control-plane /ws with exponential backoff + jitter.
 * onMsg(msg), onStatus?.('connecting'|'open'|'closed'|'auth')
 * Caller must only invoke after auth bootstrap; close code 4401 stops reconnecting.
 */
export function connectWs(onMsg, onStatus) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  let ws, alive = true, attempt = 0, timer = null, authRejected = false
  const setStatus = (s) => { try { onStatus?.(s) } catch {} }

  const backoffMs = () => {
    const baseMs = Math.min(30000, 1000 * (2 ** Math.min(attempt, 5)))
    return baseMs + Math.floor(Math.random() * 400)
  }

  const open = () => {
    if (!alive || authRejected) return
    setStatus('connecting')
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`)
    } catch {
      attempt += 1
      timer = setTimeout(open, backoffMs())
      setStatus('closed')
      return
    }
    ws.onopen = () => {
      attempt = 0
      setStatus('open')
    }
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)) } catch {} }
    ws.onclose = (ev) => {
      if (ev?.code === WS_CLOSE_AUTH) {
        authRejected = true
        setStatus('auth')
        try {
          onAuthRequired?.(new ApiError('Authentication required', {
            status: 401,
            code: 'auth_required',
          }))
        } catch { /* ignore */ }
        return
      }
      setStatus('closed')
      if (!alive || authRejected) return
      attempt += 1
      timer = setTimeout(open, backoffMs())
    }
    ws.onerror = () => { try { ws.close() } catch {} }
  }

  const onOnline = () => {
    if (!alive || authRejected) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    clearTimeout(timer)
    attempt = 0
    open()
  }
  window.addEventListener('online', onOnline)
  open()

  return () => {
    alive = false
    clearTimeout(timer)
    window.removeEventListener('online', onOnline)
    try { ws?.close() } catch {}
  }
}

/** Exported for unit tests */
export const _test = { j, readerQuery, readerBody, DEFAULT_TIMEOUT_MS, WS_CLOSE_AUTH }
