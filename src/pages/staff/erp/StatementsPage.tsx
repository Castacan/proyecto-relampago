import { useEffect, useMemo, useState } from 'react'
import { call, money, METHOD_LABELS, PAID_FROM, csvDownload } from '../../../lib/erp'
import { Page, Card, Stat, Spinner, input, label, btnGhost, btnSmall } from '../../../components/erp/ui'
import StatementCharts from './StatementCharts'

// Estado de resultados y flujo de efectivo por mes (admin). Es para tu control;
// los estados contables formales (balance general, declaraciones) los hace la contadora.

type Cell = { group?: string; month: number; cents: number }
interface Data {
  year: number; income: Cell[]; discounts: Cell[]; cogs: Cell[]; expenses: Cell[]; inventory_purchases: Cell[]; cash_in: Cell[]; cash_out: Cell[]
  position: { inventory_cost_cents: number; payables_cents: number; cash_in_register_cents: number | null; active_members: number; active_subscriptions: number; mrr_cents: number }
}
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
type Kind = 'total' | 'sub' | 'neg' | 'info' | 'group' | 'concept'
/** key: para contraer (secciones y grupos). parents: llaves de las que depende para verse. */
type Row = { label: string; values: number[]; kind?: Kind; key?: string; parents?: string[] }

// Formato de Inge (erp_estado_resultados.sql): grupo con su total y los conceptos debajo.
// event: NULL = gym; con nombre = evento (competencia, etc.; erp_eventos.sql).
type DCell = { group: string; concept: string; month: number; cents: number; event?: string | null }
interface Detail { year: number; cost_centers: string[] | null; income: DCell[]; discounts: Cell[]; expenses: DCell[] }
const INCOME_ORDER = ['Servicio', 'Plan', 'Producto', 'Otros', 'Inscripciones', 'Patrocinio', 'Otros ingresos']
const EXPENSE_ORDER = ['Gastos fijos', 'Gastos variables', 'Inversión', 'Compra de productos', 'Impuestos']
const INVERSION = 'Inversión'

const byMonth = (cells: Cell[], group?: string) => MONTHS.map((_, i) => cells.filter(c => c.month === i + 1 && (group === undefined || c.group === group)).reduce((a, c) => a + Number(c.cents), 0))
const groups = (cells: Cell[]) => [...new Set(cells.map(c => c.group ?? ''))].sort((a, b) => byMonth(cells, b).reduce((x, y) => x + y, 0) - byMonth(cells, a).reduce((x, y) => x + y, 0))
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

