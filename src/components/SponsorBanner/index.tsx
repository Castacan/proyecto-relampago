import { useState, useEffect } from 'react'
import { nowMX } from '../../lib/timezone'
import { getBannerSponsorship, getDaysRemaining } from '../../lib/sponsorship'
import type { Sponsorship } from '../../types'

interface Props {
  sponsorships: Sponsorship[]
  variant: 'tv' | 'mobile'
}

// Ticker propio de 60s, desacoplado del hook de datos — el countdown
// depende del reloj, no de que cambie una fila en la tabla.
export default function SponsorBanner({ sponsorships, variant }: Props) {
  const [now, setNow] = useState(nowMX)

  useEffect(() => {
    const t = setInterval(() => setNow(nowMX()), 60_000)
    return () => clearInterval(t)
  }, [])

  const result = getBannerSponsorship(sponsorships, now)
  if (!result) return null
  const { sponsorship, mode } = result

  if (mode === 'winner') {
    return (
      <div className={variant === 'tv'
        ? 'shrink-0 py-3 px-8 bg-primario/10 border-t border-primario/30 flex items-center justify-center gap-3'
        : 'px-4 py-3 mb-5 bg-primario/10 border border-primario/30 rounded-2xl text-center'
      }>
        <p className={variant === 'tv' ? 'text-primario font-black text-xl' : 'text-primario font-bold text-sm'}>
          🏆 {sponsorship.winner?.display_name ?? '—'} ganó {sponsorship.prize_text} — ¡Felicidades!
        </p>
      </div>
    )
  }

  const daysRemaining = getDaysRemaining(sponsorship.ends_at, now)
  const daysLabel = daysRemaining === 0 ? 'Termina hoy' : `Quedan ${daysRemaining} día${daysRemaining === 1 ? '' : 's'}`

  if (variant === 'tv') {
    return (
      <div className="shrink-0 h-20 bg-superficie border-t border-zinc-800 flex items-center px-8 gap-5">
        <span className="text-zinc-500 text-xs font-bold uppercase tracking-wide shrink-0">🏆 Patrocinador del mes</span>
        <img src={sponsorship.sponsor_logo} alt={sponsorship.sponsor_name} className="h-12 w-auto object-contain shrink-0" />
        <p className="flex-1 text-zinc-200 text-lg font-semibold truncate">
          El #1 del mes se lleva <span className="text-primario font-black">{sponsorship.prize_text}</span>
        </p>
        <span className="text-zinc-400 text-lg font-bold shrink-0">{daysLabel}</span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 mb-5 bg-superficie border border-zinc-800/60 rounded-2xl">
      <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wide mb-2">🏆 Patrocinador del mes</p>
      <div className="flex items-center gap-3">
        <img src={sponsorship.sponsor_logo} alt={sponsorship.sponsor_name} className="h-10 w-auto object-contain shrink-0" />
        <p className="flex-1 text-zinc-300 text-xs font-medium leading-snug">
          El #1 se lleva <span className="text-primario font-bold">{sponsorship.prize_text}</span> · {daysLabel}
        </p>
      </div>
    </div>
  )
}
