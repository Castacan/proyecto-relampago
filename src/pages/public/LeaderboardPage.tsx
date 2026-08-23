import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { useClimber } from '../../hooks/useClimber'
import { useSponsorships } from '../../hooks/useSponsorships'
import SponsorBanner from '../../components/SponsorBanner'
import logoHorizontal from '../../assets/logo-horizontal.png'
import type { SponsorPeriod } from '../../types'

type Tab = 'diario' | 'semanal' | 'mensual'

const TAB_PERIOD: Record<Tab, SponsorPeriod> = {
  diario: 'top_1_daily',
  semanal: 'top_1_weekly',
  mensual: 'top_1_monthly',
}

export default function LeaderboardPage() {
  const { daily, weekly, monthly, loading } = useLeaderboard()
  const { climber } = useClimber()
  const { sponsorships } = useSponsorships()
  const [tab, setTab] = useState<Tab>('diario')

  const entries = tab === 'diario' ? daily : tab === 'semanal' ? weekly : monthly

  return (
    <div className="min-h-screen bg-fondo flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-1">
        <Link to="/" className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
          ← Inicio
        </Link>
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-5 py-6">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-5">Leaderboard</h1>

        <SponsorBanner sponsorships={sponsorships} period={TAB_PERIOD[tab]} variant="mobile" />

        {/* Tabs */}
        <div className="flex gap-2 mb-5 bg-superficie rounded-2xl p-1 border border-zinc-800/60">
          <button
            onClick={() => setTab('diario')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === 'diario' ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Diario
          </button>
          <button
            onClick={() => setTab('semanal')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === 'semanal' ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Semanal
          </button>
          <button
            onClick={() => setTab('mensual')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === 'mensual' ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Mensual
          </button>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="h-40 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-10 bg-superficie rounded-2xl border border-zinc-800/60 text-center">
            <p className="text-zinc-600 text-sm">
              {tab === 'diario' ? 'Nadie ha marcado un send hoy.' : tab === 'semanal' ? 'Sin actividad esta semana.' : 'Sin actividad este mes.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, i) => {
              const isMe = climber != null && entry.display_name === climber.display_name
              const rank = i + 1
              return (
                <div
                  key={entry.display_name + i}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    isMe
                      ? 'bg-primario/10 border-primario/40'
                      : 'bg-superficie border-zinc-800/50'
                  }`}
                >
                  <span className={`font-black text-sm w-6 shrink-0 ${rank <= 3 ? 'text-primario' : 'text-zinc-600'}`}>
                    #{rank}
                  </span>
                  <span className={`flex-1 font-bold text-sm truncate ${isMe ? 'text-primario' : 'text-texto-principal'}`}>
                    {entry.display_name}{isMe && ' (tú)'}
                  </span>
                  <span className="text-zinc-400 font-bold text-sm shrink-0">{Number(entry.total_points)} pts</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer discreto */}
      <div className="shrink-0 flex items-center justify-center px-5 py-4 border-t border-zinc-800/40">
        <a
          href="https://instagram.com/jaibamuro"
          target="_blank"
          rel="noreferrer"
          className="text-zinc-600 hover:text-zinc-400 text-xs font-medium transition-colors"
        >
          @jaibamuro
        </a>
      </div>
    </div>
  )
}
