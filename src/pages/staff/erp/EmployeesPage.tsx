import { useCallback, useEffect, useState } from 'react'
import { call, erpError, money, toCents, toPesos, fmtDate, todayMx, EXPENSE_METHODS, PAID_FROM } from '../../../lib/erp'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, MoneyField } from '../../../components/erp/ui'
import { FilesBox } from './PersonExtras'
import { supabase } from '../../../lib/supabase'

// Empleados (admin): datos, contrato/pago, documentos y nómina (cae en Egresos).

interface Employee {
  id: string; full_name: string; position: string | null; profile_id: string | null; phone: string | null; email: string | null
  birth_date: string | null; address: string | null; curp: string | null; rfc: string | null; nss: string | null
  hire_date: string | null; end_date: string | null; status: 'active' | 'inactive'; pay_scheme: string | null; pay_rate_cents: number | null
  bank_name: string | null; bank_account: string | null; emergency_name: string | null; emergency_phone: string | null; notes: string | null
  login_name?: string | null; login_role?: string | null; paid_this_month?: number
}
interface List { employees: Employee[]; staff_logins: { id: string; name: string; role: string }[] }
interface Detail {
  employee: Employee
  payments: { id: string; folio: number; description: string; amount_cents: number; status: string; due_on: string; paid_on: string | null; method: string | null; period_month: string }[]
  files: { id: string; path: string; file_name: string; label: string | null; mime: string | null; size_bytes: number | null; created_at: string; uploaded_by: string | null }[]
  sales_month: { count: number; total_cents: number } | null
}

