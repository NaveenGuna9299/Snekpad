import { Component, type ReactNode } from 'react'

/** Shows the error instead of a blank window if something in the UI throws while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(error.stack ?? error.message)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 text-fg">
        <p className="mb-2 text-lg font-semibold">Something went wrong</p>
        <pre className="mb-4 whitespace-pre-wrap text-xs text-muted">{this.state.error.message}</pre>
        <button className="rounded bg-accent px-3 py-1.5 text-accentfg" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
