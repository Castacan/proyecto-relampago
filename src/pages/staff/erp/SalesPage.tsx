import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, money, fmtDate, fmtDateTime, todayMx, csvDownload, METHOD_LABELS, SOURCE_LABELS, EXPENSE_STATUS } from '../../../lib/erp'
import { Page, Card, Stat, Empty, Spinner, Msg, Badge, input, label, btnGhost, btnSmall, btnDanger } from '../../../components/erp/ui'

interface Sale {
  id: string; folio: number; created_at: string; status: string; total_cents: number; discount_cents: number; source: string
  note: string | null; void_reason: string | null; person_id: string | null; person_name: string | null; seller: string | null
  items: { description: string; quantity: number; total_cents: number }[] | null
  payments: { method: string; amount_cents: number; reference: string | null }[] | null
  void_request?: { id: string; status: 'pending' | 'approved' | 'rejected'; reason: string; decision_note: string | null; requested_by: string | null; created_at: string } | null
}

interface VoidRequest {
  id: string; sale_id: string; folio: number; total_cents: number; sale_at: string; reason: string; created_at: string
  requested_by: string | null; person_name: string | null; items: string | null; methods: string | null
}

const VOID_ERRORS: Record<string, string> = {
  reason_required: 'Escribe el motivo (mínimo 5 letras).',
  only_today: 'Solo se pueden pedir cancelaciones de ventas de hoy.',
  already_requested: 'Esa venta ya tiene una cancelación pendiente.',
  subscription_sale: 'Los cobros de domiciliación no se cancelan aquí.',
}

