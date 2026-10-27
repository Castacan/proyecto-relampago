import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, money, toCents, fmtDate, fmtDateTime, todayMx, csvDownload, EXPENSE_METHODS, PAID_FROM, STOCK_KINDS } from '../../../lib/erp'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, MoneyField } from '../../../components/erp/ui'

// Inventario de productos (agua, barras, magnesia…). Se descuenta solo al
// vender y regresa si se anula la venta. Aquí se crean productos, se registran
// pedidos que llegan (varios productos a la vez), conteos físicos y salidas sin
// venta (consumo / merma), y se ven todos los movimientos. Tomado de EVO:
// fecha del movimiento, producto solo para consumo y reajuste de precios en bloque.

interface Item {
  id: string; name: string; sku: string | null; price_cents: number; track_stock: boolean; stock: number | null
  stock_min: number | null; allow_negative_stock: boolean; is_active: boolean; cost_cents: number | null
  category: string | null; for_sale: boolean; sold_30d: number; last_movement_at: string | null
}
interface Inv { is_admin: boolean; products: Item[]; value_cents: number | null; categories: string[] }
interface Movement {
  id: string; kind: string; quantity: number; stock_after: number; note: string | null; created_at: string; occurred_on?: string
  unit_cost_cents: number | null; by: string | null; sale_folio: number | null; expense_folio: number | null; product?: string; category?: string | null
}

const INV_ERRORS: Record<string, string> = {
  reason_required: 'Escribe el motivo.', invalid_date: 'La fecha no puede ser futura ni de hace más de un año.',
  items_required: 'Agrega al menos un producto.', cost_required: 'Para registrar el egreso pon el costo de cada pieza.',
  out_of_stock: 'No hay tantas piezas en existencia.', name_taken: 'Ya existe un producto con ese nombre.',
}
const invError = (e: string | null | undefined) => (e && INV_ERRORS[e]) || erpError(e ?? undefined)
const field = input.replace('w-full ', '')

