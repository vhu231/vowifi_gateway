import React, { useEffect, useId, useRef } from 'react'

export default function Dialog({
  open,
  title,
  onClose,
  children,
  className = '',
  labelledBy,
  describedBy,
  wide,
  dismissible = true,
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const prevFocus = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    prevFocus.current = document.activeElement
    const t = setTimeout(() => {
      const el = panelRef.current
      if (!el) return
      const focusable = el.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      ;(focusable || el).focus()
    }, 0)
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose?.() }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = [...panelRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      try { prevFocus.current?.focus?.() } catch {}
    }
  }, [open, onClose, dismissible])

  if (!open) return null
  return (
    <div className="dialog-backdrop" onClick={dismissible ? onClose : undefined} role="presentation">
      <div
        ref={panelRef}
        className={`card dialog-panel ${wide ? 'dialog-wide' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && <h2 id={titleId} style={{ marginTop: 0 }}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}
