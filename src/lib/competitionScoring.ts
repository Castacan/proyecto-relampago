// Conteo de puntos el día de la competencia: jueces en /juez y panel en
// /staff/competencia/puntos. Tablas y RPCs en src/supabase/competencia_jueces.sql.

export type AttemptResult = 'top' | 'zone' | 'fail'

export const RESULT_LABELS: Record<AttemptResult, string> = {
  top: 'Top',
  zone: 'Zona',
  fail: 'No completó',
}

// Código del juez guardado en su celular: si se cierra la pestaña o se va
// la señal, al volver sigue dentro sin escribirlo otra vez.
export const JUDGE_CODE_KEY = 'relampago_judge_code'

export interface RouteResult {
  route_number: number
  attempts: number
  topped: boolean
  zoned: boolean
  flash: boolean
  zone_first?: boolean
  points: number
}

export interface CompetitorCard {
  registration_id: string
  bib: number
  full_name: string
  category_name: string
  route_numbers: number[]
  routes: RouteResult[]
  points: number | null
}

export interface RankingRow {
  registration_id: string
  bib: number | null
  full_name: string
  category_id: string
  effective_category_id: string
  points: number
  tops: number
  zones: number
  flashes: number
  attempts: number
  routes_tried: number
  topped_routes: number[]
  last_at: string | null
  achieved_at: string | null   // cuándo consiguió sus últimos puntos (desempate)
  place: number
  routes: RouteResult[]
  promotion_hint: string | null
}

export const SCORING_ERRORS: Record<string, string> = {
  invalid_code: 'Esa palabra de juez no existe o está desactivada.',
  bib_not_found: 'No hay ningún competidor con ese número.',
  not_paid: 'Ese competidor no tiene la inscripción pagada.',
  invalid_route: 'Revisa el número de ruta.',
  invalid_result: 'Elige un resultado.',
  too_old: 'Solo se puede deshacer en los primeros 30 minutos. Pídele al admin que lo corrija.',
  already_voided: 'Ese intento ya estaba anulado.',
  not_found: 'No se encontró. Actualiza.',
  forbidden: 'No tienes permiso.',
  reason_required: 'Escribe el motivo.',
  invalid_value: 'Revisa los valores: la zona debe valer menos que el top y la resta debe ser entre 0 y 1.',
  invalid_merge: 'No se puede juntar así: la categoría destino no puede estar juntada con otra.',
  invalid_name: 'Escribe el nombre (2 a 60 letras).',
  code_taken: 'Esa palabra ya la tiene otro juez. Elige otra.',
  has_attempts: 'Ya hay intentos capturados: ya no se puede numerar de nuevo. Cambia números uno por uno.',
  bib_taken: 'Ese número ya lo tiene otro competidor.',
  invalid_bib: 'El número debe ser entre 1 y 9999.',
}

export const scoringError = (code: string | undefined) =>
  (code && SCORING_ERRORS[code]) || 'Algo salió mal. Intenta de nuevo.'

/** "1-8, 12" → [1,2,…,8,12]. null si el texto no se entiende. */
export function parseRouteList(text: string): number[] | null {
  const out = new Set<number>()
  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-|a)\s*(\d+)$/i)
    if (m) {
      const a = Number(m[1]), b = Number(m[2])
      if (a < 1 || b < a || b > 999) return null
      for (let n = a; n <= b; n++) out.add(n)
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1 || n > 999) return null
      out.add(n)
    } else {
      return null
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
export function formatRouteList(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]))
    i = j
  }
  return parts.join(', ')
}

export const fmtPoints = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/Mexico_City' })