/** (Admin) Cancelaciones que pidió el staff: aprobar (se anula la venta) o rechazar. Sale en Inicio y en el Historial. */
export function VoidRequestsCard({ onChanged }: { onChanged?: () => void }) {
  const [reqs, setReqs] = useState<VoidRequest[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data } = await call<{ requests: VoidRequest[] }>('get_void_requests')
    setReqs(data?.requests ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  if (reqs.length === 0) return null
  const decide = async (r: VoidRequest, approve: boolean) => {
    if (approve && !window.confirm(`¿Anular la venta #${r.folio} por ${money(r.total_cents)}? El dinero se devuelve aparte.`)) return
    setBusy(r.id); setErr(null)
    const { error } = await call('admin_decide_void', { p_request_id: r.id, p_approve: approve, p_note: null })
    setBusy(null)
    if (error) { setErr(erpError(error)); return }
    load(); onChanged?.()
  }
  return (
    <Card title={`Cancelaciones por aprobar (${reqs.length})`} tone="accent">
      <div className="divide-y divide-zinc-800/80">
        {reqs.map(r => (
          <div key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="text-texto-principal font-semibold">#{r.folio} · {r.items} · {money(r.total_cents)}</p>
              <p className="text-zinc-400 text-xs">{fmtDateTime(r.sale_at)} · {r.person_name ?? 'Sin persona'} · {(r.methods ?? '').split(', ').map(m => METHOD_LABELS[m] ?? m).join(', ')}</p>
              <p className="text-amarillo-suave text-xs">Pidió {r.requested_by ?? 'staff'}: "{r.reason}"</p>
            </div>
            <span className="flex gap-2">
              <button disabled={busy === r.id} onClick={() => decide(r, true)} className={btnDanger}>Aprobar y anular</button>
              <button disabled={busy === r.id} onClick={() => decide(r, false)} className={btnSmall}>Rechazar</button>
            </span>
          </div>
        ))}
      </div>
      <Msg text={err} />
    </Card>
  )
}


export function SalesHistoryPage() {
  const [from, setFrom] = useState(todayMx().slice(0, 8) + '01')
  const [to, setTo] = useState(todayMx())
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [onlyToday, setOnlyToday] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    setSales(null)
    const { data } = await call<{ sales: Sale[]; only_today?: boolean }>('get_sales', { p_from: from, p_to: to })
    setSales(data?.sales ?? []); setOnlyToday(!!data?.only_today)
  }, [from, to])
  useEffect(() => { load() }, [load])
  useEffect(() => { call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin)) }, [])

  const completed = (sales ?? []).filter(s => s.status === 'completed')
  const exportCsv = () => csvDownload(`ventas_${from}_${to}.csv`, [
    ['Folio', 'Fecha', 'Persona', 'Artículos', 'Total', 'Descuento', 'Formas de pago', 'Origen', 'Vendió', 'Estado', 'Motivo anulación'],
    ...(sales ?? []).map(s => [s.folio, fmtDateTime(s.created_at), s.person_name ?? '', (s.items ?? []).map(i => `${i.description} x${i.quantity}`).join(' | '),
      (s.total_cents / 100).toFixed(2), (s.discount_cents / 100).toFixed(2),
      (s.payments ?? []).map(p => `${METHOD_LABELS[p.method] ?? p.method} ${(p.amount_cents / 100).toFixed(2)}`).join(' | '),
      SOURCE_LABELS[s.source] ?? s.source, s.seller ?? '', s.status === 'voided' ? 'Anulada' : 'Completada', s.void_reason ?? '']),
  ])

  return (
    <Page title="Historial de ventas" subtitle={onlyToday ? 'Ventas de hoy. Si alguna está mal, ábrela y pide su cancelación: el admin la aprueba.' : undefined}
      actions={isAdmin ? <button onClick={exportCsv} disabled={!sales?.length} className={btnGhost}>Descargar CSV</button> : undefined}>
      {isAdmin && <VoidRequestsCard onChanged={load} />}
      {!onlyToday && (
        <div className="flex flex-wrap items-end gap-3">
          <div><label className={label}>Desde</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={input} /></div>
          <div><label className={label}>Hasta</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={input} /></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Vendido" value={money(completed.reduce((a, s) => a + s.total_cents, 0))} sub={`${completed.length} ventas`} tone="accent" />
        <Stat label="Anuladas" value={(sales ?? []).length - completed.length} />
      </div>
      {sales === null ? <Spinner /> : sales.length === 0 ? <Empty>No hay ventas en esas fechas.</Empty> : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
          {sales.map(s => (
            <div key={s.id}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-left px-4 py-3 hover:bg-superficie-alta flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${s.status === 'voided' ? 'text-zinc-500 line-through' : 'text-texto-principal'}`}>{(s.items ?? []).map(i => i.description).join(', ')}</p>
                  <p className="text-zinc-500 text-xs">#{s.folio} · {fmtDateTime(s.created_at)} · {s.person_name ?? 'Sin persona'} · {SOURCE_LABELS[s.source] ?? s.source}</p>
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  {s.status === 'voided' && <Badge cls="text-white bg-alerta">Anulada</Badge>}
                  {s.status === 'completed' && s.void_request?.status === 'pending' && <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Cancelación pedida</Badge>}
                  <span className="text-texto-principal font-bold tabular-nums">{money(s.total_cents)}</span>
                </span>
              </button>
              {open === s.id && <SaleDetail s={s} isAdmin={isAdmin} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

function SaleDetail({ s, isAdmin, onChanged }: { s: Sale; isAdmin: boolean; onChanged: () => void }) {
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const voidIt = async () => {
    // Admin anula directo; el staff solo pide la cancelación (el admin la aprueba).
    const { error } = isAdmin
      ? await call('admin_void_sale', { p_sale_id: s.id, p_reason: reason })
      : await call('staff_request_void', { p_sale_id: s.id, p_reason: reason })
    if (error) { setError(VOID_ERRORS[error] ?? erpError(error)); return }
    onChanged()
  }
  const vr = s.void_request
  const canAsk = s.status === 'completed' && s.source !== 'subscription' && vr?.status !== 'pending'
  return (
    <div className="px-4 pb-4 space-y-2 text-sm">
      {(s.items ?? []).map((i, k) => <p key={k} className="text-zinc-300">{i.description}{i.quantity > 1 ? ` ×${i.quantity}` : ''} · {money(i.total_cents)}</p>)}
      {s.discount_cents > 0 && <p className="text-zinc-400">Descuento general: {money(s.discount_cents)}</p>}
      <p className="text-zinc-400">Pagos: {(s.payments ?? []).map(p => `${METHOD_LABELS[p.method] ?? p.method} ${money(p.amount_cents)}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}</p>
      {s.seller && <p className="text-zinc-500 text-xs">Vendió: {s.seller}</p>}
      {s.note && <p className="text-zinc-500 text-xs">Nota: {s.note}</p>}
      {s.void_reason && <p className="text-alerta text-xs">Anulada: {s.void_reason}</p>}
      {vr && s.status === 'completed' && (
        <p className={`text-xs ${vr.status === 'pending' ? 'text-amarillo-suave' : 'text-zinc-400'}`}>
          {vr.status === 'pending' ? `Cancelación pedida por ${vr.requested_by ?? 'staff'}: "${vr.reason}". Espera la aprobación del admin.`
            : vr.status === 'rejected' ? `El admin rechazó la cancelación${vr.decision_note ? `: ${vr.decision_note}` : '.'}` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {s.person_id && <Link to={`/staff/personas/${s.person_id}`} className={btnSmall}>Ver ficha</Link>}
        {canAsk && <button onClick={() => setVoiding(v => !v)} className={btnSmall}>{isAdmin ? 'Anular venta' : 'Pedir cancelación'}</button>}
      </div>
      {voiding && (
        <div className="flex gap-2">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder={isAdmin ? 'Motivo (queda registrado)' : '¿Por qué hay que cancelarla?'} className={input} />
          <button onClick={voidIt} className={btnDanger}>{isAdmin ? 'Anular' : 'Pedir'}</button>
        </div>
      )}
      {voiding && <p className="text-zinc-500 text-xs">{isAdmin
        ? 'Anular quita la membresía que dio esta venta. El dinero se devuelve aparte (efectivo, terminal o transferencia).'
        : 'No se cancela todavía: le llega al admin para que la apruebe.'}</p>}
      <Msg text={error} />
    </div>
  )
}

interface Report {
  from: string; to: string; total_cents: number; count: number; by_method: Record<string, number>
  by_product: { description: string; quantity: number; total_cents: number }[]
  by_day: { day: string; total_cents: number; count: number }[]
  cash_sessions: { business_date: string; opening: number; expected: number | null; counted: number | null; difference: number | null }[]
  expenses: {
    total_cents: number; paid_cents: number; pending_cents: number; profit_cents: number
    by_cost_center: { cost_center: string; cents: number }[]
    items: { folio: number; due_on: string; paid_on: string | null; payee: string | null; description: string; cost_center: string
      category: string | null; amount_cents: number; status: string; method: string | null; invoice_ref: string | null }[]
  } | null
}

export function ReportPage() {
  const [month, setMonth] = useState(todayMx().slice(0, 7))
  const [r, setR] = useState<Report | null>(null)
  useEffect(() => {
    setR(null)
    call<Report>('get_sales_report', { p_month: `${month}-01` }).then(({ data }) => setR(data))
  }, [month])

  const exportCsv = () => r && csvDownload(`reporte_${month}.csv`, [
    ['Reporte de ventas', month], [], ['Forma de pago', 'Total'],
    ...Object.entries(r.by_method).map(([m, c]) => [METHOD_LABELS[m] ?? m, (c / 100).toFixed(2)]),
    ['Total', (r.total_cents / 100).toFixed(2)], [], ['Concepto', 'Cantidad', 'Total'],
    ...r.by_product.map(p => [p.description, p.quantity, (p.total_cents / 100).toFixed(2)]), [], ['Día', 'Ventas', 'Total'],
    ...r.by_day.map(d => [d.day, d.count, (d.total_cents / 100).toFixed(2)]),
    ...(r.expenses ? [
      [], ['Egresos del mes', (r.expenses.total_cents / 100).toFixed(2)], ['Utilidad (ventas − egresos)', (r.expenses.profit_cents / 100).toFixed(2)],
      [], ['Centro de costos', 'Total'], ...r.expenses.by_cost_center.map(c => [c.cost_center, (c.cents / 100).toFixed(2)]),
      [], ['Folio', 'Vence', 'Pagado', 'A quién', 'Concepto', 'Centro de costos', 'Categoría', 'Monto', 'Estado', 'Factura'],
      ...r.expenses.items.map(e => [e.folio, e.due_on, e.paid_on ?? '', e.payee ?? '', e.description, e.cost_center, e.category ?? '',
        (e.amount_cents / 100).toFixed(2), EXPENSE_STATUS[e.status]?.label ?? e.status, e.invoice_ref ?? '']),
    ] : []),
  ])

  return (
    <Page title="Reporte del mes" subtitle="Para tu control y para la contadora."
      actions={<button onClick={exportCsv} disabled={!r} className={btnGhost}>Descargar CSV</button>}>
      <div><label className={label}>Mes</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${input} max-w-[12rem]`} /></div>
      {!r ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Total del mes" value={money(r.total_cents)} sub={`${r.count} ventas`} tone="accent" />
            {Object.entries(r.by_method).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => <Stat key={m} label={METHOD_LABELS[m] ?? m} value={money(c)} />)}
          </div>
          {r.expenses && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Ventas" value={money(r.total_cents)} tone="accent" />
              <Stat label="Egresos" value={money(r.expenses.total_cents)} sub={r.expenses.pending_cents ? `${money(r.expenses.pending_cents)} por pagar` : 'todo pagado'} tone="alert" />
              <Stat label="Utilidad" value={money(r.expenses.profit_cents)} sub="ventas − egresos" tone={r.expenses.profit_cents >= 0 ? 'success' : 'alert'} />
              <Card title="Egresos por centro">
                {r.expenses.by_cost_center.length === 0 ? <p className="text-zinc-500 text-xs">Sin egresos.</p> : r.expenses.by_cost_center.map(c => (
                  <div key={c.cost_center} className="flex justify-between text-xs py-0.5"><span className="text-zinc-400 truncate pr-2">{c.cost_center}</span><span className="text-zinc-200 font-bold tabular-nums">{money(c.cents)}</span></div>
                ))}
              </Card>
            </div>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Por concepto">
              {r.by_product.length === 0 ? <Empty>Sin ventas.</Empty> : r.by_product.map(p => (
                <div key={p.description} className="py-1.5 flex justify-between text-sm border-b border-zinc-800/60 last:border-0">
                  <span className="text-zinc-300 truncate pr-2">{p.description} <span className="text-zinc-500">×{p.quantity}</span></span>
                  <span className="text-texto-principal font-bold tabular-nums">{money(p.total_cents)}</span>
                </div>
              ))}
            </Card>
            <Card title="Por día">
              {r.by_day.length === 0 ? <Empty>Sin ventas.</Empty> : r.by_day.map(d => (
                <div key={d.day} className="py-1.5 flex justify-between text-sm border-b border-zinc-800/60 last:border-0">
                  <span className="text-zinc-300">{fmtDate(d.day)} <span className="text-zinc-500">· {d.count}</span></span>
                  <span className="text-texto-principal font-bold tabular-nums">{money(d.total_cents)}</span>
                </div>
              ))}
            </Card>
          </div>
          <Card title="Cortes de caja del mes">
            {r.cash_sessions.length === 0 ? <Empty>No hubo cortes.</Empty> : r.cash_sessions.map(c => (
              <div key={c.business_date + c.opening} className="py-1.5 flex justify-between text-sm border-b border-zinc-800/60 last:border-0">
                <span className="text-zinc-300">{fmtDate(c.business_date)}</span>
                <span className="text-zinc-400 text-xs">{c.counted == null ? 'Abierta' : `Esperado ${money(c.expected)} · contado ${money(c.counted)} · ${c.difference === 0 ? 'cuadró' : `diferencia ${money(c.difference)}`}`}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </Page>
  )
}
