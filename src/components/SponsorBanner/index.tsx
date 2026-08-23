import { useState, useEffect } from 'react'
import { nowMX } from '../../lib/timezone'
import { getBannerSponsorship, getDaysRemaining, PERIOD_LABELS } from '../../lib/sponsorship'
import type { Sponsorship, SponsorPeriod } from '../../types'

interface Props {
  sponsorships: Sponsorship[]
  period: SponsorPeriod
  variant: 'tv' | 'mobile'
}

// Ticker propio de 60s, desacoplado del hook de datos — el countdown
// depende del reloj, no de que cambie una fila en la tabla.
export default function SponsorBanner({ sponsorships, period, variant }: Props) {
  const [now, setNow] = useState(nowMX)

  useEffect(() => {
    const t = setInterval(() => setNow(nowMX()), 60_000)
    return () => clearInterval(t)
  }, [])

  const result = getBannerSponsorship(sponsorships, period, now)

  if (!result) {
    // Variant "tv" siempre reserva su franja de pie de columna (branding de
    // respaldo) para que las 3 columnas del leaderboard queden alineadas en
    // altura aunque solo alguna tenga patrocinador activo ahora mismo.
    // Variant "mobile" no tiene ese requisito de alineación — no renderiza
    // nada, igual que antes.
    if (variant !== 'tv') return null
    return (
      <div className="shrink-0 h-10 bg-superficie border-t border-zinc-800 flex items-center justify-center gap-2">
        <span className="text-primario text-sm">⚡</span>
        <span className="text-zinc-600 text-sm font-medium">Jaibamuro</span>
      </div>
    )
  }

  const { sponsorship, mode } = result
  const label = PERIOD_LABELS[period]

  if (mode === 'winner') {
    return (
      <div className={variant === 'tv'
        ? 'shrink-0 py-2.5 px-4 bg-primario/10 border-t border-primario/30 flex items-center justify-center text-center'
        : 'px-4 py-3 mb-5 bg-primario/10 border border-primario/30 rounded-2xl text-center'
      }>
        <p className={variant === 'tv' ? 'text-primario font-black text-sm leading-tight' : 'text-primario font-bold text-sm'}>
          🏆 {sponsorship.winner?.display_name ?? '—'} ganó {sponsorship.prize_text} — ¡Felicidades!
        </p>
      </div>
    )
  }

  const daysRemaining = getDaysRemaining(sponsorship.ends_at, now)
  const daysLabel = daysRemaining === 0 ? 'Termina hoy' : `Quedan ${daysRemaining} día${daysRemaining === 1 ? '' : 's'}`

  // Variant "tv" vive dentro de una columna de ~1/3 de pantalla (leaderboard
  // de 3 secciones, 2026-08-23) — layout apilado en vez del banner de ancho
  // completo que era antes, para caber en el espacio angosto.
  if (variant === 'tv') {
    return (
      <div className="shrink-0 px-4 py-2.5 bg-superficie border-t border-zinc-800 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wide truncate">🏆 Patrocinador {label.short}</span>
          <span className="text-zinc-400 text-xs font-bold shrink-0">{daysLabel}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <img src={sponsorship.sponsor_logo} alt={sponsorship.sponsor_name} className="h-8 w-auto object-contain shrink-0" />
          <p className="flex-1 text-zinc-200 text-xs font-semibold truncate">
            El #1 {label.article} se lleva <span className="text-primario font-black">{sponsorship.prize_text}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 mb-5 bg-superficie border border-zinc-800/60 rounded-2xl">
      <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wide mb-2">🏆 Patrocinador {label.short}</p>
      <div className="flex items-center gap-3">
        <img src={sponsorship.sponsor_logo} alt={sponsorship.sponsor_name} className="h-10 w-auto object-contain shrink-0" />
        <p className="flex-1 text-zinc-300 text-xs font-medium leading-snug">
          El #1 {label.article} se lleva <span className="text-primario font-bold">{sponsorship.prize_text}</span> · {daysLabel}
        </p>
      </div>
    </div>
  )
}
