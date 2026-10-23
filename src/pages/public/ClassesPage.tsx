import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'
import {
  BOOKING_STATUS_LABELS, classError, fmtDateKey, fmtTime, formatMoney, isActiveBooking, mxDateKey, sendClassEmails,
  type BookingInfo, type Calendar, type CalendarSession,
} from '../../lib/classes'
import logoHorizontal from '../../assets/logo-horizontal.png'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const inputClass = 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-primario/60 transition-all placeholder:text-zinc-500'
const labelClass = 'block text-zinc-300 text-xs font-bold mb-1.5'

export default function ClassesPage() {
  const { session, loading: authLoading } = useAuth()
  const { refetch: refetchClimber } = useClimber()
  const [cal, setCal] = useState<Calendar | null>(null)
  const [mine, setMine] = useState<BookingInfo[]>([])
  const [loadError, setLoadError] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [selected, setSelected] = useState<CalendarSession | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('get_class_calendar', { p_from: null, p_days: 14 })
    if (error || !data || data.error) { setLoadError(true); return }
    setLoadError(false)
    setCal(data as Calendar)
    if (session?.user) {
      const { data: b } = await db.rpc('get_my_class_bookings')
      setMine(Array.isArray(b) ? b : [])
    } else {
      setMine([])
    }
  }, [session?.user?.id])

  useEffect(() => { if (!authLoading) load() }, [authLoading, load])

  const days = useMemo(() => {
    const map = new Map<string, CalendarSession[]>()
    for (const s of cal?.sessions ?? []) {
      const k = mxDateKey(s.starts_at)
      map.set(k, [...(map.get(k) ?? []), s])
    }
    return [...map.entries()]
  }, [cal])

  const upcoming = mine.filter(b => isActiveBooking(b.status) && new Date(b.ends_at) > new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  if (loadError) {
    return (
      <div className="min-h-screen bg-fondo flex flex-col items-center justify-center p-8 text-center">
        <p className="text-texto-principal font-bold mb-2">No pudimos cargar las clases.</p>
        <button onClick={load} className="text-primario text-sm font-bold">Reintentar</button>
      </div>
    )
  }
  if (!cal) {
    return (
      <div className="min-h-screen bg-fondo flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" />
      </div>
    )
  }

  const loggedIn = !!session?.user
  const needsProfile = loggedIn && !cal.me

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <Link to="/"><img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" /></Link>
        {loggedIn
          ? <Link to="/mi-cuenta" className="text-primario text-xs font-bold hover:text-primario-hover">Mi cuenta</Link>
          : <button onClick={() => setAuthOpen(true)} className="text-primario text-xs font-bold hover:text-primario-hover">Iniciar sesión</button>}
      </header>

      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-6">
        <div>
          <h1 className="text-texto-principal font-black text-3xl tracking-tight leading-tight">Clases</h1>
          <p className="text-zinc-400 text-sm mt-1">Reserva tu lugar. Cupo limitado por clase.</p>
        </div>

        {notice && (
          <p role="status" className="bg-superficie rounded-2xl border border-exito/50 px-4 py-3 text-texto-principal text-sm">{notice}</p>
        )}

        {needsProfile && <ProfileForm onDone={() => { setNotice(null); load() }} />}

        {cal.me && (
          <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 text-sm">
            <p className="text-texto-principal font-bold">{cal.me.full_name}</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              {cal.me.membership_until
                ? <>Membresía vigente hasta el <span className="text-texto-principal font-semibold">{fmtDateKey(cal.me.membership_until)}</span></>
                : 'Sin membresía vigente'}
            </p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-zinc-300 text-xs font-bold uppercase tracking-widest">Mis reservas</h2>
            {upcoming.map(b => (
              <MyBookingCard key={b.id} booking={b} cancelHours={cal.settings.cancel_hours}
                onChanged={msg => { setNotice(msg); load() }} />
            ))}
          </section>
        )}

        <section className="space-y-5">
          {days.length === 0 && (
            <p className="text-zinc-400 text-sm text-center py-8">No hay clases programadas en los próximos días.</p>
          )}
          {days.map(([key, sessions]) => (
            <div key={key} className="space-y-2">
              <h2 className="text-zinc-300 text-xs font-bold uppercase tracking-widest">{fmtDateKey(key)}</h2>
              {sessions.map(s => (
                <SessionCard key={s.id} s={s} onOpen={() => {
                  setNotice(null)
                  if (!loggedIn) { setAuthOpen(true); return }
                  setSelected(s)
                }} />
              ))}
            </div>
          ))}
        </section>

        <p className="text-zinc-500 text-xs text-center">
          {cal.settings.rules_text ?? `Puedes cancelar sin perder tu clase hasta ${cal.settings.cancel_hours} horas antes.`}
        </p>
      </div>

      {selected && (
        <BookingSheet
          s={selected} cal={cal} needsProfile={needsProfile}
          onClose={() => setSelected(null)}
          onBooked={msg => { setSelected(null); setNotice(msg); load(); window.scrollTo(0, 0) }}
        />
      )}

      <ClimberAuthSheet
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onDone={() => { setAuthOpen(false); refetchClimber(); load() }}
      />
    </div>
  )
}

