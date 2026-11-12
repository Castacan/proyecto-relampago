import { useEffect, useState } from 'react'
import { call, money, METHOD_LABELS, PAID_FROM, csvDownload } from '../../../lib/erp'
import { Page, Card, Stat, Spinner, input, label, btnGhost } from '../../../components/erp/ui'

// Estado de resultados y flujo de efectivo por mes (admin). Es para tu control;
// los estados contables formales (balance general, declaraciones) los hace la contadora.

type Cell = { group?: string; month: number; cents: number }
interface Data {
  year: number; income: Cell[]; discounts: Cell[]; cogs: Cell[]; expenses: Cell[]; inventory_purchases: Cell[]; cash_in: Cell[]; cash_out: Cell[]
  position: { inventory_cost_cents: number; payables_cents: number; cash_in_register_cents: number | null; active_members: number; active_subscriptions: number; mrr_cents: number }
}
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
type Row = { label: string; values: number[]; kind?: 'total' | 'sub' | 'neg' | 'info' | 'group' | 'concept' }

// Formato de Inge (erp_estado_resultados.sql): grupo con su total y los conceptos debajo.
type DCell = { group: string; concept: string; month: number; cents: number }
interface Detail { year: number; cost_centers: string[] | null; income: DCell[]; discounts: Cell[]; expenses: DCell[] }
const INCOME_ORDER = ['Servicio', 'Plan', 'Producto', 'Otros']
const EXPENSE_ORDER = ['Gastos fijos', 'Gastos variables', 'Inversión', 'Compra de productos', 'Impuestos']

