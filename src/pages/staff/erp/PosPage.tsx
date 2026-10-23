import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call, erpError, money, toCents, durationLabel, KIND_LABELS, METHOD_LABELS, POS_METHODS, type Product, type ProductKind } from '../../../lib/erp'
import { Page, Card, Empty, Msg, Spinner, input, label, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'
import { PersonPicker, type Person } from '../classes/people'

interface Line { product: Product; qty: number; discount: string; startsOn: string }
interface Payment { method: string; amount: string; reference: string }

export default function PosPage() {
  const [params] = useSearchParams()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [person, setPerson] = useState<Person | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState('')
  const [payments, setPayments] = useState<Payment[]>([{ method: 'cash', amount: '', reference: '' }])
  const [cashGiven, setCashGiven] = useState('')
  const [note, setNote] = useState('')
  const [cashOpen, setCashOpen] = useState<boolean | null>(null)
  const [requireCash, setRequireCash] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ folio: number; total: number; change: number } | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    call<{ products: Product[] }>('get_products', { p_include_inactive: false }).then(({ data }) => setProducts((data?.products ?? []).filter(p => !p.is_recurring)))
    call<{ open: unknown; require_open_cash: boolean }>('get_cash_status').then(({ data }) => { setCashOpen(!!data?.open); setRequireCash(data?.require_open_cash ?? true) })
    call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin))
  }, [])

  // Persona desde la ficha (?persona=id)
  useEffect(() => {
    const pid = params.get('persona')
    if (!pid) return
    call<{ person: Person & { full_name: string } ; membership_until: string | null }>('get_person_profile', { p_person_id: pid }).then(({ data }) => {
      if (data?.person) setPerson({ ...data.person, membership_until: data.membership_until, membership_last_until: null, has_login: false } as unknown as Person)
    })
  }, [params])

  const subtotal = lines.reduce((a, l) => a + l.product.price_cents * l.qty - toCents(l.discount), 0)
  const total = Math.max(subtotal - toCents(discount), 0)
  const paid = payments.reduce((a, p) => a + toCents(p.amount), 0)
  const cashPart = payments.filter(p => p.method === 'cash').reduce((a, p) => a + toCents(p.amount), 0)
  const change = cashGiven ? Math.max(toCents(cashGiven) - cashPart, 0) : 0
  const needsPerson = lines.some(l => l.product.grants_membership)

  const grouped = useMemo(() => {
    const g = new Map<ProductKind, Product[]>()
    for (const p of products ?? []) g.set(p.kind, [...(g.get(p.kind) ?? []), p])
    return [...g.entries()]
  }, [products])

  const add = (p: Product) => {
    setDone(null); setError(null)
    setLines(ls => {
      const i = ls.findIndex(l => l.product.id === p.id)
      if (i >= 0 && !p.grants_membership) return ls.map((l, j) => j === i ? { ...l, qty: l.qty + 1 } : l)
      if (i >= 0) return ls
      return [...ls, { product: p, qty: 1, discount: '', startsOn: '' }]
    })
  }
  // Si solo hay una forma de pago, se llena sola con el total.
  useEffect(() => {
    setPayments(ps => ps.length === 1 ? [{ ...ps[0], amount: total ? String(total / 100) : '' }] : ps)
  }, [total])

  const submit = async () => {
    setError(null)
    if (lines.length === 0) { setError('Agrega al menos un artículo.'); return }
    if (needsPerson && !person) { setError('Elige a la persona: el plan le da membresía.'); return }
    if (paid !== total) { setError(`Los pagos suman ${money(paid)} y el total es ${money(total)}.`); return }
    setBusy(true)
    const { data, error } = await call<{ folio: number; total_cents: number; product?: string; stock?: number }>('create_sale', { p_sale: {
      person_id: person?.id ?? null,
      items: lines.map(l => ({ product_id: l.product.id, quantity: l.qty, discount_cents: toCents(l.discount), starts_on: l.startsOn || null })),
      discount_cents: toCents(discount),
      payments: payments.filter(p => toCents(p.amount) > 0).map(p => ({ method: p.method, amount_cents: toCents(p.amount), reference: p.reference || null })),
      note: note || null,
    } })
    setBusy(false)
    if (error === 'out_of_stock' && data?.product) { setError(`No hay suficiente ${data.product}: quedan ${data.stock ?? 0}.`); return }
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    setDone({ folio: data.folio, total: data.total_cents, change })
    setLines([]); setDiscount(''); setPayments([{ method: 'cash', amount: '', reference: '' }]); setCashGiven(''); setNote('')
  }

  return (
    <Page title="Vender" subtitle="Elige a la persona (opcional), agrega artículos y cobra." width="max-w-6xl">
      {cashOpen === false && requireCash && (
        <Card tone="alert"><div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-texto-principal font-semibold">La caja está cerrada: ábrela para poder cobrar.</p>
          <Link to="/staff/caja" className={btnPrimary}>Ir a caja</Link>
        </div></Card>
      )}
      {done && (
        <Card tone="success"><div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-exito font-bold">Venta #{done.folio} registrada · {money(done.total)}</p>
            {done.change > 0 && <p className="text-texto-principal text-lg font-black">Cambio: {money(done.change)}</p>}
          </div>
          {person && <Link to={`/staff/personas/${person.id}`} className={btnGhost}>Ver ficha de {person.full_name.split(' ')[0]}</Link>}
        </div></Card>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Persona">
            <PersonPicker selected={person} onPick={p => { setPerson(p); setDone(null) }} />
            {needsPerson && !person && <p className="text-amarillo-suave text-xs mt-2">Necesaria: hay un plan en la venta.</p>}
          </Card>
          <Card title="Artículos">
            {products === null ? <Spinner /> : products.length === 0 ? <Empty>No hay productos. Créalos en Configuración → Productos y planes.</Empty> : (
              <div className="space-y-4">
                {grouped.map(([kind, items]) => (
                  <div key={kind}>
                    <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest mb-2">{KIND_LABELS[kind]}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {items.map(p => (
                        <button key={p.id} onClick={() => add(p)} disabled={p.track_stock && !p.allow_negative_stock && (p.stock ?? 0) <= 0}
                          className="text-left rounded-xl border border-zinc-700/50 bg-fondo/60 hover:bg-superficie-alta hover:border-primario/50 p-3 transition-all disabled:opacity-40">
                          <p className="text-texto-principal text-sm font-bold leading-tight">{p.name}</p>
                          <p className="text-primario text-sm font-black mt-1">{money(p.price_cents)}</p>
                          <p className="text-zinc-500 text-[11px]">{durationLabel(p)}{p.track_stock ? ` · ${p.stock ?? 0} en stock` : ''}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Cuenta" className="lg:sticky lg:top-0">
          {lines.length === 0 ? <Empty>Toca un artículo para agregarlo.</Empty> : (
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={l.product.id} className="rounded-xl bg-fondo/60 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-texto-principal text-sm font-bold">{l.product.name}</p>
                      <p className="text-zinc-500 text-xs">{money(l.product.price_cents)} c/u</p>
                    </div>
                    <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-alerta text-lg leading-none">×</button>
                  </div>
                  <div className="flex items-center gap-2">
                    {!l.product.grants_membership && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} className={btnSmall}>−</button>
                        <span className="text-texto-principal text-sm font-bold w-6 text-center">{l.qty}</span>
                        <button onClick={() => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))} className={btnSmall}>+</button>
                      </div>
                    )}
                    <input value={l.discount} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, discount: e.target.value } : x))}
                      type="number" min={0} placeholder="Descuento $" className={`${input} py-1.5`} />
                  </div>
                  {l.product.grants_membership && (
                    <div>
                      <label className="text-zinc-400 text-[11px]">Inicia (vacío = hoy o al vencer su membresía actual)</label>
                      <input type="date" value={l.startsOn} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, startsOn: e.target.value } : x))} className={`${input} py-1.5`} />
                    </div>
                  )}
                </div>
              ))}
              <div>
                <label className={label}>Descuento general</label>
                <input type="number" min={0} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="$0" className={input} />
              </div>
              <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
                <span className="text-zinc-300 font-semibold">Total</span>
                <span className="text-texto-principal text-2xl font-black tabular-nums">{money(total)}</span>
              </div>

              <div className="space-y-2">
                <p className={label}>Cómo paga</p>
                {payments.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <select value={p.method} onChange={e => setPayments(ps => ps.map((x, j) => j === i ? { ...x, method: e.target.value } : x))} className={`${input} max-w-[10rem]`}>
                      {POS_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                    </select>
                    <input type="number" min={0} value={p.amount} onChange={e => setPayments(ps => ps.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className={input} placeholder="$" />
                    {payments.length > 1 && <button onClick={() => setPayments(ps => ps.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-alerta px-1">×</button>}
                  </div>
                ))}
                <button onClick={() => setPayments(ps => [...ps, { method: 'card', amount: String(Math.max(total - paid, 0) / 100), reference: '' }])} className={btnSmall}>+ Otra forma de pago</button>
                {paid !== total && <p className="text-amarillo-suave text-xs">Pagos: {money(paid)} · falta {money(total - paid)}</p>}
              </div>

              {cashPart > 0 && (
                <div>
                  <label className={label}>¿Con cuánto paga en efectivo? (para el cambio)</label>
                  <input type="number" min={0} value={cashGiven} onChange={e => setCashGiven(e.target.value)} className={input} placeholder={String(cashPart / 100)} />
                  {change > 0 && <p className="text-texto-principal font-bold text-sm mt-1">Cambio: {money(change)}</p>}
                </div>
              )}
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (opcional)" className={input} />
              {!isAdmin && <p className="text-zinc-500 text-[11px]">Los precios solo los cambia un admin en Configuración.</p>}
              <Msg text={error} />
              <button onClick={submit} disabled={busy || lines.length === 0} className={`${btnPrimary} w-full py-3 text-base`}>
                {busy ? 'Cobrando…' : `Cobrar ${money(total)}`}
              </button>
            </div>
          )}
          {lines.length === 0 && <Msg text={error} />}
        </Card>
      </div>
    </Page>
  )
}
