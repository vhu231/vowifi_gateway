import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try { console.error('[webui]', error, info?.componentStack) } catch {}
  }

  render() {
    if (this.state.error) {
      const fallback = this.props.fallback
      if (typeof fallback === 'function') return fallback(this.state.error, () => this.setState({ error: null }))
      return (
        <div className="card" style={{ padding: 24, margin: 16 }} role="alert">
          <h2 style={{ marginTop: 0 }}>This view crashed</h2>
          <p style={{ color: 'var(--text-dim)' }}>{String(this.state.error?.message || this.state.error)}</p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