function SessionCard({ s, onOpen }: { s: CalendarSession; onOpen: () => void }) {
  const mineActive = s.my_booking && isActiveBooking(s.my_booking.status)
  const cancelled = s.status === 'cancelled'
  const full = s.spots_left <= 0
  const price = s.is_member && s.member_price_cents < s.price_cents
    ? <><span className="line-through text-zinc-500 mr-1">{formatMoney(s.price_cents)}</span>{formatMoney(s.member_price_cents)}</>
    : formatMoney(s.price_cents)

  let action: React.ReactNode
  if (cancelled) action = <span className="text-alerta text-xs font-bold">Cancelada</span>
  else if (mineActive) action = <span className="text-exito text-xs font-bold">Reservada ✓</span>
  else if (s.booking_mode === 'staff_only') action = <span className="text-zinc-400 text-xs font-semibold text-right">Agéndala con el staff</span>
  else if (full) action = <span className="text-zinc-400 text-xs font-bold">Llena</span>
  else if (!s.bookable) action = <span className="text-zinc-400 text-xs font-semibold">Aún no abre</span>
  else action = <button onClick={onOpen} className="px-4 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento text-sm font-black active:scale-95 transition-all">Reservar</button>

  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 flex items-center gap-3"
      style={{ borderLeft: `4px solid ${s.color ?? '#ff4d15'}` }}>
      <div className="flex-1 min-w-0">
        <p className="text-texto-principal font-bold">{s.name}</p>
        <p className="text-zinc-400 text-xs mt-0.5">
          {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}{s.instructor_name && ` · ${s.instructor_name}`}
        </p>
        <p className="text-zinc-300 text-xs mt-1">
          {price}
          {!cancelled && s.booking_mode === 'online' && (
            <span className="text-zinc-500"> · {full ? 'sin lugares' : `${s.spots_left} ${s.spots_left === 1 ? 'lugar' : 'lugares'}`}</span>
          )}
          {s.is_member && s.eligible_free_monthly && s.free_left > 0 && !mineActive && (
            <span className="text-exito font-semibold"> · puedes usar tu clase gratis</span>
          )}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function BookingSheet({ s, cal, needsProfile, onClose, onBooked }: {
  s: CalendarSession; cal: Calendar; needsProfile: boolean; onClose: () => void; onBooked: (msg: string) => void
}) {
  const canFree = s.is_member && s.eligible_free_monthly && s.free_left > 0
  const canGym = cal.settings.allow_pay_at_gym
  const [option, setOption] = useState<'free_monthly' | 'at_gym' | ''>(canFree ? 'free_monthly' : canGym ? 'at_gym' : '')
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const price = s.is_member ? s.member_price_cents : s.price_cents

  const submit = async () => {
    if (!option) { setError('Elige cómo vas a pagar.'); return }
    if (!accept) { setError('Acepta las reglas de la clase.'); return }
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('book_class', { p_session_id: s.id, p_option: option })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    sendClassEmails([data.booking.id], 'confirmation')
    onBooked(option === 'free_monthly'
      ? `Listo: reservaste ${s.name} con tu clase gratis del mes.`
      : `Listo: reservaste ${s.name}. Pagas ${formatMoney(price)} en el gym.`)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-fondo border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{fmtDateKey(mxDateKey(s.starts_at))}</p>
          <h2 className="text-texto-principal font-black text-2xl leading-tight">{s.name}</h2>
          <p className="text-zinc-400 text-sm">{fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}{s.instructor_name && ` · ${s.instructor_name}`}</p>
          {s.description && <p className="text-zinc-300 text-sm mt-2">{s.description}</p>}
        </div>

        {needsProfile ? (
          <p className="text-amarillo-suave text-sm font-semibold">Primero completa tus datos arriba en la página.</p>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className={labelClass}>¿Cómo la pagas?</legend>
              {s.is_member && s.eligible_free_monthly && (
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${!canFree ? 'opacity-50 cursor-not-allowed' : option === 'free_monthly' ? 'border-primario bg-primario/10' : 'border-zinc-700/50'}`}>
                  <input type="radio" name="opt" disabled={!canFree} checked={option === 'free_monthly'} onChange={() => setOption('free_monthly')} className="mt-1 accent-primario" />
                  <span className="text-sm">
                    <span className="text-texto-principal font-bold block">Usar mi clase gratis del mes</span>
                    <span className="text-zinc-400 text-xs">{canFree ? 'Te queda disponible para este mes.' : 'Ya la usaste este mes.'}</span>
                  </span>
                </label>
              )}
              {canGym && (
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${option === 'at_gym' ? 'border-primario bg-primario/10' : 'border-zinc-700/50'}`}>
                  <input type="radio" name="opt" checked={option === 'at_gym'} onChange={() => setOption('at_gym')} className="mt-1 accent-primario" />
                  <span className="text-sm">
                    <span className="text-texto-principal font-bold block">Pagar en el gym · {formatMoney(price)}{s.is_member && ' (precio miembro)'}</span>
                    <span className="text-zinc-400 text-xs">Pagas al llegar, en efectivo o con tarjeta.</span>
                  </span>
                </label>
              )}
              {!canFree && !canGym && <p className="text-zinc-400 text-sm">Por ahora esta clase se reserva con el staff.</p>}
            </fieldset>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="w-5 h-5 mt-0.5 accent-primario shrink-0" />
              <span className="text-zinc-300 text-xs leading-relaxed">
                {cal.settings.rules_text ?? `Puedes cancelar sin perder tu clase hasta ${cal.settings.cancel_hours} horas antes. Si cancelas después o no llegas, pierdes la clase.`}
              </span>
            </label>

            {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
            <button onClick={submit} disabled={busy || (!canFree && !canGym)}
              className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-base disabled:opacity-50 active:scale-95 transition-all">
              {busy ? 'Reservando...' : 'Confirmar reserva'}
            </button>
          </>
        )}
        <button onClick={onClose} className="w-full text-zinc-400 text-sm py-2">Cerrar</button>
      </div>
    </div>
  )
}

function MyBookingCard({ booking: b, cancelHours, onChanged }: { booking: BookingInfo; cancelHours: number; onChanged: (msg: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = new Date(b.starts_at) <= new Date()
  const late = new Date(b.starts_at).getTime() - Date.now() < cancelHours * 3600_000
  const what = b.price_tier === 'free_monthly' ? 'Clase gratis del mes'
    : b.payment_status === 'paid' ? `${formatMoney(b.amount_cents)} · pagado`
    : b.amount_cents > 0 ? `${formatMoney(b.amount_cents)} · pagas en el gym` : BOOKING_STATUS_LABELS[b.status]

  const cancel = async () => {
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('cancel_my_booking', { p_booking_id: b.id })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    sendClassEmails([b.id], 'cancel')
    onChanged(data.status === 'cancelled_late'
      ? `Cancelaste ${b.class_name}. Como faltaban menos de ${cancelHours} h, cuenta como falta.`
      : `Cancelaste ${b.class_name}.`)
  }

  return (
    <div className="bg-superficie rounded-2xl border border-primario/30 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-texto-principal font-bold">{b.class_name}</p>
          <p className="text-zinc-400 text-xs">{fmtDateKey(mxDateKey(b.starts_at))} · {fmtTime(b.starts_at)}</p>
          <p className="text-zinc-300 text-xs mt-0.5">{what}</p>
        </div>
        {!started && !confirming && (
          <button onClick={() => setConfirming(true)} className="shrink-0 text-zinc-400 hover:text-alerta text-xs font-bold">Cancelar</button>
        )}
      </div>
      {confirming && (
        <div className="space-y-2">
          <p className={`text-xs font-semibold ${late ? 'text-amarillo-suave' : 'text-zinc-300'}`}>
            {late
              ? `Faltan menos de ${cancelHours} horas: si cancelas, cuenta como falta${b.price_tier === 'free_monthly' ? ' y se gasta tu clase gratis' : ''}.`
              : 'Cancelas a tiempo: no pierdes nada.'}
          </p>
          <div className="flex gap-3">
            <button onClick={cancel} disabled={busy} className="text-xs font-bold px-4 py-2 rounded-xl bg-alerta text-white disabled:opacity-50">
              {busy ? '...' : 'Sí, cancelar'}
            </button>
            <button onClick={() => setConfirming(false)} className="text-zinc-400 text-xs">Volver</button>
          </div>
        </div>
      )}
      {error && <p className="text-alerta text-xs">{error}</p>}
    </div>
  )
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [birth, setBirth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (fullName.trim().length < 3) { setError('Escribe tu nombre completo.'); return }
    if (phone.replace(/\D/g, '').length !== 10) { setError('El celular debe tener 10 dígitos.'); return }
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('upsert_my_person', { p_full_name: fullName, p_phone: phone, p_birth_date: birth || null })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="bg-superficie rounded-2xl border border-primario/40 p-4 space-y-3">
      <div>
        <p className="text-texto-principal font-bold">Completa tus datos</p>
        <p className="text-zinc-400 text-xs">Solo la primera vez. Así el coach sabe quién viene.</p>
      </div>
      <div>
        <label htmlFor="cl-name" className={labelClass}>Nombre completo</label>
        <input id="cl-name" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" className={inputClass} />
      </div>
      <div>
        <label htmlFor="cl-phone" className={labelClass}>Celular</label>
        <input id="cl-phone" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="10 dígitos" autoComplete="tel" className={inputClass} />
      </div>
      <div>
        <label htmlFor="cl-birth" className={labelClass}>Fecha de nacimiento (opcional)</label>
        <input id="cl-birth" type="date" value={birth} onChange={e => setBirth(e.target.value)} min="1920-01-01" className={inputClass} />
      </div>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-sm disabled:opacity-50">
        {busy ? 'Guardando...' : 'Guardar'}
      </button>
    </form>
  )
}
