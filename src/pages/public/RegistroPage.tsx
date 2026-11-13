import { useCallback, useEffect, useState } from 'react'
import { call, erpError } from '../../lib/erp'
import { useAuth, signOut } from '../../lib/auth'
import ClientPasswordAuth from '../../components/auth/ClientPasswordAuth'
import { setPasswordPending } from '../../lib/passwordPending'
import SignFlow from '../../components/erp/SignFlow'

// /registro: el cliente nuevo escanea el QR de recepción y desde su celular
// crea su cuenta, llena sus datos y firma responsiva, reglamento y aviso de
// privacidad. Al final se le pide pasar a recepción para su foto.

interface Reg {
  email: string | null
  is_staff?: boolean
  person: {
    id: string; full_name: string; phone: string | null; birth_date: string | null; gender: string | null
    emergency_name: string | null; emergency_phone: string | null; guardian_name: string | null; guardian_phone: string | null
    allow_marketing: boolean; is_minor: boolean; has_face: boolean
  } | null
  documents: { id: string; doc_key: string; title: string; body: string; required: boolean; signed_at: string | null }[]
}

const ERRORS: Record<string, string> = {
  invalid_name: 'Escribe tu nombre completo.',
  invalid_phone: 'Tu celular debe tener 10 dígitos.',
  birth_date_required: 'Escribe tu fecha de nacimiento.',
  invalid_birth_date: 'Revisa tu fecha de nacimiento.',
  emergency_required: 'Escribe un contacto de emergencia con celular de 10 dígitos.',
  guardian_required: 'Como eres menor de edad, escribe el nombre y celular de tu mamá, papá o tutor.',
}

const field = 'w-full rounded-xl px-3 py-3 text-base bg-white border border-zinc-300 text-zinc-900 focus:outline-none focus:border-primario'
const lbl = 'block text-zinc-700 text-sm font-bold mb-1'
const btn = 'w-full py-3.5 rounded-xl bg-primario text-texto-en-acento font-bold text-base disabled:opacity-50'

