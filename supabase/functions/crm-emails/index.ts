// Correos automáticos del CRM (bienvenida, cumpleaños, membresía por vencer,
// membresía vencida, inactivo). Ver src/supabase/erp_crm.sql (sección 8).
//
//   POST {action:'run'}              → manda lo que toca hoy (pg_cron 1 vez al día).
//                                      Pide el header x-cron-key = BILLING_CRON_KEY
//                                      (o un admin con sesión).
//   POST {action:'preview', key, draft?} → (admin) asunto y HTML, sin mandar.
//   POST {action:'test', key, draft?}    → (admin) manda la prueba SOLO al correo
//                                          del admin que la pide.
//   POST {action:'cash_alert'}       → (cron 00:05) avisa a los admins de cajas que
//                                      se cerraron solas porque nadie hizo el corte
//                                      (ver src/supabase/erp_caja_cierre.sql).
//
// Solo se mandan las automatizaciones PRENDIDAS en el panel; todas vienen
// apagadas. Cada correo sale una sola vez por (automatización, persona, fecha).
//
// Secretos: RESEND_API_KEY y BILLING_CRON_KEY (ya existen), EMAIL_FROM opcional.
// Se despliega con "Verify JWT" APAGADO (el cron no manda sesión).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_KEY = Deno.env.get('BILLING_CRON_KEY') ?? ''
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Jaibamuro <hola@jaibamuro.com>'

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

type Automation = { key: string; subject: string; heading: string; body: string; button_text: string | null; button_url: string | null; marketing: boolean }
type Vars = Record<string, string | number | null>

function fill(text: string, vars: Vars, escape: boolean): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k] ?? ''
    return escape ? esc(v) : String(v)
  })
}

