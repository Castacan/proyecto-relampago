import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { classError, fmtDateKey, todayKey, addDaysKey } from '../../../lib/classes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
export const smallBtn = 'text-zinc-200 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all disabled:opacity-50'
export const primaryBtn = 'text-sm font-bold px-4 py-2.5 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento disabled:opacity-50'
export const fieldLabel = 'block text-zinc-300 text-xs font-bold mb-1'

export interface Person {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  birth_date: string | null
  has_login: boolean
  source: string | null
  note: string | null
  membership_until: string | null
  membership_last_until: string | null
}

export function usePeopleSearch(query: string) {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await db.rpc('admin_search_people', { p_query: query })
      if (cancelled) return
      setPeople(data?.people ?? [])
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, tick])
  return { people, loading, refresh: () => setTick(t => t + 1) }
}

// Buscar o crear una persona (walk-in, Introductoria, etc.).
export function PersonPicker({ onPick, selected }: { onPick: (p: Person | null) => void; selected: Person | null }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const { people, loading } = usePeopleSearch(query)

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-superficie-alta border border-zinc-700/50 px-3 py-2">
        <div className="min-w-0">
          <p className="text-texto-principal text-sm font-bold truncate">{selected.full_name}</p>
          <p className="text-zinc-400 text-xs truncate">
            {[selected.phone, selected.email].filter(Boolean).join(' · ') || 'Sin contacto'}
            {selected.membership_until && ` · miembro hasta ${fmtDateKey(selected.membership_until)}`}
          </p>
        </div>
        <button onClick={() => onPick(null)} className="text-zinc-400 hover:text-texto-principal text-xs font-semibold shrink-0">Cambiar</button>
      </div>
    )
  }

  if (creating) {
    return <PersonForm onSaved={p => { setCreating(false); onPick(p) }} onCancel={() => setCreating(false)} initialName={query} />
  }

  return (
    <div className="space-y-2">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, celular o correo" className={inputClass} />
      <div className="max-h-56 overflow-y-auto space-y-1">
        {loading && <p className="text-zinc-500 text-xs">Buscando…</p>}
        {!loading && people.length === 0 && <p className="text-zinc-500 text-xs">Nadie con ese dato.</p>}
        {people.slice(0, 8).map(p => (
          <button key={p.id} onClick={() => onPick(p)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-superficie-alta border border-transparent hover:border-zinc-700/50">
            <span className="text-texto-principal text-sm font-semibold">{p.full_name}</span>
            <span className="text-zinc-500 text-xs"> · {p.phone ?? p.email ?? 'sin contacto'}{p.membership_until ? ' · miembro' : ''}</span>
          </button>
        ))}
      </div>
      <button onClick={() => setCreating(true)} className={smallBtn}>+ Persona nueva</button>
    </div>
  )
}

