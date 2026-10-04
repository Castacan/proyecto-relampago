// Inscripciones a la competencia (Etapa 1: registro + pago por link
// confirmado a mano). Tablas y RPCs en src/supabase/competencia.sql.

// Slug de la competencia vigente — coincide con el seed de competencia.sql.
export const COMPETITION_SLUG = 'competencia-2026'

// Último folio creado en este dispositivo ({folio, email}) — la página de
// consulta lo precarga si la persona cerró la pestaña antes de pagar.
export const LAST_REGISTRATION_KEY = 'relampago_competition_last'

export const SHIRT_SIZES = ['S', 'M', 'L', 'XL'] as const
export type ShirtSize = typeof SHIRT_SIZES[number]

export type RegistrationStatus =
  | 'pending_payment' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'needs_attention'

export interface PublicCategory {
  id: string
  name: string
  gender: string | null
  level: string | null
  description: string | null
  is_full: boolean
}

export interface PublicCompetition {
  name: string
  event_date: string
  event_time_text: string | null
  place: string | null
  includes_text: string | null
  price_cents: number
  state: 'open' | 'not_yet' | 'closed' | 'full'
  spots_left: number
  registration_opens_at: string | null
  registration_closes_at: string | null
  hold_hours: number
  privacy_text: string
  waiver_text: string | null
  categories: PublicCategory[]
}

export interface RegistrationResult {
  folio: string
  full_name: string
  category_name: string
  shirt_size: ShirtSize
  hold_expires_at: string
  price_cents: number
  payment_link_url: string | null
  payment_instructions: string | null
  is_minor: boolean
}

export interface RegistrationLookup {
  folio: string
  full_name: string
  category_name: string
  shirt_size: ShirtSize
  status: RegistrationStatus
  hold_expires_at: string | null
  hold_expired: boolean
  paid_at: string | null
  price_cents: number
  payment_link_url: string | null
  payment_instructions: string | null
  is_minor: boolean
  competition_name: string
  event_date: string
  event_time_text: string | null
  place: string | null
}

export const MINOR_NOTICE = 'Eres menor de edad: el día del evento debes llegar con un mayor de edad para firmar tu registro.'

export function formatPrice(cents: number): string {
  const pesos = cents / 100
  return `$${pesos.toLocaleString('es-MX', { minimumFractionDigits: Number.isInteger(pesos) ? 0 : 2 })} MXN`
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

// Mensajes para los códigos de error de register_for_competition.
export const REGISTER_ERRORS: Record<string, string> = {
  invalid_name: 'Revisa tu nombre completo.',
  invalid_birth_date: 'Revisa tu fecha de nacimiento.',
  invalid_email: 'Revisa tu correo.',
  invalid_phone: 'El celular debe tener 10 dígitos.',
  invalid_shirt_size: 'Elige una talla de playera.',
  invalid_category: 'Elige una categoría.',
  privacy_required: 'Debes aceptar el aviso de privacidad.',
  waiver_required: 'Debes aceptar el deslinde de responsabilidad.',
  closed: 'Las inscripciones están cerradas.',
  full: 'Ya no quedan lugares.',
  category_full: 'Esa categoría ya está llena. Elige otra.',
  duplicate: 'Ya existe una inscripción activa con ese nombre y fecha de nacimiento. Consulta tu inscripción con tu folio.',
  too_many_pending: 'Ya hay varias inscripciones pendientes de pago con este correo. Paga alguna antes de crear otra.',
}

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending_payment: 'Pendiente de pago',
  paid: 'Pagado',
  expired: 'Vencido',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  needs_attention: 'Por atender',
}
