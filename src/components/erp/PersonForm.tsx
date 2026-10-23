import { useState } from 'react'
import { call, erpError } from '../../lib/erp'
import { input, label, btnPrimary, Msg } from './ui'

export interface PersonData {
  id?: string
  full_name: string
  phone: string | null
  email: string | null
  birth_date: string | null
  gender?: string | null
  source: string | null
  note: string | null
  emergency_name?: string | null
  emergency_phone?: string | null
  guardian_name?: string | null
  guardian_phone?: string | null
  allow_marketing?: boolean
  has_login?: boolean
}

// Formulario de datos de una persona (crear o editar). El correo de quien ya
// tiene cuenta no se cambia aquí (es su login).
export default function PersonForm({ person, onSaved, onCancel }: { person?: PersonData; onSaved: (id: string) => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    full_name: person?.full_name ?? '', phone: person?.phone ?? '', email: person?.email ?? '', birth_date: person?.birth_date ?? '',
    gender: person?.gender ?? '', source: person?.source ?? '', note: person?.note ?? '',
    emergency_name: person?.emergency_name ?? '', emergency_phone: person?.emergency_phone ?? '',
    guardian_name: person?.guardian_name ?? '', guardian_phone: person?.guardian_phone ?? '',
    allow_marketing: person?.allow_marketing ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<typeof f>) => { setF(x => ({ ...x, ...p })); setError(null) }
  const isMinor = f.birth_date && new Date(f.birth_date) > new Date(new Date().setFullYear(new Date().getFullYear() - 18))

  const save = async () => {
    if (f.full_name.trim().length < 3) { setError('Escribe el nombre completo.'); return }
    setBusy(true)
    const { data, error } = await call<{ person_id: string }>('admin_save_person', { p_person: { ...f, id: person?.id ?? null } })
    setBusy(false)
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    onSaved(data.person_id)
  }

  const field = (k: keyof typeof f, l: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`pf-${k}`} className={label}>{l}</label>
      <input id={`pf-${k}`} value={f[k] as string} onChange={e => set({ [k]: e.target.value } as Partial<typeof f>)} className={input} {...props} />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('full_name', 'Nombre completo *', { autoComplete: 'off' })}
        {field('phone', 'Celular', { type: 'tel', inputMode: 'numeric', placeholder: '10 dígitos' })}
        <div>
          <label htmlFor="pf-email" className={label}>Correo {person?.has_login && <span className="text-zinc-500 font-normal">(de su cuenta)</span>}</label>
          <input id="pf-email" type="email" value={f.email} disabled={person?.has_login} onChange={e => set({ email: e.target.value })} className={input} />
        </div>
        {field('birth_date', 'Fecha de nacimiento', { type: 'date', min: '1920-01-01' })}
        <div>
          <label htmlFor="pf-gender" className={label}>Género</label>
          <select id="pf-gender" value={f.gender} onChange={e => set({ gender: e.target.value })} className={input}>
            <option value="">Sin especificar</option>
            <option value="F">Femenino</option>
            <option value="M">Masculino</option>
            <option value="X">Otro</option>
          </select>
        </div>
        {field('source', '¿Cómo nos conoció?', { placeholder: 'Instagram, recomendación, pasaba por aquí…' })}
      </div>

      <div>
        <p className="text-zinc-300 text-xs font-bold mb-2">Contacto de emergencia</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('emergency_name', 'Nombre')}
          {field('emergency_phone', 'Teléfono', { type: 'tel', inputMode: 'numeric' })}
        </div>
      </div>

      {isMinor && (
        <div className="rounded-xl border border-amarillo-suave/40 p-3">
          <p className="text-amarillo-suave text-xs font-bold mb-2">Es menor de edad: datos del padre, madre o tutor</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('guardian_name', 'Nombre del tutor')}
            {field('guardian_phone', 'Teléfono del tutor', { type: 'tel', inputMode: 'numeric' })}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="pf-note" className={label}>Nota</label>
        <textarea id="pf-note" value={f.note} onChange={e => set({ note: e.target.value })} rows={2} className={input} placeholder="Lesiones, objetivos, lo que convenga recordar…" />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input type="checkbox" checked={f.allow_marketing} onChange={e => set({ allow_marketing: e.target.checked })} className="accent-primario w-4 h-4" />
        Acepta recibir promociones e invitaciones
      </label>
      <Msg text={error} />
      <div className="flex gap-3 items-center">
        <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : person?.id ? 'Guardar cambios' : 'Crear persona'}</button>
        {onCancel && <button onClick={onCancel} className="text-zinc-400 text-sm">Cancelar</button>}
      </div>
    </div>
  )
}
