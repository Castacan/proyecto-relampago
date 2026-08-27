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

// Dificultades del Spraywall (2026-08-27) — a pedido del usuario, propias
// e independientes de las V0-V9 del muro principal (esas siguen igual,
// GRADES en lib/colors.ts, atadas a puntos/leaderboard). Estas 4 son solo
// texto libre en spraywall_routes.grade, sin ninguna lógica de puntaje
// detrás — nombre + color para que se puedan reconocer de un vistazo,
// mismo espíritu (verde→rojo) que los colores de presa del muro principal.
export const SPRAYWALL_GRADES: { key: string; hex: string }[] = [
  { key: 'Básico', hex: '#4ADE80' },
  { key: 'Intermedio', hex: '#FACC15' },
  { key: 'Avanzado', hex: '#FB923C' },
  { key: 'Experto', hex: '#EF4444' },
]

export function getSpraywallGradeHex(grade: string): string {
  return SPRAYWALL_GRADES.find(g => g.key === grade)?.hex ?? '#94A3B8'
}
