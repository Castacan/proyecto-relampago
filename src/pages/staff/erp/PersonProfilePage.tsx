import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  call, billing, erpError, money, fmtDate, fmtDateTime, scheduleLabel, subscriptionLink, todayMx,
  CHARGE_STATUS, SUB_STATUS, SOURCE_LABELS, type Product,
} from '../../../lib/erp'
import { BOOKING_STATUS_LABELS, PRICE_TIER_LABELS, fmtTime, type BookingInfo } from '../../../lib/classes'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, btnDanger } from '../../../components/erp/ui'
import PersonForm, { type PersonData } from '../../../components/erp/PersonForm'

interface Charge { id: string; cycle: number; period_start: string; period_end: string; amount_cents: number; status: string; attempt: number; max_attempts: number; error_message: string | null; next_attempt_at: string | null; paid_at: string | null }
interface Subscription {
  id: string; status: string; product_name: string; provider: string; price_cents: number; promo_cycles: number; promo_price_cents: number | null
  start_on: string; cycles_paid: number; next_charge_on: string; card_brand: string | null; card_last4: string | null
  cancel_at_period_end: boolean; cancel_reason: string | null; last_error: string | null; has_setup_link: boolean; charges: Charge[]
}
interface Membership { id: string; plan_name: string | null; valid_from: string; valid_until: string; is_void: boolean; note: string | null; subscription_id: string | null; sale_id: string | null }
interface SaleRow { id: string; folio: number; created_at: string; status: string; total_cents: number; source: string; items: string | null; methods: string | null }
interface Note { id: string; kind: string; body: string; created_at: string }
interface Profile {
  person: PersonData & { id: string; is_minor: boolean; created_at: string; has_login: boolean }
  membership_until: string | null
  memberships: Membership[]
  subscriptions: Subscription[]
  sales: SaleRow[]
  bookings: BookingInfo[]
  free_left_this_month: number
  notes: Note[]
}

const NOTE_KINDS: Record<string, string> = { note: 'Nota', call: 'Llamada', whatsapp: 'WhatsApp', email: 'Correo', visit: 'Visita' }

