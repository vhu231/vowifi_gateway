import React, { useEffect, useId } from 'react'

// Per-page SIM/line picker for multi-SIM setups.
export default function SimSelector({ instances = [], cards = [], selected, setSelected, label = 'Active SIM / line' }) {
  const selectId = useId()
  const readerFor = (i) => cards.find((c) => c.present &&
    (String(c.matched) === String(i.id) || (c.iccid && c.iccid === i.iccid)))
  const live = instances.filter((i) => readerFor(i))

  const id = selected?.id != null ? String(selected.id) : ''
  useEffect(() => {
    if (id && !live.some((i) => String(i.id) === id)) setSelected(live[0] ? String(live[0].id) : null)
  }, [id, live.map((i) => i.id).join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!live.length) return null
  return (
    <div className="card" style={{
      padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <label htmlFor={selectId} style={{ fontSize: 12, color: 'var(--text-mute)', whiteSpace: 'nowrap', margin: 0 }}>{label}</label>
      <select id={selectId} value={id || ''} onChange={(e) => setSelected(e.target.value)} style={{ flex: 1, minWidth: 180, maxWidth: 460 }}>
        {!id && <option value="">— select —</option>}
        {live.map((i) => {
          const c = readerFor(i)
          const rd = c ? `Reader ${c.index}` : null
          const st = i.status?.label ? ` — ${i.status.label}` : ''
          return <option key={String(i.id)} value={String(i.id)}>{rd ? `${rd} · ` : ''}{i.name || i.imsi}{st}</option>
        })}
      </select>
      {live.length === 1 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>only line</span>}
    </div>
  )
}
