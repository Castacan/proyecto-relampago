// Gasto rápido: el admin escribe o dicta un gasto ("pagué 350 a la de limpieza
// en efectivo el martes") y Claude lo convierte en egreso(s) listos para revisar.
// NO guarda nada: regresa la propuesta y la pantalla de Egresos la guarda con
// las RPC de siempre (admin_save_expense / stock_entry) después de que el admin
// la confirma.
//
//   POST { text }  → { items: [...], questions: [...] }   (solo admin)
//
// Secretos (Edge Functions → Secrets): ANTHROPIC_API_KEY.
// Se despliega con "Verify JWT" ENCENDIDO (solo usuarios con sesión).

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const nullable = (t: string) => ({ type: [t, 'null'] })
const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'payee_name', 'description', 'cost_center', 'category', 'amount_cents', 'date', 'method', 'paid_from',
             'event', 'product_id', 'quantity', 'paid_by_emiliano', 'notes'],
  properties: {
    kind: { type: 'string', enum: ['expense', 'stock_purchase'] },
    payee_name: nullable('string'),
    description: { type: 'string' },
    cost_center: { type: 'string' },
    category: nullable('string'),
    amount_cents: { type: 'integer' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    method: { type: 'string', enum: ['cash', 'card', 'transfer', 'other'] },
    paid_from: { type: 'string', enum: ['cash_register', 'bank', 'other'] },
    event: nullable('string'),
    product_id: nullable('string'),
    quantity: nullable('integer'),
    paid_by_emiliano: { type: 'boolean' },
    notes: nullable('string'),
  },
}
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'questions'],
  properties: {
    items: { type: 'array', items: ITEM },
    questions: { type: 'array', items: { type: 'string' } },
  },
}

function mxToday(): { iso: string; weekday: string } {
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now)
  const weekday = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long' }).format(now)
  return { iso, weekday }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!API_KEY) return json({ error: 'not_configured' })

  const auth = req.headers.get('Authorization') ?? ''
  const user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } })
  // get_expenses solo responde a admin: sirve de permiso y de contexto.
  const { iso: today, weekday } = mxToday()
  const { data: ex } = await user.rpc('get_expenses', { p_month: `${today.slice(0, 7)}-01` })
  if (!ex || ex.error) return json({ error: 'forbidden' }, 403)
  const { data: inv } = await user.rpc('get_inventory')
  const products = ((inv?.products ?? inv ?? []) as Record<string, unknown>[])
    .filter(p => p.track_stock && p.is_active)
    .map(p => ({ id: p.id, name: p.name, cost_cents: p.cost_cents }))

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text ?? '').trim().slice(0, 2000)
  if (text.length < 4) return json({ error: 'empty' })

  const payees = ((ex.payees ?? []) as Record<string, unknown>[]).map(p => `${p.name} (${p.kind}${p.default_cost_center ? `, ${p.default_cost_center}` : ''})`)
  const system = [
    'Conviertes notas de gastos de un muro de escalada (Jaibamuro, Alvarado, Veracruz) en egresos para su sistema.',
    'Quien escribe es Emiliano, el dueño. Escribe en español informal y a veces dicta por voz (puede haber errores de dictado).',
    `Hoy es ${weekday} ${today} (hora de México). Fechas relativas ("ayer", "el martes") se resuelven hacia atrás desde hoy.`,
    '',
    'Reglas:',
    '- Un renglón por cada pago distinto. Montos en centavos (350 pesos = 35000).',
    '- Si compró algo que se vende en el mostrador y está en la lista de productos, usa kind "stock_purchase" con product_id, quantity y en amount_cents el total pagado. Lo demás es kind "expense".',
    '- cost_center: uno de la lista. Renta, servicios, nómina, armado, contadora, plagas, internet, EVO → Gastos fijos; compras sueltas, limpieza de producto, publicidad, ferretería menor → Gastos variables; compra de producto para vender → Compra de productos; impuestos/SAT → Impuestos. NUNCA pongas "Inversión" a menos que el texto lo diga (Emiliano decide qué es inversión).',
    '- Si Emiliano dice que lo pagó él / de su bolsillo / "yo le pagué", paid_by_emiliano = true y paid_from "other". Emiliano casi siempre paga en efectivo.',
    `- paid_from "cash_register" solo si dice que salió de la caja Y la fecha es hoy (${today}); de la caja en otro día → "other". Transferencia o tarjeta → "bank" salvo que diga otra cosa.`,
    '- payee_name: usa el nombre exacto de la lista de proveedores si coincide; si no, un nombre corto y claro.',
    '- event: solo si el texto lo relaciona con un evento (por ejemplo la competencia); usa el nombre exacto de la lista de eventos.',
    '- Si falta algo indispensable (monto, o no se entiende el gasto), no inventes: deja el renglón fuera y pon la duda en questions. Si solo hay una duda menor, llena con lo más probable y menciónala en notes.',
    '',
    `Centros de costo: ${(ex.cost_centers ?? []).join(' | ')}`,
    `Eventos: ${(ex.events ?? []).join(' | ') || '(ninguno)'}`,
    `Proveedores: ${payees.join('; ')}`,
    `Productos con inventario (id: nombre, costo en centavos): ${products.map(p => `${p.id}: ${p.name} (${p.cost_cents ?? '?'})`).join('; ')}`,
  ].join('\n')

  const client = new Anthropic({ apiKey: API_KEY })
  try {
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system,
      messages: [{ role: 'user', content: text }],
    } as never)
    const msg = r as unknown as { stop_reason: string; content: { type: string; text?: string }[] }
    if (msg.stop_reason === 'refusal') return json({ error: 'refusal' })
    const out = msg.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(out)
    // Solo productos que existen.
    const ids = new Set(products.map(p => p.id))
    for (const it of parsed.items ?? []) {
      if (it.kind === 'stock_purchase' && !ids.has(it.product_id)) { it.kind = 'expense'; it.product_id = null; it.quantity = null }
    }
    return json(parsed)
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: 'ai_error', status: e.status })
    return json({ error: 'ai_error' })
  }
})
