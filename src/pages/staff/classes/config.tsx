import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { WEEKDAYS, classError, type ClassSettings } from '../../../lib/classes'
import { inputClass, smallBtn, primaryBtn, fieldLabel } from './people'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export interface ClassType {
  id: string
  name: string
  description: string | null
  level: string | null
  default_capacity: number
  default_duration_min: number
  price_cents: number
  member_price_cents: number | null
  eligible_free_monthly: boolean
  booking_mode: 'online' | 'staff_only'
  instructor_name: string | null
  color: string | null
  is_active: boolean
  sort_order: number
}

export interface Schedule {
  id: string
  class_type_id: string
  weekday: number
  start_time: string
  duration_min: number | null
  capacity: number | null
  instructor_name: string | null
  starts_on: string
  ends_on: string | null
  is_active: boolean
}

export interface ClassAdmin {
  is_admin: boolean
  settings: ClassSettings
  types: ClassType[]
  schedules: Schedule[]
}

export function useClassAdmin() {
  const [data, setData] = useState<ClassAdmin | null>(null)
  const [error, setError] = useState(false)
  const load = async () => {
    const { data, error } = await db.rpc('get_class_admin')
    if (error || !data || data.error) { setError(true); return }
    setError(false)
    setData(data as ClassAdmin)
  }
  useEffect(() => { load() }, [])
  return { data, error, reload: load }
}

const pesos = (cents: number | null) => (cents == null ? '' : String(cents / 100))
const toCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100))

function SettingsForm({ settings, onSaved }: { settings: ClassSettings; onSaved: () => void }) {
  const [f, setF] = useState({
    book_ahead_days: String(settings.book_ahead_days), cancel_hours: String(settings.cancel_hours),
    free_classes_per_month: String(settings.free_classes_per_month), overbook_tolerance: String(settings.overbook_tolerance),
    allow_pay_at_gym: settings.allow_pay_at_gym, rules_text: settings.rules_text ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await db.rpc('admin_update_class_settings', { p_patch: {
      book_ahead_days: Number(f.book_ahead_days), cancel_hours: Number(f.cancel_hours),
      free_classes_per_month: Number(f.free_classes_per_month), overbook_tolerance: Number(f.overbook_tolerance),
      allow_pay_at_gym: f.allow_pay_at_gym, rules_text: f.rules_text,
    } })
    setBusy(false)
    if (error || !data || data.error) { setMsg(classError(data?.error)); return }
    setMsg('Guardado.')
    onSaved()
  }
  const num = (k: keyof typeof f, label: string, help: string) => (
    <div>
      <label className={fieldLabel}>{label}</label>
      <input type="number" min={0} value={f[k] as string} onChange={e => setF({ ...f, [k]: e.target.value })} className={inputClass} />
      <p className="text-zinc-500 text-[11px] mt-0.5">{help}</p>
    </div>
  )
  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3">
      <p className="text-texto-principal font-bold text-sm">Reglas generales</p>
      <div className="grid grid-cols-2 gap-3">
        {num('book_ahead_days', 'Reservar con anticipación (días)', 'Hasta cuántos días antes se abre la reserva.')}
        {num('cancel_hours', 'Cancelar sin perder (horas)', 'Antes de esto, cancelar es gratis.')}
        {num('free_classes_per_month', 'Clases gratis al mes (miembros)', 'No se acumulan.')}
        {num('overbook_tolerance', 'Sobrecupo permitido al staff', 'Lugares extra que el staff puede meter.')}
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input type="checkbox" checked={f.allow_pay_at_gym} onChange={e => setF({ ...f, allow_pay_at_gym: e.target.checked })} className="accent-primario w-4 h-4" />
        Permitir reservar en línea para pagar en el gym
      </label>
      <div>
        <label className={fieldLabel}>Texto de reglas (lo ve el cliente al reservar)</label>
        <textarea value={f.rules_text} onChange={e => setF({ ...f, rules_text: e.target.value })} rows={3} className={inputClass} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : 'Guardar reglas'}</button>
        {msg && <span className="text-zinc-300 text-xs">{msg}</span>}
      </div>
    </div>
  )
}

