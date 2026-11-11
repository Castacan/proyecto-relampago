import { supabase } from './supabase'

// Cobro con la terminal física de Clip (Edge Function clip-terminal).
export interface TerminalPayment {
  id: string
  status: 'creating' | 'sent' | 'in_process' | 'approved' | 'declined' | 'cancelled' | 'error'
  amount_cents: number
  amount_paid_cents: number | null
  card_brand: string | null
  card_last4: string | null
  error: string | null
}

export async function terminal<T = any>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('clip-terminal', { body })
  if (error) return { data: null, error: 'server' }
  if (data && typeof data === 'object' && 'error' in data && data.error) return { data, error: String(data.error) }
  return { data, error: null }
}

export const TERMINAL_ERRORS: Record<string, string> = {
  not_configured: 'Faltan las llaves de Clip en el servidor.',
  terminal_off: 'La terminal Clip no está configurada (Config → Integraciones).',
  terminal_unavailable: 'La terminal no respondió: revisa que esté prendida, con internet y con la app PinPad abierta.',
  clip_auth: 'Clip rechazó las llaves. Revisa la llave de API de PinPad.',
  invalid_amount: 'El monto mínimo con terminal es $1.',
  in_terminal: 'La terminal ya tomó el cobro: cancélalo en la pantalla de la terminal.',
  server: 'No hubo conexión con el servidor. Intenta de nuevo.',
}

export function cardLabel(p: Pick<TerminalPayment, 'card_brand' | 'card_last4'>): string {
  const brand = p.card_brand ? p.card_brand.charAt(0).toUpperCase() + p.card_brand.slice(1) : 'Tarjeta'
  return p.card_last4 ? `${brand} ····${p.card_last4}` : brand
}
