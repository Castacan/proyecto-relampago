const GREEN_DAYS = 10
const YELLOW_DAYS = 20

export type FreshnessLevel = 'green' | 'yellow' | 'red'

// Diferencia en días de calendario (medianoche a medianoche, hora local), no en bloques de 24h.
function calendarDaysSince(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  const thenMidnight = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  const nowMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((nowMidnight - thenMidnight) / (1000 * 60 * 60 * 24))
}

export function getFreshnessLevel(placedAt: string): FreshnessLevel {
  const days = calendarDaysSince(placedAt)
  if (days <= GREEN_DAYS) return 'green'
  if (days <= YELLOW_DAYS) return 'yellow'
  return 'red'
}

export function getDaysOnWall(placedAt: string): number {
  return calendarDaysSince(placedAt)
}

export function getFreshnessColor(level: FreshnessLevel): string {
  if (level === 'green') return '#22c55e'
  if (level === 'yellow') return '#eab308'
  return '#ef4444'
}

export function getPublicLabel(level: FreshnessLevel): string {
  if (level === 'green') return 'Crudo'
  if (level === 'yellow') return 'Al dente'
  return 'Quemada'
}
