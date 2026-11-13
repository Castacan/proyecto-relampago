import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { usePasswordPending, setPasswordPending } from '../../lib/passwordPending'

// Ventana para crear (o cambiar) la contraseña del cliente. Sale sola cuando
// entró con un código (primera vez / olvidé mi contraseña) o cuando toca
// "Crear o cambiar mi contraseña". Montada una vez en App.

const MIN = 8

export default function SetPasswordPrompt() {
  const { session } = useAuth()
  const pending = usePasswordPending()
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!session?.user || (!pending && !saved)) return null
  const close = () => { setPasswordPending(false); setSaved(false); setPass(''); setPass2(''); setError(null) }

  const save = async () => {
    if (pass.length < MIN) { setError(`Usa al menos ${MIN} caracteres.`); return }
    if (pass !== pass2) { setError('Las dos contraseñas no son iguales.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password: pass })
    setBusy(false)
    // Si es la misma contraseña que ya tenía, también está bien.
    if (error && !/different from the old/i.test(error.message)) {
      setError(/weak|pwned|characters/i.test(error.message)
        ? 'Esa contraseña es muy fácil de adivinar. Prueba con otra más larga.'
        : 'No se pudo guardar. Intenta de nuevo.')
      return
    }
    setPasswordPending(false)
    setSaved(true)
  }

  const field = 'w-full rounded-xl px-3 py-3 text-base bg-white border border-zinc-300 text-zinc-900 focus:outline-none focus:border-primario'
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-3 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="spp-title">
        {saved ? (
          <>
            <p className="text-3xl">✅</p>
            <p id="spp-title" className="text-xl font-black text-zinc-900">Contraseña guardada</p>
            <p className="text-zinc-700 text-sm">La próxima vez entra con tu correo <b>{session.user.email}</b> y esta contraseña.</p>
            <button onClick={close} className="w-full py-3.5 rounded-xl bg-primario text-texto-en-acento font-bold">Listo</button>
          </>
        ) : (
          <>
            <p id="spp-title" className="text-xl font-black text-zinc-900">Crea tu contraseña</p>
            <p className="text-zinc-700 text-sm">Para entrar la próxima vez con <b>{session.user.email}</b> sin esperar un código.</p>
            <div>
              <label htmlFor="spp-1" className="block text-zinc-700 text-sm font-bold mb-1">Contraseña (mínimo {MIN} caracteres)</label>
              <input id="spp-1" type={show ? 'text' : 'password'} autoComplete="new-password" value={pass}
                onChange={e => { setPass(e.target.value); setError(null) }} className={field} />
            </div>
            <div>
              <label htmlFor="spp-2" className="block text-zinc-700 text-sm font-bold mb-1">Escríbela otra vez</label>
              <input id="spp-2" type={show ? 'text' : 'password'} autoComplete="new-password" value={pass2}
                onChange={e => { setPass2(e.target.value); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') save() }} className={field} />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Ver contraseña
            </label>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={save} disabled={busy || !pass || !pass2} className="w-full py-3.5 rounded-xl bg-primario text-texto-en-acento font-bold disabled:opacity-50">
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
            <button onClick={close} className="w-full text-zinc-500 text-sm underline">Ahora no (puedo entrar con un código)</button>
          </>
        )}
      </div>
    </div>
  )
}
