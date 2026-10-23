import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, money, toCents, toPesos, fmtDate, todayMx, csvDownload, EXPENSE_STATUS, EXPENSE_METHODS, PAID_FROM, PAYEE_KINDS } from '../../../lib/erp'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, btnDanger, MoneyField } from '../../../components/erp/ui'

// Egresos (como "Cuentas a pagar" de EVO, más simple): lo que pagas, a quién,
// de qué centro de costos, si ya se pagó y de dónde salió el dinero.

interface Expense {
  id: string; folio: number; payee_id: string | null; payee_name: string | null; payee_kind: string | null
  description: string; cost_center: string; category: string | null; amount_cents: number
  due_on: string; period_month: string; status: 'pending' | 'paid' | 'cancelled'; paid_on: string | null
  method: string | null; paid_from: string | null; invoice_ref: string | null; notes: string | null
  recurring_id: string | null; cancel_reason: string | null; created_by_name: string | null; from_cash: boolean
  stock: { product: string; quantity: number } | null
}
interface Payee { id: string; name: string; kind: string; default_cost_center: string | null; default_category: string | null; phone: string | null; notes: string | null; is_active: boolean }
interface Recurring {
  id: string; payee_id: string | null; payee_name: string | null; description: string; cost_center: string; category: string | null
  amount_cents: number; method: string | null; every_months: number; day_of_month: number; next_on: string; is_active: boolean
}
interface Data {
  month: string; today: string; cost_centers: string[]; expenses: Expense[]
  totals: { paid: number; pending: number; overdue: number }
  by_cost_center: { cost_center: string; cents: number }[]
  sales_cents: number; payees: Payee[]; categories: string[]; recurring: Recurring[]
}

type Tab = 'egresos' | 'recurrentes' | 'proveedores' | 'centros'

