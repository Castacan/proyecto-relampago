// ERP / CRM (ventas, caja, ficha, domiciliación). Ver src/supabase/erp.sql.
import { supabase } from './supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as any

export type ProductKind = 'plan' | 'pass' | 'class' | 'product' | 'service'
export interface Product {
  id: string
  kind: ProductKind
  name: string
  description: string | null
  price_cents: number
  grants_membership: boolean
  duration_unit: 'day' | 'month' | null
  duration_value: number | null
  is_recurring: boolean
  promo_active: boolean
  promo_cycles: number | null
  promo_price_cents: number | null
  class_type_id: string | null
  track_stock: boolean
  stock: number | null
  is_active: boolean
  sort_order: number
}

export const KIND_LABELS: Record<ProductKind, string> = {
  plan: 'Plan / membresía',
  pass: 'Pase',
  class: 'Clase suelta',
  product: 'Producto',
  service: 'Servicio',
}

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta (terminal)',
  transfer: 'Transferencia',
  clip: 'Clip en línea',
  openpay: 'Domiciliación (Openpay)',
  stripe: 'Domiciliación (Stripe)',
  other: 'Otro',
}
export const POS_METHODS = ['cash', 'card', 'transfer', 'other'] as const

export const SOURCE_LABELS: Record<string, string> = {
  pos: 'Mostrador',
  class: 'Clase',
  subscription: 'Domiciliación',
  online: 'En línea',
}

export const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  pending_card: { label: 'Esperando tarjeta', cls: 'text-amarillo-suave bg-amarillo-suave/10' },
  active: { label: 'Activa', cls: 'text-exito bg-exito/10' },
  past_due: { label: 'Cobro pendiente', cls: 'text-white bg-alerta' },
  cancelled: { label: 'Cancelada', cls: 'text-zinc-300 bg-superficie-alta' },
}

export const CHARGE_STATUS: Record<string, string> = {
  pending: 'Por cobrar',
  processing: 'Cobrando…',
  paid: 'Pagado',
  failed: 'Rechazado',
  needs_action: 'Banco pidió autenticar',
  abandoned: 'Sin cobrar (cancelada)',
}

export const ERP_ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso para esto.',
  cash_closed: 'La caja está cerrada. Ábrela para poder cobrar.',
  cash_already_open: 'Ya hay una caja abierta.',
  empty_sale: 'Agrega al menos un artículo.',
  person_not_found: 'No encontramos a esa persona.',
  person_required: 'Elige a la persona: este plan le da membresía.',
  invalid_product: 'Ese artículo ya no está disponible.',
  use_subscription: 'Este plan se cobra por domiciliación: usa "Domiciliar" en la ficha de la persona.',
  price_locked: 'Solo un admin puede cambiar el precio.',
  out_of_stock: 'No hay suficiente inventario.',
  invalid_payment: 'Revisa las formas de pago.',
  payments_mismatch: 'Los pagos no suman el total.',
  invalid_discount: 'El descuento es mayor que el total.',
  invalid_amount: 'Revisa el monto.',
  invalid_value: 'Hay un valor inválido. Revisa los campos.',
  reason_required: 'Escribe el motivo.',
  difference_needs_note: 'Lo contado no cuadra con lo esperado: escribe una nota explicando la diferencia.',
  invalid_state: 'Ya cambió de estado. Actualiza la página.',
  subscription_sale: 'Los cobros de domiciliación no se anulan aquí (habla con el proveedor de pagos).',
  no_provider: 'Primero elige el proveedor de cobro recurrente en Configuración → Integraciones.',
  already_subscribed: 'Esta persona ya tiene esa domiciliación.',
  invalid_date: 'Revisa la fecha.',
  charge_in_progress: 'Hay un cobro en curso; intenta en unos minutos.',
  name_taken: 'Ya existe uno con ese nombre.',
  invalid_name: 'Revisa el nombre.',
  invalid_phone: 'El celular debe tener 10 dígitos.',
  invalid_email: 'Revisa el correo.',
  invalid_birth_date: 'Revisa la fecha de nacimiento.',
  email_taken: 'Ya hay otra persona con ese correo.',
  recurring_must_be_monthly: 'Un plan de domiciliación debe durar 1 mes.',
  promo_incomplete: 'Para la promoción escribe cuántos meses y el precio.',
  has_subscriptions: 'Ya hay domiciliaciones con este plan: no se puede cambiar si es recurrente.',
  invalid_stripe_key: 'La llave publicable de Stripe empieza con pk_test_ o pk_live_.',
  invalid_openpay_key: 'La llave pública de Openpay empieza con pk_.',
  not_found: 'No se encontró.',
}
export const erpError = (code?: string, fallback = 'No se pudo completar. Intenta de nuevo.') => (code && ERP_ERRORS[code]) || fallback

export function money(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`
}
export const toCents = (v: string) => Math.round(Number(String(v).replace(/[^0-9.]/g, '') || '0') * 100)
export const toPesos = (c: number | null | undefined) => (c == null ? '' : String(c / 100))

const TZ = 'America/Mexico_City'
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ })
}
export function todayMx(): string { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }) }

export function durationLabel(p: Pick<Product, 'duration_unit' | 'duration_value'>): string {
  if (!p.duration_unit || !p.duration_value) return ''
  return p.duration_unit === 'day'
    ? `${p.duration_value} ${p.duration_value === 1 ? 'día' : 'días'}`
    : `${p.duration_value} ${p.duration_value === 1 ? 'mes' : 'meses'}`
}

// Texto del esquema de cobro: "3 meses a $600, luego $800 al mes".
export function scheduleLabel(price: number, promoCycles: number | null | undefined, promoPrice: number | null | undefined): string {
  if (promoCycles && promoPrice != null) return `${promoCycles} ${promoCycles === 1 ? 'mes' : 'meses'} a ${money(promoPrice)}, luego ${money(price)} al mes`
  return `${money(price)} al mes`
}

export function subscriptionLink(token: string): string {
  return `${window.location.origin}/domiciliacion/${token}`
}

export async function call<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await db.rpc(fn, args)
  if (error) return { data: null, error: 'server' }
  if (data && typeof data === 'object' && 'error' in data && data.error) return { data, error: String(data.error) }
  return { data, error: null }
}

export async function billing<T = any>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('billing', { body })
  if (error) return { data: null, error: 'server' }
  if (data && typeof data === 'object' && 'error' in data && data.error) return { data, error: String(data.error) }
  return { data, error: null }
}
