// Domiciliación (cobro automático mensual) con Openpay o Stripe.
//
// El calendario, la promoción y los reintentos los lleva NUESTRA base
// (src/supabase/erp.sql); el proveedor solo guarda la tarjeta y cobra cuando
// se lo pedimos. Así la regla "3 meses a $600, luego $800" funciona igual con
// los dos proveedores y se puede cambiar de proveedor sin rehacer nada.
//
// Entradas (POST JSON):
//   {action:'stripe_setup_intent', token}            → client_secret para registrar tarjeta con Stripe
//   {action:'attach_card', token, openpay_token_id, device_session_id}   (Openpay)
//   {action:'attach_card', token, setup_intent_id}                      (Stripe)
//        → guarda la tarjeta y, si ya toca, cobra el primer ciclo en ese momento
//   {action:'run_due'}                               → cobra todo lo que toca hoy (pg_cron o admin)
//   {action:'charge_now', subscription_id}           → (staff) reintentar ya
//   {action:'status'}                                → (admin) qué llaves están puestas
//   {action:'test_connection', provider}             → (admin) prueba las llaves
//   POST ?webhook=stripe | ?webhook=openpay           → avisos de los proveedores
//
// Garantías contra cobros dobles:
//   * billing_claim_due aparta cada intento con una llave única
//     (<charge_id>-<intento>); Openpay la recibe como order_id (no acepta dos
//     cargos con el mismo) y Stripe como Idempotency-Key.
//   * Si la respuesta del proveedor no llega (timeout, 5xx), el intento NO
//     se marca fallido: se queda "processing" y la siguiente corrida lo
//     reconcilia preguntando al proveedor por esa misma llave.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   OPENPAY_PRIVATE_KEY   (sk_… del panel de Openpay; sandbox o producción
//                          según "Modo pruebas" en Integraciones)
//   STRIPE_SECRET_KEY     (sk_test_… o sk_live_…)
//   STRIPE_WEBHOOK_SECRET (whsec_…, del webhook creado en Stripe)
//   BILLING_CRON_KEY      (opcional; si existe, run_due la exige en x-cron-key)
//   RESEND_API_KEY        (ya existe), EMAIL_FROM y APP_URL opcionales
// Se despliega con "Verify JWT" APAGADO (la página del link y los webhooks no traen sesión).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENPAY_PRIVATE_KEY = Deno.env.get('OPENPAY_PRIVATE_KEY') ?? ''
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const BILLING_CRON_KEY = Deno.env.get('BILLING_CRON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Jaibamuro <hola@jaibamuro.com>'
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.jaibamuro.com').replace(/\/$/, '')
const OPENPAY_API = (sandbox: boolean) => sandbox ? 'https://sandbox-api.openpay.mx/v1' : 'https://api.openpay.mx/v1'
const STRIPE_API = 'https://api.stripe.com/v1'
const RESEND_API = 'https://api.resend.com/emails'

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MXN`
async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}
async function log(provider: string | null, kind: string, payload: unknown) {
  try { await db.rpc('billing_log', { p_provider: provider, p_kind: kind, p_payload: payload }) } catch { /* bitácora: nunca rompe el flujo */ }
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
type Integrations = { recurring_provider: string | null; openpay_merchant_id: string | null; openpay_public_key: string | null; openpay_sandbox: boolean; stripe_publishable_key: string | null }
type HttpResult = { ok: boolean; status: number; body: any; network?: boolean }

async function http(url: string, init: RequestInit): Promise<HttpResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) })
    const text = await res.text()
    let body: any
    try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text.slice(0, 1000) } }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { message: String((e as Error)?.message ?? e) }, network: true }
  }
}

function openpay(intg: Integrations) {
  const base = `${OPENPAY_API(intg.openpay_sandbox)}/${intg.openpay_merchant_id}`
  const headers = { 'Authorization': 'Basic ' + btoa(`${OPENPAY_PRIVATE_KEY}:`), 'Content-Type': 'application/json' }
  return {
    ready: () => !!(OPENPAY_PRIVATE_KEY && intg.openpay_merchant_id),
    get: (path: string) => http(base + path, { method: 'GET', headers }),
    post: (path: string, body: unknown) => http(base + path, { method: 'POST', headers, body: JSON.stringify(body) }),
    del: (path: string) => http(base + path, { method: 'DELETE', headers }),
  }
}

function stripeForm(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((item, i) => out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`))
    else if (typeof v === 'object') out.push(...stripeForm(v as Record<string, unknown>, key))
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out
}
function stripe() {
  const headers = { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  return {
    ready: () => !!STRIPE_SECRET_KEY,
    get: (path: string) => http(STRIPE_API + path, { method: 'GET', headers }),
    post: (path: string, body: Record<string, unknown>, idem?: string) =>
      http(STRIPE_API + path, { method: 'POST', headers: idem ? { ...headers, 'Idempotency-Key': idem } : headers, body: stripeForm(body).join('&') }),
  }
}

// Mensajes de rechazo entendibles (Openpay: códigos 3xxx; Stripe: decline_code).
const OPENPAY_ERRORS: Record<string, string> = {
  '3001': 'La tarjeta fue rechazada por el banco.',
  '3002': 'La tarjeta está vencida.',
  '3003': 'La tarjeta no tiene fondos suficientes.',
  '3004': 'La tarjeta fue reportada como robada.',
  '3005': 'El banco marcó el cargo como posible fraude.',
  '3006': 'La operación no está permitida para esta tarjeta.',
  '3009': 'La tarjeta fue reportada como perdida.',
  '3010': 'El banco restringió la tarjeta.',
  '3011': 'El banco pidió retener la tarjeta.',
  '3012': 'Se requiere autorización del banco para este cargo.',
}
const STRIPE_ERRORS: Record<string, string> = {
  insufficient_funds: 'La tarjeta no tiene fondos suficientes.',
  expired_card: 'La tarjeta está vencida.',
  card_declined: 'La tarjeta fue rechazada por el banco.',
  generic_decline: 'La tarjeta fue rechazada por el banco.',
  lost_card: 'La tarjeta fue reportada como perdida.',
  stolen_card: 'La tarjeta fue reportada como robada.',
  fraudulent: 'El banco marcó el cargo como posible fraude.',
  incorrect_cvc: 'El código de seguridad es incorrecto.',
  authentication_required: 'El banco pidió autenticar el cargo.',
}

type Outcome =
  | { kind: 'paid'; providerId: string | null; raw: unknown }
  | { kind: 'failed'; providerId: string | null; code: string | null; message: string; raw: unknown }
  | { kind: 'needs_action'; providerId: string | null; message: string; raw: unknown }
  | { kind: 'unknown'; raw: unknown }            // sin respuesta: se reconcilia después
  | { kind: 'not_found' }                        // reconciliación: el proveedor no tiene ese cargo

// ---------------------------------------------------------------------------
// Cobro de un intento
// ---------------------------------------------------------------------------
async function chargeOpenpay(intg: Integrations, sub: any, charge: any, description: string): Promise<Outcome> {
  const op = openpay(intg)
  const res = await op.post(`/customers/${sub.provider_customer_id}/charges`, {
    source_id: sub.provider_card_id, method: 'card', amount: Number((charge.amount_cents / 100).toFixed(2)),
    currency: 'MXN', description: description.slice(0, 250), order_id: charge.idempotency_key,
    // Antifraude: el device_session_id del registro de la tarjeta (Openpay lo exige).
    device_session_id: sub.provider_device_session ?? undefined,
  })
  if (res.network || res.status >= 500) return { kind: 'unknown', raw: res.body }
  if (res.ok) return openpayChargeOutcome(res.body)
  const code = String(res.body?.error_code ?? '')
  // 1006 = order_id repetido: ese intento ya existe allá → reconciliar.
  if (code === '1006') return reconcileOpenpay(intg, sub, charge)
  return { kind: 'failed', providerId: res.body?.request_id ?? null, code, message: OPENPAY_ERRORS[code] ?? res.body?.description ?? 'Cobro rechazado', raw: res.body }
}

function openpayChargeOutcome(c: any): Outcome {
  if (c?.status === 'completed') return { kind: 'paid', providerId: c.id, raw: c }
  if (c?.status === 'in_progress' || c?.status === 'charge_pending') {
    return c?.payment_method?.url
      ? { kind: 'needs_action', providerId: c.id, message: 'El banco pidió autenticar el cargo.', raw: c }
      : { kind: 'unknown', raw: c }
  }
  const code = String(c?.error_code ?? '')
  return { kind: 'failed', providerId: c?.id ?? null, code, message: OPENPAY_ERRORS[code] ?? c?.error_message ?? 'Cobro rechazado', raw: c }
}

async function reconcileOpenpay(intg: Integrations, sub: any, charge: any): Promise<Outcome> {
  const res = await openpay(intg).get(`/customers/${sub.provider_customer_id}/charges?order_id=${encodeURIComponent(charge.idempotency_key)}`)
  if (res.network || res.status >= 500 || !res.ok) return { kind: 'unknown', raw: res.body }
  const list = Array.isArray(res.body) ? res.body : []
  if (list.length === 0) return { kind: 'not_found' }
  return openpayChargeOutcome(list[0])
}

function stripeIntentOutcome(pi: any): Outcome {
  if (pi?.status === 'succeeded') return { kind: 'paid', providerId: pi.id, raw: pi }
  if (pi?.status === 'requires_action' || pi?.status === 'requires_confirmation') {
    return { kind: 'needs_action', providerId: pi.id, message: 'El banco pidió autenticar el cargo.', raw: pi }
  }
  if (pi?.status === 'processing') return { kind: 'unknown', raw: pi }
  const err = pi?.last_payment_error
  const code = err?.decline_code ?? err?.code ?? null
  return { kind: 'failed', providerId: pi?.id ?? null, code, message: (code && STRIPE_ERRORS[code]) ?? err?.message ?? 'Cobro rechazado', raw: pi }
}

async function chargeStripe(sub: any, charge: any, description: string): Promise<Outcome> {
  // La MISMA llave de idempotencia devuelve el mismo PaymentIntent si ya se
  // creó: por eso cobrar y reconciliar son la misma llamada en Stripe.
  const res = await stripe().post('/payment_intents', {
    amount: charge.amount_cents, currency: 'mxn', customer: sub.provider_customer_id, payment_method: sub.provider_card_id,
    off_session: true, confirm: true, description: description.slice(0, 250),
    metadata: { charge_id: charge.id, subscription_id: sub.id, cycle: charge.cycle },
  }, charge.idempotency_key)
  if (res.network || res.status >= 500 || res.status === 409) return { kind: 'unknown', raw: res.body }
  if (res.ok) return stripeIntentOutcome(res.body)
  const err = res.body?.error
  if (err?.payment_intent) return stripeIntentOutcome({ ...err.payment_intent, last_payment_error: err })
  const code = err?.decline_code ?? err?.code ?? null
  return { kind: 'failed', providerId: null, code, message: (code && STRIPE_ERRORS[code]) ?? err?.message ?? 'Cobro rechazado', raw: res.body }
}

async function processClaim(intg: Integrations, item: any): Promise<Record<string, unknown>> {
  const { charge, subscription: sub } = item
  const description = `${item.product_name ?? 'Membresía'} · ${charge.period_start} al ${charge.period_end}`
  let outcome: Outcome
  if (sub.provider === 'openpay') {
    if (!openpay(intg).ready()) return { charge_id: charge.id, skipped: 'openpay_not_configured' }
    outcome = item.reconcile ? await reconcileOpenpay(intg, sub, charge) : await chargeOpenpay(intg, sub, charge, description)
  } else {
    if (!stripe().ready()) return { charge_id: charge.id, skipped: 'stripe_not_configured' }
    outcome = await chargeStripe(sub, charge, description)
  }

  if (outcome.kind === 'unknown') {
    await log(sub.provider, 'attempt_unknown', { charge_id: charge.id, key: charge.idempotency_key, raw: outcome.raw })
    return { charge_id: charge.id, result: 'unknown' }
  }
  if (outcome.kind === 'not_found') {
    await rpc('billing_release_attempt', { p_charge_id: charge.id, p_idempotency_key: charge.idempotency_key, p_note: 'El proveedor no tiene el cargo' })
    return { charge_id: charge.id, result: 'released' }
  }
  const result = await rpc('billing_record_result', {
    p_charge_id: charge.id, p_idempotency_key: charge.idempotency_key, p_outcome: outcome.kind,
    p_provider_charge_id: outcome.providerId,
    p_error_code: outcome.kind === 'failed' ? outcome.code : null,
    p_error_message: outcome.kind === 'paid' ? null : outcome.message,
    p_raw: outcome.raw as Record<string, unknown>,
  })
  if (result?.notify) await notify(result.notify, charge.id, outcome)
  return { charge_id: charge.id, result: outcome.kind, ...result }
}

async function runClaims(limit: number, subscriptionId: string | null) {
  const intg = await integrations()
  const items = await rpc<any[]>('billing_claim_due', { p_limit: limit, p_subscription_id: subscriptionId })
  const results = []
  for (const item of items ?? []) {
    try { results.push(await processClaim(intg, item)) }
    catch (e) {
      await log(item?.subscription?.provider ?? null, 'process_error', { charge_id: item?.charge?.id, message: String((e as Error)?.message ?? e) })
      results.push({ charge_id: item?.charge?.id, result: 'error' })
    }
  }
  return results
}

async function integrations(): Promise<Integrations> {
  const { data } = await db.from('integration_settings').select('*').eq('id', 1).maybeSingle()
  return (data ?? { recurring_provider: null, openpay_merchant_id: null, openpay_public_key: null, openpay_sandbox: true, stripe_publishable_key: null }) as Integrations
}

// ---------------------------------------------------------------------------
// Correos
// ---------------------------------------------------------------------------
function emailShell(tag: string, tagColor: string, title: string, body: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#013a4b;font-family:Inter,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#013a4b;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td align="center" style="padding-bottom:24px"><img src="https://jaibamuro.com/logo-email.png" alt="Jaibamuro" height="36" style="height:36px;width:auto"></td></tr>
<tr><td style="background:#015169;border-radius:16px;padding:28px 24px">
<p style="margin:0 0 6px;color:${tagColor};font-size:14px;font-weight:700">${tag}</p>
<h1 style="margin:0 0 18px;color:#f4f4f3;font-size:22px;line-height:1.25">${title}</h1>
<div style="color:#cfe3ea;font-size:14px;line-height:1.5">${body}</div>
${cta ? `<p style="margin:18px 0 0"><a href="${cta.href}" style="display:inline-block;background:#ff4d15;color:#1a1a1a;font-weight:800;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:12px">${cta.label}</a></p>` : ''}
</td></tr>
<tr><td align="center" style="padding-top:18px;color:#7fa9b7;font-size:12px">Jaibamuro · Instagram @jaibamuro</td></tr>
</table></td></tr></table></body></html>`
}

async function sendEmail(to: string, subject: string, html: string, meta: Record<string, unknown>) {
  if (!RESEND_API_KEY || !to) return
  const res = await http(RESEND_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  })
  await log(null, res.ok ? 'email_sent' : 'email_error', { to, subject, http: res.status, ...meta })
}

async function notify(kind: string, chargeId: string, outcome: Outcome) {
  try {
    const ctx = await rpc<any>('billing_charge_by_id', { p_charge_id: chargeId })
    const email = ctx?.person?.email
    if (!email) return
    const first = esc(String(ctx.person.full_name ?? '').split(' ')[0])
    const c = ctx.charge, s = ctx.subscription
    const period = `${c.period_start.split('-').reverse().join('/')} al ${c.period_end.split('-').reverse().join('/')}`
    if (kind === 'receipt') {
      await sendEmail(email, `Pago recibido · ${ctx.product_name}`, emailShell('Pago recibido', '#22c55e',
        `${first}, tu membresía está al corriente.`,
        `Cobramos <b>${money(c.amount_cents)}</b> a tu tarjeta ${esc(s.card_brand ?? '')} •••• ${esc(s.card_last4 ?? '')}.<br>Periodo: ${period}.`,
        { href: `${APP_URL}/mi-cuenta`, label: 'Ver mi cuenta' }), { charge_id: chargeId, kind })
    } else {
      const token = await rpc<string | null>('billing_issue_link', { p_subscription_id: s.id })
      const reason = outcome.kind === 'failed' || outcome.kind === 'needs_action' ? esc(outcome.message) : ''
      const href = token ? `${APP_URL}/domiciliacion/${token}` : `${APP_URL}/mi-cuenta`
      await sendEmail(email, `No pudimos cobrar tu membresía · ${ctx.product_name}`, emailShell('Cobro no realizado', '#ffd260',
        `${first}, no pudimos cobrar tu membresía.`,
        `Intentamos cobrar <b>${money(c.amount_cents)}</b> (periodo ${period}). ${reason}<br>Puedes registrar otra tarjeta con el botón; en cuanto lo hagas lo intentamos de nuevo.`,
        { href, label: 'Actualizar mi tarjeta' }), { charge_id: chargeId, kind })
    }
  } catch (e) {
    await log(null, 'email_error', { charge_id: chargeId, message: String((e as Error)?.message ?? e) })
  }
}

// ---------------------------------------------------------------------------
// Registro de tarjeta
// ---------------------------------------------------------------------------
function splitName(full: string) {
  const parts = full.trim().split(/\s+/)
  return { name: parts[0] ?? full, last_name: parts.slice(1).join(' ') || '-' }
}

async function handleStripeSetupIntent(token: string): Promise<Response> {
  if (!stripe().ready()) return json({ error: 'not_configured' })
  const ctx = await rpc<any>('billing_context_by_token', { p_token: token })
  if (ctx?.error) return json({ error: ctx.error })
  if (ctx.provider !== 'stripe') return json({ error: 'wrong_provider' })
  let customer = ctx.provider_customer_id
  if (!customer) {
    const c = await stripe().post('/customers', {
      name: ctx.person.full_name, email: ctx.person.email ?? undefined, phone: ctx.person.phone ? `+52${ctx.person.phone}` : undefined,
      metadata: { subscription_id: ctx.id },
    }, `customer-${ctx.id}`)
    if (!c.ok) { await log('stripe', 'customer_error', c.body); return json({ error: 'provider_error' }) }
    customer = c.body.id
    await rpc('billing_save_customer', { p_subscription_id: ctx.id, p_customer_id: customer })
  }
  const si = await stripe().post('/setup_intents', {
    customer, usage: 'off_session', payment_method_types: ['card'], metadata: { subscription_id: ctx.id },
  })
  if (!si.ok) { await log('stripe', 'setup_intent_error', si.body); return json({ error: 'provider_error' }) }
  return json({ client_secret: si.body.client_secret, setup_intent_id: si.body.id })
}

async function handleAttachCard(body: any): Promise<Response> {
  const token = String(body.token ?? '')
  const ctx = await rpc<any>('billing_context_by_token', { p_token: token })
  if (ctx?.error) return json({ error: ctx.error })
  const intg = ctx.integrations as Integrations
  let card: { id: string; brand: string; last4: string; exp: string }

  if (ctx.provider === 'openpay') {
    const op = openpay(intg)
    if (!op.ready()) return json({ error: 'not_configured' })
    const tokenId = String(body.openpay_token_id ?? '')
    const deviceSession = String(body.device_session_id ?? '')
    if (!tokenId || !deviceSession) return json({ error: 'bad_request' }, 400)
    let customer = ctx.provider_customer_id
    if (!customer) {
      const n = splitName(ctx.person.full_name)
      const c = await op.post('/customers', {
        name: n.name, last_name: n.last_name, email: ctx.person.email ?? `sin-correo+${ctx.person_id}@jaibamuro.com`,
        phone_number: ctx.person.phone ?? undefined, requires_account: false, external_id: ctx.id,
      })
      if (!c.ok) { await log('openpay', 'customer_error', c.body); return json({ error: 'provider_error', message: c.body?.description }) }
      customer = c.body.id
      await rpc('billing_save_customer', { p_subscription_id: ctx.id, p_customer_id: customer })
    }
    const k = await op.post(`/customers/${customer}/cards`, { token_id: tokenId, device_session_id: deviceSession })
    if (!k.ok) {
      await log('openpay', 'card_error', k.body)
      const code = String(k.body?.error_code ?? '')
      return json({ error: 'card_rejected', message: OPENPAY_ERRORS[code] ?? k.body?.description ?? 'No se pudo registrar la tarjeta.' })
    }
    card = { id: k.body.id, brand: k.body.brand, last4: String(k.body.card_number ?? '').slice(-4), exp: `${k.body.expiration_month}/${k.body.expiration_year}` }
    await rpc('billing_save_device_session', { p_subscription_id: ctx.id, p_device_session: deviceSession })
    // La tarjeta anterior ya no se usa: se borra (si falla no pasa nada).
    if (ctx.provider_card_id && ctx.provider_card_id !== card.id) await op.del(`/customers/${customer}/cards/${ctx.provider_card_id}`)
  } else {
    if (!stripe().ready()) return json({ error: 'not_configured' })
    const siId = String(body.setup_intent_id ?? '')
    const si = await stripe().get(`/setup_intents/${encodeURIComponent(siId)}`)
    if (!si.ok || si.body?.status !== 'succeeded' || si.body?.metadata?.subscription_id !== ctx.id || si.body?.customer !== ctx.provider_customer_id) {
      await log('stripe', 'setup_intent_invalid', { id: siId, status: si.body?.status })
      return json({ error: 'card_rejected', message: 'No se pudo confirmar la tarjeta. Intenta de nuevo.' })
    }
    const pmId = si.body.payment_method
    const pm = await stripe().get(`/payment_methods/${encodeURIComponent(pmId)}`)
    if (!pm.ok) return json({ error: 'provider_error' })
    await stripe().post(`/customers/${ctx.provider_customer_id}`, { invoice_settings: { default_payment_method: pmId } })
    card = { id: pmId, brand: pm.body.card?.brand ?? '', last4: pm.body.card?.last4 ?? '', exp: `${pm.body.card?.exp_month}/${pm.body.card?.exp_year}` }
  }

  const attached = await rpc<any>('billing_attach_card', {
    p_subscription_id: ctx.id, p_card_id: card.id, p_brand: card.brand, p_last4: card.last4, p_exp: card.exp,
  })
  if (attached?.error) return json({ error: attached.error })

  // Si ya toca (primer mes o un cobro pendiente), se cobra en este momento.
  const results = await runClaims(1, ctx.id)
  const first = results[0] as any
  return json({
    success: true, card: { brand: card.brand, last4: card.last4 },
    charge: first ? { result: first.result, message: first.result === 'failed' ? 'El banco rechazó el primer cobro.' : undefined } : null,
  })
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function handleStripeWebhook(req: Request): Promise<Response> {
  const raw = await req.text()
  if (!STRIPE_WEBHOOK_SECRET) { await log('stripe', 'webhook_unverified', { note: 'Falta STRIPE_WEBHOOK_SECRET' }); return json({ received: true }) }
  const header = req.headers.get('stripe-signature') ?? ''
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const expected = await hmacHex(STRIPE_WEBHOOK_SECRET, `${parts.t}.${raw}`)
  const age = Math.abs(Date.now() / 1000 - Number(parts.t))
  if (!parts.v1 || expected !== parts.v1 || !(age < 600)) return json({ error: 'bad_signature' }, 400)
  const event = JSON.parse(raw)
  await log('stripe', 'webhook', { type: event.type, id: event.id, object: event.data?.object?.id })
  const pi = event.data?.object
  const chargeId = pi?.metadata?.charge_id
  if (!chargeId || !String(event.type).startsWith('payment_intent.')) return json({ received: true })
  const ctx = await rpc<any>('billing_charge_by_id', { p_charge_id: chargeId })
  if (!ctx?.charge) return json({ received: true })
  // Se consulta el PaymentIntent real (no se confía en el cuerpo).
  const live = await stripe().get(`/payment_intents/${encodeURIComponent(pi.id)}`)
  if (!live.ok) return json({ error: 'lookup_failed' }, 500)
  const outcome = stripeIntentOutcome(live.body)
  if (outcome.kind === 'paid' || (outcome.kind === 'failed' && ctx.charge.status !== 'paid')) {
    const result = await rpc<any>('billing_record_result', {
      p_charge_id: chargeId, p_idempotency_key: ctx.charge.idempotency_key, p_outcome: outcome.kind,
      p_provider_charge_id: outcome.providerId, p_error_code: outcome.kind === 'failed' ? outcome.code : null,
      p_error_message: outcome.kind === 'failed' ? outcome.message : null, p_raw: { webhook: event.id },
    })
    if (result?.notify && !result?.noop) await notify(result.notify, chargeId, outcome)
  }
  return json({ received: true })
}

async function handleOpenpayWebhook(req: Request): Promise<Response> {
  let event: any = null
  try { event = await req.json() } catch { /* cuerpo vacío */ }
  // Al dar de alta el webhook, Openpay manda un código de verificación: queda
  // en billing_events para copiarlo al panel de Openpay.
  await log('openpay', event?.type === 'verification' ? 'webhook_verification' : 'webhook', event)
  const tx = event?.transaction
  if (!tx?.id || !String(event?.type ?? '').startsWith('charge.')) return json({ received: true })
  const orderId = String(tx.order_id ?? '')
  const chargeId = orderId.slice(0, 36)
  if (!/^[0-9a-f-]{36}$/i.test(chargeId)) return json({ received: true })
  const ctx = await rpc<any>('billing_charge_by_id', { p_charge_id: chargeId })
  if (!ctx?.charge) return json({ received: true })
  const intg = await integrations()
  // Se consulta el cargo real (no se confía en el cuerpo).
  const live = await openpay(intg).get(`/customers/${ctx.subscription.provider_customer_id}/charges/${encodeURIComponent(tx.id)}`)
  if (!live.ok) return json({ error: 'lookup_failed' }, 500)
  const outcome = openpayChargeOutcome(live.body)
  if (outcome.kind === 'paid' || (outcome.kind === 'failed' && ctx.charge.status === 'processing' && ctx.charge.idempotency_key === orderId)) {
    const result = await rpc<any>('billing_record_result', {
      p_charge_id: chargeId, p_idempotency_key: orderId, p_outcome: outcome.kind, p_provider_charge_id: outcome.providerId,
      p_error_code: outcome.kind === 'failed' ? outcome.code : null, p_error_message: outcome.kind === 'failed' ? outcome.message : null,
      p_raw: { webhook: event.type },
    })
    if (result?.notify && !result?.noop) await notify(result.notify, chargeId, outcome)
  }
  return json({ received: true })
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
async function callerRole(req: Request): Promise<{ staff: boolean; admin: boolean }> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return { staff: false, admin: false }
  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } })
  const { data } = await caller.rpc('get_erp_settings')
  if (!data || data.error) return { staff: false, admin: false }
  return { staff: true, admin: !!data.is_admin }
}

async function handleStatus(): Promise<Response> {
  const intg = await integrations()
  return json({
    openpay: { private_key: !!OPENPAY_PRIVATE_KEY, private_key_mode: OPENPAY_PRIVATE_KEY ? (intg.openpay_sandbox ? 'sandbox' : 'production') : null,
               merchant_id: !!intg.openpay_merchant_id, public_key: !!intg.openpay_public_key, sandbox: intg.openpay_sandbox },
    stripe: { secret_key: !!STRIPE_SECRET_KEY, secret_mode: STRIPE_SECRET_KEY ? (STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test') : null,
              webhook_secret: !!STRIPE_WEBHOOK_SECRET, publishable_key: !!intg.stripe_publishable_key,
              publishable_mode: intg.stripe_publishable_key ? (intg.stripe_publishable_key.startsWith('pk_live_') ? 'live' : 'test') : null },
    resend: !!RESEND_API_KEY,
    cron_key: !!BILLING_CRON_KEY,
    webhook_urls: {
      stripe: `${SUPABASE_URL}/functions/v1/billing?webhook=stripe`,
      openpay: `${SUPABASE_URL}/functions/v1/billing?webhook=openpay`,
    },
  })
}

async function handleTestConnection(provider: string): Promise<Response> {
  const intg = await integrations()
  if (provider === 'openpay') {
    if (!openpay(intg).ready()) return json({ ok: false, message: 'Falta la llave privada (secreto OPENPAY_PRIVATE_KEY) o el ID de comercio.' })
    const r = await openpay(intg).get('/customers?limit=1')
    return json({ ok: r.ok, message: r.ok ? `Conectado a Openpay (${intg.openpay_sandbox ? 'pruebas' : 'producción'}).` : (r.body?.description ?? `Error ${r.status}`) })
  }
  if (provider === 'stripe') {
    if (!stripe().ready()) return json({ ok: false, message: 'Falta la llave secreta (secreto STRIPE_SECRET_KEY).' })
    const r = await stripe().get('/balance')
    return json({ ok: r.ok, message: r.ok ? `Conectado a Stripe (${STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'producción' : 'pruebas'}).` : (r.body?.error?.message ?? `Error ${r.status}`) })
  }
  return json({ ok: false, message: 'Proveedor desconocido.' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = new URL(req.url)
  const webhook = url.searchParams.get('webhook')
  try {
    if (webhook === 'stripe') return await handleStripeWebhook(req)
    if (webhook === 'openpay') return await handleOpenpayWebhook(req)

    let body: any
    try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }
    if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400)

    switch (body.action) {
      case 'stripe_setup_intent':
        return await handleStripeSetupIntent(String(body.token ?? ''))
      case 'attach_card':
        return await handleAttachCard(body)
      case 'run_due': {
        const cronOk = BILLING_CRON_KEY && req.headers.get('x-cron-key') === BILLING_CRON_KEY
        if (BILLING_CRON_KEY && !cronOk && !(await callerRole(req)).admin) return json({ error: 'forbidden' }, 403)
        return json({ results: await runClaims(50, null) })
      }
      case 'charge_now': {
        if (!(await callerRole(req)).staff) return json({ error: 'forbidden' }, 403)
        return json({ results: await runClaims(1, String(body.subscription_id ?? '')) })
      }
      case 'status':
        if (!(await callerRole(req)).admin) return json({ error: 'forbidden' }, 403)
        return await handleStatus()
      case 'test_connection':
        if (!(await callerRole(req)).admin) return json({ error: 'forbidden' }, 403)
        return await handleTestConnection(String(body.provider ?? ''))
      default:
        return json({ error: 'bad_request' }, 400)
    }
  } catch (e) {
    await log(null, 'handler_error', { message: String((e as Error)?.message ?? e) })
    return json({ error: 'server_error' }, 500)
  }
})