export default function InventoryPage() {
  const [inv, setInv] = useState<Inv | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'stock' | 'moves'>('stock')
  const [panel, setPanel] = useState<'new' | 'entry' | 'reprice' | null>(null)
  const [entryFor, setEntryFor] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; mode: 'count' | 'out' | 'history' | 'edit' } | null>(null)
  const [onlyLow, setOnlyLow] = useState(false)
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await call<Inv>('get_inventory')
    if (error || !data) { setError('No se pudo cargar el inventario. ¿Ya se corrió erp_inventario.sql?'); return }
    setInv({ ...data, categories: data.categories ?? [] })
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Inventario"><p className="text-alerta text-sm">{error}</p></Page>
  if (!inv) return <Page title="Inventario"><Spinner /></Page>

  const tracked = inv.products.filter(p => p.track_stock && p.is_active)
  const isLow = (p: Item) => p.track_stock && (p.stock ?? 0) <= (p.stock_min ?? 0)
  const low = tracked.filter(isLow)
  const ql = q.trim().toLowerCase()
  const list = inv.products.filter(p => (!onlyLow || isLow(p)) && (!cat || (p.category ?? '') === cat)
    && (!ql || p.name.toLowerCase().includes(ql) || (p.sku ?? '').toLowerCase().includes(ql)))
  const groups = new Map<string, Item[]>()
  for (const p of list) { const k = p.category ?? 'Sin categoría'; groups.set(k, [...(groups.get(k) ?? []), p]) }
  const done = () => { setPanel(null); setEntryFor(null); setOpen(null); load() }
  const togglePanel = (p: typeof panel) => { setPanel(panel === p ? null : p); setEntryFor(null) }

  const exportCsv = () => csvDownload('inventario.csv', [
    ['Producto', 'Categoría', 'Clave', 'Existencia', 'Mínimo', 'Precio', ...(inv.is_admin ? ['Costo', 'Valor a costo'] : []), 'Vendidos 30 días', 'Para venta'],
    ...inv.products.filter(p => p.track_stock).map(p => [p.name, p.category ?? '', p.sku ?? '', p.stock ?? 0, p.stock_min ?? '', (p.price_cents / 100).toFixed(2),
      ...(inv.is_admin ? [p.cost_cents != null ? (p.cost_cents / 100).toFixed(2) : '', p.cost_cents != null ? ((Math.max(0, p.stock ?? 0) * p.cost_cents) / 100).toFixed(2) : ''] : []),
      p.sold_30d, p.for_sale ? 'Sí' : 'Solo consumo']),
  ])

  return (
    <Page title="Inventario" subtitle="Se descuenta solo al vender. Registra aquí lo que llega, los conteos y lo que sale sin venderse." width="max-w-6xl"
      actions={<>
        <button onClick={() => togglePanel('entry')} className={btnPrimary}>{panel === 'entry' && !entryFor ? 'Cerrar' : '+ Entrada de pedido'}</button>
        {inv.is_admin && <button onClick={() => togglePanel('new')} className={btnGhost}>{panel === 'new' ? 'Cerrar' : '+ Producto'}</button>}
        {inv.is_admin && <button onClick={() => togglePanel('reprice')} className={btnGhost}>{panel === 'reprice' ? 'Cerrar' : 'Reajustar precios'}</button>}
        <button onClick={exportCsv} className={btnGhost}>CSV</button>
      </>}>
      {panel === 'new' && <NewProduct categories={inv.categories} onDone={done} />}
      {panel === 'entry' && <EntryForm products={tracked} isAdmin={inv.is_admin} initialId={entryFor} onDone={done} />}
      {panel === 'reprice' && <Reprice products={inv.products.filter(p => p.is_active)} onDone={done} />}

      <div className="flex gap-1">
        <button onClick={() => setTab('stock')} className={tab === 'stock' ? btnPrimary : btnGhost}>Existencias</button>
        <button onClick={() => setTab('moves')} className={tab === 'moves' ? btnPrimary : btnGhost}>Movimientos</button>
      </div>

      {tab === 'moves' ? <MovementsReport products={inv.products.filter(p => p.track_stock)} isAdmin={inv.is_admin} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Productos con inventario" value={tracked.length} />
            <Stat label="Piezas en existencia" value={tracked.reduce((a, p) => a + Math.max(0, p.stock ?? 0), 0)} />
            <Stat label="Por surtir" value={low.length} sub="en o bajo el mínimo" tone={low.length ? 'alert' : undefined} />
            {inv.value_cents != null && <Stat label="Valor a costo" value={money(inv.value_cents)} tone="accent" />}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto o clave" className={`${field} flex-1 min-w-[12rem]`} />
            {inv.categories.length > 0 && (
              <select value={cat} onChange={e => setCat(e.target.value)} className={field} aria-label="Categoría">
                <option value="">Todas las categorías</option>
                {inv.categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} className="accent-primario w-4 h-4" />
              Solo lo que hay que surtir
            </label>
          </div>

          {list.length === 0 ? (
            <Empty>{inv.products.length === 0 ? 'No hay productos todavía. Créalos con "+ Producto".' : 'Nada con ese filtro.'}</Empty>
          ) : [...groups.entries()].map(([g, items]) => (
            <div key={g} className="space-y-1">
              {groups.size > 1 && <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest px-1">{g}</p>}
              <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
                {items.map(p => {
                  const margin = p.cost_cents != null && p.price_cents > 0 ? Math.round((p.price_cents - p.cost_cents) * 100 / p.price_cents) : null
                  const toggle = (mode: 'count' | 'out' | 'history' | 'edit') => setOpen(open?.id === p.id && open.mode === mode ? null : { id: p.id, mode })
                  return (
                    <div key={p.id}>
                      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-sm font-bold ${p.is_active ? 'text-texto-principal' : 'text-zinc-500'}`}>
                            {p.name}{p.sku && <span className="text-zinc-500 font-normal"> · {p.sku}</span>}
                            {!p.is_active && <span className="ml-2"><Badge>Inactivo</Badge></span>}
                            {!p.for_sale && <span className="ml-2"><Badge>Solo consumo</Badge></span>}
                          </p>
                          <p className="text-zinc-500 text-xs">
                            {p.for_sale && `Precio ${money(p.price_cents)}`}
                            {p.cost_cents != null && `${p.for_sale ? ' · ' : ''}costo ${money(p.cost_cents)}${p.for_sale && margin != null ? ` (${margin}% margen)` : ''}`}
                            {p.track_stock && p.for_sale && ` · ${p.sold_30d} vendidos en 30 días`}
                            {p.track_stock && p.stock_min != null && ` · mínimo ${p.stock_min}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {p.track_stock ? (
                            <span className={`text-lg font-black tabular-nums mr-1 ${isLow(p) ? 'text-alerta' : 'text-texto-principal'}`}>{p.stock ?? 0}<span className="text-zinc-500 text-xs font-semibold"> pzas</span></span>
                          ) : <Badge>Sin inventario</Badge>}
                          {p.track_stock && (
                            <>
                              <button onClick={() => { setOpen(null); setEntryFor(p.id); setPanel('entry'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className={btnSmall}>+ Entrada</button>
                              <button onClick={() => toggle('out')} className={btnSmall}>Salida</button>
                              <button onClick={() => toggle('count')} className={btnSmall}>Contar</button>
                              <button onClick={() => toggle('history')} className={btnSmall}>Movimientos</button>
                            </>
                          )}
                          {inv.is_admin && <button onClick={() => toggle('edit')} className={btnSmall}>Editar</button>}
                        </div>
                      </div>
                      {open?.id === p.id && (
                        <div className="px-4 pb-4">
                          {open.mode === 'count' && <CountForm p={p} onDone={done} />}
                          {open.mode === 'out' && <OutForm p={p} onDone={done} />}
                          {open.mode === 'history' && <History p={p} />}
                          {open.mode === 'edit' && <QuickEdit p={p} categories={inv.categories} onDone={done} />}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </Page>
  )
}

function CategoryInput({ id, value, onChange, categories }: { id: string; value: string; onChange: (v: string) => void; categories: string[] }) {
  return (
    <>
      <input id={id} list={`${id}-list`} value={value} onChange={e => onChange(e.target.value)} placeholder="Bebidas, snacks, limpieza…" className={input} />
      <datalist id={`${id}-list`}>{categories.map(c => <option key={c} value={c} />)}</datalist>
    </>
  )
}

function NewProduct({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [f, setF] = useState({ name: '', category: '', price: '', cost: '', stock: '', stock_min: '', sku: '', for_sale: true, allow_negative_stock: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }
  const save = async () => {
    setBusy(true)
    const { data, error } = await call<{ id: string }>('admin_save_product', { p_product: {
      kind: 'product', name: f.name, price_cents: f.for_sale ? toCents(f.price) : 0, cost_cents: f.cost === '' ? '' : toCents(f.cost),
      track_stock: true, stock: f.stock, stock_min: f.stock_min, sku: f.sku, allow_negative_stock: f.allow_negative_stock, is_active: true, sort_order: 0,
    } })
    if (error || !data) { setBusy(false); setError(invError(error)); return }
    await call('admin_set_product_extras', { p_product_id: data.id, p_category: f.category, p_for_sale: f.for_sale })
    setBusy(false)
    onDone()
  }
  return (
    <Card title="Producto nuevo" tone="accent">
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2"><label className={label} htmlFor="np-name">Nombre</label><input id="np-name" value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Agua Kirkland 500 ml" className={input} autoFocus /></div>
        <div><label className={label} htmlFor="np-cat">Categoría</label><CategoryInput id="np-cat" value={f.category} onChange={v => set({ category: v })} categories={categories} /></div>
        <div><label className={label} htmlFor="np-sku">Clave / código (opcional)</label><input id="np-sku" value={f.sku} onChange={e => set({ sku: e.target.value })} className={input} /></div>
        {f.for_sale && <MoneyField id="np-price" label="Precio de venta" value={f.price} onChange={v => set({ price: v })} />}
        <MoneyField id="np-cost" label="Costo por pieza" value={f.cost} onChange={v => set({ cost: v })} />
        <div><label className={label} htmlFor="np-stock">Existencia inicial</label><input id="np-stock" type="number" min={0} value={f.stock} onChange={e => set({ stock: e.target.value })} className={input} /></div>
        <div><label className={label} htmlFor="np-min">Mínimo (avisar)</label><input id="np-min" type="number" min={0} value={f.stock_min} onChange={e => set({ stock_min: e.target.value })} className={input} /></div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={!f.for_sale} onChange={e => set({ for_sale: !e.target.checked })} className="accent-primario w-4 h-4" />
          Solo para consumo interno (no sale en Vender)
        </label>
        {f.for_sale && (
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={f.allow_negative_stock} onChange={e => set({ allow_negative_stock: e.target.checked })} className="accent-primario w-4 h-4" />
            Permitir vender sin existencia
          </label>
        )}
      </div>
      <Msg text={error} />
      <button onClick={save} disabled={busy || f.name.trim().length < 2} className={`${btnPrimary} mt-3`}>{busy ? 'Guardando…' : 'Crear producto'}</button>
      <p className="text-zinc-500 text-xs mt-2">Los planes, pases y clases se crean en <Link to="/staff/config/productos" className="underline">Configuración → Productos y planes</Link>.</p>
    </Card>
  )
}

function QuickEdit({ p, categories, onDone }: { p: Item; categories: string[]; onDone: () => void }) {
  const [category, setCategory] = useState(p.category ?? '')
  const [forSale, setForSale] = useState(p.for_sale)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('admin_set_product_extras', { p_product_id: p.id, p_category: category, p_for_sale: forSale })
    if (error) { setError(invError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div><label className={label} htmlFor={`qe-${p.id}`}>Categoría</label><CategoryInput id={`qe-${p.id}`} value={category} onChange={setCategory} categories={categories} /></div>
        <label className="flex items-center gap-2 text-sm text-zinc-200 sm:col-span-2">
          <input type="checkbox" checked={!forSale} onChange={e => setForSale(!e.target.checked)} className="accent-primario w-4 h-4" />
          Solo para consumo interno (no sale en Vender)
        </label>
      </div>
      <Msg text={error} />
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={save} className={btnPrimary}>Guardar</button>
        <Link to="/staff/config/productos" className={btnGhost}>Precio, costo, mínimo y más →</Link>
      </div>
    </Card>
  )
}

interface EntryLine { product_id: string; qty: string; cost: string }

function EntryForm({ products, isAdmin, initialId, onDone }: { products: Item[]; isAdmin: boolean; initialId: string | null; onDone: () => void }) {
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const lineFor = (id: string): EntryLine => ({ product_id: id, qty: '', cost: byId.get(id)?.cost_cents != null ? String((byId.get(id)?.cost_cents ?? 0) / 100) : '' })
  const [lines, setLines] = useState<EntryLine[]>(() => [initialId ? lineFor(initialId) : { product_id: '', qty: '', cost: '' }])
  const [date, setDate] = useState(todayMx())
  const [note, setNote] = useState('')
  const [withExpense, setWithExpense] = useState(isAdmin)
  const [exp, setExp] = useState({ payee_name: '', paid: true, method: 'card', paid_from: 'bank' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (initialId) setLines([lineFor(initialId)]) }, [initialId]) // eslint-disable-line react-hooks/exhaustive-deps

  const valid = lines.filter(l => l.product_id && Number(l.qty) > 0)
  const total = valid.reduce((a, l) => a + Number(l.qty) * toCents(l.cost), 0)
  const setLine = (i: number, x: Partial<EntryLine>) => { setLines(ls => ls.map((l, j) => j === i ? { ...l, ...x } : l)); setError(null) }

  const save = async () => {
    setBusy(true); setError(null)
    const { error } = await call('stock_entry_batch', { p: {
      items: valid.map(l => ({ product_id: l.product_id, quantity: Number(l.qty), unit_cost_cents: l.cost === '' ? null : toCents(l.cost) })),
      note, occurred_on: date, expense: isAdmin && withExpense ? exp : null,
    } })
    setBusy(false)
    if (error) { setError(invError(error)); return }
    onDone()
  }
  return (
    <Card title="Entrada de mercancía" tone="accent">
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem_auto] gap-2 items-end">
            <div>
              {i === 0 && <label className={label}>Producto</label>}
              <select value={l.product_id} onChange={e => setLine(i, lineFor(e.target.value))} className={input} aria-label={`Producto ${i + 1}`}>
                <option value="">Elige…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock ?? 0})</option>)}
              </select>
            </div>
            <div>{i === 0 && <label className={label}>Piezas</label>}<input type="number" min={1} value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} className={input} aria-label={`Piezas ${i + 1}`} /></div>
            <div>{i === 0 && <label className={label}>Costo c/u</label>}<input type="number" min={0} step="0.01" value={l.cost} onChange={e => setLine(i, { cost: e.target.value })} placeholder="$" className={input} aria-label={`Costo ${i + 1}`} /></div>
            <button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} className="text-zinc-500 hover:text-alerta text-xl px-1 pb-2" aria-label="Quitar">×</button>
          </div>
        ))}
        <button onClick={() => setLines(ls => [...ls, { product_id: '', qty: '', cost: '' }])} className={btnSmall}>+ Otro producto</button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 mt-3">
        <div><label className={label} htmlFor="entry-date">Fecha en que llegó</label><input id="entry-date" type="date" value={date} max={todayMx()} onChange={e => setDate(e.target.value)} className={input} /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="entry-note">Nota (opcional)</label><input id="entry-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. pedido de Costco" className={input} /></div>
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
      <button onClick={save} disabled={busy || valid.length === 0} className={`${btnPrimary} mt-3`}>
        {busy ? 'Guardando…' : `Registrar entrada${valid.length ? ` (${valid.length} ${valid.length === 1 ? 'producto' : 'productos'}, ${valid.reduce((a, l) => a + Number(l.qty), 0)} pzas)` : ''}`}
      </button>
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
    if (error) { setError(invError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <p className="text-zinc-400 text-sm mb-2">Cuenta lo que hay físicamente. El sistema dice {p.stock ?? 0}.</p>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div><label className={label}>Piezas contadas</label><input type="number" min={0} value={counted} onChange={e => setCounted(e.target.value)} className={input} autoFocus /></div>
        {diff !== null && diff !== 0 && <div className="sm:col-span-2"><label className={label}>¿Por qué no cuadra? ({diff > 0 ? `+${diff}` : diff})</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. conteo anterior mal" className={input} /></div>}
      </div>
      {diff === 0 && <p className="text-exito text-sm font-bold mt-2">Cuadra exacto.</p>}
      <Msg text={error} />
      <button onClick={save} disabled={counted === ''} className={`${btnPrimary} mt-3`}>Guardar conteo</button>
    </Card>
  )
}

function OutForm({ p, onDone }: { p: Item; onDone: () => void }) {
  const [qty, setQty] = useState('')
  const [kind, setKind] = useState(p.for_sale ? 'waste' : 'consumption')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayMx())
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('stock_out_v2', { p: { product_id: p.id, quantity: Number(qty), kind, note, occurred_on: date } })
    if (error) { setError(invError(error)); return }
    onDone()
  }
  return (
    <Card tone="accent">
      <div className="grid sm:grid-cols-4 gap-3">
        <div><label className={label}>Piezas</label><input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} className={input} autoFocus /></div>
        <div><label className={label}>Tipo</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className={input}>
            <option value="consumption">Consumo (uso interno, staff, cortesía)</option>
            <option value="waste">Merma (caducó, se rompió, se perdió)</option>
          </select></div>
        <div><label className={label}>Motivo</label><input value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'waste' ? 'Ej. caducó' : 'Ej. baños, para el staff'} className={input} /></div>
        <div><label className={label}>Fecha</label><input type="date" value={date} max={todayMx()} onChange={e => setDate(e.target.value)} className={input} /></div>
      </div>
      <Msg text={error} />
      <button onClick={save} disabled={!qty} className={`${btnPrimary} mt-3`}>Registrar salida</button>
    </Card>
  )
}

function MovementLine({ m, showProduct }: { m: Movement; showProduct?: boolean }) {
  return (
    <div className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="text-zinc-200">
          {showProduct && <span className="text-texto-principal font-semibold">{m.product} · </span>}
          {STOCK_KINDS[m.kind] ?? m.kind}
          {m.sale_folio && <span className="text-zinc-500"> · venta #{m.sale_folio}</span>}
          {m.expense_folio && <span className="text-zinc-500"> · egreso #{m.expense_folio}</span>}
          {m.note && <span className="text-zinc-500"> · {m.note}</span>}
        </p>
        <p className="text-zinc-500 text-xs">
          {m.occurred_on && m.occurred_on !== new Date(m.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) ?`${fmtDate(m.occurred_on)} (registrado ${fmtDateTime(m.created_at)})` : fmtDateTime(m.created_at)}
          {m.by && ` · ${m.by}`}{m.unit_cost_cents != null && ` · costo ${money(m.unit_cost_cents)}`}
        </p>
      </div>
      <span className="text-right shrink-0">
        <span className={`font-bold tabular-nums ${m.quantity > 0 ? 'text-exito' : 'text-alerta'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
        <span className="text-zinc-500 text-xs block">quedan {m.stock_after}</span>
      </span>
    </div>
  )
}

function History({ p }: { p: Item }) {
  const [rows, setRows] = useState<Movement[] | null>(null)
  useEffect(() => { call<{ movements: Movement[] }>('get_stock_movements', { p_product_id: p.id }).then(({ data }) => setRows(data?.movements ?? [])) }, [p.id])
  if (!rows) return <Spinner />
  if (rows.length === 0) return <Empty>Sin movimientos.</Empty>
  return <div className="rounded-xl bg-fondo/60 divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">{rows.map(m => <MovementLine key={m.id} m={m} />)}</div>
}

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const REPORT_KINDS = ['purchase', 'sale', 'sale_void', 'consumption', 'waste', 'adjust', 'initial']

function MovementsReport({ products, isAdmin }: { products: Item[]; isAdmin: boolean }) {
  const [from, setFrom] = useState(todayMx().slice(0, 8) + '01')
  const [to, setTo] = useState(todayMx())
  const [kind, setKind] = useState('')
  const [product, setProduct] = useState('')
  const [data, setData] = useState<{ movements: Movement[]; totals: Record<string, { quantity: number; cost_cents: number | null }> } | null>(null)
  useEffect(() => {
    setData(null)
    call<{ movements: Movement[]; totals: Record<string, { quantity: number; cost_cents: number | null }> }>('get_stock_report',
      { p_from: from, p_to: to, p_kind: kind || null, p_product_id: product || null }).then(({ data }) => setData(data))
  }, [from, to, kind, product])
  const exportCsv = () => data && csvDownload(`movimientos_${from}_${to}.csv`, [
    ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Quedan', 'Nota', 'Quién', ...(isAdmin ? ['Costo unitario'] : [])],
    ...data.movements.map(m => [m.occurred_on ?? m.created_at.slice(0, 10), m.product ?? '', STOCK_KINDS[m.kind] ?? m.kind, m.quantity, m.stock_after, m.note ?? '', m.by ?? '',
      ...(isAdmin ? [m.unit_cost_cents != null ? (m.unit_cost_cents / 100).toFixed(2) : ''] : [])]),
  ])
  const t = data?.totals ?? {}
  const tile = (k: string, tone?: 'alert' | 'accent') => (
    <Stat label={STOCK_KINDS[k]} value={Math.abs(t[k]?.quantity ?? 0)} sub={isAdmin && t[k]?.cost_cents ? `${money(t[k].cost_cents ?? 0)} a costo` : 'piezas'} tone={tone} />
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className={label}>Desde</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></div>
        <div><label className={label}>Hasta</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></div>
        <button onClick={() => { setFrom(addDays(todayMx(), -6)); setTo(todayMx()) }} className={btnSmall}>7 días</button>
        <button onClick={() => { setFrom(todayMx().slice(0, 8) + '01'); setTo(todayMx()) }} className={btnSmall}>Este mes</button>
        <select value={kind} onChange={e => setKind(e.target.value)} className={field} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {REPORT_KINDS.map(k => <option key={k} value={k}>{STOCK_KINDS[k]}</option>)}
        </select>
        <select value={product} onChange={e => setProduct(e.target.value)} className={field} aria-label="Producto">
          <option value="">Todos los productos</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={exportCsv} disabled={!data} className={btnSmall}>CSV</button>
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tile('purchase', 'accent')}{tile('sale')}{tile('consumption')}{tile('waste', (t.waste?.quantity ?? 0) ? 'alert' : undefined)}
          </div>
          <Card title={`${data.movements.length} movimientos`}>
            {data.movements.length === 0 ? <Empty>Sin movimientos en esas fechas.</Empty> : (
              <div className="divide-y divide-zinc-800/60 -mx-3 max-h-[60vh] overflow-y-auto">{data.movements.map(m => <MovementLine key={m.id} m={m} showProduct />)}</div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Reprice({ products, onDone }: { products: Item[]; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>([])
  const [fieldName, setFieldName] = useState<'price' | 'cost'>('price')
  const [mode, setMode] = useState<'add_percent' | 'add_amount' | 'set'>('add_percent')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sellable = products.filter(p => fieldName === 'cost' || p.for_sale)
  const v = Number(value)
  const preview = (p: Item) => {
    const cur = (fieldName === 'price' ? p.price_cents : p.cost_cents) ?? 0
    const next = mode === 'set' ? toCents(value) : mode === 'add_amount' ? cur + Math.round(v * 100) : cur * (1 + v / 100)
    return Math.max(0, Math.round(next / 100) * 100)
  }
  const save = async () => {
    if (!window.confirm(`¿Cambiar el ${fieldName === 'price' ? 'precio' : 'costo'} de ${sel.length} productos?`)) return
    const { error } = await call('admin_bulk_reprice', { p: { product_ids: sel, field: fieldName, mode, value: mode === 'add_percent' ? v : Math.round(v * 100) } })
    if (error) { setError(invError(error)); return }
    onDone()
  }
  return (
    <Card title="Reajustar precios" tone="accent">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Qué cambia</label>
          <select value={fieldName} onChange={e => setFieldName(e.target.value as 'price' | 'cost')} className={field}><option value="price">Precio de venta</option><option value="cost">Costo</option></select></div>
        <div><label className={label}>Cómo</label>
          <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className={field}>
            <option value="add_percent">Subir o bajar %</option><option value="add_amount">Subir o bajar $</option><option value="set">Poner un precio fijo</option>
          </select></div>
        <div className="w-32"><label className={label}>{mode === 'add_percent' ? '% (−10 baja)' : '$'}</label><input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} className={input} /></div>
        <button onClick={() => setSel(sel.length === sellable.length ? [] : sellable.map(p => p.id))} className={btnSmall}>{sel.length === sellable.length ? 'Ninguno' : 'Todos'}</button>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-xl bg-fondo/60 divide-y divide-zinc-800/60">
        {sellable.map(p => {
          const cur = (fieldName === 'price' ? p.price_cents : p.cost_cents) ?? 0
          const on = sel.includes(p.id)
          return (
            <label key={p.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm cursor-pointer">
              <span className="flex items-center gap-2 min-w-0">
                <input type="checkbox" checked={on} onChange={e => setSel(s => e.target.checked ? [...s, p.id] : s.filter(x => x !== p.id))} className="accent-primario w-4 h-4" />
                <span className="text-zinc-200 truncate">{p.name}</span>
              </span>
              <span className="tabular-nums text-zinc-400 shrink-0">{money(cur)}{on && value !== '' && <> → <span className="text-texto-principal font-bold">{money(preview(p))}</span></>}</span>
            </label>
          )
        })}
      </div>
      <p className="text-zinc-500 text-xs mt-2">Se redondea al peso. Queda registrado en la bitácora con los precios anteriores.</p>
      <Msg text={error} />
      <button onClick={save} disabled={sel.length === 0 || value === ''} className={`${btnPrimary} mt-3`}>Aplicar a {sel.length} productos</button>
    </Card>
  )
}