export default function PersonProfilePage() {
  const { id } = useParams()
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await call<Profile>('get_person_profile', { p_person_id: id })
    if (error || !data) { setError(erpError(error ?? undefined, 'No se pudo cargar la ficha.')); return }
    setP(data)
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin)) }, [])

  if (error) return <Page title="Ficha"><p className="text-alerta text-sm">{error}</p></Page>
  if (!p) return <Page title="Ficha"><Spinner /></Page>
  const person = p.person
  const totalSpent = p.sales.filter(s => s.status === 'completed').reduce((a, s) => a + s.total_cents, 0)
  const attended = p.bookings.filter(b => b.status === 'attended').length
  const liveSubs = p.subscriptions.filter(s => s.status !== 'cancelled')

  return (
    <Page title={person.full_name}
      subtitle={<span className="flex flex-wrap gap-1.5 items-center">
        {p.membership_until ? <Badge cls="text-exito bg-exito/10">Miembro hasta {fmtDate(p.membership_until)}</Badge> : <Badge>Sin membresía vigente</Badge>}
        {person.is_minor && <Badge cls="text-texto-en-acento bg-amarillo-suave">Menor</Badge>}
        {person.has_login && <Badge>Con cuenta en la app</Badge>}
        <span className="text-zinc-500 text-xs">Registrado {fmtDate(person.created_at)}</span>
      </span>}
      actions={<>
        <Link to={`/staff/vender?persona=${person.id}`} className={btnPrimary}>Vender</Link>
        <button onClick={() => setSubscribing(v => !v)} className={btnGhost}>{subscribing ? 'Cerrar' : 'Domiciliar'}</button>
        <button onClick={() => setEditing(v => !v)} className={btnGhost}>{editing ? 'Cerrar' : 'Editar datos'}</button>
      </>}>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Membresía" value={p.membership_until ? fmtDate(p.membership_until) : '—'} sub={p.membership_until ? 'vigente hasta' : 'sin membresía'} tone={p.membership_until ? 'success' : undefined} />
        <Stat label="Clase gratis del mes" value={p.membership_until ? (p.free_left_this_month > 0 ? 'Disponible' : 'Usada') : '—'} sub="solo miembros" />
        <Stat label="Total comprado" value={money(totalSpent)} sub={`${p.sales.filter(s => s.status === 'completed').length} compras`} tone="accent" />
        <Stat label="Clases asistidas" value={attended} sub={`${p.bookings.filter(b => b.status === 'no_show').length} faltas`} />
      </div>

      {editing && (
        <Card title="Datos" tone="accent">
          <PersonForm person={person} onSaved={() => { setEditing(false); load() }} onCancel={() => setEditing(false)} />
        </Card>
      )}

      {subscribing && <NewSubscription personId={person.id} phone={person.phone} onDone={() => { setSubscribing(false); load() }} />}

      {liveSubs.length > 0 && liveSubs.map(s => <SubscriptionCard key={s.id} s={s} phone={person.phone} firstName={person.full_name.split(' ')[0]} onChanged={load} />)}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Contacto">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-zinc-400">Celular</dt><dd className="text-texto-principal">{person.phone ? <a href={`https://wa.me/52${person.phone}`} target="_blank" rel="noreferrer" className="text-primario">{person.phone}</a> : '—'}</dd>
            <dt className="text-zinc-400">Correo</dt><dd className="text-texto-principal break-all">{person.email ?? '—'}</dd>
            <dt className="text-zinc-400">Nacimiento</dt><dd className="text-texto-principal">{person.birth_date ? fmtDate(person.birth_date) : '—'}</dd>
            <dt className="text-zinc-400">Emergencia</dt><dd className="text-texto-principal">{person.emergency_name ? `${person.emergency_name} · ${person.emergency_phone ?? ''}` : '—'}</dd>
            {person.is_minor && <><dt className="text-zinc-400">Tutor</dt><dd className="text-texto-principal">{person.guardian_name ? `${person.guardian_name} · ${person.guardian_phone ?? ''}` : 'Falta capturar'}</dd></>}
            <dt className="text-zinc-400">Nos conoció</dt><dd className="text-texto-principal">{person.source === 'staff' ? 'Registrado en el gym' : person.source === 'web' ? 'Se registró en la app' : person.source ?? '—'}</dd>
            <dt className="text-zinc-400">Nota</dt><dd className="text-texto-principal whitespace-pre-line">{person.note ?? '—'}</dd>
          </dl>
        </Card>
        <NotesCard personId={person.id} notes={p.notes} onAdded={load} />
      </div>

      <Card title="Compras">
        {p.sales.length === 0 ? <Empty>Todavía no ha comprado nada.</Empty> : (
          <div className="divide-y divide-zinc-800/80">
            {p.sales.map(s => (
              <div key={s.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${s.status === 'voided' ? 'text-zinc-500 line-through' : 'text-texto-principal'}`}>{s.items}</p>
                  <p className="text-zinc-500 text-xs">#{s.folio} · {fmtDateTime(s.created_at)} · {SOURCE_LABELS[s.source] ?? s.source}{s.status === 'voided' && ' · anulada'}</p>
                </div>
                <span className="text-texto-principal font-bold text-sm tabular-nums">{money(s.total_cents)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <MembershipsCard memberships={p.memberships} isAdmin={isAdmin} onChanged={load} />
        <Card title="Clases">
          {p.bookings.length === 0 ? <Empty>No ha reservado clases.</Empty> : (
            <div className="divide-y divide-zinc-800/80">
              {p.bookings.slice(0, 20).map(b => (
                <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-texto-principal font-semibold">{b.class_name}</p>
                    <p className="text-zinc-500 text-xs">{fmtDate(b.starts_at.slice(0, 10))} · {fmtTime(b.starts_at)} · {PRICE_TIER_LABELS[b.price_tier]}</p>
                  </div>
                  <Badge cls={b.status === 'attended' ? 'text-exito bg-exito/10' : b.status === 'no_show' ? 'text-white bg-alerta' : undefined}>{BOOKING_STATUS_LABELS[b.status]}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}

function shareText(firstName: string, link: string) {
  return `Hola ${firstName}, para activar tu membresía con cobro automático registra tu tarjeta aquí: ${link}`
}

function LinkBox({ token, phone, firstName }: { token: string; phone: string | null; firstName: string }) {
  const link = subscriptionLink(token)
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-xl bg-fondo/70 border border-zinc-700/60 p-3 space-y-2">
      <p className="text-zinc-300 text-xs font-bold">Link para registrar la tarjeta (ábrelo aquí o mándaselo)</p>
      <p className="text-texto-principal text-xs break-all font-mono">{link}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* sin portapapeles */ } }} className={btnSmall}>{copied ? 'Copiado' : 'Copiar link'}</button>
        {phone && <a href={`https://wa.me/52${phone}?text=${encodeURIComponent(shareText(firstName, link))}`} target="_blank" rel="noreferrer" className={btnSmall}>Mandar por WhatsApp</a>}
        <a href={link} target="_blank" rel="noreferrer" className={btnSmall}>Abrir aquí (tablet del gym)</a>
      </div>
    </div>
  )
}

function NewSubscription({ personId, phone, onDone }: { personId: string; phone: string | null; onDone: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [startOn, setStartOn] = useState('')
  const [promo, setPromo] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: string; start_on: string } | null>(null)

  useEffect(() => {
    call<{ products: Product[] }>('get_products', { p_include_inactive: false }).then(({ data }) => {
      const rec = (data?.products ?? []).filter(p => p.is_recurring)
      setProducts(rec)
      if (rec[0]) setProductId(rec[0].id)
    })
  }, [])
  const prod = products.find(p => p.id === productId)

  const create = async () => {
    setBusy(true); setError(null)
    const { data, error } = await call<{ token: string; start_on: string }>('admin_create_subscription', {
      p_person_id: personId, p_product_id: productId, p_start_on: startOn || null, p_apply_promo: promo,
    })
    setBusy(false)
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    setCreated(data)
  }

  return (
    <Card title="Domiciliar (cobro automático cada mes)" tone="accent">
      {created ? (
        <div className="space-y-3">
          <p className="text-exito text-sm font-semibold">Listo. El cobro empieza el {fmtDate(created.start_on)} en cuanto registre su tarjeta.</p>
          <LinkBox token={created.token} phone={phone} firstName="" />
          <button onClick={onDone} className={btnGhost}>Terminar</button>
        </div>
      ) : products.length === 0 ? (
        <p className="text-zinc-400 text-sm">No hay planes de domiciliación activos. Créalos en Configuración → Productos y planes.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ns-prod" className={label}>Plan</label>
              <select id="ns-prod" value={productId} onChange={e => setProductId(e.target.value)} className={input}>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ns-start" className={label}>Primer cobro (vacío = hoy o al vencer su membresía)</label>
              <input id="ns-start" type="date" value={startOn} min={todayMx()} onChange={e => setStartOn(e.target.value)} className={input} />
            </div>
          </div>
          {prod && (
            <div className="rounded-xl bg-fondo/60 p-3 text-sm text-zinc-300">
              {prod.promo_active && prod.promo_cycles && prod.promo_price_cents != null ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={promo} onChange={e => setPromo(e.target.checked)} className="accent-primario w-4 h-4 mt-0.5" />
                  <span>Aplicar promoción: <b className="text-texto-principal">{scheduleLabel(prod.price_cents, prod.promo_cycles, prod.promo_price_cents)}</b></span>
                </label>
              ) : <span>Cobro: <b className="text-texto-principal">{scheduleLabel(prod.price_cents, null, null)}</b></span>}
            </div>
          )}
          <Msg text={error} />
          <button onClick={create} disabled={busy || !productId} className={btnPrimary}>{busy ? 'Creando…' : 'Crear y obtener link de tarjeta'}</button>
        </div>
      )}
    </Card>
  )
}

function SubscriptionCard({ s, phone, firstName, onChanged }: { s: Subscription; phone: string | null; firstName: string; onChanged: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'error' | 'ok' } | null>(null)
  const st = SUB_STATUS[s.status] ?? SUB_STATUS.active
  const nextCycle = s.cycles_paid + 1
  const nextAmount = s.promo_price_cents != null && nextCycle <= s.promo_cycles ? s.promo_price_cents : s.price_cents

  const newLink = async () => {
    const { data, error } = await call<{ token: string }>('admin_subscription_link', { p_subscription_id: s.id })
    if (error || !data) { setMsg({ text: erpError(error ?? undefined), tone: 'error' }); return }
    setToken(data.token)
  }
  const chargeNow = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await billing<{ results: { result: string }[] }>({ action: 'charge_now', subscription_id: s.id })
    setBusy(false)
    if (error || !data) { setMsg({ text: 'No se pudo intentar el cobro.', tone: 'error' }); return }
    const r = data.results[0]?.result
    setMsg(r === 'paid' ? { text: 'Cobro aprobado.', tone: 'ok' } : r === 'failed' ? { text: 'El banco volvió a rechazar el cobro.', tone: 'error' }
      : r ? { text: `Resultado: ${r}`, tone: 'ok' } : { text: 'No hay nada que cobrar ahora.', tone: 'ok' })
    onChanged()
  }
  const cancel = async (immediately: boolean) => {
    setBusy(true); setMsg(null)
    const { error } = await call('admin_cancel_subscription', { p_subscription_id: s.id, p_immediately: immediately, p_reason: reason })
    setBusy(false)
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    setCancelling(false); onChanged()
  }
  const resume = async () => {
    const { error } = await call('admin_resume_subscription', { p_subscription_id: s.id })
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    onChanged()
  }

  return (
    <Card title={<span className="flex items-center gap-2">Domiciliación · {s.product_name} <Badge cls={st.cls}>{st.label}</Badge></span>}
      tone={s.status === 'past_due' ? 'alert' : s.status === 'pending_card' ? 'accent' : 'success'}>
      <div className="grid sm:grid-cols-3 gap-3 text-sm mb-3">
        <div><p className="text-zinc-400 text-xs">Esquema</p><p className="text-texto-principal font-semibold">{scheduleLabel(s.price_cents, s.promo_cycles || null, s.promo_price_cents)}</p></div>
        <div><p className="text-zinc-400 text-xs">Tarjeta</p><p className="text-texto-principal font-semibold">{s.card_last4 ? `${s.card_brand ?? ''} •••• ${s.card_last4}` : 'Sin registrar'}</p></div>
        <div><p className="text-zinc-400 text-xs">Próximo cobro</p><p className="text-texto-principal font-semibold">
          {s.cancel_at_period_end ? `Termina el ${fmtDate(s.next_charge_on)}` : `${fmtDate(s.next_charge_on)} · ${money(nextAmount)}`}</p></div>
      </div>
      {s.last_error && s.status === 'past_due' && <p className="text-alerta text-sm font-semibold mb-2">Último rechazo: {s.last_error}</p>}
      {s.cancel_at_period_end && <p className="text-amarillo-suave text-sm mb-2">Se cancela al terminar el periodo pagado{s.cancel_reason ? ` (${s.cancel_reason})` : ''}.</p>}

      <div className="flex flex-wrap gap-2 mb-3">
        {s.status === 'pending_card' || s.has_setup_link
          ? <button onClick={newLink} className={btnSmall}>Ver / renovar link de tarjeta</button>
          : <button onClick={newLink} className={btnSmall}>Link para cambiar tarjeta</button>}
        {s.status === 'past_due' && <button onClick={chargeNow} disabled={busy} className={btnSmall}>{busy ? 'Cobrando…' : 'Intentar cobrar ahora'}</button>}
        {s.cancel_at_period_end
          ? <button onClick={resume} className={btnSmall}>Quitar cancelación</button>
          : <button onClick={() => setCancelling(v => !v)} className={btnSmall}>Cancelar domiciliación</button>}
      </div>
      {token && <div className="mb-3"><LinkBox token={token} phone={phone} firstName={firstName} /></div>}
      {cancelling && (
        <div className="rounded-xl border border-alerta/50 p-3 space-y-2 mb-3">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (ej. se muda de ciudad)" className={input} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => cancel(false)} disabled={busy} className={btnGhost}>Al terminar lo pagado</button>
            <button onClick={() => cancel(true)} disabled={busy} className={btnDanger}>Cancelar ya</button>
          </div>
          <p className="text-zinc-500 text-xs">"Al terminar lo pagado" deja la membresía hasta su fecha y ya no cobra el siguiente mes.</p>
        </div>
      )}
      {msg && <Msg text={msg.text} tone={msg.tone} />}

      {s.charges.length > 0 && (
        <div className="mt-2 divide-y divide-zinc-800/80">
          {s.charges.map(c => (
            <div key={c.id} className="py-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-300">Mes {c.cycle} · {fmtDate(c.period_start)} – {fmtDate(c.period_end)}</span>
              <span className="flex items-center gap-2">
                <span className="text-zinc-200 font-semibold tabular-nums">{money(c.amount_cents)}</span>
                <Badge cls={c.status === 'paid' ? 'text-exito bg-exito/10' : c.status === 'failed' || c.status === 'needs_action' ? 'text-white bg-alerta' : undefined}>
                  {CHARGE_STATUS[c.status] ?? c.status}{c.status === 'failed' ? ` ${c.attempt}/${c.max_attempts}` : ''}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function MembershipsCard({ memberships, isAdmin, onChanged }: { memberships: Membership[]; isAdmin: boolean; onChanged: () => void }) {
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const voidIt = async (id: string) => {
    const { error } = await call('admin_void_membership', { p_membership_id: id, p_reason: reason })
    if (!error) { setVoiding(null); setReason(''); onChanged() }
  }
  const today = todayMx()
  return (
    <Card title="Historial de membresías">
      {memberships.length === 0 ? <Empty>Nunca ha tenido membresía.</Empty> : (
        <div className="divide-y divide-zinc-800/80">
          {memberships.map(m => {
            const current = !m.is_void && m.valid_from <= today && m.valid_until >= today
            return (
              <div key={m.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={m.is_void ? 'text-zinc-500 line-through' : 'text-texto-principal font-semibold'}>{m.plan_name ?? 'Membresía'}</span>
                  <span className="flex items-center gap-2">
                    {current && <Badge cls="text-exito bg-exito/10">Vigente</Badge>}
                    {m.subscription_id && <Badge>Domiciliada</Badge>}
                    {isAdmin && !m.is_void && <button onClick={() => setVoiding(voiding === m.id ? null : m.id)} className="text-zinc-500 hover:text-alerta text-xs">Anular</button>}
                  </span>
                </div>
                <p className="text-zinc-500 text-xs">{fmtDate(m.valid_from)} al {fmtDate(m.valid_until)}{m.note && ` · ${m.note}`}</p>
                {voiding === m.id && (
                  <div className="flex gap-2 mt-2">
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo" className={input} />
                    <button onClick={() => voidIt(m.id)} className={btnSmall}>Anular</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function NotesCard({ personId, notes, onAdded }: { personId: string; notes: Note[]; onAdded: () => void }) {
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (body.trim().length < 2) return
    setBusy(true)
    const { error } = await call('admin_add_person_note', { p_person_id: personId, p_kind: kind, p_body: body })
    setBusy(false)
    if (!error) { setBody(''); onAdded() }
  }
  return (
    <Card title="Seguimiento">
      <div className="flex gap-2 mb-3">
        <select value={kind} onChange={e => setKind(e.target.value)} className={`${input} max-w-[8.5rem]`}>
          {Object.entries(NOTE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Ej. Le llamé, viene el sábado" className={input} />
        <button onClick={add} disabled={busy} className={btnSmall}>Agregar</button>
      </div>
      {notes.length === 0 ? <Empty>Sin notas todavía.</Empty> : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {notes.map(n => (
            <div key={n.id} className="rounded-xl bg-fondo/60 px-3 py-2">
              <p className="text-zinc-500 text-[11px]">{NOTE_KINDS[n.kind] ?? n.kind} · {fmtDateTime(n.created_at)}</p>
              <p className="text-texto-principal text-sm whitespace-pre-line">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
