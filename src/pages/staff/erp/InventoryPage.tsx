import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, money, toCents, fmtDateTime, csvDownload, EXPENSE_METHODS, PAID_FROM, STOCK_KINDS } from '../../../lib/erp'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, MoneyField } from '../../../components/erp/ui'

// Inventario de productos (agua, barras, magnesia…). Se descuenta solo al
// vender y regresa si se anula la venta. Aquí se registran entradas (compras),
// conteos físicos y salidas sin venta (consumo / merma).

interface Item {
  id: string; name: string; sku: string | null; price_cents: number; track_stock: boolean; stock: number | null
  stock_min: number | null; allow_negative_stock: boolean; is_active: boolean; cost_cents: number | null
  sold_30d: number; last_movement_at: string | null
}
interface Inv { is_admin: boolean; products: Item[]; value_cents: number | null }
interface Movement {
  id: string; kind: string; quantity: number; stock_after: number; note: string | null; created_at: string
  unit_cost_cents: number | null; by: string | null; sale_folio: number | null; expense_folio: number | null
}

export default function InventoryPage() {
  const [inv, setInv] = useState<Inv | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; mode: 'entry' | 'count' | 'out' | 'history' } | null>(null)
  const [onlyLow, setOnlyLow] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await call<Inv>('get_inventory')
    if (error || !data) { setError('No se pudo cargar el inventario. ¿Ya se corrió erp_finanzas.sql?'); return }
    setInv(data)
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Inventario"><p className="text-alerta text-sm">{error}</p></Page>
  if (!inv) return <Page title="Inventario"><Spinner /></Page>

  const tracked = inv.products.filter(p => p.track_stock && p.is_active)
  const isLow = (p: Item) => p.track_stock && (p.stock ?? 0) <= (p.stock_min ?? 0)
  const low = tracked.filter(isLow)
  const list = inv.products.filter(p => !onlyLow || isLow(p))

  const exportCsv = () => csvDownload('inventario.csv', [
    ['Producto', 'Clave', 'Existencia', 'Mínimo', 'Precio', ...(inv.is_admin ? ['Costo', 'Valor a costo'] : []), 'Vendidos 30 días'],
    ...inv.products.filter(p => p.track_stock).map(p => [p.name, p.sku ?? '', p.stock ?? 0, p.stock_min ?? '', (p.price_cents / 100).toFixed(2),
      ...(inv.is_admin ? [p.cost_cents != null ? (p.cost_cents / 100).toFixed(2) : '', p.cost_cents != null ? ((Math.max(0, p.stock ?? 0) * p.cost_cents) / 100).toFixed(2) : ''] : []),
      p.sold_30d]),
  ])

  return (
    <Page title="Inventario" subtitle="Se descuenta solo al vender. Registra aquí lo que llega, los conteos y lo que sale sin venderse."
      actions={<>
        <button onClick={exportCsv} className={btnGhost}>Descargar CSV</button>
        {inv.is_admin && <Link to="/staff/config/productos" className={btnGhost}>Productos y precios</Link>}
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Productos con inventario" value={tracked.length} />
        <Stat label="Piezas en existencia" value={tracked.reduce((a, p) => a + Math.max(0, p.stock ?? 0), 0)} />
        <Stat label="Por surtir" value={low.length} sub="en o bajo el mínimo" tone={low.length ? 'alert' : undefined} />
        {inv.value_cents != null && <Stat label="Valor a costo" value={money(inv.value_cents)} tone="accent" />}
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} className="accent-primario w-4 h-4" />
        Solo lo que hay que surtir
      </label>

      {list.length === 0 ? (
        <Empty>{inv.products.length === 0 ? 'No hay productos todavía. Créalos en Configuración → Productos y planes (tipo "Producto", con "Llevar inventario").' : 'Nada por surtir.'}</Empty>
      ) : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
          {list.map(p => {
            const margin = p.cost_cents != null && p.price_cents > 0 ? Math.round((p.price_cents - p.cost_cents) * 100 / p.price_cents) : null
            return (
              <div key={p.id}>
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${p.is_active ? 'text-texto-principal' : 'text-zinc-500'}`}>
                      {p.name}{p.sku && <span className="text-zinc-500 font-normal"> · {p.sku}</span>}
                      {!p.is_active && <span className="ml-2"><Badge>Inactivo</Badge></span>}
                    </p>
                    <p className="text-zinc-500 text-xs">
                      Precio {money(p.price_cents)}
                      {p.cost_cents != null && ` · costo ${money(p.cost_cents)}${margin != null ? ` (${margin}% margen)` : ''}`}
                      {p.track_stock && ` · ${p.sold_30d} vendidos en 30 días`}
                      {p.track_stock && p.stock_min != null && ` · mínimo ${p.stock_min}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.track_stock ? (
                      <span className={`text-lg font-black tabular-nums mr-1 ${isLow(p) ? 'text-alerta' : 'text-texto-principal'}`}>{p.stock ?? 0}<span className="text-zinc-500 text-xs font-semibold"> pzas</span></span>
                    ) : <Badge>Sin inventario</Badge>}
                    {p.track_stock && (
                      <>
                        <button onClick={() => setOpen(open?.id === p.id && open.mode === 'entry' ? null : { id: p.id, mode: 'entry' })} className={btnSmall}>+ Entrada</button>
                        <button onClick={() => setOpen(open?.id === p.id && open.mode === 'count' ? null : { id: p.id, mode: 'count' })} className={btnSmall}>Contar</button>
                        <button onClick={() => setOpen(open?.id === p.id && open.mode === 'out' ? null : { id: p.id, mode: 'out' })} className={btnSmall}>Salida</button>
                        <button onClick={() => setOpen(open?.id === p.id && open.mode === 'history' ? null : { id: p.id, mode: 'history' })} className={btnSmall}>Movimientos</button>
                      </>
                    )}
                  </div>
                </div>
                {open?.id === p.id && (
                  <div className="px-4 pb-4">
                    {open.mode === 'entry' && <EntryForm p={p} isAdmin={inv.is_admin} onDone={() => { setOpen(null); load() }} />}
                    {open.mode === 'count' && <CountForm p={p} onDone={() => { setOpen(null); load() }} />}
                    {open.mode === 'out' && <OutForm p={p} onDone={() => { setOpen(null); load() }} />}
                    {open.mode === 'history' && <History p={p} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function EntryForm({ p, isAdmin, onDone }: { p: Item; isAdmin: boolean; onDone: () => void }) {
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(p.cost_cents != null ? String(p.cost_cents / 100) : '')
  const [note, setNote] = useState('')
  const [withExpense, setWithExpense] = useState(isAdmin)
  const [exp, setExp] = useState({ payee_name: '', paid: true, method: 'card', paid_from: 'bank' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = (Number(qty) || 0) * toCents(cost)

  const save = async () => {
    setBusy(true); setError(null)
    const { error } = await call('stock_entry', { p: {
      product_id: p.id, quantity: Number(qty), unit_cost_cents: cost === '' ? null : toCents(cost), note,
      expense: isAdmin && withExpense ? exp : null,
    } })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className={label}>Piezas que llegaron</label><input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} className={input} autoFocus /></div>
        <MoneyField id={`entry-cost-${p.id}`} label="Costo por pieza (opcional)" value={cost} onChange={setCost} />
        <div><label className={label}>Nota (opcional)</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. Costco" className={input} /></div>
      </div>
      {isAdmin && (
        <div className="mt-3 rounded-xl bg-fondo/60 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={withExpense} onChange={e => setWithExpense(e.target.checked)} className="accent-primario w-4 h-4" />
            Registrar también el egreso de la compra {total > 0 && <span className="text-texto-principal font-bold">({money(total)})</span>}
          </label>
          {withExpense && (
            <div className="grid sm:grid-cols-4 gap-2">
              <div><label className={label}>Proveedor</label><input value={exp.payee_name} onChange={e => setExp({ ...exp, payee_name: e.target.value })} placeholder="Ej. Costco" className={input} /></div>
              <label className="flex items-center gap-2 text-sm text-zinc-200 sm:pt-5">
                <input type="checkbox" checked={exp.paid} onChange={e => setExp({ ...exp, paid: e.target.checked })} className="accent-primario w-4 h-4" />
                Ya se pagó
              </label>
              {exp.paid && <>
                <div><label className={label}>Forma</label>
                  <select value={exp.method} onChange={e => setExp({ ...exp, method: e.target.value, paid_from: e.target.value === 'cash' ? exp.paid_from : 'bank' })} className={input}>
                    {Object.entries(EXPENSE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className={label}>Salió de</label>
                  <select value={exp.paid_from} onChange={e => setExp({ ...exp, paid_from: e.target.value })} className={input}>
                    {Object.entries(PAID_FROM).filter(([k]) => k !== 'cash_register' || exp.method === 'cash').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
              </>}
            </div>
          )}
        </div>
      )}
      <Msg text={error} />
      <button onClick={save} disabled={busy || !qty} className={`${btnPrimary} mt-3`}>{busy ? 'Guardando…' : `Registrar entrada${qty ? ` (+${qty})` : ''}`}</button>
    </Card>
  )
}

function CountForm({ p, onDone }: { p: Item; onDone: () => void }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const diff = counted === '' ? null : Number(counted) - (p.stock ?? 0)
  const save = async () => {
    const { error } = await call('stock_count', { p_product_id: p.id, p_counted: Number(counted), p_note: note })
    if (error) { setError(erpError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <p className="text-zinc-400 text-sm mb-2">Cuenta lo que hay físicamente. El sistema dice {p.stock ?? 0}.</p>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div><label className={label}>Piezas contadas</label><input type="number" min={0} value={counted} onChange={e => setCounted(e.target.value)} className={input} autoFocus /></div>
        {diff !== null && diff !== 0 && <div className="sm:col-span-2"><label className={label}>¿Por qué no cuadra? ({diff > 0 ? `+${diff}` : diff})</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. se regalaron, conteo anterior mal" className={input} /></div>}
      </div>
      {diff === 0 && <p className="text-exito text-sm font-bold mt-2">Cuadra exacto.</p>}
      <Msg text={error} />
      <button onClick={save} disabled={counted === ''} className={`${btnPrimary} mt-3`}>Guardar conteo</button>
    </Card>
  )
}

function OutForm({ p, onDone }: { p: Item; onDone: () => void }) {
  const [qty, setQty] = useState('')
  const [kind, setKind] = useState('consumption')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('stock_out', { p_product_id: p.id, p_quantity: Number(qty), p_kind: kind, p_note: note })
    if (error) { setError(erpError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className={label}>Piezas</label><input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} className={input} autoFocus /></div>
        <div><label className={label}>Tipo</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className={input}>
            <option value="consumption">Consumo (staff, cortesía, uso interno)</option>
            <option value="adjust">Merma (caducó, se rompió, se perdió)</option>
          </select></div>
        <div><label className={label}>Motivo</label><input value={note} onChange={e => setNote(e.target.value)} className={input} /></div>
      </div>
      <Msg text={error} />
      <button onClick={save} disabled={!qty} className={`${btnPrimary} mt-3`}>Registrar salida</button>
    </Card>
  )
}

function History({ p }: { p: Item }) {
  const [rows, setRows] = useState<Movement[] | null>(null)
  useEffect(() => { call<{ movements: Movement[] }>('get_stock_movements', { p_product_id: p.id }).then(({ data }) => setRows(data?.movements ?? [])) }, [p.id])
  if (!rows) return <Spinner />
  if (rows.length === 0) return <Empty>Sin movimientos.</Empty>
  return (
    <div className="rounded-xl bg-fondo/60 divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
      {rows.map(m => (
        <div key={m.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="text-zinc-200">{STOCK_KINDS[m.kind] ?? m.kind}
              {m.sale_folio && <span className="text-zinc-500"> · venta #{m.sale_folio}</span>}
              {m.expense_folio && <span className="text-zinc-500"> · egreso #{m.expense_folio}</span>}
              {m.note && <span className="text-zinc-500"> · {m.note}</span>}
            </p>
            <p className="text-zinc-500 text-xs">{fmtDateTime(m.created_at)}{m.by && ` · ${m.by}`}{m.unit_cost_cents != null && ` · costo ${money(m.unit_cost_cents)}`}</p>
          </div>
          <span className="text-right shrink-0">
            <span className={`font-bold tabular-nums ${m.quantity > 0 ? 'text-exito' : 'text-alerta'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
            <span className="text-zinc-500 text-xs block">quedan {m.stock_after}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
