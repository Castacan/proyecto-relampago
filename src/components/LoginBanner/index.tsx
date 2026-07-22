import { useState } from 'react'

const DISMISS_KEY = 'relampago_banner_dismissed'

interface Props {
  onEnter: () => void
}

export default function LoginBanner({ onEnter }: Props) {
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem(DISMISS_KEY) === '1'
  )

  if (dismissed) return null

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="shrink-0 flex items-center gap-3 bg-zinc-900/95 border-b border-zinc-800/60 px-4 py-2.5">
      <span className="text-yellow-400 text-xs shrink-0">⚡</span>
      <span className="flex-1 text-zinc-400 text-xs leading-snug">
        Inicia sesión para sumar puntos al leaderboard
      </span>
      <button
        onClick={onEnter}
        className="text-yellow-400 text-xs font-bold shrink-0 hover:text-yellow-300 transition-colors"
      >
        Entrar
      </button>
      <button
        onClick={dismiss}
        className="text-zinc-600 hover:text-zinc-400 text-sm shrink-0 leading-none transition-colors"
        aria-label="Cerrar"
      >
        ✕
      </button>
    </div>
  )
}
