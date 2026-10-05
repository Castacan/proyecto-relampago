import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtDateOnly } from '../../lib/dates'
import {
  COMPETITION_SLUG, LAST_REGISTRATION_KEY, MINOR_NOTICE, isUnlimitedCapacity, formatPrice, formatDeadline, refreshOnlinePayment, type RegistrationLookup,
} from '../../lib/competition'
import CompetitionPayButton from '../../components/CompetitionPayButton'
import logoHorizontal from '../../assets/logo-horizontal.png'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const inputClass = 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-primario/60 transition-all placeholder:text-zinc-500'
const labelClass = 'block text-zinc-300 text-xs font-bold mb-1.5'

export default function CompetitionLookupPage() {
  const [folio, setFolio] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reg, setReg] = useState<RegistrationLookup | null>(null)

  // Con cupo sin límite no se habla de reserva ni de fecha límite.
  const [unlimited, setUnlimited] = useState(false)
  useEffect(() => {
    db.rpc('get_competition_public', { p_slug: COMPETITION_SLUG })
      .then(({ data }: { data: { spots_left?: number } | null }) => {
        if (typeof data?.spots_left === 'number') setUnlimited(isUnlimitedCapacity(data.spots_left))
      })
  }, [])

  // ?pago=ok|error: la persona viene de regreso de la página de Clip.
  const [searchParams] = useSearchParams()
  const returnedFrom = searchParams.get('pago')
  const [confirming, setConfirming] = useState(false)
  const cancelled = useRef(false)
  useEffect(() => {
    // Se rearma al montar: en desarrollo StrictMode monta, desmonta y vuelve
    // a montar, y sin esto el ref se quedaba en true para siempre.
    cancelled.current = false
    return () => { cancelled.current = true }
  }, [])

  const fetchStatus = async (f: string, e: string): Promise<RegistrationLookup | 'not_found' | 'error'> => {
    const { data, error } = await db.rpc('get_registration_status', { p_folio: f, p_email: e })
    if (error || !data) return 'error'
    if (data.error) return 'not_found'
    return data as RegistrationLookup
  }

  const lookup = async (f: string, e: string) => {
    setLoading(true)
    setError(null)
    let result = await fetchStatus(f, e)
    setLoading(false)
    if (result === 'error') { setError('No se pudo consultar. Intenta de nuevo.'); return }
    if (result === 'not_found') { setReg(null); setError('No encontramos una inscripción con ese folio y correo. Revisa que estén bien escritos.'); return }
    setReg(result)

    // Sigue pendiente: se le pide al servidor que revise con Clip (por si
    // el aviso automático no llegó). Si viene de pagar, se insiste unos
    // segundos porque la confirmación puede tardar un momento.
    if (result.status !== 'pending_payment') return
    const attempts = returnedFrom === 'ok' ? 8 : 1
    setConfirming(returnedFrom === 'ok')
    for (let i = 0; i < attempts && !cancelled.current; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000))
      await refreshOnlinePayment(f, e)
      result = await fetchStatus(f, e)
      if (cancelled.current || typeof result === 'string') break
      setReg(result)
      if (result.status !== 'pending_payment') break
    }
    setConfirming(false)
  }

  // Precarga el último folio creado en este dispositivo.
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_REGISTRATION_KEY) ?? 'null')
      if (last?.folio && last?.email) {
        setFolio(last.folio)
        setEmail(last.email)
        lookup(last.folio, last.email)
      }
    } catch { /* sin datos guardados */ }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!folio.trim() || !email.trim()) { setError('Escribe tu folio y tu correo.'); return }
    lookup(folio, email)
  }

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        <Link to="/competencia" className="text-primario text-xs font-bold hover:text-primario-hover transition-colors">
          ← Competencia
        </Link>
      </header>

      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-6">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight">Consulta tu inscripción</h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="lookup-folio" className={labelClass}>Folio</label>
            <input id="lookup-folio" type="text" value={folio} onChange={e => setFolio(e.target.value.toUpperCase())}
              autoCapitalize="characters" autoComplete="off" placeholder="JM-XXXXX" className={`${inputClass} font-mono`} />
          </div>
          <div>
            <label htmlFor="lookup-email" className={labelClass}>Correo con el que te inscribiste</label>
            <input id="lookup-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" inputMode="email" placeholder="tu@correo.com" className={inputClass} />
          </div>
          {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-sm transition-all disabled:opacity-50 active:scale-95">
            {loading ? 'Consultando...' : 'Consultar'}
          </button>
        </form>

        {confirming && (
          <p role="status" className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 text-texto-principal text-sm font-semibold flex items-center gap-3">
            <span className="w-4 h-4 rounded-full border-2 border-primario border-t-transparent animate-spin shrink-0" />
            Estamos confirmando tu pago...
          </p>
        )}
        {returnedFrom === 'error' && reg?.status === 'pending_payment' && (
          <p role="alert" className="bg-superficie rounded-2xl border border-alerta/60 p-4 text-texto-principal text-sm font-semibold">
            El pago no se completó. No se te cobró; puedes intentarlo de nuevo.
          </p>
        )}
        {reg && <RegistrationCard reg={reg} email={email} unlimited={unlimited} />}
      </div>
    </div>
  )
}

