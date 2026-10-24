// Cuentas del staff con usuario (correo) y contraseña.
//   POST {action:'save', email, name, role:'staff'|'admin', password?}
//        → (admin) crea la cuenta con esa contraseña, o si ya existe la usa
//          (y si mandan contraseña se la cambia); la deja como staff/admin.
//   POST {action:'set_password', profile_id, password}
//        → (admin) pone una contraseña nueva a un staff (si la olvidó).
//
// Crear cuentas y poner contraseñas necesita la llave service_role, por eso
// vive aquí y no en la página. Solo un admin con sesión puede usarla.
// Las contraseñas no se guardan ni se registran en ningún lado (solo Supabase Auth).
//
// Se despliega con "Verify JWT" APAGADO (revisa el admin por dentro).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function adminFromRequest(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await db.auth.getUser(token)
  const user = data?.user
  if (!user) return null
  const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return prof?.role === 'admin' ? { id: user.id } : null
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  // Pocos cientos de cuentas: se recorre la lista por páginas.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(error.message)
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === email)
    if (hit) return hit.id
    if (data.users.length < 1000) return null
  }
  return null
}

const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 72

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const admin = await adminFromRequest(req)
  if (!admin) return json({ error: 'forbidden' }, 403)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }

  try {
    if (body.action === 'save') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const name = String(body.name ?? '').trim()
      const role = body.role === 'admin' ? 'admin' : 'staff'
      const password = body.password
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' })
      if (password !== undefined && password !== null && password !== '' && !validPassword(password)) return json({ error: 'weak_password' })

      let id = await findUserIdByEmail(email)
      let created = false
      if (!id) {
        if (!validPassword(password)) return json({ error: 'password_required' })
        const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
        if (error || !data.user) return json({ error: 'create_failed', message: error?.message })
        id = data.user.id
        created = true
      } else if (validPassword(password)) {
        const { error } = await db.auth.admin.updateUserById(id, { password })
        if (error) return json({ error: 'password_failed', message: error.message })
      }
      if (id === admin.id && role !== 'admin') return json({ error: 'cannot_demote_self' })
      const { data: existing } = await db.from('profiles').select('name').eq('id', id).maybeSingle()
      const { error: pErr } = await db.from('profiles').upsert({ id, name: name || existing?.name || email, role }, { onConflict: 'id' })
      if (pErr) return json({ error: 'profile_failed', message: pErr.message })
      await db.from('class_audit_log').insert({ actor_id: admin.id, action: created ? 'staff_create' : 'staff_update', entity: 'staff', entity_id: id, after: { email, name, role, password_set: validPassword(password) } })
      return json({ success: true, id, created })
    }

    if (body.action === 'set_password') {
      const id = String(body.profile_id ?? '')
      if (!validPassword(body.password)) return json({ error: 'weak_password' })
      const { data: prof } = await db.from('profiles').select('id').eq('id', id).maybeSingle()
      if (!prof) return json({ error: 'not_found' })
      const { error } = await db.auth.admin.updateUserById(id, { password: body.password as string })
      if (error) return json({ error: 'password_failed', message: error.message })
      await db.from('class_audit_log').insert({ actor_id: admin.id, action: 'staff_password_reset', entity: 'staff', entity_id: id, after: null })
      return json({ success: true })
    }

    return json({ error: 'bad_request' }, 400)
  } catch (e) {
    return json({ error: 'server_error', message: String((e as Error)?.message ?? e) }, 500)
  }
})
