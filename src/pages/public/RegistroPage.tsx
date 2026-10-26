import { useCallback, useEffect, useState } from 'react'
import { call, erpError } from '../../lib/erp'
import { useAuth, signInWithMagicLink, verifyEmailOtp, signOut } from '../../lib/auth'
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
          <p className="text-2xl font-black text-zinc-900">Bienvenido a Jaibamuro</p>
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
      <button onClick={() => setEditing(true)} className="text-zinc-500 text-sm underline">Corregir mis datos</button>
      <button onClick={() => signOut()} className="block text-zinc-400 text-xs underline">Salir (registrar a otra persona)</button>
    </div>
  )
}

function EmailStep() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    setBusy(true); setError(null)
    const err = await signInWithMagicLink(email.trim(), window.location.href)
    setBusy(false)
    if (err) { setError('No se pudo enviar el código. Revisa tu correo.'); return }
    setSent(true)
  }
  const verify = async () => {
    setBusy(true); setError(null)
    const err = await verifyEmailOtp(email.trim(), code.trim())
    setBusy(false)
    if (err) setError('Código incorrecto o vencido. Intenta de nuevo.')
  }
  if (!sent) return (
    <div className="space-y-3">
      <p className="text-zinc-700">Escribe tu correo. Te mandamos un código para crear tu cuenta (o entrar si ya tienes una).</p>
      <label htmlFor="reg-email" className={lbl}>Correo</label>
      <input id="reg-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={field} placeholder="tucorreo@ejemplo.com" />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={send} disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} className={btn}>{busy ? 'Enviando…' : 'Mandar código'}</button>
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-zinc-700">Te mandamos un código a <b>{email}</b>. Escríbelo aquí (revisa también spam).</p>
      <label htmlFor="reg-code" className={lbl}>Código</label>
      <input id="reg-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className={`${field} text-center text-2xl tracking-[0.4em] font-mono`} maxLength={8} />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={verify} disabled={busy || code.length < 6} className={btn}>{busy ? 'Revisando…' : 'Continuar'}</button>
      <button onClick={() => { setSent(false); setCode('') }} className="text-zinc-500 text-sm underline">Cambiar correo</button>
    </div>
  )
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