function TypeForm({ t, onSaved, onCancel }: { t?: ClassType; onSaved: () => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    name: t?.name ?? '', description: t?.description ?? '', level: t?.level ?? '',
    instructor_name: t?.instructor_name ?? '', default_capacity: String(t?.default_capacity ?? 6),
    default_duration_min: String(t?.default_duration_min ?? 60), price: pesos(t?.price_cents ?? 30000),
    member_price: pesos(t?.member_price_cents ?? null), eligible_free_monthly: t?.eligible_free_monthly ?? false,
    booking_mode: t?.booking_mode ?? 'online', color: t?.color ?? '#ff4d15', is_active: t?.is_active ?? true,
    sort_order: String(t?.sort_order ?? 0),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => { setF(x => ({ ...x, ...patch })); setError(null) }

  const save = async () => {
    const price = toCents(f.price)
    if (price == null || Number.isNaN(price)) { setError('Escribe el precio.'); return }
    setBusy(true)
    const { data, error } = await db.rpc('admin_save_class_type', { p_type: {
      id: t?.id ?? null, name: f.name, description: f.description, level: f.level, instructor_name: f.instructor_name,
      default_capacity: Number(f.default_capacity), default_duration_min: Number(f.default_duration_min),
      price_cents: price, member_price_cents: toCents(f.member_price) ?? '', eligible_free_monthly: f.eligible_free_monthly,
      booking_mode: f.booking_mode, color: f.color, is_active: f.is_active, sort_order: Number(f.sort_order),
    } })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={fieldLabel}>Nombre</label><input value={f.name} onChange={e => set({ name: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Profe</label><input value={f.instructor_name} onChange={e => set({ instructor_name: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Precio normal (MXN)</label><input type="number" min={0} value={f.price} onChange={e => set({ price: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Precio miembro (MXN, vacío = igual)</label><input type="number" min={0} value={f.member_price} onChange={e => set({ member_price: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Cupo</label><input type="number" min={1} value={f.default_capacity} onChange={e => set({ default_capacity: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Duración (min)</label><input type="number" min={10} value={f.default_duration_min} onChange={e => set({ default_duration_min: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Nivel (opcional)</label><input value={f.level} onChange={e => set({ level: e.target.value })} className={inputClass} /></div>
        <div className="flex gap-3">
          <div className="flex-1"><label className={fieldLabel}>Color</label><input type="color" value={f.color} onChange={e => set({ color: e.target.value })} className="w-full h-10 rounded-xl bg-superficie-alta border border-zinc-700/50" /></div>
          <div className="w-20"><label className={fieldLabel}>Orden</label><input type="number" value={f.sort_order} onChange={e => set({ sort_order: e.target.value })} className={inputClass} /></div>
        </div>
      </div>
      <div><label className={fieldLabel}>Descripción (la ve el cliente)</label><textarea value={f.description} onChange={e => set({ description: e.target.value })} rows={2} className={inputClass} /></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-200">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.eligible_free_monthly} onChange={e => set({ eligible_free_monthly: e.target.checked })} className="accent-primario w-4 h-4" />Entra en la clase gratis del mes</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.booking_mode === 'staff_only'} onChange={e => set({ booking_mode: e.target.checked ? 'staff_only' : 'online' })} className="accent-primario w-4 h-4" />Solo la agenda el staff</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} className="accent-primario w-4 h-4" />Activa</label>
      </div>
      {error && <p className="text-alerta text-xs font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : t ? 'Guardar clase' : 'Crear clase'}</button>
        {onCancel && <button onClick={onCancel} className="text-zinc-400 text-xs">Cancelar</button>}
      </div>
    </div>
  )
}

function ScheduleRow({ s, type, onSaved }: { s?: Schedule; type: ClassType; onSaved: () => void }) {
  const [f, setF] = useState({
    weekday: String(s?.weekday ?? 1), start_time: (s?.start_time ?? '17:00').slice(0, 5),
    capacity: s?.capacity == null ? '' : String(s.capacity), duration_min: s?.duration_min == null ? '' : String(s.duration_min),
    instructor_name: s?.instructor_name ?? '', is_active: s?.is_active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => { setF(x => ({ ...x, ...patch })); setError(null) }

  const save = async () => {
    setBusy(true)
    const { data, error } = await db.rpc('admin_save_schedule', { p_schedule: {
      id: s?.id ?? null, class_type_id: type.id, weekday: Number(f.weekday), start_time: f.start_time,
      capacity: f.capacity, duration_min: f.duration_min, instructor_name: f.instructor_name, is_active: f.is_active,
      starts_on: s?.starts_on ?? null, ends_on: s?.ends_on ?? null,
    } })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    onSaved()
  }

  return (
    <div className="rounded-xl border border-zinc-700/50 p-3 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div>
          <label className={fieldLabel}>Día</label>
          <select value={f.weekday} onChange={e => set({ weekday: e.target.value })} className={inputClass}>
            {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div><label className={fieldLabel}>Hora</label><input type="time" value={f.start_time} onChange={e => set({ start_time: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Cupo</label><input type="number" min={1} value={f.capacity} placeholder={String(type.default_capacity)} onChange={e => set({ capacity: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Duración</label><input type="number" min={10} value={f.duration_min} placeholder={String(type.default_duration_min)} onChange={e => set({ duration_min: e.target.value })} className={inputClass} /></div>
        <div><label className={fieldLabel}>Profe</label><input value={f.instructor_name} placeholder={type.instructor_name ?? ''} onChange={e => set({ instructor_name: e.target.value })} className={inputClass} /></div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-zinc-200"><input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} className="accent-primario w-4 h-4" />Activo</label>
        <button onClick={save} disabled={busy} className={smallBtn}>{busy ? '…' : s ? 'Guardar horario' : 'Agregar horario'}</button>
        {error && <span className="text-alerta text-xs">{error}</span>}
      </div>
    </div>
  )
}

function OneOffSession({ types }: { types: ClassType[] }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [when, setWhen] = useState('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const create = async () => {
    if (!typeId || !when) { setMsg('Elige clase, fecha y hora.'); return }
    setBusy(true); setMsg(null)
    // datetime-local está en hora local del navegador; el gym y el staff están en México.
    const { data, error } = await db.rpc('admin_create_session', {
      p_class_type_id: typeId, p_starts_at: new Date(when).toISOString(),
      p_duration_min: null, p_capacity: capacity ? Number(capacity) : null, p_instructor_name: null,
    })
    setBusy(false)
    if (error || !data || data.error) { setMsg(classError(data?.error)); return }
    setMsg('Sesión creada. Aparece en "Hoy" en su fecha.')
    setWhen(''); setCapacity('')
  }
  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3">
      <div>
        <p className="text-texto-principal font-bold text-sm">Sesión suelta</p>
        <p className="text-zinc-400 text-xs">Una clase fuera de horario (por ejemplo una Introductoria cuando alguien la pide).</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select value={typeId} onChange={e => setTypeId(e.target.value)} className={inputClass}>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={inputClass} />
        <input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Cupo (opcional)" className={inputClass} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={create} disabled={busy} className={smallBtn}>{busy ? '…' : 'Crear sesión'}</button>
        {msg && <span className="text-zinc-300 text-xs">{msg}</span>}
      </div>
    </div>
  )
}

export function ConfigTab({ admin, reload }: { admin: ClassAdmin; reload: () => void }) {
  const [openType, setOpenType] = useState<string | null>(null)
  const [newType, setNewType] = useState(false)

  if (!admin.is_admin) return <p className="text-zinc-400 text-sm">Solo un admin puede cambiar la configuración de clases.</p>

  return (
    <div className="space-y-4">
      <SettingsForm settings={admin.settings} onSaved={reload} />

      <div className="flex items-center justify-between">
        <p className="text-texto-principal font-bold text-sm">Clases y horarios</p>
        <button onClick={() => setNewType(v => !v)} className={smallBtn}>{newType ? 'Cerrar' : '+ Nueva clase'}</button>
      </div>
      {newType && (
        <div className="bg-superficie rounded-2xl border border-primario/40 p-4">
          <TypeForm onSaved={() => { setNewType(false); reload() }} onCancel={() => setNewType(false)} />
        </div>
      )}

      {admin.types.map(t => {
        const schedules = admin.schedules.filter(s => s.class_type_id === t.id)
        return (
          <div key={t.id} className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3" style={{ borderLeft: `4px solid ${t.color ?? '#ff4d15'}` }}>
            <button onClick={() => setOpenType(openType === t.id ? null : t.id)} className="w-full text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-texto-principal font-bold">{t.name}</span>
                {!t.is_active && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-zinc-300 bg-superficie-alta">Inactiva</span>}
                {t.booking_mode === 'staff_only' && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-amarillo-suave bg-amarillo-suave/10">Solo staff</span>}
              </div>
              <p className="text-zinc-400 text-xs">
                ${t.price_cents / 100}{t.member_price_cents != null && ` · miembro $${t.member_price_cents / 100}`}
                {t.eligible_free_monthly && ' · entra en la gratis'} · cupo {t.default_capacity} · {t.default_duration_min} min
                {t.instructor_name && ` · ${t.instructor_name}`}
              </p>
              <p className="text-zinc-500 text-xs">
                {schedules.filter(s => s.is_active).map(s => `${WEEKDAYS[s.weekday]} ${s.start_time.slice(0, 5)}`).join(', ') || 'Sin horario fijo'}
              </p>
            </button>
            {openType === t.id && (
              <div className="space-y-3">
                <TypeForm t={t} onSaved={reload} />
                <p className="text-zinc-300 text-xs font-bold pt-2">Horarios semanales</p>
                <p className="text-zinc-500 text-[11px]">Si cambias un horario, las clases futuras sin reservas se ajustan solas; las que ya tienen gente se quedan como estaban.</p>
                {schedules.map(s => <ScheduleRow key={s.id} s={s} type={t} onSaved={reload} />)}
                <ScheduleRow key={`new-${schedules.length}`} type={t} onSaved={reload} />
              </div>
            )}
          </div>
        )
      })}

      <OneOffSession types={admin.types.filter(t => t.is_active)} />
    </div>
  )
}
