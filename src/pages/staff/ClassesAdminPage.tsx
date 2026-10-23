import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  BOOKING_STATUS_LABELS, PAID_WITH_LABELS, PRICE_TIER_LABELS, addDaysKey, classError, fmtDateKey, fmtTime, formatMoney,
  isActiveBooking, sendClassEmails, todayKey, type BookingInfo, type ClassSettings, type PriceTier,
} from '../../lib/classes'
import { PeopleTab, PersonPicker, inputClass, smallBtn, primaryBtn, fieldLabel, type Person } from './classes/people'
import { ConfigTab, useClassAdmin, type ClassAdmin } from './classes/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface DaySession {
  id: string
  class_type_id: string
  name: string
  color: string | null
  instructor_name: string | null
  starts_at: string
  ends_at: string
  status: 'scheduled' | 'cancelled'
  cancel_reason: string | null
  capacity: number
  taken: number
  attendance_taken: boolean
  price_cents: number
  member_price_cents: number
  eligible_free_monthly: boolean
  booking_mode: 'online' | 'staff_only'
  bookings: BookingInfo[]
}

interface DaySale { id: string; class_name: string; full_name: string; amount_cents: number; paid_with: string; note: string | null }
interface DayData { settings: ClassSettings; sessions: DaySession[]; sales: DaySale[] }

type Tab = 'today' | 'people' | 'intro' | 'config'

export default function ClassesAdminPage() {
  const [tab, setTab] = useState<Tab>('today')
  const { data: admin, error, reload } = useClassAdmin()

  const tabBtn = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)}
      className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${tab === t ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300 border border-zinc-700'}`}>
      {label}
    </button>
  )

  return (
    <div className="h-full overflow-y-auto bg-fondo px-4 pt-5 pb-10">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-texto-principal font-black text-2xl tracking-tight">Clases</h1>
          <p className="text-zinc-400 text-xs">Reservas, asistencia, personas y configuración.</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabBtn('today', 'Hoy')}
          {tabBtn('people', 'Personas')}
          {tabBtn('intro', 'Introductoria')}
          {admin?.is_admin && tabBtn('config', 'Configuración')}
        </div>
        {error && <p className="text-alerta text-xs">No se pudo cargar. ¿Ya se corrió el SQL de clases?</p>}
        {tab === 'today' && <TodayTab isAdmin={!!admin?.is_admin} />}
        {tab === 'people' && <PeopleTab />}
        {tab === 'intro' && admin && <IntroTab admin={admin} />}
        {tab === 'config' && admin && <ConfigTab admin={admin} reload={reload} />}
      </div>
    </div>
  )
}