function detailRows(cells: DCell[], order: string[]): Row[] {
  const gs = [...new Set(cells.map(c => c.group))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  const out: Row[] = []
  for (const g of gs) {
    const gc = cells.filter(c => c.group === g)
    out.push({ label: g, values: byMonth(gc), kind: 'group' })
    const concepts = [...new Set(gc.map(c => c.concept))]
      .map(c => ({ label: c, values: byMonth(gc.filter(x => x.concept === c)), kind: 'concept' as const }))
      .sort((a, b) => sum(b.values) - sum(a.values))
    out.push(...concepts)
  }
  return out
}

const byMonth = (cells: Cell[], group?: string) => MONTHS.map((_, i) => cells.filter(c => c.month === i + 1 && (group === undefined || c.group === group)).reduce((a, c) => a + Number(c.cents), 0))
const groups = (cells: Cell[]) => [...new Set(cells.map(c => c.group ?? ''))].sort((a, b) => byMonth(cells, b).reduce((x, y) => x + y, 0) - byMonth(cells, a).reduce((x, y) => x + y, 0))
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

export default function StatementsPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [d, setD] = useState<Data | null>(null)
  const [det, setDet] = useState<Detail | null>(null)
  const [detError, setDetError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'formato' | 'resultados' | 'flujo'>('formato')
  useEffect(() => {
    setD(null); setDet(null); setDetError(false)
    call<Data>('get_financial_statements', { p_year: year }).then(({ data, error }) => {
      if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin puede ver los estados financieros.' : 'No se pudo cargar. ¿Ya se corrió erp_crm.sql?'); return }
      setError(null); setD(data)
    })
    call<Detail>('get_income_statement', { p_year: year }).then(({ data, error }) => {
      if (error || !data) { setDetError(true); return }
      setDet(data)
    })
  }, [year])

  if (error) return <Page title="Estados financieros"><p className="text-alerta text-sm">{error}</p></Page>

  let rows: Row[] = []
  // Meses a mostrar: en tu formato solo los que tienen movimiento; en los otros, los 12.
  let shown = MONTHS.map((_, i) => i)
  if (tab === 'formato' && det) {
    const inc = byMonth(det.income), disc = byMonth(det.discounts), exp = byMonth(det.expenses)
    const net = sub(inc, disc)
    rows = [
      { label: 'Ingresos', values: [], kind: 'sub' }, ...detailRows(det.income, INCOME_ORDER),
      ...(sum(disc) ? [{ label: 'Descuentos', values: disc.map(v => -v), kind: 'neg' as const }] : []),
      { label: 'Total ingresos', values: net, kind: 'total' },
      { label: 'Egresos', values: [], kind: 'sub' }, ...detailRows(det.expenses, [...EXPENSE_ORDER, ...(det.cost_centers ?? [])]),
      { label: 'Total egresos', values: exp, kind: 'total' },
      { label: 'Utilidad neta', values: sub(net, exp), kind: 'total' },
    ]
    shown = shown.filter(i => inc[i] || exp[i])
    if (!shown.length) shown = [new Date().getMonth()]
  } else if (d) {
    if (tab === 'resultados') {
      const incomeRows = groups(d.income).map(g => ({ label: g, values: byMonth(d.income, g) }))
      const income = byMonth(d.income), disc = byMonth(d.discounts), cogs = byMonth(d.cogs)
      const net = sub(income, disc), gross = sub(net, cogs)
      const expRows = groups(d.expenses).map(g => ({ label: g, values: byMonth(d.expenses, g) }))
      const exp = byMonth(d.expenses)
      rows = [
        { label: 'Ingresos', values: [], kind: 'sub' }, ...incomeRows,
        ...(sum(disc) ? [{ label: 'Descuentos generales', values: disc.map(v => -v), kind: 'neg' as const }] : []),
        { label: 'Ingresos netos', values: net, kind: 'total' },
        { label: 'Costo de lo vendido (productos)', values: cogs.map(v => -v), kind: 'neg' },
        { label: 'Utilidad bruta', values: gross, kind: 'total' },
        { label: 'Gastos', values: [], kind: 'sub' }, ...expRows.map(r => ({ ...r, values: r.values.map(v => -v), kind: 'neg' as const })),
        { label: 'Total gastos', values: exp.map(v => -v), kind: 'total' },
        { label: 'Utilidad de operación', values: sub(gross, exp), kind: 'total' },
        ...(sum(byMonth(d.inventory_purchases)) ? [{ label: 'Compras de inventario (ya incluidas vía costo de lo vendido)', values: byMonth(d.inventory_purchases), kind: 'info' as const }] : []),
      ]
    } else {
      const inRows = groups(d.cash_in).map(g => ({ label: METHOD_LABELS[g] ?? g, values: byMonth(d.cash_in, g) }))
      const outRows = groups(d.cash_out).map(g => ({ label: PAID_FROM[g] ?? g, values: byMonth(d.cash_out, g).map(v => -v), kind: 'neg' as const }))
      const cin = byMonth(d.cash_in), cout = byMonth(d.cash_out), net = sub(cin, cout)
      let acc = 0
      rows = [
        { label: 'Entradas (cobros)', values: [], kind: 'sub' }, ...inRows, { label: 'Total entradas', values: cin, kind: 'total' },
        { label: 'Salidas (egresos pagados)', values: [], kind: 'sub' }, ...outRows, { label: 'Total salidas', values: cout.map(v => -v), kind: 'total' },
        { label: 'Flujo neto del mes', values: net, kind: 'total' },
        { label: 'Acumulado del año', values: net.map(v => (acc += v)), kind: 'info' },
      ]
    }
  }

  const exportCsv = () => csvDownload(`${tab === 'flujo' ? 'flujo_efectivo' : 'estado_resultados'}_${year}.csv`, [
    ['Concepto', ...shown.map(i => MONTHS[i]), 'Total'],
    ...rows.map(r => [r.kind === 'group' ? r.label.toUpperCase() : r.label,
      ...(r.values.length ? shown.map(i => (r.values[i] / 100).toFixed(2)) : shown.map(() => '')),
      r.values.length ? (sum(r.values) / 100).toFixed(2) : '']),
  ])
  const ready = tab === 'formato' ? !!det : !!d

  return (
    <Page title="Estados financieros" width="max-w-7xl"
      subtitle="Estado de resultados y flujo de efectivo por mes, con lo que registras en ventas y egresos. Para tu control; lo contable formal lo hace la contadora."
      actions={<button onClick={exportCsv} disabled={!ready} className={btnGhost}>Descargar CSV</button>}>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Año</label><input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`${input} max-w-[8rem]`} /></div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setTab('formato')} className={`px-3 py-2 rounded-xl text-sm font-bold ${tab === 'formato' ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Estado de resultados</button>
          <button onClick={() => setTab('resultados')} className={`px-3 py-2 rounded-xl text-sm font-bold ${tab === 'resultados' ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Con costo de lo vendido</button>
          <button onClick={() => setTab('flujo')} className={`px-3 py-2 rounded-xl text-sm font-bold ${tab === 'flujo' ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300'}`}>Flujo de efectivo</button>
        </div>
      </div>
      {tab === 'formato' && detError ? <p className="text-alerta text-sm">No se pudo cargar. ¿Ya se corrió erp_estado_resultados.sql?</p> : !ready || !d ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Socios con membresía" value={d.position.active_members} />
            <Stat label="Domiciliaciones" value={d.position.active_subscriptions} sub={`${money(d.position.mrr_cents)} al mes`} tone="accent" />
            <Stat label="Inventario a costo" value={money(d.position.inventory_cost_cents)} />
            <Stat label="Por pagar" value={money(d.position.payables_cents)} tone={d.position.payables_cents ? 'alert' : undefined} />
            <Stat label="Efectivo en caja" value={d.position.cash_in_register_cents == null ? 'Cerrada' : money(d.position.cash_in_register_cents)} />
          </div>
          <Card>
            <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
              <table className={`w-full text-sm ${shown.length > 6 ? 'min-w-[980px]' : ''}`}>
                <thead><tr className="text-zinc-500 text-xs">
                  <th className="text-left font-semibold py-1.5 pr-3 sticky left-0 bg-superficie">Concepto</th>
                  {shown.map(i => <th key={i} className="text-right font-semibold py-1.5 px-1.5">{MONTHS[i]}</th>)}
                  <th className="text-right font-semibold py-1.5 pl-2">Total</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => r.kind === 'sub' ? (
                    <tr key={i}><td colSpan={shown.length + 2} className="pt-4 pb-1 text-zinc-400 text-[11px] font-bold uppercase tracking-widest sticky left-0 bg-superficie">{r.label}</td></tr>
                  ) : (
                    <tr key={i} className={r.kind === 'total' ? 'border-t border-zinc-700/60 font-bold' : r.kind === 'group' ? 'border-t border-zinc-700/40 font-bold' : 'border-t border-zinc-800/40'}>
                      <td className={`py-1.5 pr-3 sticky left-0 bg-superficie ${r.kind === 'info' ? 'text-zinc-500 text-xs' : r.kind === 'group' ? 'text-texto-principal uppercase text-xs tracking-wide pt-3' : r.kind === 'concept' ? 'text-zinc-300 pl-4' : 'text-zinc-200'}`}>{r.label}</td>
                      {shown.map(k => { const v = r.values[k]; return <td key={k} className={`text-right tabular-nums py-1.5 px-1.5 ${v < 0 ? 'text-alerta/90' : r.kind === 'info' || r.kind === 'concept' ? 'text-zinc-400' : 'text-texto-principal'}`}>{v === 0 ? '—' : money(v)}</td> })}
                      <td className={`text-right tabular-nums py-1.5 pl-2 ${sum(r.values) < 0 ? 'text-alerta' : r.kind === 'concept' ? 'text-zinc-400' : 'text-texto-principal'}`}>{money(sum(r.values))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-zinc-500 text-xs">
            {tab === 'formato'
              ? 'Ingresos por mes de la venta; egresos por el mes al que corresponden, incluidas las compras de productos. Para mover un gasto a Inversión, edítalo en Egresos y cambia su centro de costo.'
              : tab === 'resultados'
              ? 'Ingresos por mes de la venta; gastos por el mes al que corresponden. El costo de lo vendido usa el costo capturado en cada producto, por eso las compras de inventario no se restan otra vez.'
              : 'Entradas por forma de pago el día de la venta; salidas el día en que se pagó cada egreso (de la caja, banco u otro).'}
          </p>
        </>
      )}
    </Page>
  )
}
