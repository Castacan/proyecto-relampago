import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { signInWithMagicLink, verifyEmailOtp } from '../../lib/auth'
import { setPasswordPending } from '../../lib/passwordPending'

// Entrada de clientes con correo y contraseña.
// · Entrar: correo + contraseña.
// · Primera vez / olvidé mi contraseña: le mandamos un código al correo, lo
//   escribe y después crea su contraseña (SetPasswordPrompt). Así no depende
//   de la plantilla de "confirmar cuenta" de Supabase y sirve igual para los
//   clientes que ya existían (entraban solo con código).

type Step = 'login' | 'email' | 'code'
type Intent = 'create' | 'reset'

export const authTheme = {
  dark: {
    field: 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3.5 text-base outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 placeholder:text-zinc-600',
    label: 'block text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2',
    text: 'text-zinc-400 text-sm',
    strong: 'text-texto-principal',
    btn: 'w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm disabled:opacity-40 active:scale-95 transition-all',
    link: 'text-zinc-400 hover:text-texto-principal text-sm underline',
    error: 'text-red-400 text-sm',
  },
  light: {
    field: 'w-full rounded-xl px-3 py-3 text-base bg-white border border-zinc-300 text-zinc-900 focus:outline-none focus:border-primario',
    label: 'block text-zinc-700 text-sm font-bold mb-1',
    text: 'text-zinc-700 text-sm',
    strong: 'text-zinc-900',
    btn: 'w-full py-3.5 rounded-xl bg-primario text-texto-en-acento font-bold text-base disabled:opacity-50',
    link: 'text-zinc-500 text-sm underline',
    error: 'text-red-600 text-sm',
  },
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

interface Props {
  theme?: 'dark' | 'light'
  /** Texto arriba del formulario de entrar. */
  intro?: string
  /** Ya hay sesión (con contraseña o con código). */
  onAuthed: () => void
  onCancel?: () => void
  /** Se mandó un código (por si abre el link del correo en otra pestaña). */
  onCodeSent?: () => void
}

export default function ClientPasswordAuth({ theme = 'dark', intro, onAuthed, onCancel, onCodeSent }: Props) {
  const t = authTheme[theme]
  const [step, setStep] = useState<Step>('login')
  const [intent, setIntent] = useState<Intent>('create')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const okEmail = EMAIL_RE.test(email.trim())

  const login = async () => {
    if (!okEmail || !password) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(/invalid login/i.test(error.message)
        ? 'Correo o contraseña incorrectos. Si es tu primera vez, o antes entrabas con un código, toca "Crear mi cuenta".'
        : 'No se pudo entrar. Revisa tu conexión e intenta de nuevo.')
      return
    }
    setPasswordPending(false)
    onAuthed()
  }

  const goCode = (i: Intent) => { setIntent(i); setError(null); setCode(''); setStep('email') }

  const sendCode = async () => {
    if (!okEmail) return
    setBusy(true); setError(null)
    const err = await signInWithMagicLink(email.trim(), window.location.href)
    setBusy(false)
    if (err) {
      setError(/rate|seconds|too many/i.test(err.message)
        ? 'Ya te mandamos un código hace poco. Espera un minuto y vuelve a intentar.'
        : 'No se pudo mandar el código. Revisa tu correo.')
      return
    }
    // Si abre el link del correo en vez de escribir el código, igual le pedimos la contraseña.
    setPasswordPending(true)
    onCodeSent?.()
    setStep('code')
  }

  const verify = async () => {
    if (code.length < 6) return
    setBusy(true); setError(null)
    const err = await verifyEmailOtp(email.trim(), code.trim())
    setBusy(false)
    if (err) { setError('Código incorrecto o vencido. Intenta de nuevo o pide otro.'); return }
    setPasswordPending(true)   // SetPasswordPrompt le pide crear su contraseña
    onAuthed()
  }

  if (step === 'login') return (
    <div className="space-y-3">
      {intro && <p className={t.text}>{intro}</p>}
      <div>
        <label htmlFor="cpa-email" className={t.label}>Correo</label>
        <input id="cpa-email" type="email" inputMode="email" autoComplete="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(null) }} className={t.field} placeholder="tucorreo@ejemplo.com" />
      </div>
      <div>
        <label htmlFor="cpa-pass" className={t.label}>Contraseña</label>
        <div className="relative">
          <input id="cpa-pass" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') login() }}
            className={`${t.field} pr-20`} />
          <button type="button" onClick={() => setShow(v => !v)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${t.link} no-underline text-xs font-bold`}>
            {show ? 'Ocultar' : 'Ver'}
          </button>
        </div>
      </div>
      {error && <p className={t.error}>{error}</p>}
      <button onClick={login} disabled={busy || !okEmail || !password} className={t.btn}>{busy ? 'Entrando…' : 'Entrar'}</button>
      <div className="flex flex-col items-center gap-2 pt-1">
        <button onClick={() => goCode('create')} className={`${t.link} font-bold`}>¿Primera vez? Crear mi cuenta</button>
        <button onClick={() => goCode('reset')} className={t.link}>Olvidé mi contraseña</button>
        {onCancel && <button onClick={onCancel} className={t.link}>Cancelar</button>}
      </div>
    </div>
  )

  if (step === 'email') return (
    <div className="space-y-3">
      <p className={`${t.strong} font-black text-lg`}>{intent === 'create' ? 'Crear mi cuenta' : 'Nueva contraseña'}</p>
      <p className={t.text}>
        {intent === 'create'
          ? 'Escribe tu correo. Te mandamos un código de verificación y luego creas tu contraseña. Si ya venías al muro, usa el mismo correo que diste en recepción.'
          : 'Escribe tu correo. Te mandamos un código y después eliges una contraseña nueva.'}
      </p>
      <div>
        <label htmlFor="cpa-email2" className={t.label}>Correo</label>
        <input id="cpa-email2" type="email" inputMode="email" autoComplete="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') sendCode() }}
          className={t.field} placeholder="tucorreo@ejemplo.com" />
      </div>
      {error && <p className={t.error}>{error}</p>}
      <button onClick={sendCode} disabled={busy || !okEmail} className={t.btn}>{busy ? 'Enviando…' : 'Mandar código'}</button>
      <div className="text-center"><button onClick={() => { setStep('login'); setError(null) }} className={t.link}>Ya tengo contraseña: entrar</button></div>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className={t.text}>Te mandamos un código a <b className={t.strong}>{email.trim()}</b>. Escríbelo aquí (si no llega, revisa spam).</p>
      <div>
        <label htmlFor="cpa-code" className={t.label}>Código</label>
        <input id="cpa-code" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={8}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 8)); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') verify() }}
          className={`${t.field} text-center text-2xl tracking-[0.35em] font-mono`} placeholder="000000" />
      </div>
      {error && <p className={t.error}>{error}</p>}
      <button onClick={verify} disabled={busy || code.length < 6} className={t.btn}>{busy ? 'Revisando…' : 'Continuar'}</button>
      <div className="flex justify-center gap-4">
        <button onClick={sendCode} disabled={busy} className={t.link}>Mandar otro código</button>
        <button onClick={() => { setStep('email'); setCode(''); setError(null) }} className={t.link}>Cambiar correo</button>
      </div>
    </div>
  )
}
