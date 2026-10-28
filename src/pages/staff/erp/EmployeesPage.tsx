import { useCallback, useEffect, useState } from 'react'
import { call, erpError, money, toCents, toPesos, fmtDate, todayMx, EXPENSE_METHODS, PAID_FROM } from '../../../lib/erp'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, MoneyField } from '../../../components/erp/ui'
import { FilesBox } from './PersonExtras'
import { supabase } from '../../../lib/supabase'
import { STAFF_SECTIONS, useStaffSections, setStaffSectionsCache } from '../../../lib/staffSections'

// Empleados (admin): datos, contrato/pago, documentos y nómina (cae en Egresos).

interface Employee {
  id: string; full_name: string; position: string | null; profile_id: string | null; phone: string | null; email: string | null
  birth_date: string | null; address: string | null; curp: string | null; rfc: string | null; nss: string | null
  hire_date: string | null; end_date: string | null; status: 'active' | 'inactive'; pay_scheme: string | null; pay_rate_cents: number | null; pay_every?: string | null
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

// Cómo se calcula el pago y cada cuánto se paga (erp_nomina.sql). "Sueldo fijo" se guarda como weekly/biweekly/monthly.
const PAY_CALC: Record<string, string> = { daily: 'Por día', hourly: 'Por hora', per_class: 'Por clase', per_job: 'Por trabajo (armado, etc.)', fixed: 'Sueldo fijo' }
const PAY_EVERY: Record<string, string> = { weekly: 'Cada semana', biweekly: 'Cada quincena', monthly: 'Cada mes' }
const RATE_LABEL: Record<string, string> = { daily: 'Tarifa por día', hourly: 'Tarifa por hora', per_class: 'Pago por clase', per_job: 'Pago por trabajo', fixed: 'Sueldo de cada pago' }
const isFixed = (s: string | null | undefined) => s === 'weekly' || s === 'biweekly' || s === 'monthly'
const calcOf = (s: string | null | undefined) => (isFixed(s) ? 'fixed' : s ?? '')
const everyOf = (e: Pick<Employee, 'pay_scheme' | 'pay_every'>) => e.pay_every ?? (isFixed(e.pay_scheme) ? e.pay_scheme : null)
function payText(e: Employee): string | null {
  if (!e.pay_scheme) return null
  const calc = calcOf(e.pay_scheme)
  const every = everyOf(e)
  const rate = e.pay_rate_cents ? money(e.pay_rate_cents) : ''
  const base = calc === 'fixed' ? `Sueldo fijo ${rate}` : `${PAY_CALC[calc]} ${rate}`.trim()
  return `${base}${every ? ` · ${PAY_EVERY[every].toLowerCase()}` : ''}`
}

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
                  <p className="text-zinc-500 text-xs">{e.position ?? 'Sin puesto'}{payText(e) ? ` · ${payText(e)}` : ''}{e.login_name ? ` · usuario del panel: ${e.login_name} (${e.login_role})` : ''}</p>
                </div>
                <span className="text-zinc-400 text-xs shrink-0">pagado este mes <span className="text-texto-principal font-bold">{money(e.paid_this_month ?? 0)}</span></span>
              </button>
              {selected === e.id && <EmployeeDetail id={e.id} logins={list.staff_logins} others={list.employees.filter(x => x.id !== e.id && x.status === 'active')} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
      <p className="text-zinc-500 text-xs">{active.length} activos.</p>
      <StaffAccessCard key={list.staff_logins.length} onChanged={load} />
      <StaffSectionsCard />
    </Page>
  )
}

