// Cobro con la terminal física de Clip desde Vender (API de PinPad).
// Ver src/supabase/erp_clip_terminal.sql.
//
//   POST {action:'devices'}                          → (staff) estado de las terminales en Clip
//   POST {action:'charge', amount_cents, description} → (staff) manda el cobro a la terminal configurada
//   POST {action:'check', id}                        → (staff) consulta en Clip cómo va ese cobro
//   POST {action:'cancel', id}                       → (staff) cancela si la terminal aún no lo toma
//   POST ?wh=<terminal_payment id>                   → webhook de Clip (PINPAD_INTENT_STATUS_CHANGED)
//
// Reglas:
//   * El renglón local se escribe ANTES de mandarle el cobro a Clip.
//   * El webhook no trae firma: solo dispara una consulta. El estado que se
//     guarda es SIEMPRE el que responde la API de Clip con nuestras llaves.
//   * Nada marca un cobro como aprobado desde el navegador.
//
// Secretos (Edge Functions → Secrets): usa los mismos CLIP_API_KEY y
// CLIP_API_SECRET de la competencia. Si Clip da otra llave para PinPad, se
// pone en CLIP_PINPAD_TOKEN y esa manda.
// Se despliega con "Verify JWT" APAGADO (Clip no manda JWT al webhook).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CLIP_API_KEY = Deno.env.get('CLIP_API_KEY') ?? ''
const CLIP_API_SECRET = Deno.env.get('CLIP_API_SECRET') ?? ''
// La documentación de Clip pide la llave en "x-api-key" para crear/cancelar y
// en "Authorization: Basic" para consultar; mandamos las dos en cada llamada.
const TOKEN = Deno.env.get('CLIP_PINPAD_TOKEN') || (CLIP_API_KEY ? btoa(`${CLIP_API_KEY}:${CLIP_API_SECRET}`) : '')
const PAY_API = 'https://api.payclip.io/f2f/pinpad/v1/payment'
const DEVICES_API = 'https://api-gw.payclip.com/f2f/pinpad/v1/devices/status'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/clip-terminal`

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function clipHeaders(): Record<string, string> {
  return { 'x-api-key': TOKEN, 'Authorization': `Basic ${TOKEN}`, 'Content-Type': 'application/json', 'Pinpad-Include-Detail': 'true' }
}

async function caller(req: Request): Promise<{ staff: boolean; uid: string | null }> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return { staff: false, uid: null }
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } })
  const { data } = await c.rpc('get_clip_terminal_settings')
  if (!data || data.error) return { staff: false, uid: null }
  const { data: u } = await c.auth.getUser()
  return { staff: true, uid: u?.user?.id ?? null }
}

// Lo que se le regresa a Vender (sin el JSON crudo de Clip).
function view(row: Record<string, unknown>) {
  const { raw: _raw, ...rest } = row
  return rest
}

async function handleDevices(): Promise<Response> {
  if (!TOKEN) return json({ error: 'not_configured' })
  const r = await fetch(DEVICES_API, { headers: clipHeaders() })
  const body = await r.json().catch(() => null)
  if (!r.ok) return json({ error: 'clip_error', status: r.status, detail: body })
  return json({ devices: body })
}

async function handleCharge(body: any, uid: string | null): Promise<Response> {
  if (!TOKEN) return json({ error: 'not_configured' })
  const amount = Math.round(Number(body.amount_cents))
  if (!Number.isFinite(amount) || amount < 100 || amount > 5_000_000) return json({ error: 'invalid_amount' })
  const { data: s } = await db.from('erp_settings').select('clip_terminal_enabled, clip_terminal_serial').eq('id', 1).single()
  if (!s?.clip_terminal_enabled || !s.clip_terminal_serial) return json({ error: 'terminal_off' })
  const description = String(body.description ?? '').slice(0, 120) || 'Jaibamuro'

  const { data: row, error } = await db.from('terminal_payments')
    .insert({ serial_number: s.clip_terminal_serial, amount_cents: amount, description, created_by: uid })
    .select().single()
  if (error || !row) return json({ error: 'server_error' }, 500)

  const r = await fetch(PAY_API, {
    method: 'POST', headers: clipHeaders(),
    body: JSON.stringify({
      amount: amount / 100, currency: 'MXN', serial_number: s.clip_terminal_serial,
      description, external_reference: row.id, tip_enabled: false,
      webhook_url: `${FUNCTION_URL}?wh=${row.id}`,
      preferences: { tip_screen_enabled: false, msi_enabled: false, mci_enabled: false, nfc_enabled: true },
    }),
  })
  const res = await r.json().catch(() => null)
  if (!r.ok || !res?.id) {
    // 400 = terminal apagada, con la app PinPad cerrada u ocupada (ERR10_04).
    const msg = String(res?.message ?? res?.error ?? res?.code ?? `HTTP ${r.status}`).slice(0, 300)
    const { data: upd } = await db.from('terminal_payments')
      .update({ status: 'error', error: msg, raw: res, updated_at: new Date().toISOString() })
      .eq('id', row.id).select().single()
    return json({ error: r.status === 401 ? 'clip_auth' : 'terminal_unavailable', message: msg, payment: upd ? view(upd) : null })
  }
  const { data: upd } = await db.from('terminal_payments')
    .update({ request_id: res.id, status: 'sent', raw: res, updated_at: new Date().toISOString() })
    .eq('id', row.id).select().single()
  return json({ payment: view(upd ?? row) })
}

// Consulta Clip y guarda el estado. Un cobro ya cerrado no se vuelve a tocar.
async function refresh(id: string): Promise<Record<string, unknown> | null> {
  const { data: row } = await db.from('terminal_payments').select('*').eq('id', id).single()
  if (!row) return null
  if (!row.request_id || ['approved', 'declined', 'cancelled', 'error'].includes(row.status)) return row
  const r = await fetch(`${PAY_API}?pinpadRequestId=${encodeURIComponent(row.request_id)}`, { headers: clipHeaders() })
  const res = await r.json().catch(() => null)
  if (!r.ok || !res) return row

  const results: any[] = res?.detail?.results ?? []
  const approved = results.filter(t => t?.status === 'approved')
  const paidCents = Math.round(approved.reduce((a, t) => a + Number(t.amount ?? 0), 0) * 100)
  let status = row.status
  if (res.status === 'PENDING') status = 'sent'
  else if (res.status === 'IN_PROCESS') status = 'in_process'
  else if (res.status === 'COMPLETED') {
    // Aprobado aunque pague menos de lo pedido: amount_paid_cents lo dice y Vender lo avisa.
    if (approved.length > 0) status = 'approved'
    else if (results.some(t => t?.status === 'declined')) status = 'declined'
    else status = 'cancelled'
  }
  const card = approved[0]?.payment_method
  const patch: Record<string, unknown> = {
    status, raw: res, updated_at: new Date().toISOString(),
    amount_paid_cents: approved.length ? paidCents : null,
    card_brand: card?.id ?? null, card_last4: card?.card?.last_digits ?? null, card_issuer: card?.card?.issuer ?? null,
    transaction_id: approved[0]?.transaction_id ?? null,
  }
  const { data: upd } = await db.from('terminal_payments').update(patch).eq('id', id).select().single()
  return upd ?? row
}

async function handleCancel(id: string): Promise<Response> {
  const row = await refresh(id)
  if (!row) return json({ error: 'not_found' })
  if (row.status !== 'sent' && row.status !== 'creating') return json({ error: 'in_terminal', payment: view(row) })
  if (row.request_id) {
    const r = await fetch(`${PAY_API}/${encodeURIComponent(String(row.request_id))}`, { method: 'DELETE', headers: clipHeaders() })
    if (!r.ok) {
      // La terminal ya lo tomó: hay que cancelarlo en la pantalla de la terminal.
      return json({ error: 'in_terminal', payment: view((await refresh(id)) ?? row) })
    }
  }
  const { data: upd } = await db.from('terminal_payments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).select().single()
  return json({ payment: view(upd ?? row) })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const wh = new URL(req.url).searchParams.get('wh')
  try {
    if (wh) {
      // Webhook de Clip: solo dispara la consulta del cobro que ya conocemos.
      if (/^[0-9a-f-]{36}$/i.test(wh)) await refresh(wh)
      return json({ ok: true })
    }
    let body: any
    try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }
    const who = await caller(req)
    if (!who.staff) return json({ error: 'forbidden' }, 403)
    switch (body?.action) {
      case 'devices': return await handleDevices()
      case 'charge': return await handleCharge(body, who.uid)
      case 'check': {
        const row = await refresh(String(body.id ?? ''))
        return row ? json({ payment: view(row) }) : json({ error: 'not_found' })
      }
      case 'cancel': return await handleCancel(String(body.id ?? ''))
      default: return json({ error: 'bad_request' }, 400)
    }
  } catch (e) {
    console.error('clip-terminal', e)
    return json({ error: 'server_error' }, 500)
  }
})
