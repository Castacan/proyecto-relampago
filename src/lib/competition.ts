// Inscripciones a la competencia. Tablas y RPCs en
// src/supabase/competencia.sql; cobro en línea con Clip en
// src/supabase/competencia_pagos.sql + supabase/functions/competition-payments.

import { supabase } from './supabase'

// Slug de la competencia vigente — coincide con el seed de competencia.sql.
export const COMPETITION_SLUG = 'competencia-2026'

// Último folio creado en este dispositivo ({folio, email}) — la página de
// consulta lo precarga si la persona cerró la pestaña antes de pagar.
export const LAST_REGISTRATION_KEY = 'relampago_competition_last'

// "Cupo ilimitado" se guarda como un cupo enorme (capacity_total es NOT
// NULL y toda la lógica de cupo sigue igual). De este valor para arriba el
// panel dice "sin límite" en vez de mostrar el número.
export const UNLIMITED_CAPACITY = 100000

// Con cupo sin límite no hay lugar que "apartar": las pantallas no hablan
// de reserva ni de fecha límite, solo de que falta el pago.
export function isUnlimitedCapacity(spotsLeft: number): boolean {
  return spotsLeft >= UNLIMITED_CAPACITY / 2
}

// La página pública solo menciona lugares disponibles cuando quedan pocos.
export const SPOTS_NOTICE_THRESHOLD = 20

export const SHIRT_SIZES =['S', 'M', 'L', 'XL'] as const
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
  courtesy?: boolean        // inscrita con código de cortesía: ya confirmada, sin pago
  time_slot_label?: string  // horario elegido (competencia_horarios.sql)
}

// ---- Horarios (bloques que mezclan categorías) ----
// src/supabase/competencia_horarios.sql. El cupo de cada bloque sube solo
// cuando todos se llenan; la persona elige una vez y después solo staff
// lo cambia.
export interface TimeSlot {
  id: string
  label: string
  is_full: boolean
}

export interface RegistrationSlot {
  time_slot_id: string | null
  time_slot_label?: string
  can_choose?: boolean
  slots?: TimeSlot[]
}

export const SLOT_ERRORS: Record<string, string> = {
  invalid_slot: 'Elige un horario.',
  slot_full: 'Ese horario se acaba de llenar. Elige otro.',
  already_chosen: 'Ya tienes un horario. Si necesitas cambiarlo, escríbenos.',
  not_active: 'Esta inscripción ya no está activa.',
  not_found: 'No encontramos tu inscripción.',
}

export async function fetchTimeSlots(): Promise<TimeSlot[]> {
  const { data, error } = await (supabase as unknown as { rpc: (f: string, a: object) => Promise<{ data: { slots?: TimeSlot[] } | null; error: unknown }> })
    .rpc('get_competition_slots_public', { p_slug: COMPETITION_SLUG })
  if (error || !data?.slots) return []
  return data.slots
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

// Aviso junto al selector de categoría. El mismo criterio va, más
// completo, en el texto de reglas que se acepta (competitions.waiver_text).
export const CATEGORY_NOTICE = 'Elige la categoría de tu nivel real. Medimos el desempeño de todos los participantes y podemos mover a una categoría más difícil a quien compita por debajo de su nivel.'

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
  waiver_required: 'Debes aceptar las reglas y el deslinde de responsabilidad.',
  closed: 'Las inscripciones están cerradas.',
  full: 'Ya no quedan lugares.',
  category_full: 'Esa categoría ya está llena. Elige otra.',
  duplicate: 'Ya existe una inscripción activa con ese nombre y fecha de nacimiento. Consulta tu inscripción con tu folio.',
  too_many_pending: 'Ya hay varias inscripciones pendientes de pago con este correo. Paga alguna antes de crear otra.',
  invalid_code: 'Ese código promocional no es válido. Revísalo o déjalo vacío para pagar.',
  code_used_up: 'Ese código promocional ya se usó.',
  invalid_slot: 'Elige un horario.',
  slot_full: 'Ese horario se acaba de llenar. Elige otro.',
}

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending_payment: 'Pendiente de pago',
  paid: 'Pagado',
  expired: 'Vencido',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  needs_attention: 'Por atender',
}

// ---- Cobro en línea (Clip) ----
// El navegador solo PIDE el link o PIDE que se revise el estado; quien
// confirma un pago es siempre el servidor consultando a Clip.

export const PAYMENT_ERRORS: Record<string, string> = {
  not_found: 'No encontramos tu inscripción. Revisa tu folio y correo.',
  already_paid: 'Esta inscripción ya está pagada.',
  not_payable: 'Esta inscripción ya no se puede pagar. Escríbenos si crees que es un error.',
  full: 'Tu reserva venció y ya no quedan lugares, por eso no generamos el cobro.',
  busy: 'Ya estamos generando tu pago. Espera unos segundos e intenta de nuevo.',
  not_configured: 'El pago en línea aún no está disponible. Te contactaremos con los datos para pagar.',
}

const PAYMENT_ERROR_DEFAULT = 'No pudimos generar tu pago. Intenta de nuevo en un momento.'

// Pide el link de pago de Clip para una inscripción. Devuelve la URL a la
// que hay que mandar a la persona, o el mensaje de error a mostrar.
export async function startOnlinePayment(folio: string, email: string): Promise<{ url: string } | { message: string }> {
  const { data, error } = await supabase.functions.invoke('competition-payments', {
    body: { action: 'pay', folio, email },
  })
  if (error || !data) return { message: PAYMENT_ERROR_DEFAULT }
  if (typeof data.payment_url === 'string') return { url: data.payment_url }
  return { message: PAYMENT_ERRORS[data.error] ?? PAYMENT_ERROR_DEFAULT }
}

// Pide al servidor que consulte en Clip los links abiertos de esta
// inscripción (por si el aviso automático de Clip no llegó).
export async function refreshOnlinePayment(folio: string, email: string): Promise<void> {
  try {
    await supabase.functions.invoke('competition-payments', { body: { action: 'check', folio, email } })
  } catch { /* la consulta de estado sigue funcionando sin esto */ }
}
