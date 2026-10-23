// Clases y reservas (Fase 1a). Ver src/supabase/clases.sql y
// docs/plan-erp-clases.md. Los textos y reglas viven en la base
// (class_settings / class_types); aquí solo tipos, etiquetas y formatos.
import { supabase } from './supabase'

export const TZ = 'America/Mexico_City'

export interface ClassSettings {
  book_ahead_days: number
  cancel_hours: number
  free_classes_per_month: number
  overbook_tolerance: number
  allow_pay_at_gym: boolean
  rules_text: string | null
}

export type BookingStatus =
  | 'pending_payment' | 'booked' | 'attended' | 'no_show'
  | 'cancelled' | 'cancelled_late' | 'cancelled_by_gym'
export type PriceTier = 'regular' | 'member' | 'free_monthly' | 'courtesy'
export type PaymentMethod = 'online' | 'at_gym' | 'none'
export type PaymentStatus = 'not_needed' | 'pending' | 'paid' | 'refunded'

export interface MyBookingRef {
  id: string
  status: BookingStatus
  price_tier: PriceTier
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  amount_cents: number
}

export interface CalendarSession {
  id: string
  class_type_id: string
  name: string
  description: string | null
  level: string | null
  color: string | null
  instructor_name: string | null
  starts_at: string
  ends_at: string
  status: 'scheduled' | 'cancelled'
  capacity: number
  spots_left: number
  price_cents: number
  member_price_cents: number
  booking_mode: 'online' | 'staff_only'
  eligible_free_monthly: boolean
  bookable: boolean
  is_member: boolean
  free_left: number
  my_booking: MyBookingRef | null
}

export interface CalendarMe {
  person_id: string
  full_name: string
  phone: string | null
  membership_until: string | null
}

export interface Calendar {
  settings: ClassSettings
  today: string
  me: CalendarMe | null
  sessions: CalendarSession[]
}

export interface BookingInfo {
  id: string
  session_id: string
  person_id: string
  status: BookingStatus
  price_tier: PriceTier
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  paid_with: string | null
  amount_cents: number
  is_overbook: boolean
  needs_reschedule: boolean
  booked_at: string
  cancelled_at: string | null
  full_name: string
  phone: string | null
  email: string | null
  is_minor: boolean
  class_name: string
  starts_at: string
  ends_at: string
  instructor_name: string | null
}

export const ACTIVE_STATUSES: BookingStatus[] = ['pending_payment', 'booked', 'attended', 'no_show']
export const isActiveBooking = (s: BookingStatus) => ACTIVE_STATUSES.includes(s)

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_payment: 'Por pagar',
  booked: 'Reservada',
  attended: 'Asistió',
  no_show: 'Faltó',
  cancelled: 'Cancelada',
  cancelled_late: 'Cancelada tarde',
  cancelled_by_gym: 'Cancelada por el gym',
}

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  regular: 'Precio normal',
  member: 'Precio miembro',
  free_monthly: 'Gratis del mes',
  courtesy: 'Cortesía',
}

export const PAID_WITH_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  clip: 'Clip en línea',
  other: 'Otro',
}

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export const CLASS_ERRORS: Record<string, string> = {
  not_logged_in: 'Inicia sesión para reservar.',
  profile_required: 'Completa tus datos para reservar.',
  invalid_option: 'Elige cómo vas a pagar.',
  not_found: 'No encontramos esa clase. Actualiza la página.',
  not_available: 'Esa clase ya no está disponible.',
  staff_only: 'Esta clase se agenda directamente con el staff.',
  started: 'La clase ya empezó.',
  too_early: 'Todavía no se abren las reservas para esa fecha.',
  already_booked: 'Ya tienes una reserva en esa clase.',
  full: 'La clase está llena.',
  not_member: 'Necesitas una membresía vigente para eso.',
  not_eligible: 'Esa clase no entra en la clase gratis del mes.',
  free_used: 'Ya usaste tu clase gratis de ese mes.',
  pay_at_gym_disabled: 'Por ahora no se puede reservar para pagar en el gym.',
  invalid_state: 'La reserva ya cambió. Actualiza la página.',
  invalid_name: 'Escribe el nombre completo.',
  invalid_phone: 'El celular debe tener 10 dígitos.',
  invalid_email: 'Revisa el correo.',
  invalid_birth_date: 'Revisa la fecha de nacimiento.',
  email_taken: 'Ya hay otra persona con ese correo.',
  person_not_found: 'No encontramos a esa persona.',
  invalid_tier: 'Elige el precio.',
  invalid_method: 'Elige cómo pagó.',
  invalid_status: 'Estado inválido.',
  invalid_class: 'Elige una clase.',
  invalid_amount: 'Revisa el monto.',
  invalid_value: 'Hay un valor inválido. Revisa los campos.',
  invalid_date: 'Revisa la fecha.',
  name_taken: 'Ya existe una clase con ese nombre.',
  reason_required: 'Escribe el motivo.',
  forbidden: 'No tienes permiso para esto.',
}

export const classError = (code: string | undefined, fallback = 'No se pudo completar. Intenta de nuevo.') =>
  (code && CLASS_ERRORS[code]) || fallback

export function formatMoney(cents: number): string {
  const pesos = cents / 100
  return `$${pesos.toLocaleString('es-MX', { minimumFractionDigits: Number.isInteger(pesos) ? 0 : 2 })}`
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
}

export function fmtDayLong(iso: string): string {
  const s = new Date(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// "YYYY-MM-DD" de un instante, en hora de México.
export function mxDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

export function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

// Suma días a "YYYY-MM-DD" sin pasar por zonas horarias.
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function fmtDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Correos (Edge Function class-emails). Se dispara y se olvida: si falla,
// la reserva ya quedó hecha; solo no llega el aviso.
export function sendClassEmails(bookingIds: string[], kind: 'confirmation' | 'cancel') {
  if (bookingIds.length === 0) return
  supabase.functions.invoke('class-emails', { body: { booking_ids: bookingIds, kind } }).catch(() => { /* sin correo */ })
}