// Qué secciones del panel ve el staff (el admin siempre ve todo). Se activan poco a poco.
function StaffSectionsCard() {
  const current = useStaffSections()
  const [sel, setSel] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (current && sel === null) setSel(current) }, [current, sel])
  if (!sel) return <Card title="Secciones que ve el staff"><Spinner /></Card>
  const changed = JSON.stringify([...sel].sort()) !== JSON.stringify([...(current ?? [])].sort())
  const save = async () => {
    setBusy(true); setMsg(null)
    const { error } = await call('admin_set_staff_sections', { p_sections: sel })
    setBusy(false)
    if (error) { setMsg({ text: error === 'server' ? 'No se pudo guardar. ¿Ya se corrió erp_staff_secciones.sql?' : erpError(error), tone: 'error' }); return }
    setStaffSectionsCache(sel)
    setMsg({ text: 'Guardado. El staff lo ve al recargar la página.', tone: 'ok' })
  }
  return (
    <Card title="Secciones que ve el staff">
      <p className="text-zinc-400 text-sm mb-3">Mientras no todo está al 100, el staff solo ve lo que actives aquí. Tú (admin) siempre ves todo. Egresos, empleados, bitácora, estados y configuración son solo del admin.</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {STAFF_SECTIONS.map(s => (
          <label key={s.key} className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={sel.includes(s.key)} onChange={e => setSel(v => e.target.checked ? [...(v ?? []), s.key] : (v ?? []).filter(x => x !== s.key))} className="accent-primario w-4 h-4" />
            {s.label}
          </label>
        ))}
      </div>
      {msg && <div className="mt-2"><Msg text={msg.text} tone={msg.tone} /></div>}
      <button onClick={save} disabled={busy || !changed} className={`${btnPrimary} mt-3`}>{busy ? 'Guardando…' : 'Guardar secciones'}</button>
    </Card>
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

function EmployeeDetail({ id, logins, others, onChanged }: { id: string; logins: List['staff_logins']; others: { id: string; full_name: string }[]; onChanged: () => void }) {
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
              {row('Pago', payText(e))}
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
      <ScheduleCard employeeId={e.id} others={others} />
      <Card title="Documentos (contrato, INE, comprobantes…)">
        <FilesBox ownerKind="employee" ownerId={e.id} files={d.files} canDelete onChanged={load} />
      </Card>
    </div>
  )
}

