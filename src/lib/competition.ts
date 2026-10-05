// Inscripciones a la competencia. Tablas y RPCs en
// src/supabase/competencia.sql; cobro en línea con Clip en
// src/supabase/competencia_pagos.sql + supabase/functions/competition-payments.

import { supabase } from './supabase'

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
