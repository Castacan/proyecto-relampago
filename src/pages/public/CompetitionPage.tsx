import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtDateOnly } from '../../lib/dates'
import {
  COMPETITION_SLUG, LAST_REGISTRATION_KEY, SHIRT_SIZES, MINOR_NOTICE, REGISTER_ERRORS, formatPrice, formatDeadline,
  type PublicCompetition, type RegistrationResult, type ShirtSize,
} from '../../lib/competition'
import CompetitionPayButton from '../../components/CompetitionPayButton'
import logoHorizontal from '../../assets/logo-horizontal.png'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const inputClass = 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-primario/60 transition-all placeholder:text-zinc-500'
const labelClass = 'block text-zinc-300 text-xs font-bold mb-1.5'

// Edad cumplida el día del evento, a partir de dos fechas "YYYY-MM-DD"
// (sin pasar por Date(): evita el corrimiento de un día por timezone).
function isMinorOn(birthDate: string, eventDate: string): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [ey, em, ed] = eventDate.split('-').map(Number)
  const age = ey - by - (em < bm || (em === bm && ed < bd) ? 1 : 0)
  return age < 18
}

export default function CompetitionPage() {
  const [comp, setComp] = useState<PublicCompetition | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [resultEmail, setResultEmail] = useState('')

  const [fullName, setFullName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [email, setEmail] = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [shirtSize, setShirtSize] = useState<ShirtSize | ''>('')
  const [acceptPrivacy, setAcceptPrivacy] = useState(false)
  const [acceptWaiver, setAcceptWaiver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadCompetition = () => {
    db.rpc('get_competition_public', { p_slug: COMPETITION_SLUG })
      .then(({ data, error }: { data: (PublicCompetition & { error?: string }) | null; error: unknown }) => {
        if (error || !data || data.error) { setLoadError(true); return }
        setComp(data)
      })
  }

  useEffect(loadCompetition, [])

  if (loadError) {
    return (
      <div className="min-h-screen bg-fondo flex flex-col items-center justify-center p-8 text-center">
        <p className="text-texto-principal font-bold mb-2">No pudimos cargar la competencia.</p>
        <p className="text-zinc-400 text-sm">Revisa tu conexión e intenta de nuevo.</p>
      </div>
    )
  }

  if (!comp) {
    return (
      <div className="min-h-screen bg-fondo flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" />
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const phoneDigits = phone.replace(/\D/g, '')
  const emailNorm = email.trim().toLowerCase()
  const isMinor = birthDate !== '' && isMinorOn(birthDate, comp.event_date)

  const validate = (): string | null => {
    if (fullName.trim().length < 3) return 'Escribe tu nombre completo.'
    if (!birthDate || birthDate < '1920-01-01' || birthDate > today) return 'Revisa tu fecha de nacimiento.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return 'Revisa tu correo.'
    if (emailNorm !== emailConfirm.trim().toLowerCase()) return 'Los dos correos no coinciden.'
    if (phoneDigits.length !== 10) return 'El celular debe tener 10 dígitos.'
    if (!categoryId) return 'Elige una categoría.'
    if (!shirtSize) return 'Elige una talla de playera.'
    if (!acceptPrivacy) return 'Debes aceptar el aviso de privacidad.'
    if (comp.waiver_text && !acceptWaiver) return 'Debes aceptar el deslinde de responsabilidad.'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem) { setFormError(problem); return }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await db.rpc('register_for_competition', {
      p_slug: COMPETITION_SLUG,
      p_full_name: fullName,
      p_birth_date: birthDate,
      p_email: emailNorm,
      p_phone: phoneDigits,
      p_category_id: categoryId,
      p_shirt_size: shirtSize,
      p_accept_privacy: acceptPrivacy,
      p_accept_waiver: acceptWaiver,
    })
    setSubmitting(false)
    if (error || !data) { setFormError('No se pudo completar la inscripción. Intenta de nuevo.'); return }
    if (data.error) {
      setFormError(REGISTER_ERRORS[data.error] ?? 'No se pudo completar la inscripción. Intenta de nuevo.')
      // El cupo o el estado pudo cambiar mientras llenaba el formulario.
      if (['closed', 'full', 'category_full'].includes(data.error)) loadCompetition()
      return
    }
    try {
      localStorage.setItem(LAST_REGISTRATION_KEY, JSON.stringify({ folio: data.folio, email: emailNorm }))
    } catch { /* almacenamiento bloqueado: el folio igual se muestra en pantalla */ }
    setResult(data as RegistrationResult)
    setResultEmail(emailNorm)
    window.scrollTo(0, 0)
  }

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        <Link to="/competencia/consulta" className="text-primario text-xs font-bold hover:text-primario-hover transition-colors">
          Consulta tu inscripción
        </Link>
      </header>

      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-6">
        {result ? (
          <RegistrationDone result={result} email={resultEmail} />
        ) : (
          <>
            <div>
              <h1 className="text-texto-principal font-black text-3xl tracking-tight leading-tight">{comp.name}</h1>
              <p className="text-zinc-300 text-sm font-semibold mt-2">
                {fmtDateOnly(comp.event_date)}
                {comp.event_time_text && ` · ${comp.event_time_text}`}
                {comp.place && ` · ${comp.place}`}
              </p>
            </div>

            <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-zinc-400 text-xs font-semibold">Inscripción</p>
                <p className="text-primario font-black text-2xl leading-tight">{formatPrice(comp.price_cents)}</p>
                {comp.includes_text && <p className="text-zinc-400 text-xs mt-1">{comp.includes_text}</p>}
              </div>
              {comp.state === 'open' && (
                <div className="text-right shrink-0">
                  <p className="text-texto-principal font-black text-2xl leading-tight">{comp.spots_left}</p>
                  <p className="text-zinc-400 text-xs font-semibold">{comp.spots_left === 1 ? 'lugar disponible' : 'lugares disponibles'}</p>
                </div>
              )}
            </div>

            {comp.state !== 'open' ? (
              <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-6 text-center">
                <p className="text-texto-principal font-bold mb-1">
                  {comp.state === 'full' ? 'Cupo lleno' : comp.state === 'not_yet' ? 'Inscripciones próximamente' : 'Inscripciones cerradas'}
                </p>
                <p className="text-zinc-400 text-sm">
                  {comp.state === 'full'
                    ? 'Ya no quedan lugares para esta competencia.'
                    : comp.state === 'not_yet' && comp.registration_opens_at
                      ? `Abren el ${formatDeadline(comp.registration_opens_at)}.`
                      : 'Por ahora no se están recibiendo inscripciones.'}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div>
                  <label htmlFor="comp-name" className={labelClass}>Nombre completo</label>
                  <input id="comp-name" type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                    maxLength={120} autoComplete="name" placeholder="Nombre y apellidos" className={inputClass} />
                </div>

                <div>
                  <label htmlFor="comp-birth" className={labelClass}>Fecha de nacimiento</label>
                  <input id="comp-birth" type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)}
                    min="1920-01-01" max={today} autoComplete="bday" className={inputClass} />
                  {isMinor && <p className="text-amarillo-suave text-xs font-semibold mt-2">{MINOR_NOTICE}</p>}
                </div>

                <div>
                  <label htmlFor="comp-email" className={labelClass}>Correo</label>
                  <input id="comp-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    autoComplete="email" inputMode="email" placeholder="tu@correo.com" className={inputClass} />
                </div>

                <div>
                  <label htmlFor="comp-email2" className={labelClass}>Confirma tu correo</label>
                  <input id="comp-email2" type="email" value={emailConfirm} onChange={e => setEmailConfirm(e.target.value)}
                    autoComplete="off" inputMode="email" placeholder="Escríbelo otra vez" className={inputClass} />
                  <p className="text-zinc-500 text-xs mt-1.5">Con tu correo y tu folio consultas tu inscripción.</p>
                </div>

                <div>
                  <label htmlFor="comp-phone" className={labelClass}>Celular</label>
                  <input id="comp-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    autoComplete="tel-national" inputMode="numeric" maxLength={14} placeholder="10 dígitos" className={inputClass} />
                </div>

                <fieldset>
                  <legend className={labelClass}>Categoría</legend>
                  <div className="space-y-2">
                    {comp.categories.map(cat => {
                      const selected = categoryId === cat.id
                      return (
                        <label key={cat.id}
                          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all ${
                            cat.is_full ? 'opacity-50 border-zinc-800/60 bg-superficie'
                              : selected ? 'border-primario bg-superficie-alta cursor-pointer'
                              : 'border-zinc-700/50 bg-superficie hover:bg-superficie-alta cursor-pointer'}`}>
                          <input type="radio" name="category" value={cat.id} checked={selected} disabled={cat.is_full}
                            onChange={() => setCategoryId(cat.id)} className="mt-1 accent-primario" />
                          <span className="min-w-0">
                            <span className="block text-texto-principal text-sm font-bold">
                              {cat.name}{cat.is_full && ' · llena'}
                            </span>
                            {cat.description && <span className="block text-zinc-400 text-xs mt-0.5">{cat.description}</span>}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className={labelClass}>Talla de playera</legend>
                  <div className="grid grid-cols-4 gap-2">
                    {SHIRT_SIZES.map(size => (
                      <label key={size}
                        className={`py-3 rounded-xl border text-center text-sm font-black cursor-pointer transition-all ${
                          shirtSize === size ? 'border-primario bg-primario text-texto-en-acento'
                            : 'border-zinc-700/50 bg-superficie text-texto-principal hover:bg-superficie-alta'}`}>
                        <input type="radio" name="shirt" value={size} checked={shirtSize === size}
                          onChange={() => setShirtSize(size)} className="sr-only" />
                        {size}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="space-y-3">
                  <ConsentBox title="Aviso de privacidad" text={comp.privacy_text}
                    label="Acepto el aviso de privacidad" checked={acceptPrivacy} onChange={setAcceptPrivacy} />
                  {comp.waiver_text && (
                    <ConsentBox title="Deslinde de responsabilidad" text={comp.waiver_text}
                      label="Acepto el deslinde de responsabilidad" checked={acceptWaiver} onChange={setAcceptWaiver} />
                  )}
                </div>

                {formError && (
                  <p role="alert" className="text-alerta text-sm font-semibold">
                    {formError}
                    {formError === REGISTER_ERRORS.duplicate && (
                      <> <Link to="/competencia/consulta" className="underline">Ir a consulta</Link></>
                    )}
                  </p>
                )}

                <button type="submit" disabled={submitting}
                  className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-base transition-all disabled:opacity-50 active:scale-95">
                  {submitting ? 'Inscribiendo...' : 'Inscribirme'}
                </button>
                <p className="text-zinc-500 text-xs text-center">
                  Al inscribirte apartamos tu lugar por {comp.hold_hours} horas mientras pagas.
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ConsentBox({ title, text, label, checked, onChange }: {
  title: string; text: string; label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="bg-superficie rounded-xl border border-zinc-800/60 p-4">
      <p className="text-zinc-300 text-xs font-bold mb-1.5">{title}</p>
      <p className="text-zinc-400 text-xs leading-relaxed whitespace-pre-line mb-3">{text}</p>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-primario shrink-0" />
        <span className="text-texto-principal text-sm font-semibold">{label}</span>
      </label>
    </div>
  )
}

function RegistrationDone({ result, email }: { result: RegistrationResult; email: string }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-texto-principal font-black text-2xl tracking-tight">Tu lugar está apartado</h1>
        <p className="text-zinc-300 text-sm mt-1">
          {result.full_name} · {result.category_name} · talla {result.shirt_size}
        </p>
      </div>

      <div className="bg-superficie rounded-2xl border border-primario/30 p-5 text-center">
        <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Tu folio</p>
        <p className="text-primario font-black font-mono text-4xl tracking-wider select-all">{result.folio}</p>
        <p className="text-zinc-400 text-xs mt-2">Guárdalo: tómale captura de pantalla.</p>
      </div>

      <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-5 space-y-3">
        <p className="text-texto-principal font-bold">Falta tu pago de {formatPrice(result.price_cents)}</p>
        <p className="text-zinc-300 text-sm">
          Tienes hasta el <span className="font-bold text-texto-principal">{formatDeadline(result.hold_expires_at)}</span> para pagar; después de esa hora tu lugar se libera.
        </p>
        {result.payment_instructions && (
          <p className="text-zinc-300 text-sm whitespace-pre-line">{result.payment_instructions}</p>
        )}
        <CompetitionPayButton folio={result.folio} email={email}
          priceCents={result.price_cents} manualLinkUrl={result.payment_link_url} />
      </div>

      {result.is_minor && (
        <p className="bg-superficie rounded-2xl border border-amarillo-suave/40 p-4 text-amarillo-suave text-sm font-semibold">{MINOR_NOTICE}</p>
      )}

      <p className="text-zinc-400 text-sm text-center">
        Revisa el estado de tu pago en{' '}
        <Link to="/competencia/consulta" className="text-primario font-bold hover:text-primario-hover">Consulta tu inscripción</Link>.
      </p>
    </div>
  )
}
