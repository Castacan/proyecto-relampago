// Correos de clases (reserva confirmada / reserva cancelada).
//   POST {booking_ids: string[], kind: 'confirmation' | 'cancel'}
//
// La página la llama después de reservar o cancelar (y el panel después de
// una reserva de staff o de cancelar una sesión). No pide credencial: cada
// correo sale UNA sola vez (class_claim_email lo aparta en la base), solo
// al correo de la persona dueña de la reserva y solo si la reserva está en
// el estado que corresponde. Llamarla de más no manda nada de más.
//
// Secretos: RESEND_API_KEY (ya existe), EMAIL_FROM y APP_URL opcionales.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los pone Supabase.
// Se despliega con "Verify JWT" APAGADO (la página pública la llama sin sesión
// a veces y no hace falta).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.jaibamuro.com').replace(/\/$/, '')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Jaibamuro <hola@jaibamuro.com>'
const RESEND_API = 'https://api.resend.com/emails'

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const TZ = 'America/Mexico_City'
function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  const time = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-MX')} MXN`

type Claimed = {
  id: string; status: string; price_tier: string; payment_method: string; payment_status: string
  amount_cents: number; needs_reschedule: boolean; full_name: string; email: string
  class_name: string; starts_at: string; instructor_name: string | null; cancel_reason: string | null
  settings: { cancel_hours: number; rules_text: string | null }
}

function priceLine(b: Claimed): string {
  if (b.price_tier === 'free_monthly') return 'Tu clase gratis del mes'
  if (b.price_tier === 'courtesy') return 'Cortesía'
  const tier = b.price_tier === 'member' ? ' (precio miembro)' : ''
  if (b.payment_status === 'paid') return `${money(b.amount_cents)}${tier} · pagado`
  return `${money(b.amount_cents)}${tier} · pagas en el gym`
}

function render(b: Claimed, kind: 'confirmation' | 'cancel'): { subject: string; html: string } {
  const first = esc(String(b.full_name).split(' ')[0])
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 0;color:#9fc3cf;font-size:14px;width:110px;vertical-align:top">${k}</td><td style="padding:6px 0;color:#f4f4f3;font-size:14px;font-weight:600">${v}</td></tr>`
  const details = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row('Clase', esc(b.class_name))}
${row('Cuándo', esc(fmtWhen(b.starts_at)))}
${b.instructor_name ? row('Con', esc(b.instructor_name)) : ''}
${kind === 'confirmation' ? row('Precio', esc(priceLine(b))) : ''}
</table>`

  let tag: string, tagColor: string, title: string, body: string, subject: string
  if (kind === 'confirmation') {
    tag = 'Reserva confirmada'; tagColor = '#22c55e'
    title = `${first}, tu lugar está apartado.`
    body = `<p style="margin:18px 0 0;color:#cfe3ea;font-size:14px;line-height:1.5">${esc(b.settings.rules_text ?? `Puedes cancelar sin perder tu clase hasta ${b.settings.cancel_hours} horas antes.`)}</p>`
    subject = `Reserva confirmada · ${b.class_name} · ${fmtWhen(b.starts_at)}`
  } else if (b.status === 'cancelled_by_gym') {
    tag = 'Clase cancelada'; tagColor = '#ffd260'
    title = `${first}, tuvimos que cancelar esta clase.`
    body = `<p style="margin:18px 0 0;color:#cfe3ea;font-size:14px;line-height:1.5">Lo sentimos.${b.cancel_reason ? ` Motivo: ${esc(b.cancel_reason)}.` : ''} ${b.price_tier === 'free_monthly' ? 'Tu clase gratis del mes no se gastó.' : ''} ${b.needs_reschedule ? 'Como ya habías pagado, te ayudamos a pasar tu lugar a otra clase: escríbenos o pregunta en el gym.' : ''}</p>`
    subject = `Clase cancelada · ${b.class_name} · ${fmtWhen(b.starts_at)}`
  } else {
    const late = b.status === 'cancelled_late'
    tag = 'Reserva cancelada'; tagColor = '#ffd260'
    title = `${first}, cancelamos tu reserva.`
    body = `<p style="margin:18px 0 0;color:#cfe3ea;font-size:14px;line-height:1.5">${late
      ? `Cancelaste con menos de ${b.settings.cancel_hours} horas, así que cuenta como falta${b.price_tier === 'free_monthly' ? ' y tu clase gratis del mes se gastó' : ''}.`
      : `Cancelaste a tiempo${b.price_tier === 'free_monthly' ? ': tu clase gratis del mes sigue disponible' : ''}.`}${b.needs_reschedule ? ' Como ya habías pagado, te ayudamos a pasar tu lugar a otra clase.' : ''}</p>`
    subject = `Reserva cancelada · ${b.class_name} · ${fmtWhen(b.starts_at)}`
  }

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#013a4b;font-family:Inter,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#013a4b;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td align="center" style="padding-bottom:24px"><img src="https://jaibamuro.com/logo-email.png" alt="Jaibamuro" height="36" style="height:36px;width:auto"></td></tr>
<tr><td style="background:#015169;border-radius:16px;padding:28px 24px">
<p style="margin:0 0 6px;color:${tagColor};font-size:14px;font-weight:700">${tag}</p>
<h1 style="margin:0 0 18px;color:#f4f4f3;font-size:22px;line-height:1.25">${title}</h1>
${details}
${body}
<p style="margin:18px 0 0"><a href="${APP_URL}/clases" style="display:inline-block;background:#ff4d15;color:#1a1a1a;font-weight:800;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:12px">Ver mis clases</a></p>
</td></tr>
<tr><td align="center" style="padding-top:18px;color:#7fa9b7;font-size:12px">Jaibamuro · Instagram @jaibamuro</td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}

async function sendOne(bookingId: string, kind: 'confirmation' | 'cancel'): Promise<'sent' | 'skipped' | 'error'> {
  const { data, error } = await db.rpc('class_claim_email', { p_booking_id: bookingId, p_kind: kind })
  if (error) return 'error'
  if (!data) return 'skipped'
  const b = data as Claimed
  try {
    const { subject, html } = render(b, kind)
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [b.email], subject, html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return 'sent'
    // 4xx (correo inválido, etc.): no se insiste. 5xx/429: se suelta para reintentar.
    if (res.status >= 500 || res.status === 429) await db.rpc('class_release_email', { p_booking_id: bookingId, p_kind: kind })
    return 'error'
  } catch {
    await db.rpc('class_release_email', { p_booking_id: bookingId, p_kind: kind })
    return 'error'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!RESEND_API_KEY) return json({ error: 'not_configured' })

  let body: { booking_ids?: unknown; kind?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }
  if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400)
  const kind = body.kind === 'cancel' ? 'cancel' : body.kind === 'confirmation' ? 'confirmation' : null
  const ids = Array.isArray(body.booking_ids)
    ? [...new Set(body.booking_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 50)
    : []
  if (!kind || ids.length === 0) return json({ error: 'bad_request' }, 400)

  let sent = 0, skipped = 0, errors = 0
  for (const id of ids) {
    const r = await sendOne(id, kind)
    if (r === 'sent') sent++
    else if (r === 'skipped') skipped++
    else errors++
  }
  return json({ sent, skipped, errors })
})
