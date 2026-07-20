import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { signInWithMagicLink } from '../../lib/auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  isOpen: boolean
  onClose: () => void
  onDone: () => void
  /** Si ya hay sesión activa pero no hay registro en climbers, saltamos al paso de setup */
  startAtSetup?: boolean
}

type Step = 'email' | 'sent' | 'setup' | 'saving'

export default function ClimberAuthSheet({ isOpen, onClose, onDone, startAtSetup }: Props) {
  const { session } = useAuth()
  const [step, setStep] = useState<Step>(startAtSetup ? 'setup' : 'email')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [visible, setVisible] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Cuando la sesión se activa (magic link clickeado), avanzar a setup
  useEffect(() => {
    if (session?.user && step === 'sent') {
      setStep('setup')
    }
  }, [session?.user?.id, step])

  // Resetear estado al abrir
  useEffect(() => {
    if (isOpen) {
      setStep(startAtSetup ? 'setup' : 'email')
      setEmail('')
      setSendError(null)
      setDisplayName('')
      setVisible(true)
      setSaveError(null)
    }
  }, [isOpen, startAtSetup])

  if (!isOpen) return null

  async function handleSendLink() {
    if (!email.trim()) return
    setSending(true)
    setSendError(null)
    const error = await signInWithMagicLink(email.trim(), window.location.href)
    setSending(false)
    if (error) {
      setSendError('No se pudo enviar el link. Verifica tu correo.')
    } else {
      setStep('sent')
    }
  }

  async function handleSaveProfile() {
    if (!displayName.trim() || !session?.user) return
    setStep('saving')
    setSaveError(null)
    const { error } = await db.from('climbers').insert({
      id: session.user.id,
      email: session.user.email ?? '',
      display_name: displayName.trim(),
      visible_in_leaderboard: visible,
    })
    if (error) {
      setSaveError('Error al guardar. Intenta de nuevo.')
      setStep('setup')
      return
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-zinc-900 rounded-t-3xl px-6 pt-6 pb-12 border-t border-zinc-800/80 max-w-md mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6" />

        {step === 'email' && (
          <>
            <h2 className="text-white font-black text-xl tracking-tight mb-1">Suma tus puntos</h2>
            <p className="text-zinc-500 text-sm mb-6">Inicia sesión para registrar tus sends y aparecer en el leaderboard.</p>
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Tu correo</p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendLink() }}
              placeholder="correo@ejemplo.com"
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3.5 text-sm mb-4 outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 transition-all placeholder:text-zinc-600"
              autoComplete="email"
              inputMode="email"
            />
            {sendError && <p className="text-red-400 text-xs mb-3">{sendError}</p>}
            <button
              onClick={handleSendLink}
              disabled={sending || !email.trim()}
              className="w-full py-4 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm transition-all disabled:opacity-40 active:scale-95"
            >
              {sending ? 'Enviando...' : 'Enviar link mágico'}
            </button>
            <button onClick={onClose} className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors mt-1">
              Cancelar
            </button>
          </>
        )}

        {step === 'sent' && (
          <>
            <div className="text-center py-4">
              <div className="text-4xl mb-4">📬</div>
              <h2 className="text-white font-black text-xl tracking-tight mb-2">Revisa tu correo</h2>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Te enviamos un link a <span className="text-white font-semibold">{email}</span>.
                <br />Ábrelo en este mismo celular para continuar.
              </p>
              <p className="text-zinc-600 text-xs mt-4">El link expira en 1 hora.</p>
            </div>
            <button onClick={onClose} className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors mt-4">
              Cerrar
            </button>
          </>
        )}

        {(step === 'setup' || step === 'saving') && (
          <>
            <h2 className="text-white font-black text-xl tracking-tight mb-1">¡Ya casi!</h2>
            <p className="text-zinc-500 text-sm mb-6">Elige cómo aparecerás en el leaderboard.</p>
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Tu nombre o alias</p>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Ej: Carlos M., LaGarra, etc."
              maxLength={24}
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3.5 text-sm mb-5 outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 transition-all placeholder:text-zinc-600"
            />
            <button
              onClick={() => setVisible(v => !v)}
              className="w-full flex items-center gap-3 py-3.5 px-4 rounded-2xl bg-zinc-800 border border-zinc-700/50 mb-5 text-left transition-all hover:bg-zinc-700"
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${visible ? 'bg-yellow-400 border-yellow-400' : 'border-zinc-600'}`}>
                {visible && <span className="text-zinc-950 text-xs font-black">✓</span>}
              </div>
              <div>
                <p className="text-white text-sm font-semibold">Aparecer en la pantalla del gym</p>
                <p className="text-zinc-500 text-xs">Tu nombre se mostrará en el leaderboard público.</p>
              </div>
            </button>
            <p className="text-zinc-600 text-[10px] leading-relaxed mb-5">
              Al continuar aceptas que tus datos (nombre y actividad) se usen para el leaderboard de El Muro conforme al aviso de privacidad disponible en recepción. Puedes cambiar esta preferencia después.
            </p>
            {saveError && <p className="text-red-400 text-xs mb-3">{saveError}</p>}
            <button
              onClick={handleSaveProfile}
              disabled={step === 'saving' || !displayName.trim()}
              className="w-full py-4 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm transition-all disabled:opacity-40 active:scale-95"
            >
              {step === 'saving' ? 'Guardando...' : 'Entrar al leaderboard'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