function detailRows(cells: DCell[], order: string[], section: string, outer: string[] = []): Row[] {
  const gs = [...new Set(cells.map(c => c.group))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  const out: Row[] = []
  for (const g of gs) {
    const gc = cells.filter(c => c.group === g)
    const key = `${section}/${g}`
    out.push({ label: g, values: byMonth(gc), kind: 'group', key, parents: [...outer, section] })
    const concepts = [...new Set(gc.map(c => c.concept))]
      .map(c => ({ label: c, values: byMonth(gc.filter(x => x.concept === c)), kind: 'concept' as const, parents: [...outer, section, key] }))
      .sort((a, b) => sum(b.values) - sum(a.values))
    out.push(...concepts)
  }
  return out
}

export default function StatementsPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [d, setD] = useState<Data | null>(null)
  const [det, setDet] = useState<Detail | null>(null)
  const [detError, setDetError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'formato' | 'resultados' | 'flujo'>('formato')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<number> | null>(null)   // null = todos los meses con movimiento
  const [withInv, setWithInv] = useState(true)
  const [scope, setScope] = useState<'gym' | 'todo'>('todo')   // gym solo o gym + eventos
  const [charts, setCharts] = useState(true)

  useEffect(() => {
    setD(null); setDet(null); setDetError(false); setPicked(null)
    call<Data>('get_financial_statements', { p_year: year }).then(({ data, error }) => {
      if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin puede ver los estados financieros.' : 'No se pudo cargar. ¿Ya se corrió erp_crm.sql?'); return }
      setError(null); setD(data)
    })
    call<Detail>('get_income_statement', { p_year: year }).then(({ data, error }) => {
      if (error || !data) { setDetError(true); return }
      setDet(data)
    })
  }, [year])

  // Renglones de la pestaña activa + meses que tienen movimiento.
  const { rows, available, chart } = useMemo(() => {
    let rows: Row[] = []
    let available = MONTHS.map((_, i) => i)
    let chart: { inc: number[]; exp: number[]; net: number[]; byGroup: { label: string; values: number[] }[] } | null = null
    if (tab === 'formato' && det) {
      const expOrder = [...EXPENSE_ORDER, ...(det.cost_centers ?? [])]
      const used = (cells: DCell[]) => withInv ? cells : cells.filter(c => c.group !== INVERSION)
      const invLabel = (r: Row) => !withInv && r.label === INVERSION && r.kind === 'group' ? { ...r, label: `${INVERSION} (no se resta)` } : r
      const gymInc = det.income.filter(c => !c.event), gymExp = det.expenses.filter(c => !c.event)
      const events = [...new Set([...det.income, ...det.expenses].map(c => c.event).filter((e): e is string => !!e))].sort()
      const showEvents = scope === 'todo' && events.length > 0
      const disc = byMonth(det.discounts)
      const gNet = sub(byMonth(gymInc), disc), gExp = byMonth(used(gymExp)), gUtil = sub(gNet, gExp)
      const gymWord = showEvents ? ' del gym' : ''
      rows = [
        { label: `Ingresos${gymWord}`, values: [], kind: 'sub', key: 'Ingresos' }, ...detailRows(gymInc, INCOME_ORDER, 'Ingresos'),
        ...(sum(disc) ? [{ label: 'Descuentos', values: disc.map(v => -v), kind: 'neg' as const, parents: ['Ingresos'] }] : []),
        { label: `Total ingresos${gymWord}`, values: gNet, kind: 'total' },
        { label: `Egresos${gymWord}`, values: [], kind: 'sub', key: 'Egresos' },
        ...detailRows(gymExp, expOrder, 'Egresos').map(invLabel),
        { label: `Total egresos${gymWord}${withInv ? '' : ' (sin inversión)'}`, values: gExp, kind: 'total' },
        { label: `${withInv ? 'Utilidad' : 'Utilidad sin inversión'}${showEvents ? ' del gym' : ' neta'}`, values: gUtil, kind: 'total' },
      ]
      let tInc = gNet, tExp = gExp
      if (showEvents) {
        for (const ev of events) {
          const k = `Evento:${ev}`
          const eInc = det.income.filter(c => c.event === ev), eExp = det.expenses.filter(c => c.event === ev)
          const ei = byMonth(eInc), ee = byMonth(used(eExp))
          rows.push(
            { label: `Evento: ${ev}`, values: [], kind: 'sub', key: k },
            ...detailRows(eInc, INCOME_ORDER, `${k}/ing`, [k]),
            { label: 'Ingresos del evento', values: ei, kind: 'total', parents: [k] },
            ...detailRows(eExp, expOrder, `${k}/egr`, [k]).map(invLabel),
            { label: 'Egresos del evento', values: ee, kind: 'total', parents: [k] },
            { label: `Resultado: ${ev}`, values: sub(ei, ee), kind: 'total' },
          )
          tInc = tInc.map((v, i) => v + ei[i]); tExp = tExp.map((v, i) => v + ee[i])
        }
        rows.push({ label: withInv ? 'Utilidad total (gym + eventos)' : 'Utilidad total sin inversión (gym + eventos)', values: sub(tInc, tExp), kind: 'total' })
      }
      const allInc = showEvents ? det.income : gymInc, allExp = showEvents ? det.expenses : gymExp
      const anyInc = byMonth(allInc), anyExp = byMonth(allExp)
      available = available.filter(i => anyInc[i] || anyExp[i])
      if (!available.length) available = [new Date().getMonth()]
      chart = {
        inc: tInc, exp: tExp, net: sub(tInc, tExp),
        byGroup: [...new Set(used(allExp).map(c => c.group))]
          .map(g => ({ label: g, values: byMonth(used(allExp).filter(c => c.group === g)) })),
      }
    } else if (d && tab === 'resultados') {
      const incomeRows = groups(d.income).map(g => ({ label: g, values: byMonth(d.income, g), parents: ['Ingresos'] }))
      const income = byMonth(d.income), disc = byMonth(d.discounts), cogs = byMonth(d.cogs)
      const net = sub(income, disc), gross = sub(net, cogs)
      const expRows = groups(d.expenses).map(g => ({ label: g, values: byMonth(d.expenses, g).map(v => -v), kind: 'neg' as const, parents: ['Gastos'] }))
      const exp = byMonth(d.expenses)
      rows = [
        { label: 'Ingresos', values: [], kind: 'sub', key: 'Ingresos' }, ...incomeRows,
        ...(sum(disc) ? [{ label: 'Descuentos generales', values: disc.map(v => -v), kind: 'neg' as const, parents: ['Ingresos'] }] : []),
        { label: 'Ingresos netos', values: net, kind: 'total' },
        { label: 'Costo de lo vendido (productos)', values: cogs.map(v => -v), kind: 'neg' },
        { label: 'Utilidad bruta', values: gross, kind: 'total' },
        { label: 'Gastos', values: [], kind: 'sub', key: 'Gastos' }, ...expRows,
        { label: 'Total gastos', values: exp.map(v => -v), kind: 'total' },
        { label: 'Utilidad de operación', values: sub(gross, exp), kind: 'total' },
        ...(sum(byMonth(d.inventory_purchases)) ? [{ label: 'Compras de inventario (ya incluidas vía costo de lo vendido)', values: byMonth(d.inventory_purchases), kind: 'info' as const }] : []),
      ]
    } else if (d) {
      const inRows = groups(d.cash_in).map(g => ({ label: METHOD_LABELS[g] ?? g, values: byMonth(d.cash_in, g), parents: ['Entradas'] }))
      const outRows = groups(d.cash_out).map(g => ({ label: PAID_FROM[g] ?? g, values: byMonth(d.cash_out, g).map(v => -v), kind: 'neg' as const, parents: ['Salidas'] }))
      const cin = byMonth(d.cash_in), cout = byMonth(d.cash_out), net = sub(cin, cout)
      let acc = 0
      rows = [
        { label: 'Entradas (cobros)', values: [], kind: 'sub', key: 'Entradas' }, ...inRows, { label: 'Total entradas', values: cin, kind: 'total' },
        { label: 'Salidas (egresos pagados)', values: [], kind: 'sub', key: 'Salidas' }, ...outRows, { label: 'Total salidas', values: cout.map(v => -v), kind: 'total' },
        { label: 'Flujo neto del mes', values: net, kind: 'total' },
        { label: 'Acumulado del año', values: net.map(v => (acc += v)), kind: 'info' },
      ]
    }
    return { rows, available, chart }
  }, [tab, d, det, withInv, scope])

  if (error) return <Page title="Estados financieros"><p className="text-alerta text-sm">{error}</p></Page>

  const shown = available.filter(i => !picked || picked.has(i))
  const total = (r: Row) => shown.reduce((a, i) => a + (r.values[i] ?? 0), 0)
  const visible = rows.filter(r => !(r.parents ?? []).some(p => collapsed.has(p)))
  const groupKeys = rows.filter(r => r.key).map(r => r.key as string)
  const toggle = (k: string) => setCollapsed(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  // Con "Todos" activo, tocar un mes elige solo ese; luego cada toque suma o quita.
  const toggleMonth = (i: number) => setPicked(prev => {
    if (!prev) return available.length === 1 ? null : new Set([i])
    const n = new Set(prev)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n.size === 0 || n.size === available.length ? null : n
  })

  const exportCsv = () => csvDownload(`${tab === 'flujo' ? 'flujo_efectivo' : 'estado_resultados'}_${year}.csv`, [
    ['Concepto', ...shown.map(i => MONTHS[i]), 'Total'],
    ...rows.map(r => [r.kind === 'group' || r.kind === 'sub' ? r.label.toUpperCase() : r.label,
      ...(r.values.length ? shown.map(i => (r.values[i] / 100).toFixed(2)) : shown.map(() => '')),
      r.values.length ? (total(r) / 100).toFixed(2) : '']),
  ])
  const ready = tab === 'formato' ? !!det : !!d
  const tabBtn = (t: typeof tab, text: string) => (
    <button onClick={() => { setTab(t); setCollapsed(new Set()) }} className={`px-3 py-2 rounded-xl text-sm font-bold ${tab === t ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>{text}</button>
  )
  const hasInv = !!det?.expenses.some(c => c.group === INVERSION)
  const hasEvents = !!det && [...det.income, ...det.expenses].some(c => c.event)

  // Colores alternados (renglones visibles con números); el fondo sólido sirve también para la primera columna fija.
  let zebra = 0
  return (
    <Page title="Estados financieros" width="max-w-7xl"
      subtitle="Estado de resultados y flujo de efectivo por mes, con lo que registras en ventas y egresos. Para tu control; lo contable formal lo hace la contadora."
      actions={<button onClick={exportCsv} disabled={!ready} className={btnGhost}>Descargar CSV</button>}>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Año</label><input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`${input} max-w-[8rem]`} /></div>
        <div className="flex flex-wrap gap-1">
          {tabBtn('formato', 'Estado de resultados')}
          {tabBtn('resultados', 'Con costo de lo vendido')}
          {tabBtn('flujo', 'Flujo de efectivo')}
        </div>
      </div>

      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-400 text-xs font-bold mr-1">Meses:</span>
          <button onClick={() => setPicked(null)} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${!picked ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Todos</button>
          {available.map(i => (
            <button key={i} onClick={() => toggleMonth(i)} aria-pressed={shown.includes(i)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold ${picked && shown.includes(i) ? 'bg-primario/80 text-texto-en-acento' : picked ? 'bg-superficie text-zinc-500' : 'bg-superficie-alta text-texto-principal'}`}>{MONTHS[i]}</button>
          ))}
          <span className="flex-1" />
          {tab === 'formato' && hasEvents && (
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/50 text-xs font-bold">
              <button onClick={() => setScope('gym')} className={`px-2.5 py-1 ${scope === 'gym' ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Solo gym</button>
              <button onClick={() => setScope('todo')} className={`px-2.5 py-1 ${scope === 'todo' ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Gym + eventos</button>
            </div>
          )}
          {tab === 'formato' && hasInv && (
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/50 text-xs font-bold">
              <button onClick={() => setWithInv(true)} className={`px-2.5 py-1 ${withInv ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Utilidad con inversión</button>
              <button onClick={() => setWithInv(false)} className={`px-2.5 py-1 ${!withInv ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Sin inversión</button>
            </div>
          )}
          <button onClick={() => setCollapsed(new Set(groupKeys))} className={btnSmall}>Contraer todo</button>
          <button onClick={() => setCollapsed(new Set())} className={btnSmall}>Expandir todo</button>
          {tab === 'formato' && <button onClick={() => setCharts(v => !v)} className={btnSmall}>{charts ? 'Ocultar gráficas' : 'Ver gráficas'}</button>}
        </div>
      )}

      {tab === 'formato' && detError ? <p className="text-alerta text-sm">No se pudo cargar. ¿Ya se corrió erp_estado_resultados.sql?</p> : !ready || !d ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Socios con membresía" value={d.position.active_members} />
            <Stat label="Domiciliaciones" value={d.position.active_subscriptions} sub={`${money(d.position.mrr_cents)} al mes`} tone="accent" />
            <Stat label="Inventario a costo" value={money(d.position.inventory_cost_cents)} />
            <Stat label="Por pagar" value={money(d.position.payables_cents)} tone={d.position.payables_cents ? 'alert' : undefined} />
            <Stat label="Efectivo en caja" value={d.position.cash_in_register_cents == null ? 'Cerrada' : money(d.position.cash_in_register_cents)} />
          </div>

          {tab === 'formato' && charts && chart && (
            <StatementCharts
              months={shown.map(i => MONTHS[i])}
              inc={shown.map(i => chart.inc[i])} exp={shown.map(i => chart.exp[i])} net={shown.map(i => chart.net[i])}
              netLabel={withInv ? 'Utilidad neta' : 'Utilidad sin inversión'}
              breakdown={chart.byGroup.map(g => ({ label: g.label, cents: shown.reduce((a, i) => a + g.values[i], 0) }))
                .filter(g => g.cents > 0).sort((a, b) => b.cents - a.cents)} />
          )}

          <Card>
            <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
              <table className={`w-full text-sm ${shown.length > 6 ? 'min-w-[980px]' : ''}`}>
                <thead><tr className="text-zinc-500 text-xs">
                  <th className="text-left font-semibold py-1.5 pr-3 sticky left-0 bg-superficie">Concepto</th>
                  {shown.map(i => <th key={i} className="text-right font-semibold py-1.5 px-1.5">{MONTHS[i]}</th>)}
                  <th className="text-right font-semibold py-1.5 pl-2">Total</th>
                </tr></thead>
                <tbody>
                  {visible.map((r, i) => {
                    if (r.kind === 'sub') {
                      zebra = 0
                      const open = !collapsed.has(r.key!)
                      return (
                        <tr key={i}><td colSpan={shown.length + 2} className="pt-4 pb-1 sticky left-0 bg-superficie">
                          <button onClick={() => toggle(r.key!)} className="text-zinc-300 hover:text-texto-principal text-[11px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5" aria-expanded={open}>
                            <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>{r.label}
                          </button>
                        </td></tr>
                      )
                    }
                    const isGroup = r.kind === 'group'
                    if (isGroup || r.kind === 'total') zebra = 0
                    const stripe = r.kind === 'concept' || r.kind === 'neg' || r.kind === 'info' ? (zebra++ % 2 === 1) : false
                    const bg = stripe ? 'bg-superficie-alta/60' : 'bg-superficie'
                    const open = isGroup && !collapsed.has(r.key!)
                    const tot = total(r)
                    return (
                      <tr key={i} className={`${r.kind === 'total' ? 'border-t border-zinc-600/70 font-bold' : isGroup ? 'border-t border-zinc-700/40 font-bold' : ''} ${bg}`}>
                        <td className={`py-1.5 pr-3 sticky left-0 ${stripe ? 'bg-[#01607c]' : 'bg-superficie'} ${r.kind === 'info' ? 'text-zinc-500 text-xs' : isGroup ? 'text-texto-principal uppercase text-xs tracking-wide pt-3' : r.kind === 'concept' ? 'text-zinc-300 pl-6' : 'text-zinc-200'}`}>
                          {isGroup ? (
                            <button onClick={() => toggle(r.key!)} className="inline-flex items-center gap-1.5 hover:text-primario" aria-expanded={open}>
                              <span className={`inline-block text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>{r.label}
                            </button>
                          ) : r.label}
                        </td>
                        {shown.map(k => { const v = r.values[k] ?? 0; return <td key={k} className={`text-right tabular-nums py-1.5 px-1.5 ${v < 0 ? 'text-alerta/90' : r.kind === 'info' || r.kind === 'concept' ? 'text-zinc-300' : 'text-texto-principal'}`}>{v === 0 ? '—' : money(v)}</td> })}
                        <td className={`text-right tabular-nums py-1.5 pl-2 ${tot < 0 ? 'text-alerta' : r.kind === 'concept' ? 'text-zinc-300' : 'text-texto-principal'}`}>{money(tot)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-zinc-500 text-xs">
            {tab === 'formato'
              ? 'Ingresos por mes de la venta; egresos por el mes al que corresponden, incluidas las compras de productos. Toca un título para contraerlo. Para mover un gasto a Inversión, edítalo en Egresos y cambia su centro de costo.'
              : tab === 'resultados'
              ? 'Ingresos por mes de la venta; gastos por el mes al que corresponden. El costo de lo vendido usa el costo capturado en cada producto, por eso las compras de inventario no se restan otra vez.'
              : 'Entradas por forma de pago el día de la venta; salidas el día en que se pagó cada egreso (de la caja, banco u otro).'}
          </p>
        </>
      )}
    </Page>
  )
}