// Horario semanal: de aquí salen los retardos y faltas de Asistencia.
const DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
interface SchedRow { dow: number; works: boolean; start_time: string; end_time: string }
type SchedApi = { schedule: { dow: number; start_time: string; end_time: string | null }[] }
const toRows = (got: SchedApi['schedule']): SchedRow[] => [1, 2, 3, 4, 5, 6, 7].map(dow => {
  const r = got.find(x => x.dow === dow)
  return { dow, works: !!r, start_time: r?.start_time.slice(0, 5) ?? '', end_time: r?.end_time?.slice(0, 5) ?? '' }
})
function ScheduleCard({ employeeId, others }: { employeeId: string; others: { id: string; full_name: string }[] }) {
  const [rows, setRows] = useState<SchedRow[] | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  useEffect(() => {
    call<SchedApi>('get_employee_schedule', { p_employee_id: employeeId }).then(({ data }) => setRows(toRows(data?.schedule ?? [])))
  }, [employeeId])
  if (!rows) return <Card title="Horario"><Spinner /></Card>
  const set = (dow: number, x: Partial<SchedRow>) => { setRows(rows.map(r => r.dow === dow ? { ...r, ...x } : r)); setMsg(null) }
  // Copia la hora de un día a los demás días que trabaja (si no trabaja ningún otro, de lunes a viernes).
  const copyFrom = (src: SchedRow) => {
    const targets = rows.some(r => r.works && r.dow !== src.dow) ? rows.filter(r => r.works) : rows.filter(r => r.dow <= 5 || r.dow === src.dow)
    setRows(rows.map(r => targets.some(t => t.dow === r.dow) ? { ...r, works: true, start_time: src.start_time, end_time: src.end_time } : r))
    setMsg({ text: `Copiado a ${targets.filter(t => t.dow !== src.dow).map(t => DAYS[t.dow]).join(', ') || 'ningún otro día'}. Falta guardar.`, tone: 'ok' })
  }
  const toggle = (r: SchedRow) => {
    if (r.works) { set(r.dow, { works: false }); return }
    const model = rows.find(x => x.works && x.start_time)
    set(r.dow, { works: true, start_time: r.start_time || model?.start_time || '', end_time: r.end_time || model?.end_time || '' })
  }
  const copyOther = async (id: string) => {
    if (!id) return
    const { data } = await call<SchedApi>('get_employee_schedule', { p_employee_id: id })
    const got = data?.schedule ?? []
    if (got.length === 0) { setMsg({ text: 'Esa persona no tiene horario.', tone: 'error' }); return }
    setRows(toRows(got))
    setMsg({ text: `Copiado el horario de ${others.find(o => o.id === id)?.full_name}. Falta guardar.`, tone: 'ok' })
  }
  const save = async () => {
    if (rows.some(r => r.works && !r.start_time)) { setMsg({ text: 'Falta la hora de entrada en algún día que trabaja.', tone: 'error' }); return }
    const { error } = await call('admin_save_employee_schedule', { p_employee_id: employeeId, p: rows.filter(r => r.works && r.start_time).map(({ dow, start_time, end_time }) => ({ dow, start_time, end_time })) })
    setMsg(error ? { text: error === 'bad_times' ? 'La hora de salida debe ser después de la de entrada.' : erpError(error), tone: 'error' } : { text: 'Horario guardado.', tone: 'ok' })
  }
  return (
    <Card title="Horario (para retardos y faltas)" actions={others.length > 0 ? (
      <select defaultValue="" onChange={e => { copyOther(e.target.value); e.target.value = '' }} className={`${input.replace('w-full ', '')} py-1.5 text-xs`} aria-label="Copiar horario de">
        <option value="">Copiar el horario de…</option>
        {others.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
      </select>) : undefined}>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.dow} className="grid grid-cols-[7rem_1fr_1fr_auto] gap-2 items-center text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.works} onChange={() => toggle(r)} className="accent-primario w-4 h-4" />
              <span className={r.works ? 'text-texto-principal font-semibold' : 'text-zinc-500'}>{DAYS[r.dow]}</span>
            </label>
            {r.works ? <>
              <input type="time" value={r.start_time} onChange={x => set(r.dow, { start_time: x.target.value })} className={input} aria-label={`Entrada ${DAYS[r.dow]}`} />
              <input type="time" value={r.end_time} onChange={x => set(r.dow, { end_time: x.target.value })} className={input} aria-label={`Salida ${DAYS[r.dow]}`} />
              <button onClick={() => copyFrom(r)} disabled={!r.start_time} className={btnSmall} title="Poner esta misma hora en los demás días que trabaja">Copiar a los demás</button>
            </> : <span className="text-zinc-500 text-xs col-span-3">Descansa</span>}
          </div>
        ))}
      </div>
      <p className="text-zinc-500 text-xs mt-2">Marca los días que trabaja, pon la hora una vez y toca "Copiar a los demás".</p>
      {msg && <div className="mt-2"><Msg text={msg.text} tone={msg.tone} /></div>}
      <button onClick={save} className={`${btnPrimary} mt-3`}>Guardar horario</button>
    </Card>
  )
}

