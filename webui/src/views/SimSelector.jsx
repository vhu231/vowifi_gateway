import React, { useEffect, useId } from 'react'

// Short labels for narrow toolbars (mobile). Full label stays for a11y / desktop.
const SHORT = {
  'Active SIM / line': 'Line',
  'Show logs for': 'Logs',
  'Configuring line': 'Config',
}

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
  const short = SHORT[label] || 'Line'
  return (
    <div className="card sim-selector">
      <label htmlFor={selectId} className="sim-selector-label">
        <span className="sim-label-full">{label}</span>
        <span className="sim-label-short">{short}</span>
      </label>
      <select
        id={selectId}
        className="sim-selector-select"
        value={id || ''}
        onChange={(e) => setSelected(e.target.value)}
      >
        {!id && <option value="">— select —</option>}
        {live.map((i) => {
          const c = readerFor(i)
          const rd = c ? `R${c.index}` : null
          const name = i.name || i.imsi
          const st = i.status?.label ? ` — ${i.status.label}` : ''
          // Compact option text (Reader 0 · …); full status kept for clarity in the dropdown.
          return (
            <option key={String(i.id)} value={String(i.id)}>
              {rd ? `${rd} · ` : ''}{name}{st}
            </option>
          )
        })}
      </select>
      {live.length === 1 && <span className="sim-selector-hint">only line</span>}
    </div>
  )
}