function RegistrationCard({ reg, email, unlimited }: { reg: RegistrationLookup; email: string; unlimited: boolean }) {
  const unpaid = reg.status === 'pending_payment'

  const headline =
    reg.status === 'paid' ? { text: 'Pago confirmado. Tu lugar está asegurado.', color: 'text-exito' }
    : reg.status === 'needs_attention' ? { text: 'Recibimos tu pago. Estamos revisando tu inscripción y te contactaremos.', color: 'text-amarillo-suave' }
    : reg.status === 'cancelled' ? { text: 'Esta inscripción fue cancelada.', color: 'text-zinc-300' }
    : reg.status === 'refunded' ? { text: 'Esta inscripción fue reembolsada.', color: 'text-zinc-300' }
    : reg.status === 'expired' ? { text: 'Esta inscripción venció sin pago.', color: 'text-zinc-300' }
    : unlimited ? { text: 'Pendiente de pago.', color: 'text-amarillo-suave' }
    : reg.hold_expired ? { text: 'Tu reserva venció y tu lugar ya no está apartado.', color: 'text-amarillo-suave' }
    : { text: 'Pendiente de pago. Tu lugar está apartado.', color: 'text-amarillo-suave' }

  return (
    <div className="space-y-4">
      <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-5 space-y-3">
        <p className={`font-bold ${headline.color}`}>{headline.text}</p>
        <dl className="text-sm space-y-1.5">
          <Row label="Folio" value={<span className="font-mono font-bold">{reg.folio}</span>} />
          <Row label="Nombre" value={reg.full_name} />
          <Row label="Categoría" value={reg.category_name} />
          <Row label="Talla" value={reg.shirt_size} />
          <Row label="Competencia" value={`${reg.competition_name} · ${fmtDateOnly(reg.event_date)}${reg.event_time_text ? ` · ${reg.event_time_text}` : ''}`} />
          {reg.place && <Row label="Lugar" value={reg.place} />}
        </dl>
      </div>

      {unpaid && (
        <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-5 space-y-3">
          {unlimited ? (
            <p className="text-zinc-300 text-sm">
              Tu inscripción queda confirmada en cuanto se aprueba tu pago de {formatPrice(reg.price_cents)}. Si ya pagaste, lo confirmaremos en cuanto lo verifiquemos.
            </p>
          ) : reg.hold_expired ? (
            <p className="text-zinc-300 text-sm">
              Si ya pagaste, tu pago no se pierde: lo confirmaremos en cuanto lo verifiquemos. Si aún no pagas, todavía puedes hacerlo, pero el lugar depende de que quede cupo.
            </p>
          ) : reg.hold_expires_at && (
            <p className="text-zinc-300 text-sm">
              Paga {formatPrice(reg.price_cents)} antes del <span className="font-bold text-texto-principal">{formatDeadline(reg.hold_expires_at)}</span> para conservar tu lugar. Si ya pagaste, lo confirmaremos en cuanto lo verifiquemos.
            </p>
          )}
          {reg.payment_instructions && <p className="text-zinc-300 text-sm whitespace-pre-line">{reg.payment_instructions}</p>}
          <CompetitionPayButton folio={reg.folio} email={email}
            priceCents={reg.price_cents} manualLinkUrl={reg.payment_link_url} />
        </div>
      )}

      {reg.is_minor && ['pending_payment', 'paid', 'needs_attention'].includes(reg.status) && (
        <p className="bg-superficie rounded-2xl border border-amarillo-suave/40 p-4 text-amarillo-suave text-sm font-semibold">{MINOR_NOTICE}</p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-zinc-400 w-24 shrink-0">{label}</dt>
      <dd className="text-texto-principal min-w-0 break-words">{value}</dd>
    </div>
  )
}