export function render(a: Automation, vars: Vars): { subject: string; html: string } {
  const paragraphs = esc(a.body).split(/\n{2,}/).map(p => fill(p, vars, true).replace(/\n/g, '<br>'))
    .map(p => `<p style="margin:0 0 14px;color:#cfe3ea;font-size:15px;line-height:1.55">${p}</p>`).join('')
  const button = a.button_text && a.button_url && /^https:\/\//.test(a.button_url)
    ? `<p style="margin:8px 0 0"><a href="${esc(a.button_url)}" style="display:inline-block;background:#ff4d15;color:#1a1a1a;font-weight:800;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(a.button_text)}</a></p>` : ''
  const footer = a.marketing ? 'Si ya no quieres recibir estos correos, respóndenos o avísanos en recepción.' : 'Jaibamuro · Instagram @jaibamuro'
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#013a4b;font-family:Inter,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#013a4b;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td align="center" style="padding-bottom:24px"><img src="https://jaibamuro.com/logo-email.png" alt="Jaibamuro" height="36" style="height:36px;width:auto"></td></tr>
<tr><td style="background:#015169;border-radius:16px;padding:28px 24px">
<h1 style="margin:0 0 16px;color:#f4f4f3;font-size:22px;line-height:1.25">${esc(fill(a.heading, vars, false))}</h1>
${paragraphs}${button}
</td></tr>
<tr><td align="center" style="padding-top:18px;color:#7fa9b7;font-size:12px">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`
  return { subject: fill(a.subject, vars, false), html }
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

async function adminFromRequest(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await db.auth.getUser(token)
  const user = data?.user
  if (!user?.email) return null
  const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return prof?.role === 'admin' ? { id: user.id, email: user.email } : null
}

async function automation(key: string, draft: unknown): Promise<Automation | null> {
  const { data } = await db.rpc('crm_automation', { p_key: key })
  if (!data) return null
  const a = data as Automation
  // El panel puede mandar el borrador sin guardar para previsualizarlo / probarlo.
  if (draft && typeof draft === 'object') {
    const d = draft as Partial<Automation>
    return { ...a, ...Object.fromEntries(Object.entries(d).filter(([k, v]) => ['subject', 'heading', 'body', 'button_text', 'button_url'].includes(k) && (typeof v === 'string' || v === null))) }
  }
  return a
}

const SAMPLE: Vars = { nombre: 'Emiliano', fecha: '15/11/2026', dias: 14 }

async function runDue(): Promise<{ sent: number; errors: number }> {
  const { data, error } = await db.rpc('crm_due_emails')
  if (error) throw new Error(error.message)
  const due = (data ?? []) as { key: string; person_id: string; email: string; ref_date: string; vars: Vars }[]
  const cache = new Map<string, Automation | null>()
  let sent = 0, errors = 0
  for (const d of due) {
    if (!cache.has(d.key)) cache.set(d.key, await automation(d.key, null))
    const a = cache.get(d.key)
    if (!a) continue
    // Se aparta antes de mandar (si dos corridas coinciden, solo una manda).
    const { data: claimed } = await db.rpc('crm_log_email', { p_key: d.key, p_person_id: d.person_id, p_email: d.email, p_ref_date: d.ref_date, p_status: 'sent', p_error: null })
    if (!(claimed as { success?: boolean })?.success) continue
    const { subject, html } = render(a, d.vars)
    const r = await sendEmail(d.email, subject, html)
    if (r.ok) sent++
    else {
      errors++
      await db.from('email_log').update({ status: 'error', error: r.error ?? 'error' })
        .eq('automation_key', d.key).eq('person_id', d.person_id).eq('ref_date', d.ref_date).eq('status', 'sent')
    }
  }
  return { sent, errors }
}

type CashAlert = { id: string; business_date: string; opened_by_name: string | null; expected_cash_cents: number | null; sales_count: number; sales_total_cents: number }
const pesos = (c: number | null) => `$${((c ?? 0) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`

async function sendCashAlerts(): Promise<{ sent: number; alerts: number }> {
  const { data, error } = await db.rpc('cash_alerts_to_email')
  if (error) throw new Error(error.message)
  const { admins, alerts } = data as { admins: string[]; alerts: CashAlert[] }
  if (!alerts.length || !admins.length) return { sent: 0, alerts: alerts.length }
  const lines = alerts.map(a => `${a.business_date}: abrió ${a.opened_by_name ?? 'alguien'}, ${a.sales_count} ventas (${pesos(a.sales_total_cents)}), efectivo esperado ${pesos(a.expected_cash_cents)}.`).join('\n')
  const { subject, html } = render({
    key: 'cash_alert', marketing: false,
    subject: alerts.length === 1 ? `Caja sin corte del ${alerts[0].business_date}` : `${alerts.length} cajas sin corte`,
    heading: 'Nadie hizo el corte de caja',
    body: `La caja se cerró sola a medianoche, sin que nadie contara el efectivo:

${lines}

Revisa con el staff cuánto efectivo había y márcalo como enterado en Caja.`,
    button_text: 'Abrir Caja', button_url: 'https://app.jaibamuro.com/staff/caja',
  }, {})
  let sent = 0
  for (const to of admins) if ((await sendEmail(to, subject, html)).ok) sent++
  if (sent > 0) await db.rpc('cash_alert_mark_emailed', { p_ids: alerts.map(a => a.id) })
  return { sent, alerts: alerts.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  let body: { action?: string; key?: string; draft?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }
  try {
    if (body.action === 'run') {
      const cronOk = !!CRON_KEY && req.headers.get('x-cron-key') === CRON_KEY
      if (!cronOk && !(await adminFromRequest(req))) return json({ error: 'forbidden' }, 403)
      return json(await runDue())
    }
    if (body.action === 'cash_alert') {
      const cronOk = !!CRON_KEY && req.headers.get('x-cron-key') === CRON_KEY
      if (!cronOk && !(await adminFromRequest(req))) return json({ error: 'forbidden' }, 403)
      return json(await sendCashAlerts())
    }
    if (body.action === 'preview' || body.action === 'test') {
      const admin = await adminFromRequest(req)
      if (!admin) return json({ error: 'forbidden' }, 403)
      const a = await automation(String(body.key ?? ''), body.draft)
      if (!a) return json({ error: 'not_found' }, 404)
      const { subject, html } = render(a, SAMPLE)
      if (body.action === 'preview') return json({ subject, html })
      const r = await sendEmail(admin.email, `[Prueba] ${subject}`, html)
      await db.rpc('crm_log_email', { p_key: a.key, p_person_id: null, p_email: admin.email, p_ref_date: new Date().toISOString().slice(0, 10), p_status: r.ok ? 'test' : 'error', p_error: r.error ?? null })
      return json(r.ok ? { success: true, to: admin.email } : { error: 'send_failed', message: r.error })
    }
    return json({ error: 'bad_request' }, 400)
  } catch (e) {
    return json({ error: 'server_error', message: String((e as Error)?.message ?? e) }, 500)
  }
})