function EmployeeForm({ e, logins, onSaved }: { e?: Employee; logins: List['staff_logins']; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    full_name: e?.full_name ?? '', position: e?.position ?? '', profile_id: e?.profile_id ?? '', phone: e?.phone ?? '', email: e?.email ?? '',
    birth_date: e?.birth_date ?? '', address: e?.address ?? '', curp: e?.curp ?? '', rfc: e?.rfc ?? '', nss: e?.nss ?? '',
    hire_date: e?.hire_date ?? '', end_date: e?.end_date ?? '', status: e?.status ?? 'active', pay_calc: calcOf(e?.pay_scheme), pay_every: e ? everyOf(e) ?? '' : '',
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
    const { pay_rate, pay_calc, pay_every, ...rest } = f
    if (pay_calc && !pay_every) { setBusy(false); setError('Elige cada cuánto se le paga.'); return }
    const pay_scheme = pay_calc === 'fixed' ? pay_every : pay_calc
    let profile_id = access === 'existing' ? rest.profile_id : ''
    if (access === 'new') {
      if (!rest.full_name.trim()) { setBusy(false); setError('Escribe el nombre completo.'); return }
      if (!rest.email.includes('@')) { setBusy(false); setError('Para darle acceso al panel escribe su correo.'); return }
      const r = await staffAdmin({ action: 'save', email: rest.email, name: rest.full_name, role: acc.role, password: acc.password || null })
      if (r.error || !r.data?.id) { setBusy(false); setError(r.error ?? 'No se pudo dar el acceso.'); return }
      profile_id = r.data.id
    }
    const { data, error } = await call<{ id: string }>('admin_save_employee', { p: { id: e?.id ?? null, ...rest, profile_id, pay_scheme, pay_rate_cents: pay_rate === '' ? '' : toCents(pay_rate) } })
    if (!error && data) {
      const r = await call('admin_set_employee_pay_every', { p_employee_id: data.id, p_every: pay_calc ? pay_every : '' })
      if (r.error) { setBusy(false); setError(r.error === 'server' ? 'Se guardó, pero falta correr erp_nomina.sql para guardar cada cuánto se le paga.' : erpError(r.error)); return }
    }
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
        <div><label className={label}>Cómo se calcula su pago</label>
          <select value={f.pay_calc} onChange={x => set({ pay_calc: x.target.value })} className={input}>
            <option value="">—</option>{Object.entries(PAY_CALC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <MoneyField id={`emp-rate-${e?.id ?? 'new'}`} label={RATE_LABEL[f.pay_calc] ?? 'Monto'} value={f.pay_rate} onChange={v => set({ pay_rate: v })} />
        <div><label className={label}>Se le paga</label>
          <select value={f.pay_every} onChange={x => set({ pay_every: x.target.value })} disabled={!f.pay_calc} className={input}>
            <option value="">—</option>{Object.entries(PAY_EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        {txt('bank_name', 'Banco')}
        {txt('bank_account', 'CLABE / cuenta')}{txt('emergency_name', 'Contacto de emergencia')}{txt('emergency_phone', 'Tel. de emergencia')}
      </div>
      {txt('notes', 'Notas')}
      <Msg text={error} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

// Periodo de pago que contiene una fecha, según cada cuánto se le paga.
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const lastOfMonth = (d: string) => { const x = new Date(d.slice(0, 8) + '01T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10) }
function periodOf(every: string | null, day: string): { from: string; to: string } {
  if (every === 'weekly') {
    const dow = new Date(day + 'T12:00:00Z').getUTCDay() || 7
    const from = addDays(day, 1 - dow)
    return { from, to: addDays(from, 6) }
  }
  if (every === 'monthly') return { from: day.slice(0, 8) + '01', to: lastOfMonth(day) }
  return Number(day.slice(8)) <= 15 ? { from: day.slice(0, 8) + '01', to: day.slice(0, 8) + '15' } : { from: day.slice(0, 8) + '16', to: lastOfMonth(day) }
}
const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })

interface Suggestion {
  scheme: string | null; rate_cents: number | null; scheduled_days: number; worked_days: number; hours: number
  lates: number; absences: number; late_absences: number; excused: number; lates_per_absence: number; has_attendance: boolean
  basis: 'asistencia' | 'horario' | 'fijo' | 'manual'; units: number | null; suggested_cents: number | null
}

function PayForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const t = todayMx()
  const every = everyOf(employee)
  const [period, setPeriod] = useState(() => periodOf(every, t))
  const [sug, setSug] = useState<Suggestion | null | undefined>(undefined)
  const [touched, setTouched] = useState(false)
  const [f, setF] = useState({ amount: toPesos(employee.pay_rate_cents), description: `Nómina ${employee.full_name}`, paid_on: t, method: 'transfer', paid_from: 'bank', notes: '' })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSug(undefined)
    call<Suggestion>('get_payroll_suggestion', { p_employee_id: employee.id, p_from: period.from, p_to: period.to }).then(({ data }) => {
      setSug(data)
      setF(v => ({ ...v, description: `Nómina ${employee.full_name} · ${shortDate(period.from)} al ${shortDate(period.to)}`,
        amount: !touched && data?.suggested_cents != null ? toPesos(data.suggested_cents) : v.amount }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, period.from, period.to])
  const move = (dir: 1 | -1) => { setTouched(false); setPeriod(periodOf(every, dir === 1 ? addDays(period.to, 1) : addDays(period.from, -1))) }
  const save = async () => {
    const { error } = await call('admin_pay_employee', { p_employee_id: employee.id, p: { amount_cents: toCents(f.amount), description: f.description, paid_on: f.paid_on,
      period_month: period.from.slice(0, 8) + '01', method: f.method, paid_from: f.paid_from, notes: f.notes } })
    if (error) { setError(erpError(error)); return }
    onDone()
  }
  const rate = sug?.rate_cents ?? employee.pay_rate_cents
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => move(-1)} className={btnSmall}>←</button>
        <span className="text-texto-principal font-bold">Periodo: {shortDate(period.from)} al {shortDate(period.to)}</span>
        <button onClick={() => move(1)} className={btnSmall}>→</button>
        <span className="text-zinc-500 text-xs">{every ? PAY_EVERY[every] : 'Sin frecuencia de pago (edita sus datos)'}</span>
      </div>
      {sug === undefined ? <Spinner /> : sug === null ? <p className="text-zinc-500 text-xs">No se pudo calcular (¿ya se corrió erp_nomina.sql?). Escribe el monto.</p> : (
        <div className="rounded-xl bg-fondo/60 p-3 text-sm space-y-1">
          {sug.basis === 'asistencia' && sug.scheme === 'daily' && <p className="text-zinc-200">Vino <b>{sug.worked_days}</b> {sug.worked_days === 1 ? 'día' : 'días'} (según Mi asistencia) × {money(rate)} = <b className="text-texto-principal">{money(sug.suggested_cents)}</b></p>}
          {sug.basis === 'horario' && <p className="text-zinc-200">Tiene <b>{sug.scheduled_days}</b> días en su horario × {money(rate)} = <b className="text-texto-principal">{money(sug.suggested_cents)}</b> <span className="text-zinc-500">(todavía no checa en Mi asistencia, así que se toma su horario)</span></p>}
          {sug.basis === 'asistencia' && sug.scheme === 'hourly' && <p className="text-zinc-200"><b>{sug.hours}</b> horas (según Mi asistencia) × {money(rate)} = <b className="text-texto-principal">{money(sug.suggested_cents)}</b></p>}
          {sug.basis === 'fijo' && <p className="text-zinc-200">Sueldo fijo: <b className="text-texto-principal">{money(sug.suggested_cents)}</b></p>}
          {sug.basis === 'manual' && sug.scheme && <p className="text-zinc-400">Se paga {sug.scheme === 'per_class' ? 'por clase' : 'por trabajo'}: escribe el monto.</p>}
          {!sug.scheme && <p className="text-amarillo-suave">No tiene forma de pago. Ponla en "Editar datos" para que se calcule sola.</p>}
          {sug.has_attendance && (sug.lates > 0 || sug.absences > 0 || sug.excused > 0) && (
            <p className="text-zinc-400 text-xs">
              En el periodo: {sug.lates} {sug.lates === 1 ? 'retardo' : 'retardos'} · {sug.absences} {sug.absences === 1 ? 'falta' : 'faltas'}
              {sug.late_absences > 0 && ` (${sug.late_absences} por llegar tarde)`}{sug.excused > 0 && ` · ${sug.excused} justificadas`}.
              {' '}Cada {sug.lates_per_absence} retardos al mes cuentan como una falta: si descuentas, ajusta el monto.
            </p>
          )}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <MoneyField id={`pay-${employee.id}`} label="Monto a pagar" value={f.amount} onChange={v => { setTouched(true); setF({ ...f, amount: v }) }} />
        <div className="sm:col-span-2"><label className={label}>Concepto</label><input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} className={input} /></div>
        <div><label className={label}>Fecha de pago</label><input type="date" value={f.paid_on} onChange={e => setF({ ...f, paid_on: e.target.value })} className={input} /></div>
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