export default function RegistroPage() {
  const { session, loading } = useAuth()
  const user = session?.user
  const [reg, setReg] = useState<Reg | null>(null)
  const [editing, setEditing] = useState(false)
  const load = useCallback(async () => { const { data } = await call<Reg>('get_my_registration'); setReg(data) }, [])
  useEffect(() => { if (user) load(); else setReg(null) }, [user, load])

  const wrap = (children: React.ReactNode, step?: number) => (
    <div className="min-h-screen bg-zinc-100 px-4 py-6">
      <div className="max-w-md mx-auto space-y-4">
        <div className="text-center">
          <p className="text-2xl font-black text-zinc-900">Te damos la bienvenida a Jaibamuro</p>
          {step && <p className="text-zinc-500 text-sm">Paso {step} de 3</p>}
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">{children}</div>
      </div>
    </div>
  )

  if (loading) return wrap(<p className="text-zinc-500">Cargando…</p>)
  if (!user) return wrap(<EmailStep />, 1)
  if (!reg) return wrap(<p className="text-zinc-500">Cargando…</p>)
  if (reg.is_staff) return wrap(
    <div className="space-y-3 text-zinc-700">
      <p className="font-bold text-zinc-900">Esta compu tiene abierta la sesión del staff ({reg.email}).</p>
      <p>El registro es para hacerlo desde el celular del cliente. Para registrarlo aquí, entra al panel → Personas → + Nueva persona, y en su ficha → Documentos que firme en la pantalla.</p>
      <a href="/staff/acceso" className="block text-center py-3 rounded-xl bg-primario text-texto-en-acento font-bold">Ir a Acceso</a>
    </div>)
  if (!reg.person || editing) return wrap(<DataStep reg={reg} onSaved={() => { setEditing(false); load() }} />, 2)

  const pending = reg.documents.filter(d => d.required && !d.signed_at)
  if (pending.length > 0) return wrap(
    <SignFlow light docs={pending} defaultName={reg.person.full_name} isMinor={reg.person.is_minor} defaultGuardian={reg.person.guardian_name}
      onSign={async p => { const { error } = await call('sign_my_document', { p }); return error }}
      onDone={load} />, 3)

  return wrap(
    <div className="space-y-3 text-zinc-800">
      <p className="text-3xl">✅</p>
      <p className="text-xl font-black text-zinc-900">¡Listo, {reg.person.full_name.split(' ')[0]}!</p>
      {reg.person.has_face
        ? <p>Tu registro está completo. Ya te reconocemos en recepción.</p>
        : <p className="text-lg"><b>Pasa a recepción</b> para tomarte tu foto de registro. La próxima vez solo te asomas a la cámara y listo.</p>}
      <div className="border-t border-zinc-200 pt-3 space-y-1 text-sm text-zinc-500">
        {reg.documents.filter(d => d.signed_at).map(d => <p key={d.id}>✓ {d.title}</p>)}
      </div>
      {!reg.person.is_minor && <Dependents guardianName={reg.person.full_name} />}
      <a href="/clases" className="block text-center py-3 rounded-xl bg-primario text-texto-en-acento font-bold">Ver y reservar clases</a>
      <button onClick={() => setEditing(true)} className="text-zinc-500 text-sm underline">Corregir mis datos</button>
      <button onClick={() => setPasswordPending(true)} className="block text-zinc-500 text-sm underline">Crear o cambiar mi contraseña</button>
      <button onClick={() => signOut()} className="block text-zinc-400 text-xs underline">Salir (registrar a otra persona)</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Menores a mi cargo (erp_menores.sql): el tutor registra a sus hijos y firma por ellos.
// ---------------------------------------------------------------------------

interface Dependent {
  id: string; full_name: string; birth_date: string | null; gender: string | null; shoe_size: string | null
  is_minor: boolean; has_face: boolean
  documents: { id: string; doc_key: string; title: string; body: string; required: boolean; signed_at: string | null }[]
}

const DEP_ERRORS: Record<string, string> = {
  invalid_name: 'Escribe el nombre completo del menor.',
  birth_date_required: 'Escribe la fecha de nacimiento del menor.',
  invalid_birth_date: 'Revisa la fecha de nacimiento.',
  not_a_minor: 'Solo puedes registrar aquí a menores de 18 años. Un adulto se registra con su propio correo.',
  guardian_must_be_adult: 'Para registrar a un menor, el tutor debe ser mayor de edad.',
  too_many: 'Ya registraste a muchos menores. Pide ayuda en recepción.',
  profile_required: 'Primero completa tus datos (con tu celular).',
}

function Dependents({ guardianName }: { guardianName: string }) {
  const [list, setList] = useState<Dependent[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [signing, setSigning] = useState<Dependent | null>(null)
  // Si erp_menores.sql aún no se corrió en la base, ocultamos la sección en vez de mostrar errores.
  const [unavailable, setUnavailable] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await call<{ dependents: Dependent[] }>('get_my_dependents')
    if (error) { setUnavailable(true); return }
    setList(data?.dependents ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  if (unavailable) return null

  if (signing) {
    const pending = signing.documents.filter(d => d.required && !d.signed_at)
    return (
      <div className="border-t border-zinc-200 pt-3 space-y-3">
        <p className="font-black text-zinc-900">Firma por {signing.full_name.split(' ')[0]}</p>
        <p className="text-sm text-zinc-600">Como tutor, lees y firmas los documentos a nombre de tu menor. Tu nombre queda como tutor.</p>
        <SignFlow light docs={pending} defaultName={signing.full_name} isMinor defaultGuardian={guardianName}
          onSign={async p => { const { error } = await call('sign_dependent_document', { p_person_id: signing.id, p }); return error }}
          onDone={() => { setSigning(null); load() }} />
        <button onClick={() => setSigning(null)} className="text-zinc-500 text-sm underline">Volver</button>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-200 pt-3 space-y-2">
      <p className="font-bold text-zinc-900">Menores a mi cargo</p>
      {list === null ? <p className="text-zinc-500 text-sm">Cargando…</p> : list.length === 0 && !adding ? (
        <p className="text-sm text-zinc-600">¿Vienes con tu hijo o hija? Regístralo aquí y firma su responsiva. No necesita correo.</p>
      ) : list.map(dep => {
        const pending = dep.documents.filter(d => d.required && !d.signed_at)
        return (
          <div key={dep.id} className="rounded-xl border border-zinc-200 p-3 text-sm">
            <p className="font-bold text-zinc-900">{dep.full_name}</p>
            {pending.length > 0 ? (
              <button onClick={() => setSigning(dep)} className="mt-2 w-full py-2.5 rounded-xl bg-primario text-texto-en-acento font-bold">Firmar su responsiva ({pending.length})</button>
            ) : (
              <p className="text-zinc-600">✓ Documentos firmados.{dep.has_face ? ' Ya lo reconocemos en recepción.' : ' Pasen a recepción para su foto.'}</p>
            )}
          </div>
        )
      })}
      {adding
        ? <DependentForm onSaved={async id => {
            setAdding(false)
            const { data } = await call<{ dependents: Dependent[] }>('get_my_dependents')
            const deps = data?.dependents ?? []
            setList(deps)
            const dep = deps.find(x => x.id === id)
            if (dep && dep.documents.some(d => d.required && !d.signed_at)) setSigning(dep)
          }} onCancel={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="w-full py-3 rounded-xl border-2 border-primario text-primario font-bold">+ Registrar a un menor</button>}
    </div>
  )
}

function DependentForm({ onSaved, onCancel }: { onSaved: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ full_name: '', birth_date: '', gender: '', shoe_size: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setErr(null)
    const { data, error } = await call<{ person_id: string }>('save_my_dependent', { p: f })
    setBusy(false)
    if (error || !data) { setErr(DEP_ERRORS[error ?? ''] ?? erpError(error ?? undefined)); return }
    onSaved(data.person_id)
  }
  return (
    <div className="space-y-3 rounded-xl bg-zinc-50 p-3">
      <div><label className={lbl}>Nombre completo del menor</label><input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} className={field} autoComplete="off" /></div>
      <div><label className={lbl}>Fecha de nacimiento</label><input type="date" value={f.birth_date} onChange={e => setF({ ...f, birth_date: e.target.value })} className={field} /></div>
      <div><label className={lbl}>Género (opcional)</label>
        <select value={f.gender} onChange={e => setF({ ...f, gender: e.target.value })} className={field}>
          <option value="">Prefiero no decir</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option>
        </select></div>
      <div><label className={lbl}>Talla de gatas (opcional)</label><input value={f.shoe_size} onChange={e => setF({ ...f, shoe_size: e.target.value })} className={field} placeholder="Ej. 22 MX" /></div>
      {err && <p className="text-red-600 text-sm font-semibold">{err}</p>}
      <button onClick={save} disabled={busy} className={btn}>{busy ? 'Guardando…' : 'Guardar y firmar su responsiva'}</button>
      <button onClick={onCancel} className="w-full text-zinc-500 text-sm underline">Cancelar</button>
    </div>
  )
}

function EmailStep() {
  // Al entrar (con contraseña o código) useAuth trae la sesión y la página pasa al paso 2.
  return <ClientPasswordAuth theme="light"
    intro="Entra con tu correo y contraseña. ¿Es tu primera vez? Toca «Crear mi cuenta»: te mandamos un código y eliges tu contraseña."
    onAuthed={() => {}} />
}

function DataStep({ reg, onSaved }: { reg: Reg; onSaved: () => void }) {
  const p = reg.person
  const [f, setF] = useState({
    full_name: p?.full_name ?? '', phone: p?.phone ?? '', birth_date: p?.birth_date ?? '', gender: p?.gender ?? '',
    emergency_name: p?.emergency_name ?? '', emergency_phone: p?.emergency_phone ?? '',
    guardian_name: p?.guardian_name ?? '', guardian_phone: p?.guardian_phone ?? '', allow_marketing: p?.allow_marketing ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }
  const minor = !!f.birth_date && new Date(f.birth_date) > new Date(new Date().setFullYear(new Date().getFullYear() - 18))
  const save = async () => {
    setBusy(true)
    const { error } = await call('save_my_registration', { p: f })
    setBusy(false)
    if (error) { setError(ERRORS[error] ?? erpError(error)); return }
    onSaved()
  }
  const txt = (k: keyof typeof f, l: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`reg-${k}`} className={lbl}>{l}</label>
      <input id={`reg-${k}`} value={f[k] as string} onChange={e => set({ [k]: e.target.value } as Partial<typeof f>)} className={field} {...props} />
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-zinc-500 text-sm">Cuenta: {reg.email}</p>
      {txt('full_name', 'Nombre completo', { autoComplete: 'name' })}
      {txt('phone', 'Celular (10 dígitos)', { type: 'tel', inputMode: 'numeric', autoComplete: 'tel' })}
      {txt('birth_date', 'Fecha de nacimiento', { type: 'date' })}
      <div>
        <label htmlFor="reg-gender" className={lbl}>Género (opcional)</label>
        <select id="reg-gender" value={f.gender} onChange={e => set({ gender: e.target.value })} className={field}>
          <option value="">Prefiero no decir</option><option value="f">Mujer</option><option value="m">Hombre</option><option value="x">Otro</option>
        </select>
      </div>
      <p className="text-zinc-900 font-bold pt-2">Contacto de emergencia</p>
      {txt('emergency_name', 'Nombre')}
      {txt('emergency_phone', 'Celular', { type: 'tel', inputMode: 'numeric' })}
      {minor && (
        <>
          <p className="text-zinc-900 font-bold pt-2">Mamá, papá o tutor (eres menor de edad)</p>
          {txt('guardian_name', 'Nombre del tutor')}
          {txt('guardian_phone', 'Celular del tutor', { type: 'tel', inputMode: 'numeric' })}
          <p className="text-zinc-500 text-xs">Tu tutor tiene que firmar contigo en el siguiente paso.</p>
        </>
      )}
      <label className="flex items-center gap-2 text-sm text-zinc-700 pt-1">
        <input type="checkbox" checked={f.allow_marketing} onChange={e => set({ allow_marketing: e.target.checked })} />
        Quiero recibir avisos de eventos y promociones
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={save} disabled={busy} className={btn}>{busy ? 'Guardando…' : 'Siguiente'}</button>
    </div>
  )
}