export function PersonForm({ person, initialName, onSaved, onCancel }: {
  person?: Person; initialName?: string; onSaved: (p: Person) => void; onCancel?: () => void
}) {
  const [form, setForm] = useState({
    full_name: person?.full_name ?? initialName ?? '', phone: person?.phone ?? '', email: person?.email ?? '',
    birth_date: person?.birth_date ?? '', source: person?.source ?? '', note: person?.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setError(null) }

  const save = async () => {
    if (form.full_name.trim().length < 3) { setError('Escribe el nombre completo.'); return }
    setBusy(true)
    const { data, error } = await db.rpc('admin_save_person', { p_person: { ...form, id: person?.id ?? null } })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    const { data: found } = await db.rpc('admin_search_people', { p_query: form.full_name })
    const saved = (found?.people as Person[] | undefined)?.find(p => p.id === data.person_id)
    onSaved(saved ?? { id: data.person_id, full_name: form.full_name, phone: form.phone || null, email: form.email || null,
      birth_date: form.birth_date || null, has_login: false, source: form.source || null, note: form.note || null,
      membership_until: null, membership_last_until: null })
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-700/50 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className={fieldLabel}>Nombre completo</label>
          <input value={form.full_name} onChange={e => set({ full_name: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Celular</label>
          <input type="tel" inputMode="numeric" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="10 dígitos" className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Correo {person?.has_login && <span className="text-zinc-500 font-normal">(de su cuenta)</span>}</label>
          <input type="email" value={form.email} disabled={person?.has_login} onChange={e => set({ email: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Fecha de nacimiento</label>
          <input type="date" value={form.birth_date} onChange={e => set({ birth_date: e.target.value })} min="1920-01-01" className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>¿De dónde llegó?</label>
          <input value={form.source} onChange={e => set({ source: e.target.value })} placeholder="Instagram, recomendación…" className={inputClass} />
        </div>
        <div>
          <label className={fieldLabel}>Nota</label>
          <input value={form.note} onChange={e => set({ note: e.target.value })} className={inputClass} />
        </div>
      </div>
      {error && <p className="text-alerta text-xs font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : person ? 'Guardar' : 'Crear persona'}</button>
        {onCancel && <button onClick={onCancel} className="text-zinc-400 text-xs">Cancelar</button>}
      </div>
    </div>
  )
}

function MembershipEditor({ person, onSaved }: { person: Person; onSaved: () => void }) {
  const [until, setUntil] = useState(person.membership_until ?? addDaysKey(todayKey(), 30))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (value: string | null) => {
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('admin_set_membership', { p_person_id: person.id, p_until: value, p_plan_name: null, p_note: null })
    setBusy(false)
    if (error || !data || data.error) { setError(classError(data?.error)); return }
    onSaved()
  }

  return (
    <div className="rounded-xl border border-zinc-700/50 p-3 space-y-2">
      <p className="text-zinc-300 text-xs font-bold">Membresía</p>
      <p className="text-zinc-400 text-xs">
        {person.membership_until
          ? <>Vigente hasta el <span className="text-texto-principal font-semibold">{fmtDateKey(person.membership_until)}</span></>
          : person.membership_last_until ? `Sin membresía vigente (la última venció el ${fmtDateKey(person.membership_last_until)})` : 'Sin membresía'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className={fieldLabel}>Vigente hasta</label>
          <input type="date" value={until} min={todayKey()} onChange={e => setUntil(e.target.value)} className={inputClass} />
        </div>
        <button onClick={() => save(until)} disabled={busy || !until} className={smallBtn}>Guardar membresía</button>
        {person.membership_until && <button onClick={() => save(null)} disabled={busy} className={smallBtn}>Quitar</button>}
      </div>
      {error && <p className="text-alerta text-xs">{error}</p>}
    </div>
  )
}

export function PeopleTab() {
  const [query, setQuery] = useState('')
  const { people, loading, refresh } = usePeopleSearch(query)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, celular o correo" className={inputClass} />
        <button onClick={() => setCreating(v => !v)} className={primaryBtn + ' shrink-0'}>{creating ? 'Cerrar' : '+ Nueva'}</button>
      </div>
      {creating && <PersonForm onSaved={() => { setCreating(false); refresh() }} onCancel={() => setCreating(false)} />}
      {loading && <p className="text-zinc-500 text-xs">Buscando…</p>}
      {!loading && people.length === 0 && <p className="text-zinc-500 text-sm">Todavía no hay personas{query && ' con ese dato'}.</p>}
      <div className="space-y-2">
        {people.map(p => (
          <div key={p.id} className="bg-superficie rounded-2xl border border-zinc-800/80 px-4 py-3">
            <button onClick={() => setOpenId(openId === p.id ? null : p.id)} className="w-full text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-texto-principal font-bold text-sm">{p.full_name}</span>
                {p.membership_until && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-exito bg-exito/10">Miembro</span>}
                {p.has_login && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-zinc-300 bg-superficie-alta">Con cuenta</span>}
              </div>
              <p className="text-zinc-400 text-xs">{[p.phone, p.email].filter(Boolean).join(' · ') || 'Sin contacto'}</p>
            </button>
            {openId === p.id && (
              <div className="mt-3 space-y-3">
                <MembershipEditor person={p} onSaved={refresh} />
                <PersonForm person={p} onSaved={() => { refresh() }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
