// Cobro en línea de inscripciones a la competencia con Clip.
// Una sola función con cuatro entradas:
//   POST {action:'pay', folio, email}       → link de pago de Clip para esa inscripción
//   POST {action:'check', folio, email}     → consulta en Clip los links abiertos de esa inscripción
//   POST {action:'reconcile'}               → (solo admin) consulta TODOS los links abiertos
//   POST ?wh=<payment_id>&s=<firma>         → webhook de Clip
//
// Reglas (ver src/supabase/competencia_pagos.sql):
//   * El pago local se escribe ANTES de pedirle el link a Clip.
//   * El webhook de Clip no trae firma: su cuerpo solo se guarda como
//     evidencia. El estado que se aplica es SIEMPRE el que responde la API
//     de Clip al consultarla con nuestras credenciales.
//   * Nada marca una inscripción como pagada desde el navegador.
//
// Secretos que hay que definir en Supabase (Edge Functions → Secrets):
//   CLIP_API_KEY, CLIP_API_SECRET   (panel de desarrolladores de Clip)
//   APP_URL                         (opcional; default https://app.jaibamuro.com)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY los pone Supabase.
//
// Se despliega con "Verify JWT" APAGADO (Clip no manda JWT al webhook).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CLIP_API_KEY = Deno.env.get('CLIP_API_KEY') ?? ''
const CLIP_API_SECRET = Deno.env.get('CLIP_API_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.jaibamuro.com').replace(/\/$/, '')

