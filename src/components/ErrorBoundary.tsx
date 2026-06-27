import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-red-400 text-xs font-mono whitespace-pre-wrap">
          <p className="font-bold mb-2">Error en AdminPage:</p>
          <p>{this.state.error.message}</p>
          <p className="mt-2 text-zinc-500">{this.state.error.stack}</p>
        </div>
      )
    }
    return this.props.children
  }
}
