import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { markPendingOnboarding, clearPendingOnboarding } from '../../lib/pendingOnboarding'
import ClientPasswordAuth from '../auth/ClientPasswordAuth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  isOpen: boolean
  onClose: () => void
  onDone: () => void
  startAtSetup?: boolean
  // 'classes': para reservar una clase. Otro texto y sin el paso del alias del
  // leaderboard (un alumno de calistenia no tiene por qué salir en la TV).
  purpose?: 'climbing' | 'classes'
}

type Step = 'auth' | 'setup' | 'saving'

// Entrar con correo y contraseña (o crear la cuenta con un código; ver
// ClientPasswordAuth). Para escalar, después pide el alias del leaderboard.
export default function ClimberAuthSheet({ isOpen, onClose, onDone, startAtSetup, purpose = 'climbing' }: Props) {
  const forClasses = purpose === 'classes'
  const { session } = useAuth()
  const [step, setStep] = useState<Step>(startAtSetup ? 'setup' : 'auth')
  const [displayName, setDisplayName] = useState('')
  const [visible, setVisible] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Resetear estado al abrir
  useEffect(() => {
    if (isOpen) {
      setStep(startAtSetup ? 'setup' : 'auth')
      setDisplayName('')
      setVisible(true)
      setSaveError(null)
    }
  }, [isOpen, startAtSetup])

  // Bloquear scroll del body mientras el sheet está abierto. En mobile,
  // enfocar un input dentro de un overlay "fixed" puede hacer que el
  // navegador desplace el body detrás; se restaura y se fuerza scroll a 0
  // al cerrar, por si ya hubo drift.
  useEffect(() => {
    if (!isOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
      window.scrollTo(0, 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Ya entró: para clases terminamos; para escalar, alias si todavía no tiene perfil.
  async function afterAuth() {
    if (forClasses) { onDone(); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await db.from('climbers').select('id').eq('id', user.id).maybeSingle()
    if (data) { clearPendingOnboarding(); onDone() } else setStep('setup')
  }

  async function handleSaveProfile() {
    if (!displayName.trim() || !session?.user) return
    setStep('saving')
    setSaveError(null)
    const { error } = await db.from('climbers').upsert({
      id: session.user.id,
      email: session.user.email ?? '',
      display_name: displayName.trim(),
      visible_in_leaderboard: visible,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      // 23505 = unique_violation en climbers_display_name_unique_idx (ver
      // schema.sql, 2026-09-10) — alguien más ya tiene ese alias.
      setSaveError(
        error.code === '23505'
          ? 'Ese nombre ya lo está usando alguien más. Prueba con otro.'
          : 'Error al guardar. Intenta de nuevo.'
      )
      setStep('setup')
      return
    }
    clearPendingOnboarding()
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-superficie rounded-t-3xl px-6 pt-6 pb-12 border-t border-zinc-800/80 max-w-md mx-auto max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6" />

        {step === 'auth' && (
          <>
            <h2 className="text-texto-principal font-black text-xl tracking-tight mb-1">{forClasses ? 'Aparta tu lugar' : 'Suma tus puntos'}</h2>
            <ClientPasswordAuth
              theme="dark"
              intro={forClasses
                ? 'Entra con tu correo y contraseña. ¿Primera vez? Crea tu cuenta en un minuto.'
                : 'Entra para registrar tus sends y aparecer en el leaderboard.'}
              onAuthed={afterAuth}
              onCodeSent={() => { if (!forClasses) markPendingOnboarding() }}
              onCancel={onClose}
            />
          </>
        )}

        {(step === 'setup' || step === 'saving') && (
          <>
            <h2 className="text-texto-principal font-black text-xl tracking-tight mb-1">¡Ya casi!</h2>
            <p className="text-zinc-500 text-sm mb-6">Elige cómo aparecerás en el leaderboard.</p>
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Tu nombre o alias</p>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Ej: Carlos M., LaGarra, etc."
              maxLength={24}
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3.5 text-sm mb-5 outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all placeholder:text-zinc-600"
            />
            <button
              onClick={() => setVisible(v => !v)}
              className="w-full flex items-center gap-3 py-3.5 px-4 rounded-2xl bg-superficie-alta border border-zinc-700/50 mb-5 text-left transition-all hover:bg-superficie-alta-hover"
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${visible ? 'bg-primario border-primario' : 'border-zinc-600'}`}>
                {visible && <span className="text-texto-en-acento text-xs font-black">✓</span>}
              </div>
              <div>
                <p className="text-texto-principal text-sm font-semibold">Aparecer en la pantalla del gym</p>
                <p className="text-zinc-500 text-xs">Tu nombre se mostrará en el leaderboard público.</p>
              </div>
            </button>
            <p className="text-zinc-600 text-[10px] leading-relaxed mb-5">
              Al continuar aceptas que tus datos (nombre y actividad) se usen para el leaderboard de Jaibamuro conforme al aviso de privacidad disponible en recepción. Puedes cambiar esta preferencia después.
            </p>
            {saveError && <p className="text-red-400 text-xs mb-3">{saveError}</p>}
            <button
              onClick={handleSaveProfile}
              disabled={step === 'saving' || !displayName.trim()}
              className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm transition-all disabled:opacity-40 active:scale-95"
            >
              {step === 'saving' ? 'Guardando...' : 'Entrar al leaderboard'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
