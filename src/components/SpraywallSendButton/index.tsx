import type { Climber } from '../../types'

interface Props {
  climber: Climber | null
  climberLoading: boolean
  sent: boolean
  sentAt?: string
  onToggle: () => void
  onNeedAuth: () => void
}

export default function SpraywallSendButton({ climber, climberLoading, sent, sentAt, onToggle, onNeedAuth }: Props) {
  if (climberLoading) return null

  if (!climber) {
    return (
      <button
        onClick={onNeedAuth}
        className="w-full py-4 rounded-2xl bg-zinc-800 border border-zinc-700/50 text-zinc-300 font-bold text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] hover:bg-zinc-700"
      >
        <span className="text-lg">⚡</span>
        Inicia sesión para llevar tu registro
      </button>
    )
  }

  if (sent) {
    const date = sentAt ? new Date(sentAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : null
    return (
      <button
        onClick={onToggle}
        className="w-full py-4 rounded-2xl bg-zinc-800 border border-green-500/30 text-center transition-all active:scale-[0.98]"
      >
        <p className="text-green-400 font-bold text-base">✓ Enviada</p>
        {date && <p className="text-zinc-500 text-xs mt-1">Primera vez: {date} · toca para desmarcar</p>}
      </button>
    )
  }

  return (
    <button
      onClick={onToggle}
      className="w-full py-5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-black text-lg transition-all active:scale-[0.97] shadow-lg shadow-yellow-400/25 flex items-center justify-center gap-3"
    >
      <span className="text-xl">🏆</span>
      MARCAR COMO ENVIADA
    </button>
  )
}