const CLIP_API = 'https://api.payclip.com/v2/checkout'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/competition-payments`

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Firma por pago para la URL del webhook: quien no conozca el secreto de
// Clip no puede fabricar una URL válida. No sustituye a consultar a Clip,
// solo evita que cualquiera nos haga consultar su API a voluntad.
async function sign(paymentId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIP_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(paymentId))
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

// Consulta el estado real de un link en Clip y lo aplica. Devuelve lo que
// decidió la base (o el error de comunicación, que también queda guardado).
async function checkWithClip(providerPaymentId: string, source: string): Promise<Record<string, unknown>> {
  try {
    const res = await clip(`${CLIP_API}/${encodeURIComponent(providerPaymentId)}`)
    if (!res.ok) {
      await db.rpc('competition_record_payment_event', {
        p_provider_payment_id: providerPaymentId, p_source: source, p_kind: 'error',
        p_payload: { step: 'get_status', http: res.status, body: res.body },
      })
      return { error: 'clip_error', http: res.status }
    }
    const { data, error } = await db.rpc('competition_apply_payment_status', {
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
    await db.rpc('competition_record_payment_event', {
      p_provider_payment_id: providerPaymentId, p_source: source, p_kind: 'error',
      p_payload: { step: 'check', message: String((e as Error)?.message ?? e) },
    })
    return { error: 'check_failed' }
  }
}

async function handlePay(folio: string, email: string): Promise<Response> {
  if (!CLIP_API_KEY || !CLIP_API_SECRET) return json({ error: 'not_configured' })

  const { data: begin, error } = await db.rpc('competition_begin_payment', { p_folio: folio, p_email: email })
  if (error) return json({ error: 'server_error' })
  if (begin.error) return json({ error: begin.error })
  if (begin.reuse) return json({ payment_url: begin.payment_url })

  const paymentId: string = begin.payment_id
  const base = {
    amount: begin.amount_cents / 100,
    currency: 'MXN',
    purchase_description: `Inscripción ${begin.competition_name} · Folio ${begin.folio}`.slice(0, 250),
    redirection_url: {
      success: `${APP_URL}/competencia/consulta?pago=ok`,
      error: `${APP_URL}/competencia/consulta?pago=error`,
      default: `${APP_URL}/competencia/consulta`,
    },
    webhook_url: `${FUNCTION_URL}?wh=${paymentId}&s=${await sign(paymentId)}`,
  }
  const full = {
    ...base,
    metadata: {
      external_reference: begin.folio,
      customer_info: { name: begin.full_name, email: begin.email, phone: Number(begin.phone) },
    },
    // Solo tarjeta: sin efectivo (OXXO), que tarda días en confirmarse.
    custom_payment_options: { payment_method_types: ['debit', 'credit'] },
  }

  try {
    let res = await clip(CLIP_API, { method: 'POST', body: JSON.stringify(full) })
    if (res.status === 400) {
      // Clip rechazó algún campo opcional: se reintenta con lo mínimo
      // (conservando el folio como referencia) y se guarda el rechazo.
      await db.rpc('competition_record_payment_event', {
        p_provider_payment_id: null, p_source: 'create', p_kind: 'error',
        p_payload: { step: 'create_full', payment_id: paymentId, http: res.status, body: res.body },
      })
      res = await clip(CLIP_API, {
        method: 'POST',
        body: JSON.stringify({ ...base, metadata: { external_reference: begin.folio } }),
      })
    }
    const providerId = res.body.payment_request_id
    const url = res.body.payment_request_url
    if (!res.ok || typeof providerId !== 'string' || typeof url !== 'string') {
      await db.rpc('competition_fail_payment', { p_payment_id: paymentId, p_error: { http: res.status, body: res.body } })
      return json({ error: res.status === 401 ? 'not_configured' : 'clip_error' })
    }
    const expires = typeof res.body.expired_at === 'string' ? res.body.expired_at : null
    const { error: attachError } = await db.rpc('competition_attach_payment', {
      p_payment_id: paymentId, p_provider_payment_id: providerId, p_payment_url: url,
      p_expires_at: expires, p_raw: res.body,
    })
    // Sin registro local del link no se entrega: nadie debe pagar un link
    // que la base no conoce.
    if (attachError) return json({ error: 'server_error' })
    return json({ payment_url: url })
  } catch (e) {
    await db.rpc('competition_fail_payment', {
      p_payment_id: paymentId, p_error: { message: String((e as Error)?.message ?? e) },
    })
    return json({ error: 'clip_error' })
  }
}

async function handleCheck(folio: string, email: string): Promise<Response> {
  const { data, error } = await db.rpc('competition_payments_to_check', { p_folio: folio, p_email: email })
  if (error) return json({ error: 'server_error' })
  const rows = (data ?? []) as { provider_payment_id: string }[]
  for (const row of rows.slice(0, 5)) await checkWithClip(row.provider_payment_id, 'check')
  return json({ checked: Math.min(rows.length, 5) })
}

async function handleReconcile(req: Request): Promise<Response> {
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await caller.rpc('competition_is_admin')
  if (isAdmin !== true) return json({ error: 'forbidden' })

  const { data, error } = await db.rpc('competition_payments_to_check', { p_folio: null, p_email: null })
  if (error) return json({ error: 'server_error' })
  const rows = (data ?? []) as { provider_payment_id: string }[]
  let completed = 0
  let errors = 0
  for (const row of rows.slice(0, 150)) {
    const r = await checkWithClip(row.provider_payment_id, 'reconcile')
    if (r.error) errors++
    else if (r.status === 'completed' && !r.noop) completed++
  }
  return json({ checked: Math.min(rows.length, 150), pending_more: Math.max(rows.length - 150, 0), completed, errors })
}

async function handleWebhook(req: Request, url: URL): Promise<Response> {
  const paymentId = url.searchParams.get('wh') ?? ''
  const sig = url.searchParams.get('s') ?? ''
  // Sin secreto de Clip no hay firma que comparar (y firmar con llave vacía truena).
  if (!CLIP_API_SECRET || !/^[0-9a-f-]{36}$/.test(paymentId) || sig !== await sign(paymentId)) return json({ error: 'forbidden' }, 403)

  let body: unknown = null
  try { body = await req.json() } catch { /* cuerpo vacío o no-JSON: se guarda null */ }

  const { data: pay } = await db.from('competition_payments')
    .select('provider_payment_id').eq('id', paymentId).maybeSingle()
  const providerId: string | null = pay?.provider_payment_id ?? null

  // 1) Guardar el aviso tal cual llegó. Si esto falla, 500 para que Clip reintente.
  const { error: recError } = await db.rpc('competition_record_payment_event', {
    p_provider_payment_id: providerId, p_source: 'webhook', p_kind: 'raw',
    p_payload: { payment_id: paymentId, body },
  })
  if (recError) return json({ error: 'server_error' }, 500)
  if (!providerId) return json({ received: true })

  // 2) Consultar el estado real en Clip y aplicarlo.
  const result = await checkWithClip(providerId, 'webhook')
  return json({ received: true }, result.error ? 500 : 200)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  if (url.searchParams.has('wh')) return handleWebhook(req, url)

  let body: { action?: string; folio?: string; email?: string }
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }

  const folio = String(body.folio ?? '').trim()
  const email = String(body.email ?? '').trim()
  switch (body.action) {
    case 'pay':
      if (!folio || !email) return json({ error: 'bad_request' }, 400)
      return handlePay(folio, email)
    case 'check':
      if (!folio || !email) return json({ error: 'bad_request' }, 400)
      return handleCheck(folio, email)
    case 'reconcile':
      return handleReconcile(req)
    default:
      return json({ error: 'bad_request' }, 400)
  }
})
