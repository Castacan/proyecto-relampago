import { useState, useEffect } from 'react'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { getColorHex } from '../../lib/colors'

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_ES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']

function nowMX() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
}

export default function LeaderboardDisplay() {
  const { daily, monthly, events, loading, connected } = useLeaderboard()
  const [tickerIdx, setTickerIdx] = useState(0)
  const [now, setNow] = useState(nowMX)

  // Rotar ticker cada 4 segundos
  useEffect(() => {
    if (events.length === 0) return
    const t = setInterval(() => setTickerIdx(i => (i + 1) % events.length), 4000)
    return () => clearInterval(t)
  }, [events.length])

  // Reloj local
  useEffect(() => {
    const t = setInterval(() => setNow(nowMX()), 60_000)
    return () => clearInterval(t)
  }, [])

  const dayLabel = `${DAYS_ES[now.getDay()]} ${now.getDate()} de ${MONTHS_ES[now.getMonth()]}`
  const monthLabel = `${MONTHS_ES[now.getMonth()]} ${now.getFullYear()}`
  const monthRange = `1–${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()} de ${MONTHS_ES[now.getMonth()]}`

  const currentEvent = events[tickerIdx]

  if (loading) {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-yellow-400 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-zinc-950 flex flex-col overflow-hidden font-sans select-none">

      {/* Ticker superior */}
      <div className="shrink-0 h-14 bg-zinc-900 border-b border-zinc-800 flex items-center px-8 gap-4">
        {events.length > 0 && currentEvent ? (
          <>
            <div
              className="w-3 h-3 rounded-full shrink-0 animate-pulse"
              style={{ backgroundColor: getColorHex(currentEvent.color) }}
            />
            <p className="text-zinc-200 text-lg font-bold tracking-wide">
              <span className="text-white">{currentEvent.display_name}</span>
              {' '}mandó{' '}
              <span style={{ color: getColorHex(currentEvent.color) }}>{currentEvent.grade}</span>
              {' '}{currentEvent.color}
            </p>
          </>
        ) : (
          <>
            <div className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
            <p className="text-zinc-500 text-lg font-semibold">Sé el primero en mandar hoy</p>
          </>
        )}

        {/* Indicador de conexión */}
        {!connected && (
          <div className="ml-auto flex items-center gap-2 text-orange-400">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-sm font-semibold">Reconectando...</span>
          </div>
        )}
      </div>

      {/* Cuerpo: Daily (65%) + Monthly (35%) */}
      <div className="flex-1 flex overflow-hidden">

        {/* Leaderboard Diario */}
        <div className="flex-[65] flex flex-col px-10 py-8 border-r border-zinc-800">
          <div className="mb-8">
            <h1 className="text-yellow-400 font-black tracking-tight" style={{ fontSize: '4rem', lineHeight: 1 }}>HOY</h1>
            <p className="text-zinc-400 text-2xl font-semibold mt-1">{dayLabel}</p>
          </div>

          {daily.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-zinc-600 text-3xl font-bold mb-2">Nadie ha marcado un send hoy</p>
                <p className="text-zinc-700 text-xl">¡Sé el primero!</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {daily.map((entry, i) => (
                <DailyRow key={entry.display_name} rank={i + 1} name={entry.display_name} points={Number(entry.total_points)} />
              ))}
            </div>
          )}
        </div>

        {/* Leaderboard Mensual */}
        <div className="flex-[35] flex flex-col px-8 py-8">
          <div className="mb-8">
            <h2 className="text-zinc-300 font-black tracking-tight" style={{ fontSize: '2.5rem', lineHeight: 1 }}>{monthLabel.toUpperCase()}</h2>
            <p className="text-zinc-600 text-lg font-semibold mt-1">{monthRange}</p>
          </div>

          {monthly.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-zinc-700 text-xl font-bold text-center">Sin actividad este mes</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {monthly.map((entry, i) => (
                <MonthlyRow key={entry.display_name} rank={i + 1} name={entry.display_name} points={Number(entry.total_points)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 h-10 bg-zinc-900 border-t border-zinc-800 flex items-center justify-center gap-2">
        <span className="text-yellow-400 text-sm">⚡</span>
        <span className="text-zinc-600 text-sm font-medium">El Muro · Jaibamuro</span>
      </div>
    </div>
  )
}

function DailyRow({ rank, name, points }: { rank: number; name: string; points: number }) {
  const isFirst = rank === 1
  const fontSize = isFirst ? '2.25rem' : rank <= 3 ? '1.75rem' : '1.4rem'
  const nameColor = isFirst ? 'text-white' : 'text-zinc-200'
  const rankColor = isFirst ? 'text-yellow-400' : rank <= 3 ? 'text-zinc-300' : 'text-zinc-600'
  const ptsColor = isFirst ? 'text-yellow-400' : 'text-zinc-400'
  const bg = isFirst ? 'bg-zinc-900 border border-yellow-400/20' : 'bg-zinc-900/50'

  return (
    <div className={`flex items-center gap-4 px-5 py-3 rounded-2xl ${bg}`}>
      <span className={`font-black shrink-0 ${rankColor}`} style={{ fontSize, width: '3.5rem' }}>
        #{rank}
      </span>
      <span className={`flex-1 font-black truncate ${nameColor}`} style={{ fontSize }}>
        {name}
      </span>
      <span className={`font-black shrink-0 ${ptsColor}`} style={{ fontSize }}>
        {points} pts
      </span>
    </div>
  )
}

function MonthlyRow({ rank, name, points }: { rank: number; name: string; points: number }) {
  const isFirst = rank === 1
  const fontSize = isFirst ? '1.75rem' : '1.35rem'
  const nameColor = isFirst ? 'text-white' : 'text-zinc-300'
  const rankColor = isFirst ? 'text-yellow-400' : 'text-zinc-500'

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl ${isFirst ? 'bg-zinc-900 border border-zinc-700/50' : ''}`}>
      <span className={`font-black shrink-0 ${rankColor}`} style={{ fontSize, width: '2.75rem' }}>
        #{rank}
      </span>
      <span className={`flex-1 font-bold truncate ${nameColor}`} style={{ fontSize }}>
        {name}
      </span>
      <span className="font-bold shrink-0 text-zinc-500" style={{ fontSize }}>
        {points} pts
      </span>
    </div>
  )
}
