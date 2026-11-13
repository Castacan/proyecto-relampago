// Anticipo de clases con Clip (ver src/supabase/clases_anticipo.sql).
// Mismo esquema que competition-payments:
//   POST {action:'pay', booking_id}    (con la sesión del cliente) → link de pago de Clip
//   POST {action:'check', booking_id}  → consulta en Clip los links abiertos de esa reserva
//   POST {action:'reconcile'}          (solo staff) → consulta todos los links abiertos
//   POST ?wh=<payment_id>&s=<firma>    → webhook de Clip
//
// Reglas:
//   * El pago local se escribe ANTES de pedirle el link a Clip.
//   * El webhook de Clip no trae firma: el estado que se aplica es SIEMPRE el
//     que responde la API de Clip al consultarla con nuestras credenciales.
//   * Nada marca un anticipo como pagado desde el navegador.
//
// Usa los mismos secretos que competition-payments (CLIP_API_KEY,
// CLIP_API_SECRET, APP_URL opcional). Se despliega con "Verify JWT" APAGADO.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CLIP_API_KEY = Deno.env.get('CLIP_API_KEY') ?? ''
const CLIP_API_SECRET = Deno.env.get('CLIP_API_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.jaibamuro.com').replace(/\/$/, '')

const CLIP_API = 'https://api.payclip.com/v2/checkout'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/class-payments`

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const UUID_RE = /^[0-9a-f-]{36}$/

async function sign(paymentId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIP_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('class:' + paymentId))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function clip(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': 'Basic ' + btoa(`${CLIP_API_KEY}:${CLIP_API_SECRET}`),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  return { ok: res.ok, status: res.status, body }
}

// Cliente con la sesión de quien llama (para validar que la reserva es suya).
function userClient(req: Request) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

async function checkWithClip(providerPaymentId: string, source: string): Promise<Record<string, unknown>> {
  try {
    const res = await clip(`${CLIP_API}/${encodeURIComponent(providerPaymentId)}`)
    if (!res.ok) {
      await db.rpc('class_record_payment_event', {
        p_provider_payment_id: providerPaymentId, p_source: source, p_kind: 'error',
        p_payload: { step: 'get_status', http: res.status, body: res.body },
      })
      return { error: 'clip_error', http: res.status }
    }
    const { data, error } = await db.rpc('class_apply_payment_status', {
      p_provider_payment_id: providerPaymentId,
      p_provider_status: String(res.body.status ?? ''),
      p_amount: typeof res.body.amount === 'number' ? res.body.amount : null,
      p_receipt_no: res.body.receipt_no ? String(res.body.receipt_no) : null,
      p_source: source,
      p_raw: res.body,
    })
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  } catch (e) {
    await db.rpc('class_record_payment_event', {
      p_provider_payment_id: providerPaymentId, p_source: source, p_kind: 'error',
      p_payload: { step: 'check', message: String((e as Error)?.message ?? e) },
    })
    return { error: 'check_failed' }
  }
}

async function handlePay(req: Request, bookingId: string): Promise<Response> {
  if (!CLIP_API_KEY || !CLIP_API_SECRET) return json({ error: 'not_configured' })

  const { data: begin, error } = await userClient(req).rpc('class_begin_deposit', { p_booking_id: bookingId })
  if (error) return json({ error: 'server_error' })
  if (begin.error) return json({ error: begin.error })
  if (begin.reuse) return json({ payment_url: begin.payment_url })

  const paymentId: string = begin.payment_id
  const back = `${APP_URL}/clases?reserva=${encodeURIComponent(bookingId)}`
  const base = {
    amount: begin.amount_cents / 100,
    currency: 'MXN',
    purchase_description: `Anticipo clase ${begin.class_name} · ${fmtWhen(begin.starts_at)}`.slice(0, 250),
    redirection_url: { success: `${back}&pago=ok`, error: `${back}&pago=error`, default: back },
    webhook_url: `${FUNCTION_URL}?wh=${paymentId}&s=${await sign(paymentId)}`,
  }
  const phone = Number(String(begin.phone ?? '').replace(/\D/g, ''))
  const full = {
    ...base,
    metadata: {
      external_reference: bookingId,
      customer_info: { name: begin.full_name, email: begin.email, ...(phone ? { phone } : {}) },
    },
    custom_payment_options: { payment_method_types: ['debit', 'credit'] },
  }

  try {
    let res = await clip(CLIP_API, { method: 'POST', body: JSON.stringify(full) })
    if (res.status === 400) {
      await db.rpc('class_record_payment_event', {
        p_provider_payment_id: null, p_source: 'create', p_kind: 'error',
        p_payload: { step: 'create_full', payment_id: paymentId, http: res.status, body: res.body },
      })
      res = await clip(CLIP_API, { method: 'POST', body: JSON.stringify({ ...base, metadata: { external_reference: bookingId } }) })
    }
    const providerId = res.body.payment_request_id
    const url = res.body.payment_request_url
    if (!res.ok || typeof providerId !== 'string' || typeof url !== 'string') {
      await db.rpc('class_fail_payment', { p_payment_id: paymentId, p_error: { http: res.status, body: res.body } })
      return json({ error: res.status === 401 ? 'not_configured' : 'clip_error' })
    }
    const expires = typeof res.body.expired_at === 'string' ? res.body.expired_at : null
    const { error: attachError } = await db.rpc('class_attach_payment', {
      p_payment_id: paymentId, p_provider_payment_id: providerId, p_payment_url: url,
      p_expires_at: expires, p_raw: res.body,
    })
    if (attachError) return json({ error: 'server_error' })
    return json({ payment_url: url })
  } catch (e) {
    await db.rpc('class_fail_payment', { p_payment_id: paymentId, p_error: { message: String((e as Error)?.message ?? e) } })
    return json({ error: 'clip_error' })
  }
}

async function handleCheck(bookingId: string): Promise<Response> {
  const { data, error } = await db.rpc('class_payments_to_check', { p_booking_id: bookingId })
  if (error) return json({ error: 'server_error' })
  const rows = ((data ?? []) as { provider_payment_id: string }[]).slice(0, 5)
  const results = []
  for (const r of rows) results.push(await checkWithClip(r.provider_payment_id, 'check'))
  return json({ checked: rows.length, results })
}

async function handleReconcile(req: Request): Promise<Response> {
  const { data: who } = await userClient(req).rpc('get_class_admin')
  if (!who || (who as { error?: string }).error) return json({ error: 'forbidden' }, 403)
  const { data, error } = await db.rpc('class_payments_to_check', { p_booking_id: null })
  if (error) return json({ error: 'server_error' })
  const rows = (data ?? []) as { provider_payment_id: string }[]
  let completed = 0, errors = 0
  for (const r of rows) {
    const res = await checkWithClip(r.provider_payment_id, 'reconcile')
    if (res.error) errors++
    else if (res.status === 'completed' && !res.noop) completed++
  }
  return json({ checked: rows.length, completed, errors })
}

async function handleWebhook(req: Request, url: URL): Promise<Response> {
  const paymentId = url.searchParams.get('wh') ?? ''
  const sig = url.searchParams.get('s') ?? ''
  if (!CLIP_API_SECRET || !UUID_RE.test(paymentId) || sig !== await sign(paymentId)) return json({ error: 'forbidden' }, 403)

  let body: unknown = null
  try { body = await req.json() } catch { /* sin cuerpo */ }

  const { data: pay } = await db.from('class_payments').select('provider_payment_id').eq('id', paymentId).maybeSingle()
  const providerId: string | null = pay?.provider_payment_id ?? null

  const { error: recError } = await db.rpc('class_record_payment_event', {
    p_provider_payment_id: providerId, p_source: 'webhook', p_kind: 'raw', p_payload: { payment_id: paymentId, body },
  })
  if (recError) return json({ error: 'server_error' }, 500)
  if (!providerId) return json({ received: true })

  const result = await checkWithClip(providerId, 'webhook')
  return json({ received: true }, result.error ? 500 : 200)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  if (url.searchParams.has('wh')) return handleWebhook(req, url)

  let body: { action?: string; booking_id?: string }
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }
  const bookingId = String(body?.booking_id ?? '').trim()
  switch (body?.action) {
    case 'pay':
      if (!UUID_RE.test(bookingId)) return json({ error: 'bad_request' }, 400)
      return handlePay(req, bookingId)
    case 'check':
      if (!UUID_RE.test(bookingId)) return json({ error: 'bad_request' }, 400)
      return handleCheck(bookingId)
    case 'reconcile':
      return handleReconcile(req)
    default:
      return json({ error: 'bad_request' }, 400)
  }
})
