import { nowMX, toMXDate } from './timezone'
import type { Sponsorship, SponsorPeriod } from '../types'

// Copy por periodo — usado en SponsorBanner (TV y móvil) y SponsorForm.
export const PERIOD_LABELS: Record<SponsorPeriod, { short: string; article: string }> = {
  top_1_daily: { short: 'del día', article: 'de hoy' },
  top_1_weekly: { short: 'de la semana', article: 'de la semana' },
  top_1_monthly: { short: 'del mes', article: 'del mes' },
}

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

// Decide qué patrocinio (si alguno) debe mostrarse en el banner de un
// periodo (día/semana/mes) ahora mismo:
// - 'sponsor': hay un patrocinio de ese periodo activo dentro de su ventana
//   starts_at/ends_at.
// - 'winner': un patrocinio de ese periodo ya terminó, tiene ganador, y
//   sigue dentro de la ventana de anuncio (no entregado Y <48h desde que
//   terminó).
// null si no hay nada que mostrar. Cada periodo se evalúa de forma
// independiente (commit 2026-08-23) — pueden coexistir hasta 3 banners
// activos a la vez, uno por columna del leaderboard TV.
export function getBannerSponsorship(
  sponsorships: Sponsorship[],
  period: SponsorPeriod,
  now: Date = nowMX()
): { sponsorship: Sponsorship; mode: BannerMode } | null {
  const nowIso = now.toISOString()
  const ofPeriod = sponsorships.filter(s => s.winner_rule === period)

  const active = ofPeriod.find(
    s => s.is_active && s.starts_at <= nowIso && s.ends_at >= nowIso
  )
  if (active) return { sponsorship: active, mode: 'sponsor' }

  const winnerWindow = ofPeriod.find(s =>
    s.is_active &&
    s.winner_user_id &&
    !s.prize_delivered &&
    s.ends_at < nowIso &&
    now.getTime() - new Date(s.ends_at).getTime() < WINNER_BANNER_WINDOW_MS
  )
  return winnerWindow ? { sponsorship: winnerWindow, mode: 'winner' } : null
}