export default function ExpensesPage() {
  const [month, setMonth] = useState(todayMx().slice(0, 7))
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('egresos')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await call<Data>('get_expenses', { p_month: `${month}-01` })
    if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin puede ver los egresos.' : 'No se pudieron cargar los egresos. ¿Ya se corrió erp_finanzas.sql?'); return }
    setError(null); setD(data)
  }, [month])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Egresos"><p className="text-alerta text-sm">{error}</p></Page>
  if (!d) return <Page title="Egresos"><Spinner /></Page>

  const tabs: [Tab, string][] = [['egresos', 'Egresos'], ['recurrentes', `Recurrentes (${d.recurring.filter(r => r.is_active).length})`], ['proveedores', 'A quién se paga'], ['centros', 'Centros de costos']]

  return (
    <Page title="Egresos" subtitle="Lo que pagas: proveedores, servicios, nómina, impuestos. Lo pagado de la caja sale solo del efectivo."
      actions={<button onClick={() => { setTab('egresos'); setCreating(v => !v) }} className={btnPrimary}>{creating ? 'Cerrar' : '+ Nuevo egreso'}</button>}>
      <div className="flex flex-wrap gap-1 border-b border-zinc-800/80">
        {tabs.map(([k, v]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-primario text-texto-principal' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}>{v}</button>
        ))}
      </div>

      {tab === 'egresos' && <ExpensesTab d={d} month={month} setMonth={setMonth} creating={creating} setCreating={setCreating} reload={load} />}
      {tab === 'recurrentes' && <RecurringTab d={d} reload={load} />}
      {tab === 'proveedores' && <PayeesTab d={d} reload={load} />}
      {tab === 'centros' && <CentersTab d={d} reload={load} />}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Egresos del mes
// ---------------------------------------------------------------------------
function ExpensesTab({ d, month, setMonth, creating, setCreating, reload }: {
  d: Data; month: string; setMonth: (m: string) => void; creating: boolean; setCreating: (v: boolean) => void; reload: () => void
}) {
  const [status, setStatus] = useState<'all' | 'pending' | 'paid' | 'cancelled'>('all')
  const [center, setCenter] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const list = useMemo(() => d.expenses.filter(e =>
    (status === 'all' ? e.status !== 'cancelled' : e.status === status)
    && (!center || e.cost_center === center)
    && (!q || `${e.description} ${e.payee_name ?? ''} ${e.category ?? ''} ${e.folio}`.toLowerCase().includes(q.toLowerCase()))
  ), [d.expenses, status, center, q])

  const monthTotal = d.totals.paid + d.totals.pending
  const maxCenter = Math.max(1, ...d.by_cost_center.map(c => c.cents))
  const inMonth = (e: Expense) => e.period_month.slice(0, 7) === month

  const exportCsv = () => csvDownload(`egresos_${month}.csv`, [
    ['Folio', 'Vence', 'Mes', 'Pagado', 'A quién', 'Concepto', 'Centro de costos', 'Categoría', 'Monto', 'Estado', 'Forma de pago', 'De dónde', 'Factura', 'Notas'],
    ...d.expenses.filter(inMonth).map(e => [e.folio, e.due_on, e.period_month.slice(0, 7), e.paid_on ?? '', e.payee_name ?? '', e.description, e.cost_center,
      e.category ?? '', (e.amount_cents / 100).toFixed(2), EXPENSE_STATUS[e.status].label, e.method ? EXPENSE_METHODS[e.method] : '',
      e.paid_from ? PAID_FROM[e.paid_from] : '', e.invoice_ref ?? '', e.notes ?? '']),
  ])

  return (
    <>
      {creating && (
        <Card title="Nuevo egreso" tone="accent">
          <ExpenseForm d={d} onSaved={() => { setCreating(false); reload() }} />
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><label className={label}>Mes</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${input} max-w-[12rem]`} /></div>
        <button onClick={exportCsv} className={btnGhost}>Descargar CSV</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Egresos del mes" value={money(monthTotal)} sub={`${money(d.totals.paid)} pagado`} tone="accent" />
        <Stat label="Por pagar" value={money(d.totals.pending)} sub={d.totals.overdue ? `${money(d.totals.overdue)} vencido` : 'nada vencido'} tone={d.totals.overdue ? 'alert' : undefined} />
        <Stat label="Ventas del mes" value={money(d.sales_cents)} />
        <Stat label="Utilidad" value={money(d.sales_cents - monthTotal)} sub="ventas − egresos" tone={d.sales_cents - monthTotal >= 0 ? 'success' : 'alert'} />
      </div>

      {d.by_cost_center.length > 0 && (
        <Card title="Por centro de costos">
          <div className="space-y-2">
            {d.by_cost_center.map(c => (
              <button key={c.cost_center} onClick={() => setCenter(center === c.cost_center ? '' : c.cost_center)} className="w-full text-left">
                <div className="flex justify-between text-sm mb-1">
                  <span className={center === c.cost_center ? 'text-primario font-bold' : 'text-zinc-300'}>{c.cost_center}</span>
                  <span className="text-texto-principal font-bold tabular-nums">{money(c.cents)} <span className="text-zinc-500 font-normal text-xs">{Math.round(c.cents * 100 / Math.max(1, monthTotal))}%</span></span>
                </div>
                <div className="h-2 rounded-full bg-fondo overflow-hidden"><div className="h-full bg-primario/70 rounded-full" style={{ width: `${c.cents * 100 / maxCenter}%` }} /></div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={`${input} max-w-[11rem]`}>
          <option value="all">Pagados y por pagar</option><option value="pending">Por pagar</option><option value="paid">Pagados</option><option value="cancelled">Cancelados</option>
        </select>
        <select value={center} onChange={e => setCenter(e.target.value)} className={`${input} max-w-[13rem]`}>
          <option value="">Todos los centros</option>
          {d.cost_centers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar concepto, proveedor, folio…" className={`${input} max-w-xs`} />
      </div>

      {list.length === 0 ? <Empty>No hay egresos con esos filtros.</Empty> : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
          {list.map(e => {
            const overdue = e.status === 'pending' && e.due_on < d.today
            return (
              <div key={e.id}>
                <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full text-left px-4 py-3 hover:bg-superficie-alta flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${e.status === 'cancelled' ? 'text-zinc-500 line-through' : 'text-texto-principal'}`}>
                      {e.description}{e.payee_name && <span className="text-zinc-400 font-normal"> · {e.payee_name}</span>}
                    </p>
                    <p className="text-zinc-500 text-xs">
                      #{e.folio} · {e.cost_center}{e.category ? ` · ${e.category}` : ''} · {e.status === 'paid' ? `pagado ${fmtDate(e.paid_on)}` : `vence ${fmtDate(e.due_on)}`}
                      {!inMonth(e) && ` · de ${e.period_month.slice(0, 7)}`}{e.recurring_id && ' · 🔁'}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 shrink-0">
                    {overdue ? <Badge cls="text-white bg-alerta">Vencido</Badge> : <Badge cls={EXPENSE_STATUS[e.status].cls}>{EXPENSE_STATUS[e.status].label}</Badge>}
                    <span className="text-texto-principal font-bold tabular-nums">{money(e.amount_cents)}</span>
                  </span>
                </button>
                {open === e.id && <ExpenseDetail e={e} d={d} onChanged={() => { setOpen(null); reload() }} />}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function ExpenseDetail({ e, d, onChanged }: { e: Expense; d: Data; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'pay' | 'edit' | 'cancel'>('none')
  const [pay, setPay] = useState({ paid_on: todayMx(), method: e.method ?? 'transfer', paid_from: 'bank', invoice_ref: e.invoice_ref ?? '' })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doPay = async () => {
    setBusy(true); setError(null)
    const { error } = await call('admin_pay_expense', { p_expense_id: e.id, p_paid_on: pay.paid_on, p_method: pay.method, p_paid_from: pay.paid_from, p_invoice_ref: pay.invoice_ref })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onChanged()
  }
  const doCancel = async () => {
    setBusy(true); setError(null)
    const { error } = await call('admin_cancel_expense', { p_expense_id: e.id, p_reason: reason })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onChanged()
  }

  return (
    <div className="px-4 pb-4 space-y-2 text-sm">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-zinc-300">
        <p><span className="text-zinc-500">Vence:</span> {fmtDate(e.due_on)} · <span className="text-zinc-500">mes:</span> {e.period_month.slice(0, 7)}</p>
        {e.status === 'paid' && <p><span className="text-zinc-500">Pagado:</span> {fmtDate(e.paid_on)} · {EXPENSE_METHODS[e.method ?? ''] ?? e.method} · {PAID_FROM[e.paid_from ?? ''] ?? e.paid_from}</p>}
        {e.invoice_ref && <p><span className="text-zinc-500">Factura / nota:</span> {e.invoice_ref}</p>}
        {e.stock && <p><span className="text-zinc-500">Inventario:</span> entraron {e.stock.quantity} de {e.stock.product}</p>}
        {e.created_by_name && <p><span className="text-zinc-500">Capturó:</span> {e.created_by_name}</p>}
        {e.notes && <p className="sm:col-span-2"><span className="text-zinc-500">Notas:</span> {e.notes}</p>}
        {e.cancel_reason && <p className="sm:col-span-2 text-alerta">Cancelado: {e.cancel_reason}</p>}
      </div>
      {e.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          {e.status === 'pending' && <button onClick={() => setMode(mode === 'pay' ? 'none' : 'pay')} className={btnSmall}>Marcar pagado</button>}
          <button onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')} className={btnSmall}>Editar</button>
          <button onClick={() => setMode(mode === 'cancel' ? 'none' : 'cancel')} className={btnSmall}>{e.status === 'pending' ? 'Cancelar (no se paga)' : 'Cancelar'}</button>
        </div>
      )}
      {mode === 'pay' && (
        <div className="rounded-xl bg-fondo/60 p-3 grid sm:grid-cols-4 gap-2 items-end">
          <div><label className={label}>Fecha de pago</label><input type="date" value={pay.paid_on} onChange={x => setPay({ ...pay, paid_on: x.target.value })} className={input} /></div>
          <div><label className={label}>Forma</label>
            <select value={pay.method} onChange={x => setPay({ ...pay, method: x.target.value, paid_from: x.target.value === 'cash' ? pay.paid_from : 'bank' })} className={input}>
              {Object.entries(EXPENSE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className={label}>Salió de</label>
            <select value={pay.paid_from} onChange={x => setPay({ ...pay, paid_from: x.target.value })} className={input}>
              {Object.entries(PAID_FROM).filter(([k]) => k !== 'cash_register' || pay.method === 'cash').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className={label}>Factura / nota</label><input value={pay.invoice_ref} onChange={x => setPay({ ...pay, invoice_ref: x.target.value })} className={input} /></div>
          <div className="sm:col-span-4 flex flex-wrap items-center gap-3">
            <button onClick={doPay} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : `Pagar ${money(e.amount_cents)}`}</button>
            {pay.paid_from === 'cash_register' && <span className="text-zinc-500 text-xs">Sale del efectivo de la caja abierta.</span>}
          </div>
        </div>
      )}
      {mode === 'edit' && <div className="rounded-xl bg-fondo/60 p-3"><ExpenseForm d={d} e={e} onSaved={onChanged} /></div>}
      {mode === 'cancel' && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <input value={reason} onChange={x => setReason(x.target.value)} placeholder="Motivo (queda registrado)" className={input} />
            <button onClick={doCancel} disabled={busy} className={btnDanger}>Cancelar egreso</button>
          </div>
          {e.from_cash && <p className="text-zinc-500 text-xs">Salió de la caja: si esa caja sigue abierta, el efectivo regresa a la caja.</p>}
          {e.recurring_id && e.status === 'pending' && <p className="text-zinc-500 text-xs">Solo se cancela este mes; el gasto recurrente sigue (páusalo en Recurrentes).</p>}
        </div>
      )}
      <Msg text={error} />
    </div>
  )
}

function ExpenseForm({ d, e, onSaved }: { d: Data; e?: Expense; onSaved: () => void }) {
  const t = todayMx()
  const [f, setF] = useState({
    payee_name: e?.payee_name ?? '', description: e?.description ?? '', amount: toPesos(e?.amount_cents ?? null),
    cost_center: e?.cost_center ?? '', category: e?.category ?? '', due_on: e?.due_on ?? t,
    period_month: (e?.period_month ?? t).slice(0, 7), invoice_ref: e?.invoice_ref ?? '', notes: e?.notes ?? '',
    pay_now: !e, method: 'transfer', paid_from: 'bank', paid_on: t, repeat: false, every_months: '1',
  })
  const [monthTouched, setMonthTouched] = useState(!!e)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }

  const pickPayee = (name: string) => {
    const p = d.payees.find(y => y.name.toLowerCase() === name.trim().toLowerCase())
    set({ payee_name: name, ...(p && !f.cost_center && p.default_cost_center ? { cost_center: p.default_cost_center } : {}),
      ...(p && !f.category && p.default_category ? { category: p.default_category } : {}) })
  }

  const save = async () => {
    setBusy(true)
    const base = {
      payee_name: f.payee_name, description: f.description, amount_cents: toCents(f.amount), cost_center: f.cost_center,
      category: f.category, due_on: f.due_on, period_month: `${f.period_month}-01`, invoice_ref: f.invoice_ref, notes: f.notes,
    }
    const p = e ? { id: e.id, ...base } : {
      ...base, pay_now: f.pay_now, method: f.pay_now ? f.method : null, paid_from: f.paid_from, paid_on: f.paid_on,
      repeat: f.repeat ? { every_months: Number(f.every_months), day_of_month: Math.min(28, Number(f.due_on.slice(8, 10))) } : null,
    }
    const { error } = await call('admin_save_expense', { p })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onSaved()
  }

  return (
    <div className="space-y-3">
      <datalist id="payees-list">{d.payees.filter(p => p.is_active).map(p => <option key={p.id} value={p.name} />)}</datalist>
      <datalist id="categories-list">{d.categories.map(c => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={label}>A quién se le paga</label><input list="payees-list" value={f.payee_name} onChange={x => pickPayee(x.target.value)} placeholder="Ej. Telmex, Costco, Ximena" className={input} /></div>
        <div className="sm:col-span-2"><label className={label}>Concepto</label><input value={f.description} onChange={x => set({ description: x.target.value })} placeholder="Ej. Internet, limpieza, agarres" className={input} /></div>
        <MoneyField id={`exp-amount-${e?.id ?? 'new'}`} label="Monto" value={f.amount} onChange={v => set({ amount: v })} />
        <div><label className={label}>Centro de costos</label>
          <select value={f.cost_center} onChange={x => set({ cost_center: x.target.value })} className={input}>
            <option value="">Elige…</option>
            {[...new Set([...d.cost_centers, ...(f.cost_center ? [f.cost_center] : [])])].map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label className={label}>Categoría (opcional)</label><input list="categories-list" value={f.category} onChange={x => set({ category: x.target.value })} placeholder="Ej. Servicios, Limpieza" className={input} /></div>
        <div><label className={label}>Vence</label><input type="date" value={f.due_on}
          onChange={x => set({ due_on: x.target.value, ...(monthTouched ? {} : { period_month: x.target.value.slice(0, 7) }) })} className={input} /></div>
        <div><label className={label}>Corresponde al mes</label><input type="month" value={f.period_month} onChange={x => { setMonthTouched(true); set({ period_month: x.target.value }) }} className={input} /></div>
        <div><label className={label}>Factura / nota (opcional)</label><input value={f.invoice_ref} onChange={x => set({ invoice_ref: x.target.value })} className={input} /></div>
      </div>
      <div><label className={label}>Notas (opcional)</label><input value={f.notes} onChange={x => set({ notes: x.target.value })} className={input} /></div>

      {!e && (
        <div className="rounded-xl bg-fondo/60 p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={f.pay_now} onChange={x => set({ pay_now: x.target.checked })} className="accent-primario w-4 h-4" />
            Ya se pagó
          </label>
          {f.pay_now && (
            <div className="grid sm:grid-cols-3 gap-2">
              <div><label className={label}>Forma</label>
                <select value={f.method} onChange={x => set({ method: x.target.value, paid_from: x.target.value === 'cash' ? f.paid_from : 'bank' })} className={input}>
                  {Object.entries(EXPENSE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label className={label}>Salió de</label>
                <select value={f.paid_from} onChange={x => set({ paid_from: x.target.value })} className={input}>
                  {Object.entries(PAID_FROM).filter(([k]) => k !== 'cash_register' || f.method === 'cash').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label className={label}>Fecha de pago</label><input type="date" value={f.paid_on} onChange={x => set({ paid_on: x.target.value })} className={input} /></div>
              {f.paid_from === 'cash_register' && <p className="sm:col-span-3 text-zinc-500 text-xs">Se descuenta del efectivo de la caja abierta (aparece en el corte).</p>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={f.repeat} onChange={x => set({ repeat: x.target.checked })} className="accent-primario w-4 h-4" />
            Se repite (internet, renta, contadora…): crea el pendiente solo cada periodo
          </label>
          {f.repeat && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44"><label className={label}>Cada</label>
                <select value={f.every_months} onChange={x => set({ every_months: x.target.value })} className={input}>
                  <option value="1">mes</option><option value="2">2 meses</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">año</option>
                </select></div>
              <p className="text-zinc-500 text-xs pb-3">el día {Math.min(28, Number(f.due_on.slice(8, 10)))} · aparece como "por pagar" una semana antes</p>
            </div>
          )}
        </div>
      )}
      <Msg text={error} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : e ? 'Guardar cambios' : 'Guardar egreso'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recurrentes
// ---------------------------------------------------------------------------
function RecurringTab({ d, reload }: { d: Data; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const toggle = async (r: Recurring) => {
    await call('admin_save_recurring', { p: { ...r, is_active: !r.is_active } })
    reload()
  }
  const everyLabel = (r: Recurring) => r.every_months === 1 ? `cada mes, día ${r.day_of_month}` : r.every_months === 12 ? `cada año, día ${r.day_of_month}` : `cada ${r.every_months} meses, día ${r.day_of_month}`
  const monthly = d.recurring.filter(r => r.is_active).reduce((a, r) => a + Math.round(r.amount_cents / r.every_months), 0)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-zinc-400 text-sm">Gastos fijos que se repiten. Una semana antes de cada vencimiento aparecen solos como "por pagar". Promedio al mes: <span className="text-texto-principal font-bold">{money(monthly)}</span></p>
        <button onClick={() => setCreating(v => !v)} className={btnGhost}>{creating ? 'Cerrar' : '+ Nuevo recurrente'}</button>
      </div>
      {creating && <Card title="Nuevo gasto recurrente" tone="accent"><RecurringForm d={d} onSaved={() => { setCreating(false); reload() }} /></Card>}
      {d.recurring.length === 0 ? <Empty>Aún no hay gastos recurrentes. Al capturar un egreso marca "Se repite".</Empty> : (
        <div className="space-y-2">
          {d.recurring.map(r => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={() => setEditing(editing === r.id ? null : r.id)} className="text-left min-w-0">
                  <p className={`font-bold ${r.is_active ? 'text-texto-principal' : 'text-zinc-500'}`}>{r.description}{r.payee_name && <span className="text-zinc-400 font-normal"> · {r.payee_name}</span>}</p>
                  <p className="text-zinc-500 text-xs">{r.cost_center} · {everyLabel(r)} · {r.is_active ? `próximo ${fmtDate(r.next_on)}` : 'pausado'}</p>
                </button>
                <span className="flex items-center gap-2">
                  <span className="text-texto-principal font-black tabular-nums">{money(r.amount_cents)}</span>
                  <button onClick={() => toggle(r)} className={btnSmall}>{r.is_active ? 'Pausar' : 'Reanudar'}</button>
                </span>
              </div>
              {editing === r.id && <div className="mt-3"><RecurringForm d={d} r={r} onSaved={() => { setEditing(null); reload() }} /></div>}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function RecurringForm({ d, r, onSaved }: { d: Data; r?: Recurring; onSaved: () => void }) {
  const [f, setF] = useState({
    payee_name: r?.payee_name ?? '', description: r?.description ?? '', amount: toPesos(r?.amount_cents ?? null),
    cost_center: r?.cost_center ?? '', category: r?.category ?? '', method: r?.method ?? '',
    every_months: String(r?.every_months ?? 1), day_of_month: String(r?.day_of_month ?? 1), next_on: r?.next_on ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }
  const save = async () => {
    setBusy(true)
    const { error } = await call('admin_save_recurring', { p: {
      id: r?.id ?? null, payee_name: f.payee_name, description: f.description, amount_cents: toCents(f.amount), cost_center: f.cost_center,
      category: f.category, method: f.method, every_months: Number(f.every_months), day_of_month: Number(f.day_of_month),
      next_on: f.next_on || null, is_active: r?.is_active ?? true,
    } })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onSaved()
  }
  return (
    <div className="space-y-3">
      <datalist id="payees-list-r">{d.payees.map(p => <option key={p.id} value={p.name} />)}</datalist>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={label}>A quién</label><input list="payees-list-r" value={f.payee_name} onChange={x => set({ payee_name: x.target.value })} className={input} /></div>
        <div className="sm:col-span-2"><label className={label}>Concepto</label><input value={f.description} onChange={x => set({ description: x.target.value })} className={input} /></div>
        <MoneyField id={`rec-amount-${r?.id ?? 'new'}`} label="Monto" value={f.amount} onChange={v => set({ amount: v })} />
        <div><label className={label}>Centro de costos</label>
          <select value={f.cost_center} onChange={x => set({ cost_center: x.target.value })} className={input}>
            <option value="">Elige…</option>
            {[...new Set([...d.cost_centers, ...(f.cost_center ? [f.cost_center] : [])])].map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label className={label}>Categoría</label><input value={f.category} onChange={x => set({ category: x.target.value })} className={input} /></div>
        <div><label className={label}>Cada</label>
          <select value={f.every_months} onChange={x => set({ every_months: x.target.value })} className={input}>
            <option value="1">mes</option><option value="2">2 meses</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">año</option>
          </select></div>
        <div><label className={label}>Día del mes (1–28)</label><input type="number" min={1} max={28} value={f.day_of_month} onChange={x => set({ day_of_month: x.target.value })} className={input} /></div>
        <div><label className={label}>Próximo vencimiento</label><input type="date" value={f.next_on} onChange={x => set({ next_on: x.target.value })} className={input} /></div>
      </div>
      <Msg text={error} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A quién se paga
// ---------------------------------------------------------------------------
function PayeesTab({ d, reload }: { d: Data; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-zinc-400 text-sm">Se crean solos al capturar un egreso. Aquí les pones tipo y centro de costos por defecto (se rellena al elegirlos).</p>
        <button onClick={() => setCreating(v => !v)} className={btnGhost}>{creating ? 'Cerrar' : '+ Nuevo'}</button>
      </div>
      {creating && <Card tone="accent"><PayeeForm d={d} onSaved={() => { setCreating(false); reload() }} /></Card>}
      {d.payees.length === 0 ? <Empty>Todavía no hay a quién.</Empty> : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80">
          {d.payees.map(p => (
            <div key={p.id}>
              <button onClick={() => setEditing(editing === p.id ? null : p.id)} className="w-full text-left px-4 py-2.5 hover:bg-superficie-alta flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${p.is_active ? 'text-texto-principal' : 'text-zinc-500'}`}>{p.name}</span>
                <span className="text-zinc-500 text-xs">{PAYEE_KINDS[p.kind]}{p.default_cost_center ? ` · ${p.default_cost_center}` : ''}</span>
              </button>
              {editing === p.id && <div className="px-4 pb-4"><PayeeForm d={d} p={p} onSaved={() => { setEditing(null); reload() }} /></div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function PayeeForm({ d, p, onSaved }: { d: Data; p?: Payee; onSaved: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', kind: p?.kind ?? 'supplier', default_cost_center: p?.default_cost_center ?? '', default_category: p?.default_category ?? '', phone: p?.phone ?? '', notes: p?.notes ?? '', is_active: p?.is_active ?? true })
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('admin_save_payee', { p: { id: p?.id ?? null, ...f } })
    if (error) { setError(erpError(error)); return }
    onSaved()
  }
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className={label}>Nombre</label><input value={f.name} onChange={x => setF({ ...f, name: x.target.value })} className={input} /></div>
        <div><label className={label}>Tipo</label>
          <select value={f.kind} onChange={x => setF({ ...f, kind: x.target.value })} className={input}>
            {Object.entries(PAYEE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className={label}>Teléfono</label><input value={f.phone} onChange={x => setF({ ...f, phone: x.target.value })} className={input} /></div>
        <div><label className={label}>Centro de costos por defecto</label>
          <select value={f.default_cost_center} onChange={x => setF({ ...f, default_cost_center: x.target.value })} className={input}>
            <option value="">—</option>{d.cost_centers.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label className={label}>Categoría por defecto</label><input value={f.default_category} onChange={x => setF({ ...f, default_category: x.target.value })} className={input} /></div>
        <div><label className={label}>Notas</label><input value={f.notes} onChange={x => setF({ ...f, notes: x.target.value })} className={input} /></div>
      </div>
      {p && (
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={f.is_active} onChange={x => setF({ ...f, is_active: x.target.checked })} className="accent-primario w-4 h-4" />
          Activo (aparece en la lista al capturar)
        </label>
      )}
      <Msg text={error} />
      <button onClick={save} className={btnPrimary}>Guardar</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Centros de costos
// ---------------------------------------------------------------------------
function CentersTab({ d, reload }: { d: Data; reload: () => void }) {
  const [list, setList] = useState<string[]>(d.cost_centers)
  const [nuevo, setNuevo] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const save = async () => {
    const { error } = await call('admin_set_cost_centers', { p_centers: list })
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    setMsg({ text: 'Guardado.', tone: 'ok' }); reload()
  }
  return (
    <Card title="Centros de costos" actions={<Link to="/staff/reportes" className="text-primario text-xs font-bold">Ver reporte del mes</Link>}>
      <p className="text-zinc-400 text-sm mb-3">Las "cajitas" en que se agrupan los egresos en el reporte (como en EVO: Gastos fijos, Gastos variables, Compra de productos). Quitar uno no cambia los egresos que ya lo usan.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {list.map(c => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-xl bg-superficie-alta border border-zinc-700/50 px-3 py-1.5 text-sm text-zinc-200">
            {c}<button onClick={() => setList(list.filter(x => x !== c))} className="text-zinc-500 hover:text-alerta" aria-label={`Quitar ${c}`}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 max-w-md">
        <input value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Nuevo centro (ej. Nómina)" className={input} />
        <button onClick={() => { if (nuevo.trim() && !list.includes(nuevo.trim())) setList([...list, nuevo.trim()]); setNuevo('') }} className={btnSmall}>Agregar</button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} className={btnPrimary}>Guardar centros</button>
        <Msg text={msg?.text ?? null} tone={msg?.tone} />
      </div>
    </Card>
  )
}
