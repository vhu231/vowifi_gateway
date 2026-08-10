import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'
import SimSelector from './SimSelector.jsx'
import Icon from '../components/Icon.jsx'
import { ErrorState } from '../components/Field.jsx'

export default function Messages({ selected, subscribe, showToast, instances, cards, setSelected }) {
  const id = selected?.id
  const [threads, setThreads] = useState([])
  const [peer, setPeer] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [newTo, setNewTo] = useState('')
  const [sending, setSending] = useState(false)
  const [selMode, setSelMode] = useState(false)
  const [selIds, setSelIds] = useState(() => new Set())
  const [err, setErr] = useState(null)
  const [composing, setComposing] = useState(false)

  const loadThreads = useCallback(async () => {
    if (!id) return
    try {
      const r = await api.threads(id)
      setThreads(r.threads)
      setErr(null)
    } catch (e) {
      setErr(e.message || 'Failed to load conversations')
    }
  }, [id])

  const loadMsgs = useCallback(async (p) => {
    if (!id || !p) return
    try {
      const r = await api.messages(id, p)
      setMsgs(r.messages)
      setErr(null)
    } catch (e) {
      setErr(e.message || 'Failed to load messages')
    }
  }, [id])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { if (peer) loadMsgs(peer) }, [peer, loadMsgs])
  useEffect(() => { setSelMode(false); setSelIds(new Set()) }, [peer])
  useEffect(() => { if (!msgs.length) { setSelMode(false); setSelIds(new Set()) } }, [msgs.length])
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'sms' && msg.instance === id) {
      loadThreads()
      if (peer) loadMsgs(peer)
    }
  }), [subscribe, id, peer, loadThreads, loadMsgs])

  const send = async () => {
    const to = peer || newTo
    if (!to || !text) return
    setSending(true)
    try {
      const res = await api.sendSms(id, to, text)
      setText(''); setPeer(to); setNewTo(''); setComposing(false)
      await loadThreads(); await loadMsgs(to)
      if (res && res.ok === false) {
        const msg = 'SMS not delivered: ' + (res.error || 'unknown error')
        showToast ? showToast(msg, 'danger') : alert(msg)
      }
    } catch (e) {
      const msg = 'SMS failed: ' + e.message
      showToast ? showToast(msg, 'danger') : alert(msg)
    }
    setSending(false)
  }

  const toast = (m) => (showToast ? showToast(m) : null)

  const toggleSel = (mid) => setSelIds((s) => {
    const n = new Set(s); n.has(mid) ? n.delete(mid) : n.add(mid); return n
  })
  const refreshIfSame = async (forId, p) => {
    if (forId !== id) return
    await loadThreads(); if (p) await loadMsgs(p)
  }

  const deleteSelected = async () => {
    if (!selIds.size) return
    if (!confirm(`Delete ${selIds.size} selected message${selIds.size > 1 ? 's' : ''}?`)) return
    const forId = id, p = peer
    try {
      await api.deleteMessages(forId, { ids: [...selIds] })
      setSelMode(false); setSelIds(new Set())
      await refreshIfSame(forId, p)
      toast('Messages deleted')
    } catch (e) { toast('Delete failed: ' + e.message) }
  }

  const deleteThread = async (p, e) => {
    if (e) e.stopPropagation()
    if (!confirm(`Delete the entire conversation with ${p}? This removes all its messages.`)) return
    const forId = id
    try {
      await api.deleteMessages(forId, { peer: p })
      if (peer === p) { setPeer(null); setMsgs([]) }
      if (forId === id) await loadThreads()
      toast('Conversation deleted')
    } catch (e2) { toast('Delete failed: ' + e2.message) }
  }

  const clearAll = async () => {
    if (!threads.length) return
    if (!confirm('Delete ALL messages on this line? This cannot be undone.')) return
    const forId = id
    try {
      await api.deleteMessages(forId, { all: true })
      if (forId === id) { setPeer(null); setMsgs([]); await loadThreads() }
      toast('All messages deleted')
    } catch (e) { toast('Delete failed: ' + e.message) }
  }

  const openThread = (p) => { setPeer(p); setComposing(false) }
  const startNew = () => { setPeer(null); setMsgs([]); setComposing(true) }
  const showDetail = !!(peer || composing)
  const paneClass = showDetail ? 'is-detail' : 'is-list'

  if (!id) return (
    <div>
      <SimSelector instances={instances} cards={cards} selected={selected} setSelected={setSelected} />
      <div style={{ color: 'var(--text-dim)' }}>Select a SIM / line to view and send messages.</div>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>
        <SimSelector instances={instances} cards={cards} selected={selected} setSelected={setSelected} />
      </div>
      {err && (
        <div style={{ marginBottom: 12 }}>
          <ErrorState title="Messages unavailable" onRetry={() => { loadThreads(); if (peer) loadMsgs(peer) }}>{err}</ErrorState>
        </div>
      )}
      <div className={`split-pane ${paneClass}`}>
        <div className="card pane-list" style={{ padding: 12, overflow: 'auto', minHeight: 0 }}>
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={startNew}>
            + New message
          </button>
          {threads.length > 0 &&
            <button type="button" className="btn btn-ghost btn-danger-ghost" style={{ width: '100%', marginBottom: 10, fontSize: 12 }}
              onClick={clearAll}>Clear all conversations</button>}
          {threads.map((t) => (
            <div key={t.peer} className="hover-row"
              style={{
                padding: 4, borderRadius: 10, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
                background: peer === t.peer ? 'var(--active)' : 'transparent',
              }}>
              <button
                type="button"
                onClick={() => openThread(t.peer)}
                aria-current={peer === t.peer ? 'true' : undefined}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent',
                  cursor: 'pointer', padding: 10, borderRadius: 10, color: 'inherit', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }} className="mono">{t.peer}</div>
                <div style={{ fontSize: 12, color: 'var(--text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last_body}</div>
              </button>
              <button type="button" className="row-del" title="Delete conversation" aria-label={`Delete conversation with ${t.peer}`}
                onClick={(e) => deleteThread(t.peer, e)}><Icon name="trash" size={16} /></button>
            </div>
          ))}
          {threads.length === 0 && <div style={{ color: 'var(--text-mute)', fontSize: 13, padding: 8 }}>No conversations yet.</div>}
        </div>

        <div className="card pane-detail" style={{ display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0 }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost btn-sm messages-back" aria-label="Back to conversations"
              onClick={() => { setPeer(null); setComposing(false); setMsgs([]) }}>
              <Icon name="back" size={16} /> Back
            </button>
            {peer ? <span className="mono" style={{ fontWeight: 600, flex: 1 }}>{peer}</span>
              : <input placeholder="Recipient number e.g. +1..." aria-label="Recipient number"
                value={newTo} onChange={(e) => setNewTo(e.target.value)} style={{ maxWidth: 300, flex: 1 }} />}
            {peer && msgs.length > 0 && (
              selMode ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>{selIds.size} selected</span>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-ghost"
                    disabled={!selIds.size} onClick={deleteSelected}>Delete</button>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => { setSelMode(false); setSelIds(new Set()) }}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelMode(true)}>Select</button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-ghost" title="Delete conversation"
                    onClick={() => deleteThread(peer)}>Delete all</button>
                </>
              )
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msgs.map((m) => {
              const failed = m.status === 'failed'
              const delivered = m.status === 'delivered'
              const sent = m.status === 'sent'
              const statusText = failed ? ' · Failed to deliver'
                : m.status === 'pending' ? ' · sending…'
                : sent ? ' · Sent'
                : delivered ? ' · Delivered ✓'
                : ''
              const statusColor = failed ? 'var(--danger)' : delivered ? 'var(--success)' : 'var(--text-mute)'
              const checked = selIds.has(m.id)
              return (
                <div key={m.id}
                  style={{
                    alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '74%',
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexDirection: m.direction === 'out' ? 'row-reverse' : 'row',
                  }}>
                  {selMode && (
                    <input type="checkbox" checked={checked} aria-label={`Select message`}
                      onChange={() => toggleSel(m.id)} style={{ width: 'auto', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      background: checked ? 'var(--active)' : failed ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : (m.direction === 'out' ? 'var(--primary)' : 'var(--hover)'),
                      color: (!failed && m.direction === 'out' && !checked) ? 'var(--primary-fg)' : 'inherit',
                      border: failed ? '1px solid color-mix(in srgb, var(--danger) 55%, transparent)' : '1px solid transparent',
                      padding: '8px 12px', borderRadius: 12, fontSize: 14,
                    }}>{m.body}</div>
                    <div style={{
                      fontSize: 10, color: statusColor,
                      textAlign: m.direction === 'out' ? 'right' : 'left', marginTop: 2,
                    }}>
                      {new Date(m.ts * 1000).toLocaleString()}
                      {statusText}
                    </div>
                    {failed && m.error && (
                      <div style={{
                        fontSize: 10.5, color: 'var(--danger)', marginTop: 1,
                        textAlign: m.direction === 'out' ? 'right' : 'left', maxWidth: 280,
                      }}>{m.error}</div>
                    )}
                  </div>
                </div>
              )
            })}
            {!peer && composing && !msgs.length && (
              <div style={{ color: 'var(--text-mute)', fontSize: 13 }}>Enter a recipient and message to start a conversation.</div>
            )}
          </div>
          <div style={{
            display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0,
            paddingBottom: 'calc(12px + var(--safe-bottom))',
          }}>
            <input placeholder="Type a message…" aria-label="Message text" value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button type="button" className="btn btn-primary" disabled={sending || (!peer && !newTo)} onClick={send}>Send</button>
          </div>
        </div>
      </div>
      <style>{`
        .messages-back { display: none; }
        @media (max-width: 860px) {
          .messages-back { display: inline-flex !important; }
          .split-pane.is-list .pane-detail { display: none !important; }
          .split-pane.is-detail .pane-list { display: none !important; }
          .split-pane.is-detail .pane-detail { display: flex !important; }
        }
        @media (min-width: 861px) {
          .split-pane.is-list .pane-detail { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
