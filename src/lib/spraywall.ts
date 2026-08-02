export type HoldRole = 'top' | 'disponible' | 'inicio_pie' | 'inicio_mano'

export const HOLD_ROLES: { key: HoldRole; hex: string; label: string }[] = [
  { key: 'top',         hex: '#CC0000', label: 'Top' },
  { key: 'disponible',  hex: '#A3E635', label: 'Disponible' },
  { key: 'inicio_pie',  hex: '#1C1C1E', label: 'Inicio pie' },
  { key: 'inicio_mano', hex: '#F1F5F9', label: 'Inicio mano' },
]

export function getHoldHex(role: HoldRole): string {
  return HOLD_ROLES.find(r => r.key === role)?.hex ?? '#94A3B8'
}
