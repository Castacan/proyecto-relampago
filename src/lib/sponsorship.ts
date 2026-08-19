import { nowMX, toMXDate } from './timezone'
import type { Sponsorship } from '../types'

// Días de calendario (medianoche a medianoche, hora MX), igual que
// calendarDaysSince en freshness.ts pero con el signo invertido: cuenta
// hacia adelante en vez de hacia atrás.
export function getDaysRemaining(endsAtIso: string, now: Date = nowMX()): number {
  const end = toMXDate(endsAtIso)
  const endMidnight = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const nowMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((endMidnight - nowMidnight) / 86_400_000))
}

export type BannerMode = 'sponsor' | 'winner'

const WINNER_BANNER_WINDOW_MS = 48 * 60 * 60 * 1000

// Decide qué patrocinio (si alguno) debe mostrarse en el banner ahora mismo:
// - 'sponsor': hay un patrocinio activo dentro de su ventana starts_at/ends_at.
// - 'winner': un patrocinio ya terminó, tiene ganador, y sigue dentro de la
//   ventana de anuncio (no entregado Y <48h desde que terminó).
// null si no hay nada que mostrar.
export function getBannerSponsorship(
  sponsorships: Sponsorship[],
  now: Date = nowMX()
): { sponsorship: Sponsorship; mode: BannerMode } | null {
  const nowIso = now.toISOString()

  const active = sponsorships.find(
    s => s.is_active && s.starts_at <= nowIso && s.ends_at >= nowIso
  )
  if (active) return { sponsorship: active, mode: 'sponsor' }

  const winnerWindow = sponsorships.find(s =>
    s.is_active &&
    s.winner_user_id &&
    !s.prize_delivered &&
    s.ends_at < nowIso &&
    now.getTime() - new Date(s.ends_at).getTime() < WINNER_BANNER_WINDOW_MS
  )
  return winnerWindow ? { sponsorship: winnerWindow, mode: 'winner' } : null
}
