const GREEN_DAYS = 10
const YELLOW_DAYS = 20

export type FreshnessLevel = 'green' | 'yellow' | 'red'

export function getFreshnessLevel(placedAt: string): FreshnessLevel {
  const days = Math.floor((Date.now() - new Date(placedAt).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= GREEN_DAYS) return 'green'
  if (days <= YELLOW_DAYS) return 'yellow'
  return 'red'
}

export function getDaysOnWall(placedAt: string): number {
  return Math.floor((Date.now() - new Date(placedAt).getTime()) / (1000 * 60 * 60 * 24))
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
