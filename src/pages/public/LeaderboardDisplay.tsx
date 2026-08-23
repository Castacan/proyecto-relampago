import { useState, useEffect } from 'react'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { useSponsorships } from '../../hooks/useSponsorships'
import { useDisplaySlides } from '../../hooks/useDisplaySlides'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { useSlideCarousel } from '../../hooks/useSlideCarousel'
import { getColorHex } from '../../lib/colors'
import { nowMX } from '../../lib/timezone'
import { MONTHS_ES, DAYS_ES } from '../../lib/dates'
import SponsorBanner from '../../components/SponsorBanner'
import DisplaySlide from '../../components/DisplaySlide'
import type { LeaderboardEntry, Sponsorship, SponsorPeriod } from '../../types'

export default function LeaderboardDisplay() {
  const { daily, weekly, monthly, events, loading, connected } = useLeaderboard()
  const { sponsorships } = useSponsorships()
  const { slides } = useDisplaySlides()
  const { settings } = useDisplaySettings()
  const { phase, currentSlide } = useSlideCarousel(slides, settings.slide_interval_seconds, settings.fade_duration_ms)
  const [tickerIdx, setTickerIdx] = useState(0)
  const [now, setNow] = useState(nowMX)

  // Precarga todas las imágenes de slides activos al montar/cambiar la
  // lista — son pocas y máx. 2MB cada una, más simple y seguro que
  // precargar solo la siguiente.
  useEffect(() => {
    slides.forEach(s => { new Image().src = s.image_url })
  }, [slides])

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

  // Rango del mes con nombre de día al inicio y fin (ej. "Sábado 1 a
  // Lunes 31 de Agosto"), no solo los números — mismo criterio que semana.
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const monthRange = `${DAYS_ES[firstOfMonth.getDay()]} 1 a ${DAYS_ES[lastOfMonth.getDay()]} ${lastOfMonth.getDate()} de ${MONTHS_ES[now.getMonth()]}`

  // Semana calendario lunes-domingo (date_trunc('week', ...) de Postgres
  // trunca a lunes, mismo criterio que usa get_weekly_leaderboard). Rango
  // con nombre de día (ej. "Lunes 24 a Domingo 30") — monday.getDay() es
  // siempre 1 y sunday.getDay() siempre 0 por construcción, pero se leen
  // de DAYS_ES igual para no hardcodear los nombres dos veces.
  const dow = now.getDay() // 0=domingo..6=sábado
  const monday = new Date(now)
  monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekRange = monday.getMonth() === sunday.getMonth()
    ? `${DAYS_ES[monday.getDay()]} ${monday.getDate()} a ${DAYS_ES[sunday.getDay()]} ${sunday.getDate()} de ${MONTHS_ES[monday.getMonth()]}`
    : `${DAYS_ES[monday.getDay()]} ${monday.getDate()} de ${MONTHS_ES[monday.getMonth()]} a ${DAYS_ES[sunday.getDay()]} ${sunday.getDate()} de ${MONTHS_ES[sunday.getMonth()]}`

  const currentEvent = events[tickerIdx]

  if (loading) {
    return (
      <div className="w-screen h-screen bg-fondo flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-primario border-t-transparent animate-spin" />
      </div>
    )
  }

  const leaderboardVisible = phase === 'leaderboard'
  const slideVisible = phase === 'slide'

  return (
    <div className="relative w-screen h-screen bg-fondo overflow-hidden font-sans select-none">
    <div
      className="absolute inset-0 flex flex-col transition-opacity"
      style={{ opacity: leaderboardVisible ? 1 : 0, transitionDuration: `${settings.fade_duration_ms}ms` }}
    >

      {/* Ticker superior */}
      <div className="shrink-0 h-14 bg-superficie border-b border-zinc-800 flex items-center px-8 gap-4">
        {events.length > 0 && currentEvent ? (
          <>
            <div
              className="w-3 h-3 rounded-full shrink-0 animate-pulse"
              style={{ backgroundColor: getColorHex(currentEvent.color) }}
            />
            <p className="text-zinc-200 text-lg font-bold tracking-wide">
              <span className="text-texto-principal">{currentEvent.display_name}</span>
              {' '}mandó{' '}
              <span style={{ color: getColorHex(currentEvent.color) }}>{currentEvent.grade}</span>
              {' '}{currentEvent.color}
            </p>
          </>
        ) : (
          <>
            <div className="w-3 h-3 rounded-full bg-primario shrink-0" />
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

      {/* Cuerpo: 3 columnas iguales, cada una con su propio patrocinador
          abajo (commit 2026-08-23, antes era Diario 65% + Mensual 35% con
          un solo banner global de pie de página) */}
      <div className="flex-1 flex overflow-hidden">
        <LeaderboardColumn
          title="HOY" titleAccent subtitle={dayLabel}
          entries={daily} emptyTitle="Nadie ha marcado un send hoy" emptySubtitle="¡Sé el primero!"
          period="top_1_daily" sponsorships={sponsorships} borderRight
        />
        <LeaderboardColumn
          title="SEMANA" subtitle={weekRange}
          entries={weekly} emptyTitle="Sin actividad esta semana"
          period="top_1_weekly" sponsorships={sponsorships} borderRight tinted
        />
        <LeaderboardColumn
          title={monthLabel.toUpperCase()} subtitle={monthRange}
          entries={monthly} emptyTitle="Sin actividad este mes"
          period="top_1_monthly" sponsorships={sponsorships}
        />
      </div>
    </div>

      <div
        className="absolute inset-0 transition-opacity"
        style={{ opacity: slideVisible ? 1 : 0, transitionDuration: `${settings.fade_duration_ms}ms` }}
      >
        <DisplaySlide slide={currentSlide} />
      </div>
    </div>
  )
}

interface ColumnProps {
  title: string
  titleAccent?: boolean
  subtitle: string
  entries: LeaderboardEntry[]
  emptyTitle: string
  emptySubtitle?: string
  period: SponsorPeriod
  sponsorships: Sponsorship[]
  borderRight?: boolean
  tinted?: boolean
}

function LeaderboardColumn({ title, titleAccent, subtitle, entries, emptyTitle, emptySubtitle, period, sponsorships, borderRight, tinted }: ColumnProps) {
  return (
    // Tinte muy sutil (5% blanco) solo en la columna Semana — deja claro
    // a simple vista que son 3 secciones distintas sin competir con el
    // fondo de las filas (bg-superficie/50), que se queda igual.
    <div className={`flex-1 flex flex-col overflow-hidden ${borderRight ? 'border-r border-zinc-800' : ''} ${tinted ? 'bg-white/5' : ''}`}>
      <div className="flex-1 flex flex-col px-6 py-6 overflow-hidden">
        <div className="mb-6 shrink-0">
          <h1
            className={`font-black tracking-tight ${titleAccent ? 'text-primario' : 'text-zinc-300'}`}
            style={{ fontSize: '2.5rem', lineHeight: 1 }}
          >
            {title}
          </h1>
          <p className="text-zinc-500 text-lg font-semibold mt-1">{subtitle}</p>
        </div>

        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-zinc-600 text-xl font-bold mb-1">{emptyTitle}</p>
              {emptySubtitle && <p className="text-zinc-700 text-base">{emptySubtitle}</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto">
            {entries.map((entry, i) => (
              <LeaderboardRow key={entry.display_name} rank={i + 1} name={entry.display_name} points={Number(entry.total_points)} />
            ))}
          </div>
        )}
      </div>

      {/* Patrocinador de este periodo si hay uno activo/ganador; si no,
          SponsorBanner mismo cae a un branding de respaldo (variant="tv"
          nunca regresa null, mantiene alineada la altura entre columnas) */}
      <SponsorBanner sponsorships={sponsorships} period={period} variant="tv" />
    </div>
  )
}

function LeaderboardRow({ rank, name, points }: { rank: number; name: string; points: number }) {
  const isFirst = rank === 1
  const fontSize = isFirst ? '2rem' : rank <= 3 ? '1.5rem' : '1.15rem'
  const nameColor = isFirst ? 'text-texto-principal' : 'text-zinc-200'
  const rankColor = isFirst ? 'text-primario' : rank <= 3 ? 'text-zinc-300' : 'text-zinc-600'
  const ptsColor = isFirst ? 'text-primario' : 'text-zinc-400'
  const bg = isFirst ? 'bg-superficie border border-primario/20' : 'bg-superficie/50'

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl ${bg}`}>
      <span className={`font-black shrink-0 ${rankColor}`} style={{ fontSize, width: '2.75rem' }}>
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