function TodayTab({ isAdmin }: { isAdmin: boolean }) {
  const [date, setDate] = useState(todayKey())
  const [day, setDay] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await db.rpc('get_class_day', { p_date: date })
    setLoading(false)
    if (error || !data || data.error) { setError(classError(data?.error, 'No se pudo cargar el día.')); return }
    setError(null)
    setDay(data as DayData)
  }, [date])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setDate(d => addDaysKey(d, -1))} className={smallBtn}>‹</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={inputClass + ' max-w-[11rem]'} />
        <button onClick={() => setDate(d => addDaysKey(d, 1))} className={smallBtn}>›</button>
        {date !== todayKey() && <button onClick={() => setDate(todayKey())} className={smallBtn}>Hoy</button>}
        <button onClick={load} className={smallBtn + ' ml-auto'}>Actualizar</button>
      </div>
      <p className="text-zinc-300 text-sm font-semibold">{fmtDateKey(date)}</p>
      {error && <p className="text-alerta text-xs">{error}</p>}
      {loading && !day && <p className="text-zinc-500 text-sm">Cargando…</p>}
      {day && day.sessions.length === 0 && <p className="text-zinc-500 text-sm">No hay clases este día.</p>}
      {day?.sessions.map(s => <SessionPanel key={s.id} s={s} settings={day.settings} isAdmin={isAdmin} onChanged={load} />)}
      {day && day.sales.length > 0 && (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-1">
          <p className="text-texto-principal font-bold text-sm">Ventas sueltas del día</p>
          {day.sales.map(sa => (
            <p key={sa.id} className="text-zinc-300 text-xs">
              {sa.class_name} · {sa.full_name} · {formatMoney(sa.amount_cents)} ({PAID_WITH_LABELS[sa.paid_with] ?? sa.paid_with}){sa.note && ` · ${sa.note}`}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionPanel({ s, settings, isAdmin, onChanged }: { s: DaySession; settings: ClassSettings; isAdmin: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const active = s.bookings.filter(b => isActiveBooking(b.status))
  const cancelled = s.bookings.filter(b => !isActiveBooking(b.status))
  const owed = active.filter(b => b.payment_status === 'pending').reduce((acc, b) => acc + b.amount_cents, 0)

  const cancelSession = async () => {
    const { data, error } = await db.rpc('admin_cancel_session', { p_session_id: s.id, p_reason: reason })
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    sendClassEmails(data.booking_ids ?? [], 'cancel')
    setCancelling(false)
    onChanged()
  }

  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3" style={{ borderLeft: `4px solid ${s.color ?? '#ff4d15'}` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-texto-principal font-bold">{s.name} <span className="text-zinc-400 font-semibold text-sm">· {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span></p>
          <p className="text-zinc-400 text-xs">
            {s.instructor_name ?? 'Sin profe'} · {s.taken}/{s.capacity} lugares
            {s.taken > s.capacity && <span className="text-amarillo-suave font-bold"> · sobrecupo</span>}
            {owed > 0 && <span className="text-amarillo-suave"> · por cobrar {formatMoney(owed)}</span>}
          </p>
          {s.status === 'cancelled' && <p className="text-alerta text-xs font-bold">Cancelada{s.cancel_reason && `: ${s.cancel_reason}`}</p>}
        </div>
        {s.status === 'scheduled' && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setAdding(v => !v)} className={smallBtn}>{adding ? 'Cerrar' : '+ Persona'}</button>
            {isAdmin && <button onClick={() => setCancelling(v => !v)} className={smallBtn}>Cancelar clase</button>}
          </div>
        )}
      </div>

      {cancelling && (
        <div className="rounded-xl border border-alerta/50 p-3 space-y-2">
          <p className="text-zinc-300 text-xs">Se cancelan todas las reservas y se les avisa por correo. A quien usó su clase gratis se le devuelve.</p>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (ej. profe enfermo)" className={inputClass} />
          <div className="flex gap-2">
            <button onClick={cancelSession} className="text-xs font-bold px-4 py-2 rounded-xl bg-alerta text-white">Confirmar cancelación</button>
            <button onClick={() => setCancelling(false)} className="text-zinc-400 text-xs">Volver</button>
          </div>
        </div>
      )}

      {adding && <AddPerson s={s} onDone={() => { setAdding(false); onChanged() }} />}
      {error && <p className="text-alerta text-xs">{error}</p>}

      {active.length === 0 && <p className="text-zinc-500 text-xs">Nadie ha reservado.</p>}
      <div className="space-y-2">
        {active.map(b => <BookingRow key={b.id} b={b} settings={settings} onChanged={onChanged} />)}
      </div>

      {cancelled.length > 0 && (
        <div>
          <button onClick={() => setShowCancelled(v => !v)} className="text-zinc-500 text-xs font-semibold">
            {showCancelled ? 'Ocultar' : 'Ver'} canceladas ({cancelled.length})
          </button>
          {showCancelled && cancelled.map(b => (
            <p key={b.id} className="text-zinc-500 text-xs mt-1">
              {b.full_name} · {BOOKING_STATUS_LABELS[b.status]}{b.needs_reschedule && ' · pagó: reagendar'}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function BookingRow({ b, settings, onChanged }: { b: BookingInfo; settings: ClassSettings; onChanged: () => void }) {
  const [paying, setPaying] = useState(false)
  const [method, setMethod] = useState('cash')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const late = new Date(b.starts_at).getTime() - Date.now() < settings.cancel_hours * 3600_000

  const call = async (fn: string, args: Record<string, unknown>, after?: () => void) => {
    setBusy(true); setError(null)
    const { data, error } = await db.rpc(fn, args)
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    after?.()
    onChanged()
  }

  const statusColor = b.status === 'attended' ? 'text-exito bg-exito/10' : b.status === 'no_show' ? 'text-white bg-alerta' : 'text-zinc-300 bg-superficie-alta'

  return (
    <div className="rounded-xl bg-fondo/60 border border-zinc-800/80 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-texto-principal font-bold text-sm">{b.full_name}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor}`}>{BOOKING_STATUS_LABELS[b.status]}</span>
        {b.is_minor && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-texto-en-acento bg-amarillo-suave">Menor</span>}
        {b.is_overbook && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-amarillo-suave bg-amarillo-suave/10">Sobrecupo</span>}
      </div>
      <p className="text-zinc-400 text-xs">
        {PRICE_TIER_LABELS[b.price_tier]}
        {b.amount_cents > 0 && ` · ${formatMoney(b.amount_cents)}`}
        {b.payment_status === 'pending' && <span className="text-amarillo-suave font-semibold"> · por cobrar</span>}
        {b.payment_status === 'paid' && ` · pagado (${PAID_WITH_LABELS[b.paid_with ?? ''] ?? b.paid_with})`}
        {b.phone && ` · ${b.phone}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => call('admin_mark_attendance', { p_booking_id: b.id, p_status: b.status === 'attended' ? 'booked' : 'attended' })}
          className={b.status === 'attended' ? 'text-xs font-bold px-3 py-2 rounded-xl bg-exito text-white' : smallBtn}>Asistió</button>
        <button disabled={busy} onClick={() => call('admin_mark_attendance', { p_booking_id: b.id, p_status: b.status === 'no_show' ? 'booked' : 'no_show' })}
          className={b.status === 'no_show' ? 'text-xs font-bold px-3 py-2 rounded-xl bg-alerta text-white' : smallBtn}>Faltó</button>
        {b.payment_status === 'pending' && !paying && <button onClick={() => setPaying(true)} className={smallBtn}>Cobrar</button>}
        {b.status === 'booked' && !confirmCancel && <button onClick={() => setConfirmCancel(true)} className={smallBtn}>Cancelar</button>}
      </div>
      {paying && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={method} onChange={e => setMethod(e.target.value)} className={inputClass + ' max-w-[10rem]'}>
            {['cash', 'card', 'transfer', 'other'].map(k => <option key={k} value={k}>{PAID_WITH_LABELS[k]}</option>)}
          </select>
          <button disabled={busy} onClick={() => call('admin_mark_booking_paid', { p_booking_id: b.id, p_paid_with: method }, () => setPaying(false))} className={primaryBtn}>
            Cobrado {formatMoney(b.amount_cents)}
          </button>
          <button onClick={() => setPaying(false)} className="text-zinc-400 text-xs">Volver</button>
        </div>
      )}
      {confirmCancel && (
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={() => call('admin_cancel_booking', { p_booking_id: b.id, p_late: false }, () => sendClassEmails([b.id], 'cancel'))} className={smallBtn}>
            Cancelar a tiempo (no pierde)
          </button>
          <button disabled={busy} onClick={() => call('admin_cancel_booking', { p_booking_id: b.id, p_late: true }, () => sendClassEmails([b.id], 'cancel'))} className={smallBtn}>
            Cancelar tarde (cuenta como falta){late ? ' ← aplica' : ''}
          </button>
          <button onClick={() => setConfirmCancel(false)} className="text-zinc-400 text-xs">Volver</button>
        </div>
      )}
      {error && <p className="text-alerta text-xs">{error}</p>}
    </div>
  )
}

function AddPerson({ s, onDone }: { s: DaySession; onDone: () => void }) {
  const [person, setPerson] = useState<Person | null>(null)
  const [tier, setTier] = useState<PriceTier>('regular')
  const [paidNow, setPaidNow] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMember = !!person?.membership_until

  useEffect(() => { setTier(isMember ? 'member' : 'regular') }, [person?.id, isMember])

  const amount = tier === 'regular' ? s.price_cents : tier === 'member' ? s.member_price_cents : 0
  const tiers: PriceTier[] = isMember
    ? (s.eligible_free_monthly ? ['member', 'free_monthly', 'regular', 'courtesy'] : ['member', 'regular', 'courtesy'])
    : ['regular', 'courtesy']

  const submit = async () => {
    if (!person) { setError('Elige o crea a la persona.'); return }
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('admin_book_person', {
      p_session_id: s.id, p_person_id: person.id, p_tier: tier, p_paid_with: amount > 0 && paidNow ? paidNow : null,
    })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    if (new Date(s.starts_at) > new Date()) sendClassEmails([data.booking.id], 'confirmation')
    onDone()
  }

  return (
    <div className="rounded-xl border border-primario/40 p-3 space-y-3">
      <PersonPicker selected={person} onPick={setPerson} />
      {person && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={fieldLabel}>Precio</label>
              <select value={tier} onChange={e => setTier(e.target.value as PriceTier)} className={inputClass}>
                {tiers.map(t => <option key={t} value={t}>{PRICE_TIER_LABELS[t]}{t === 'regular' ? ` (${formatMoney(s.price_cents)})` : t === 'member' ? ` (${formatMoney(s.member_price_cents)})` : ''}</option>)}
              </select>
            </div>
            {amount > 0 && (
              <div>
                <label className={fieldLabel}>¿Ya pagó?</label>
                <select value={paidNow} onChange={e => setPaidNow(e.target.value)} className={inputClass}>
                  <option value="">Por cobrar</option>
                  {['cash', 'card', 'transfer', 'other'].map(k => <option key={k} value={k}>Pagó: {PAID_WITH_LABELS[k]}</option>)}
                </select>
              </div>
            )}
          </div>
          {s.taken >= s.capacity && <p className="text-amarillo-suave text-xs font-semibold">La clase está llena: entraría como sobrecupo.</p>}
          {error && <p className="text-alerta text-xs font-semibold">{error}</p>}
          <button onClick={submit} disabled={busy} className={primaryBtn}>{busy ? 'Agregando…' : 'Agregar a la clase'}</button>
        </>
      )}
    </div>
  )
}

function IntroTab({ admin }: { admin: ClassAdmin }) {
  const intro = admin.types.find(t => t.booking_mode === 'staff_only' && t.is_active) ?? admin.types[0]
  const [typeId, setTypeId] = useState(intro?.id ?? '')
  const type = admin.types.find(t => t.id === typeId)
  const [person, setPerson] = useState<Person | null>(null)
  const [amount, setAmount] = useState(String((type?.price_cents ?? 0) / 100))
  const [paidWith, setPaidWith] = useState('cash')
  const [date, setDate] = useState(todayKey())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { setAmount(String((type?.price_cents ?? 0) / 100)) }, [typeId, type?.price_cents])

  const submit = async () => {
    if (!person) { setMsg('Elige o crea a la persona.'); return }
    setBusy(true); setMsg(null)
    const { data, error } = await db.rpc('admin_register_sale', {
      p_class_type_id: typeId, p_person_id: person.id, p_sold_on: date,
      p_amount_cents: Math.round(Number(amount) * 100), p_paid_with: paidWith, p_note: note || null,
    })
    setBusy(false)
    if (error || !data || data.error) { setMsg(classError(data?.error)); return }
    setMsg(`Registrado: ${type?.name} de ${person.full_name}, ${formatMoney(Math.round(Number(amount) * 100))}.`)
    setPerson(null); setNote('')
  }

  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3">
      <div>
        <p className="text-texto-principal font-bold text-sm">Registrar clase vendida</p>
        <p className="text-zinc-400 text-xs">Para la Introductoria (o cualquier clase) cuando no hay una sesión en el calendario: solo queda la venta.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className={fieldLabel}>Clase</label>
          <select value={typeId} onChange={e => setTypeId(e.target.value)} className={inputClass}>
            {admin.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={fieldLabel}>Fecha</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Monto (MXN)</label>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Cómo pagó</label>
          <select value={paidWith} onChange={e => setPaidWith(e.target.value)} className={inputClass}>
            {['cash', 'card', 'transfer', 'other'].map(k => <option key={k} value={k}>{PAID_WITH_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={fieldLabel}>Persona</label>
        <PersonPicker selected={person} onPick={setPerson} />
      </div>
      <div>
        <label className={fieldLabel}>Nota (opcional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. agendó por Instagram" className={inputClass} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : 'Registrar venta'}</button>
        {msg && <span className="text-zinc-300 text-xs">{msg}</span>}
      </div>
    </div>
  )
}
