import React, { useId } from 'react'

export function Field({ label, hint, error, children, htmlFor, className }) {
  const autoId = useId()
  const id = htmlFor || autoId
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
      id: children.props.id || id,
      'aria-invalid': error ? true : children.props['aria-invalid'],
      'aria-describedby': [children.props['aria-describedby'], hint ? `${id}-hint` : null, error ? `${id}-err` : null]
        .filter(Boolean).join(' ') || undefined,
    })
    : children
  return (
    <div className={className || undefined}>
      {label && <label htmlFor={id}>{label}</label>}
      {child}
      {hint && !error && <div id={`${id}-hint`} style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>{hint}</div>}
      {error && <div id={`${id}-err`} style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }} role="alert">{error}</div>}
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state" role="status">
      {title && <div style={{ fontWeight: 700, color: 'var(--text-soft)' }}>{title}</div>}
      {children}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <div style={{ fontWeight: 700 }}>{title}</div>
      {children}
      {onRetry && (
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}

export function StatusDot({ state, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
      <span className={`dot st-${state || 'STOPPED'}`} aria-hidden />
      {label || state || 'Unknown'}
    </span>
  )
}
