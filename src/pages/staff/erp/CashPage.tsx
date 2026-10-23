import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, money, toCents, fmtDate, fmtDateTime, METHOD_LABELS, SOURCE_LABELS } from '../../../lib/erp'
import { Page, Card, Stat, Empty, Msg, Spinner, Badge, input, label, btnPrimary, btnGhost, btnSmall, MoneyField } from '../../../components/erp/ui'

interface Summary { by_method: Record<string, number>; sales_total: number; sales_count: number; withdrawals: number; expenses: number; deposits: number; expected_cash: number }
interface Movement { id: string; kind: string; amount_cents: number; note: string; created_at: string }
interface SaleRow { id: string; folio: number; created_at: string; status: string; total_cents: number; person_name: string | null; source: string; items: string | null; methods: string | null }
interface OpenSession { id: string; business_date: string; opened_at: string; opening_cash_cents: number; opened_by_name: string | null; note: string | null; summary: Summary; movements: Movement[]; sales: SaleRow[] }
interface ClosedSession { id: string; business_date: string; opened_at: string; closed_at: string; opening_cash_cents: number; expected_cash_cents: number; counted_cash_cents: number; difference_cents: number; note: string | null; summary: Summary }
interface Status { require_open_cash: boolean; today: string; open: OpenSession | null; history: ClosedSession[] }

const MOV_LABELS: Record<string, string> = { withdrawal: 'Retiro de efectivo', expense: 'Gasto pagado con caja', deposit: 'Ingreso de efectivo (cambio)' }