const PAY_SCHEMES: Record<string, string> = { weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual', per_class: 'Por clase', hourly: 'Por hora', per_job: 'Por trabajo (armado, etc.)' }

export default function EmployeesPage() {
  const [list, setList] = useState<List | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await call<List>('get_employees')
    if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin puede ver a los empleados.' : 'No se pudo cargar. ¿Ya se corrió erp_crm.sql?'); return }
    setList(data)
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Empleados"><p className="text-alerta text-sm">{error}</p></Page>
  if (!list) return <Page title="Empleados"><Spinner /></Page>
  const active = list.employees.filter(e => e.status === 'active')

  return (
    <Page title="Empleados" subtitle="Datos de cada persona del equipo, sus documentos y sus pagos (la nómina se registra como egreso)."
      actions={<button onClick={() => { setCreating(v => !v); setSelected(null) }} className={btnPrimary}>{creating ? 'Cerrar' : '+ Nuevo empleado'}</button>}>
      {creating && <Card title="Nuevo empleado" tone="accent"><EmployeeForm logins={list.staff_logins} onSaved={id => { setCreating(false); load(); setSelected(id) }} /></Card>}
      {list.employees.length === 0 ? <Empty>Todavía no hay empleados.</Empty> : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80">
          {list.employees.map(e => (
            <div key={e.id}>
              <button onClick={() => setSelected(selected === e.id ? null : e.id)} className="w-full text-left px-4 py-3 hover:bg-superficie-alta flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-bold ${e.status === 'active' ? 'text-texto-principal' : 'text-zinc-500'}`}>{e.full_name} {e.status === 'inactive' && <Badge>Baja</Badge>}</p>
                  <p className="text-zinc-500 text-xs">{e.position ?? 'Sin puesto'}{e.pay_scheme ? ` · ${PAY_SCHEMES[e.pay_scheme]}${e.pay_rate_cents ? ` ${money(e.pay_rate_cents)}` : ''}` : ''}{e.login_name ? ` · usuario del panel: ${e.login_name} (${e.login_role})` : ''}</p>
                </div>
                <span className="text-zinc-400 text-xs shrink-0">pagado este mes <span className="text-texto-principal font-bold">{money(e.paid_this_month ?? 0)}</span></span>
              </button>
              {selected === e.id && <EmployeeDetail id={e.id} logins={list.staff_logins} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
      <p className="text-zinc-500 text-xs">{active.length} activos.</p>
      <StaffAccessCard key={list.staff_logins.length} onChanged={load} />
    </Page>
  )
}

// Quién puede entrar al panel (/staff) con su correo y contraseña. Solo el admin lo administra.
interface StaffUser { id: string; name: string; role: 'staff' | 'admin'; email: string | null; last_sign_in_at: string | null }
const STAFF_ERRORS: Record<string, string> = {
  invalid_email: 'Revisa el correo.',
  weak_password: 'La contraseña debe tener al menos 8 caracteres.',
  password_required: 'Es una cuenta nueva: escribe una contraseña temporal (mínimo 8 caracteres).',
  cannot_remove_self: 'No te puedes quitar a ti mismo.',
  cannot_demote_self: 'No te puedes quitar el rol de admin a ti mismo.',
  has_history: 'No se puede quitar porque tiene historial (armó rutas, etc.).',
  forbidden: 'Solo un admin puede hacer esto.',
}

async function staffAdmin(body: Record<string, unknown>): Promise<{ data: { created?: boolean; id?: string } | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body })
  if (error) return { data: null, error: 'No se pudo usar la función staff-admin (¿ya se desplegó?).' }
  if (data?.error) return { data: null, error: STAFF_ERRORS[data.error] ?? data.message ?? data.error }
  return { data, error: null }
}

function StaffAccessCard({ onChanged }: { onChanged: () => void }) {
  const [users, setUsers] = useState<StaffUser[] | null>(null)
  const [f, setF] = useState({ email: '', name: '', role: 'staff', password: '' })
  const [open, setOpen] = useState(false)
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data } = await call<{ staff: StaffUser[] }>('admin_list_staff')
    setUsers(data?.staff ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await staffAdmin({ action: 'save', email: f.email, name: f.name, role: f.role, password: f.password || null })
    setBusy(false)
    if (error || !data) { setMsg({ text: error ?? 'Error', tone: 'error' }); return }
    setMsg({ text: `${f.email} ${data.created ? 'ya tiene cuenta' : 'quedó'} como ${f.role === 'admin' ? 'admin' : 'staff'}. Entra en app.jaibamuro.com/login con su correo${f.password ? ' y la contraseña que pusiste' : ''}.`, tone: 'ok' })
    setF({ email: '', name: '', role: 'staff', password: '' }); load(); onChanged()
  }
  const setPassword = async (u: StaffUser) => {
    setBusy(true); setMsg(null)
    const { error } = await staffAdmin({ action: 'set_password', profile_id: u.id, password: newPw })
    setBusy(false)
    if (error) { setMsg({ text: error, tone: 'error' }); return }
    setMsg({ text: `Listo: ${u.name} ya entra con la contraseña nueva.`, tone: 'ok' })
    setPwFor(null); setNewPw('')
  }
  const remove = async (u: StaffUser) => {
    if (!window.confirm(`¿Quitarle el acceso al panel a ${u.name}? Su cuenta de cliente sigue igual.`)) return
    const { error } = await call('admin_remove_staff', { p_profile_id: u.id })
    if (error) { setMsg({ text: STAFF_ERRORS[error] ?? erpError(error), tone: 'error' }); return }
    load(); onChanged()
  }

  return (
    <Card title="Acceso al panel (usuarios de staff)">
      <p className="text-zinc-400 text-sm mb-3">Solo estas cuentas entran a app.jaibamuro.com/login con su correo y contraseña. El staff vende, abre caja, ve personas, clases e inventario; el admin además ve egresos, empleados, bitácora, estados y configuración.</p>
      {users === null ? <Spinner /> : (
        <div className="divide-y divide-zinc-800/80 mb-4">
          {users.map(u => (
            <div key={u.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-texto-principal font-semibold">{u.name} <Badge cls={u.role === 'admin' ? 'text-primario bg-primario/10' : undefined}>{u.role}</Badge></p>
                  <p className="text-zinc-500 text-xs">{u.email ?? '—'} · último acceso {u.last_sign_in_at ? fmtDate(u.last_sign_in_at.slice(0, 10)) : 'nunca'}</p>
                </div>
                <span className="flex gap-3 shrink-0">
                  <button onClick={() => { setPwFor(pwFor === u.id ? null : u.id); setNewPw('') }} className="text-zinc-400 hover:text-texto-principal text-xs font-bold">Nueva contraseña</button>
                  <button onClick={() => remove(u)} className="text-zinc-500 hover:text-alerta text-xs font-bold">Quitar acceso</button>
                </span>
              </div>
              {pwFor === u.id && (
                <div className="flex gap-2 mt-2">
                  <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Contraseña nueva (mín. 8)" autoComplete="new-password" className={input} />
                  <button onClick={() => setPassword(u)} disabled={busy || newPw.length < 8} className={btnPrimary}>Guardar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-zinc-400 text-sm mb-3">Para un empleado, dale acceso desde "+ Nuevo empleado" o "Editar datos" (queda ligado a su ficha).</p>
      <button onClick={() => setOpen(v => !v)} className={btnGhost}>{open ? 'Cerrar' : 'Dar acceso a alguien que no está en Empleados'}</button>
      {open && <>
      <div className="grid mt-3 sm:grid-cols-4 gap-2 items-end">
        <div><label className={label}>Correo</label><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="correo@ejemplo.com" autoComplete="off" className={input} /></div>
        <div><label className={label}>Nombre</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={input} /></div>
        <div><label className={label}>Contraseña temporal</label><input type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder="mín. 8 caracteres" autoComplete="new-password" className={input} /></div>
        <div><label className={label}>Rol</label>
          <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })} className={input}>
            <option value="staff">Staff</option><option value="admin">Admin (ve todo)</option>
          </select></div>
      </div>
      <button onClick={save} disabled={busy || !f.email.includes('@')} className={`${btnPrimary} mt-3`}>{busy ? 'Guardando…' : 'Dar acceso al panel'}</button>
      <p className="text-zinc-500 text-xs mt-2">Si la persona ya tiene cuenta (por ejemplo, porque escala aquí), se usa la misma; la contraseña es opcional en ese caso. Después ella la puede cambiar en el panel con "Cambiar mi contraseña".</p>
      </>}
      {msg && <div className="mt-2"><Msg text={msg.text} tone={msg.tone} /></div>}
    </Card>
  )
}

function EmployeeDetail({ id, logins, onChanged }: { id: string; logins: List['staff_logins']; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const load = useCallback(async () => { const { data } = await call<Detail>('get_employee', { p_employee_id: id }); setD(data) }, [id])
  useEffect(() => { load() }, [load])
  if (!d) return <div className="px-4 pb-4"><Spinner /></div>
  const e = d.employee
  const row = (k: string, v: string | null | undefined) => v ? <><dt className="text-zinc-400">{k}</dt><dd className="text-texto-principal break-all">{v}</dd></> : null

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setPaying(v => !v)} className={btnGhost}>{paying ? 'Cerrar' : 'Registrar pago'}</button>
        <button onClick={() => setEditing(v => !v)} className={btnGhost}>{editing ? 'Cerrar' : 'Editar datos'}</button>
      </div>
      {paying && <Card tone="accent"><PayForm employee={e} onDone={() => { setPaying(false); load(); onChanged() }} /></Card>}
      {editing ? <Card><EmployeeForm e={e} logins={logins} onSaved={() => { setEditing(false); load(); onChanged() }} /></Card> : (
        <div className="grid lg:grid-cols-2 gap-3">
          <Card title="Datos">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {row('Puesto', e.position)}{row('Celular', e.phone)}{row('Correo', e.email)}{row('Nacimiento', e.birth_date ? fmtDate(e.birth_date) : null)}
              {row('Domicilio', e.address)}{row('CURP', e.curp)}{row('RFC', e.rfc)}{row('NSS', e.nss)}
              {row('Ingreso', e.hire_date ? fmtDate(e.hire_date) : null)}{row('Baja', e.end_date ? fmtDate(e.end_date) : null)}
              {row('Pago', e.pay_scheme ? `${PAY_SCHEMES[e.pay_scheme]}${e.pay_rate_cents ? ` · ${money(e.pay_rate_cents)}` : ''}` : null)}
              {row('Banco', e.bank_name ? `${e.bank_name}${e.bank_account ? ` · ${e.bank_account}` : ''}` : e.bank_account)}
              {row('Emergencia', e.emergency_name ? `${e.emergency_name} · ${e.emergency_phone ?? ''}` : null)}
              {row('Notas', e.notes)}
            </dl>
            {d.sales_month && <p className="text-zinc-400 text-xs mt-2">Ventas este mes: {d.sales_month.count} · {money(d.sales_month.total_cents)}</p>}
          </Card>
          <Card title="Pagos">
            {d.payments.length === 0 ? <Empty>Sin pagos registrados.</Empty> : (
              <div className="divide-y divide-zinc-800/80 max-h-72 overflow-y-auto">
                {d.payments.map(p => (
                  <div key={p.id} className="py-1.5 flex justify-between gap-3 text-sm">
                    <span className="text-zinc-300 min-w-0 truncate">{p.description} <span className="text-zinc-500 text-xs">· {fmtDate(p.paid_on ?? p.due_on)}{p.status === 'pending' ? ' · por pagar' : ''}</span></span>
                    <span className="text-texto-principal font-bold tabular-nums">{money(p.amount_cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      <Card title="Documentos (contrato, INE, comprobantes…)">
        <FilesBox ownerKind="employee" ownerId={e.id} files={d.files} canDelete onChanged={load} />
      </Card>
    </div>
  )
}

function EmployeeForm({ e, logins, onSaved }: { e?: Employee; logins: List['staff_logins']; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    full_name: e?.full_name ?? '', position: e?.position ?? '', profile_id: e?.profile_id ?? '', phone: e?.phone ?? '', email: e?.email ?? '',
    birth_date: e?.birth_date ?? '', address: e?.address ?? '', curp: e?.curp ?? '', rfc: e?.rfc ?? '', nss: e?.nss ?? '',
    hire_date: e?.hire_date ?? '', end_date: e?.end_date ?? '', status: e?.status ?? 'active', pay_scheme: e?.pay_scheme ?? '',
    pay_rate: toPesos(e?.pay_rate_cents ?? null), bank_name: e?.bank_name ?? '', bank_account: e?.bank_account ?? '',
    emergency_name: e?.emergency_name ?? '', emergency_phone: e?.emergency_phone ?? '', notes: e?.notes ?? '',
  })
  // Acceso al panel en el mismo formulario: sin acceso, un usuario que ya existe o darle uno nuevo con su correo.
  const [access, setAccess] = useState<'none' | 'existing' | 'new'>(e?.profile_id ? 'existing' : 'none')
  const [acc, setAcc] = useState({ role: 'staff', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }
  const save = async () => {
    setBusy(true)
    const { pay_rate, ...rest } = f
    let profile_id = access === 'existing' ? rest.profile_id : ''
    if (access === 'new') {
      if (!rest.full_name.trim()) { setBusy(false); setError('Escribe el nombre completo.'); return }
      if (!rest.email.includes('@')) { setBusy(false); setError('Para darle acceso al panel escribe su correo.'); return }
      const r = await staffAdmin({ action: 'save', email: rest.email, name: rest.full_name, role: acc.role, password: acc.password || null })
      if (r.error || !r.data?.id) { setBusy(false); setError(r.error ?? 'No se pudo dar el acceso.'); return }
      profile_id = r.data.id
    }
    const { data, error } = await call<{ id: string }>('admin_save_employee', { p: { id: e?.id ?? null, ...rest, profile_id, pay_rate_cents: pay_rate === '' ? '' : toCents(pay_rate) } })
    setBusy(false)
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    onSaved(data.id)
  }
  const txt = (k: keyof typeof f, l: string, type = 'text', ph = '') => (
    <div><label className={label}>{l}</label><input type={type} value={f[k]} placeholder={ph} onChange={x => set({ [k]: x.target.value } as Partial<typeof f>)} className={input} /></div>
  )
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        {txt('full_name', 'Nombre completo')}{txt('position', 'Puesto', 'text', 'Recepción, coach, armador…')}
        <div><label className={label}>Acceso al panel</label>
          <select value={access} onChange={x => { setAccess(x.target.value as typeof access); setError(null) }} className={input}>
            <option value="none">Sin acceso</option>
            {logins.length > 0 && <option value="existing">Ya tiene usuario</option>}
            <option value="new">Darle acceso con su correo</option>
          </select></div>
        {txt('phone', 'Celular')}{txt('email', 'Correo', 'email')}{txt('birth_date', 'Nacimiento', 'date')}
        {access === 'existing' && (
          <div className="sm:col-span-3"><label className={label}>Usuario del panel</label>
            <select value={f.profile_id} onChange={x => set({ profile_id: x.target.value })} className={input}>
              <option value="">Elige…</option>{logins.map(l => <option key={l.id} value={l.id}>{l.name} ({l.role})</option>)}
            </select></div>
        )}
        {access === 'new' && (
          <div className="sm:col-span-3 grid sm:grid-cols-3 gap-3 rounded-xl border border-primario/30 bg-primario/5 p-3">
            <div><label className={label}>Contraseña temporal</label><input type="text" value={acc.password} onChange={x => setAcc({ ...acc, password: x.target.value })} placeholder="mín. 8 caracteres" autoComplete="new-password" className={input} /></div>
            <div><label className={label}>Rol</label>
              <select value={acc.role} onChange={x => setAcc({ ...acc, role: x.target.value })} className={input}>
                <option value="staff">Staff</option><option value="admin">Admin (ve todo)</option>
              </select></div>
            <p className="text-zinc-400 text-xs self-end">Entra en app.jaibamuro.com/login con el correo de arriba. Si ya tiene cuenta (porque escala aquí) la contraseña es opcional.</p>
          </div>
        )}
        <div className="sm:col-span-3">{txt('address', 'Domicilio')}</div>
        {txt('curp', 'CURP')}{txt('rfc', 'RFC')}{txt('nss', 'NSS (IMSS)')}
        {txt('hire_date', 'Fecha de ingreso', 'date')}{txt('end_date', 'Fecha de baja', 'date')}
        <div><label className={label}>Estado</label>
          <select value={f.status} onChange={x => set({ status: x.target.value as 'active' | 'inactive' })} className={input}>
            <option value="active">Activo</option><option value="inactive">Baja</option>
          </select></div>
        <div><label className={label}>Esquema de pago</label>
          <select value={f.pay_scheme} onChange={x => set({ pay_scheme: x.target.value })} className={input}>
            <option value="">—</option>{Object.entries(PAY_SCHEMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <MoneyField id={`emp-rate-${e?.id ?? 'new'}`} label="Monto por periodo / clase / hora" value={f.pay_rate} onChange={v => set({ pay_rate: v })} />
        {txt('bank_name', 'Banco')}
        {txt('bank_account', 'CLABE / cuenta')}{txt('emergency_name', 'Contacto de emergencia')}{txt('emergency_phone', 'Tel. de emergencia')}
      </div>
      {txt('notes', 'Notas')}
      <Msg text={error} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

function PayForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const t = todayMx()
  const [f, setF] = useState({ amount: toPesos(employee.pay_rate_cents), description: `Nómina ${employee.full_name}`, paid_on: t, period_month: t.slice(0, 7), method: 'transfer', paid_from: 'bank', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('admin_pay_employee', { p_employee_id: employee.id, p: { amount_cents: toCents(f.amount), description: f.description, paid_on: f.paid_on, period_month: `${f.period_month}-01`, method: f.method, paid_from: f.paid_from, notes: f.notes } })
    if (error) { setError(erpError(error)); return }
    onDone()
  }
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <MoneyField id={`pay-${employee.id}`} label="Monto" value={f.amount} onChange={v => setF({ ...f, amount: v })} />
        <div className="sm:col-span-2"><label className={label}>Concepto</label><input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} className={input} /></div>
        <div><label className={label}>Fecha de pago</label><input type="date" value={f.paid_on} onChange={e => setF({ ...f, paid_on: e.target.value })} className={input} /></div>
        <div><label className={label}>Corresponde al mes</label><input type="month" value={f.period_month} onChange={e => setF({ ...f, period_month: e.target.value })} className={input} /></div>
        <div><label className={label}>Forma</label>
          <select value={f.method} onChange={e => setF({ ...f, method: e.target.value, paid_from: e.target.value === 'cash' ? f.paid_from : 'bank' })} className={input}>
            {Object.entries(EXPENSE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className={label}>Salió de</label>
          <select value={f.paid_from} onChange={e => setF({ ...f, paid_from: e.target.value })} className={input}>
            {Object.entries(PAID_FROM).filter(([k]) => k !== 'cash_register' || f.method === 'cash').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      <Msg text={error} />
      <button onClick={save} className={btnPrimary}>Registrar pago (queda en Egresos)</button>
    </div>
  )
}