export default function CashPage() {
  const [s, setS] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await call<Status>('get_cash_status')
    if (error || !data) { setError('No se pudo cargar la caja.'); return }
    setS(data)
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Caja"><p className="text-alerta text-sm">{error}</p></Page>
  if (!s) return <Page title="Caja"><Spinner /></Page>

  return (
    <Page title="Caja" subtitle={s.open ? `Abierta desde ${fmtDateTime(s.open.opened_at)}${s.open.opened_by_name ? ` por ${s.open.opened_by_name}` : ''}` : 'Ábrela al empezar el día y ciérrala al terminar.'}
      actions={<Link to="/staff/vender" className={btnGhost}>Ir a vender</Link>}>
      {s.open ? <OpenCash session={s.open} onChanged={load} /> : <OpenForm onOpened={load} />}
      <Card title="Cortes anteriores">
        {s.history.length === 0 ? <Empty>Todavía no hay cortes.</Empty> : (
          <div className="divide-y divide-zinc-800/80">
            {s.history.map(h => (
              <div key={h.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="text-texto-principal font-semibold">{fmtDate(h.business_date)}</p>
                  <p className="text-zinc-500 text-xs">Ventas {money(h.summary.sales_total)} ({h.summary.sales_count}) · efectivo esperado {money(h.expected_cash_cents)} · contado {money(h.counted_cash_cents)}{h.note && ` · ${h.note}`}</p>
                </div>
                <Badge cls={h.difference_cents === 0 ? 'text-exito bg-exito/10' : 'text-white bg-alerta'}>
                  {h.difference_cents === 0 ? 'Cuadró' : `${h.difference_cents > 0 ? 'Sobró' : 'Faltó'} ${money(Math.abs(h.difference_cents))}`}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  )
}

function OpenForm({ onOpened }: { onOpened: () => void }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = async () => {
    setBusy(true); setError(null)
    const { error } = await call('open_cash', { p_opening_cents: toCents(amount), p_note: null })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onOpened()
  }
  return (
    <Card title="Abrir caja" tone="accent">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48"><MoneyField id="open-cash" label="Efectivo con el que empiezas" value={amount} onChange={setAmount} placeholder="0" /></div>
        <button onClick={open} disabled={busy} className={btnPrimary}>{busy ? 'Abriendo…' : 'Abrir caja'}</button>
      </div>
      <p className="text-zinc-500 text-xs mt-2">Cuenta el fondo de cambio que dejas en la caja antes de empezar a vender.</p>
      <Msg text={error} />
    </Card>
  )
}

function OpenCash({ session, onChanged }: { session: OpenSession; onChanged: () => void }) {
  const sm = session.summary
  const [movKind, setMovKind] = useState('expense')
  const [movAmount, setMovAmount] = useState('')
  const [movNote, setMovNote] = useState('')
  const [counted, setCounted] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const diff = counted === '' ? null : toCents(counted) - sm.expected_cash

  const addMov = async () => {
    setBusy(true); setMsg(null)
    const { error } = await call('add_cash_movement', { p_kind: movKind, p_amount_cents: toCents(movAmount), p_note: movNote })
    setBusy(false)
    if (error) { setMsg(erpError(error)); return }
    setMovAmount(''); setMovNote(''); onChanged()
  }
  const close = async () => {
    setBusy(true); setMsg(null)
    const { error } = await call('close_cash', { p_counted_cents: toCents(counted), p_note: closeNote || null })
    setBusy(false)
    if (error) { setMsg(erpError(error)); return }
    onChanged()
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Ventas del día" value={money(sm.sales_total)} sub={`${sm.sales_count} ventas`} tone="accent" />
        <Stat label="Efectivo esperado en caja" value={money(sm.expected_cash)} sub={`Fondo ${money(session.opening_cash_cents)}`} tone="success" />
        <Stat label="Tarjeta" value={money(sm.by_method.card ?? 0)} sub="terminal" />
        <Stat label="Transferencias" value={money(sm.by_method.transfer ?? 0)} sub={sm.by_method.other ? `Otros ${money(sm.by_method.other)}` : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Movimientos de efectivo">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-2 mb-2">
            <select value={movKind} onChange={e => setMovKind(e.target.value)} className={input}>
              {Object.entries(MOV_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="number" min={0} value={movAmount} onChange={e => setMovAmount(e.target.value)} placeholder="$" className={input} />
          </div>
          <div className="flex gap-2 mb-3">
            <input value={movNote} onChange={e => setMovNote(e.target.value)} placeholder="Motivo (ej. compra de garrafones)" className={input} />
            <button onClick={addMov} disabled={busy} className={btnSmall}>Registrar</button>
          </div>
          {movKind === 'expense' && <p className="text-zinc-500 text-xs mb-3">El gasto también queda en Egresos (como gasto variable; un admin lo puede reclasificar).</p>}
          {session.movements.length === 0 ? <Empty>Sin retiros ni gastos.</Empty> : (
            <div className="divide-y divide-zinc-800/80">
              {session.movements.map(m => (
                <div key={m.id} className="py-1.5 flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{MOV_LABELS[m.kind]} · {m.note}</span>
                  <span className={`font-bold tabular-nums ${m.kind === 'deposit' ? 'text-exito' : 'text-alerta'}`}>{m.kind === 'deposit' ? '+' : '−'}{money(m.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Cerrar caja (corte del día)" tone="accent">
          <p className="text-zinc-400 text-sm mb-3">Cuenta el efectivo que hay en la caja y escríbelo. Te decimos si cuadra.</p>
          <div className="w-56"><MoneyField id="counted" label="Efectivo contado" value={counted} onChange={setCounted} /></div>
          {diff !== null && (
            <p className={`text-sm font-bold mt-2 ${diff === 0 ? 'text-exito' : 'text-alerta'}`}>
              {diff === 0 ? 'Cuadra exacto.' : `${diff > 0 ? 'Sobran' : 'Faltan'} ${money(Math.abs(diff))} (esperado ${money(sm.expected_cash)}).`}
            </p>
          )}
          {diff !== null && diff !== 0 && (
            <div className="mt-2">
              <label className={label}>Explica la diferencia</label>
              <input value={closeNote} onChange={e => setCloseNote(e.target.value)} className={input} placeholder="Ej. di mal un cambio" />
            </div>
          )}
          <button onClick={close} disabled={busy || counted === ''} className={`${btnPrimary} mt-3`}>{busy ? 'Cerrando…' : 'Cerrar caja'}</button>
        </Card>
      </div>
      <Msg text={msg} />

      <Card title={`Ventas de esta caja (${session.sales.length})`}>
        {session.sales.length === 0 ? <Empty>Sin ventas todavía.</Empty> : (
          <div className="divide-y divide-zinc-800/80">
            {session.sales.map(v => (
              <div key={v.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className={v.status === 'voided' ? 'text-zinc-500 line-through' : 'text-texto-principal font-semibold'}>{v.items}</p>
                  <p className="text-zinc-500 text-xs">#{v.folio} · {fmtDateTime(v.created_at)} · {v.person_name ?? 'Sin persona'} · {SOURCE_LABELS[v.source] ?? v.source} · {(v.methods ?? '').split(', ').map(m => METHOD_LABELS[m] ?? m).join(', ')}</p>
                </div>
                <span className="text-texto-principal font-bold tabular-nums">{money(v.total_cents)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
