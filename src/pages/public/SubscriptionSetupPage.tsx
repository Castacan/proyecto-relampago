import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { call, billing, money, fmtDate, scheduleLabel } from '../../lib/erp'
import logoHorizontal from '../../assets/logo-horizontal.png'

// Página del link de domiciliación: la persona registra su tarjeta. El número
// de tarjeta NUNCA pasa por nuestro servidor: se convierte en un token con la
// librería del proveedor (Openpay.js o Stripe.js) directo en el navegador.

interface Setup {
  status: string; provider: 'openpay' | 'stripe'; first_name: string; product_name: string
  price_cents: number; promo_cycles: number; promo_price_cents: number | null
  start_on: string; next_charge_on: string; cycles_paid: number; next_amount_cents: number
  card_brand: string | null; card_last4: string | null; today: string
  openpay: { merchant_id: string; public_key: string; sandbox: boolean } | null
  stripe: { publishable_key: string } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { OpenPay?: any; Stripe?: any; jQuery?: unknown } }

// Una sola carga por script; quien llegue después espera a la misma promesa
// (si no, una segunda llamada vería la etiqueta puesta pero sin cargar).
const scriptLoads = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  const existing = scriptLoads.get(src)
  if (existing) return existing
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = false
    s.onload = () => resolve()
    s.onerror = () => { scriptLoads.delete(src); reject(new Error('No cargó ' + src)) }
    document.head.appendChild(s)
  })
  scriptLoads.set(src, p)
  return p
}

const inputCls = 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-primario/60 placeholder:text-zinc-500'
const labelCls = 'block text-zinc-300 text-xs font-bold mb-1.5'

export default function SubscriptionSetupPage() {
  const { token = '' } = useParams()
  const [s, setS] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ last4: string; charge: string | null } | null>(null)

  useEffect(() => {
    call<Setup>('get_subscription_setup', { p_token: token }).then(({ data, error }) => {
      if (error || !data) { setError(error === 'invalid_link' ? 'Este link ya no es válido. Pide uno nuevo en el gym.' : 'No pudimos cargar la información.'); return }
      setS(data)
    })
  }, [token])

  const isUpdate = s && (s.status === 'active' || s.status === 'past_due')
  const chargesToday = s && s.next_charge_on <= s.today

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-center px-5 py-4 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
      </header>
      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-5">
        {error && <p className="text-alerta font-semibold text-center py-10">{error}</p>}
        {!s && !error && <div className="flex justify-center py-16"><div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" /></div>}
        {s && done && (
          <div className="bg-superficie rounded-2xl border border-exito/50 p-6 text-center space-y-2">
            <p className="text-exito font-black text-2xl">¡Listo!</p>
            <p className="text-texto-principal">Tu tarjeta •••• {done.last4} quedó registrada.</p>
            {done.charge === 'paid' && <p className="text-zinc-300 text-sm">Ya cobramos tu primer mes. Te mandamos el recibo por correo.</p>}
            {done.charge === 'failed' && <p className="text-alerta text-sm font-semibold">El banco rechazó el cobro. Intenta con otra tarjeta o avísanos en el gym.</p>}
            {(done.charge === 'unknown' || done.charge === 'needs_action') && <p className="text-amarillo-suave text-sm">El cobro está en revisión con el banco; te avisamos por correo.</p>}
            {!done.charge && <p className="text-zinc-300 text-sm">El primer cobro será el {fmtDate(s.next_charge_on)}.</p>}
          </div>
        )}
        {s && !done && (
          <>
            <div>
              <h1 className="text-texto-principal font-black text-2xl leading-tight">
                {isUpdate ? `${s.first_name}, actualiza tu tarjeta` : `${s.first_name}, activa tu ${s.product_name}`}
              </h1>
              <p className="text-zinc-400 text-sm mt-1">Cobro automático cada mes a tu tarjeta.</p>
            </div>
            <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">Plan</span><span className="text-texto-principal font-semibold">{s.product_name}</span></div>
              <div className="flex justify-between gap-4"><span className="text-zinc-400">Precio</span><span className="text-texto-principal font-semibold text-right">{scheduleLabel(s.price_cents, s.promo_cycles || null, s.promo_price_cents)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{chargesToday ? 'Se cobra hoy' : 'Primer cobro'}</span>
                <span className="text-primario font-black">{chargesToday ? money(s.next_amount_cents) : `${fmtDate(s.next_charge_on)} · ${money(s.next_amount_cents)}`}</span></div>
              {s.card_last4 && <div className="flex justify-between"><span className="text-zinc-400">Tarjeta actual</span><span className="text-texto-principal">{s.card_brand} •••• {s.card_last4}</span></div>}
            </div>
            {s.provider === 'openpay' ? <OpenpayForm s={s} token={token} onDone={setDone} /> : <StripeForm s={s} token={token} onDone={setDone} />}
            <p className="text-zinc-500 text-xs text-center">Tus datos de tarjeta se procesan directamente con {s.provider === 'openpay' ? 'Openpay (BBVA)' : 'Stripe'}; Jaibamuro no los ve ni los guarda. Puedes cancelar cuando quieras avisando en el gym.</p>
          </>
        )}
      </div>
    </div>
  )
}

function Consent({ checked, onChange, s }: { checked: boolean; onChange: (v: boolean) => void; s: Setup }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 mt-0.5 accent-primario shrink-0" />
      <span className="text-zinc-300 text-xs leading-relaxed">
        Autorizo a Jaibamuro a cobrar a esta tarjeta {scheduleLabel(s.price_cents, s.promo_cycles || null, s.promo_price_cents)} de forma automática cada mes, hasta que cancele.
      </span>
    </label>
  )
}

function OpenpayForm({ s, token, onDone }: { s: Setup; token: string; onDone: (d: { last4: string; charge: string | null }) => void }) {
  const [f, setF] = useState({ name: '', number: '', month: '', year: '', cvv: '' })
  const [accept, setAccept] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const device = useRef<string>('')

  useEffect(() => {
    (async () => {
      try {
        await loadScript('https://code.jquery.com/jquery-3.7.1.min.js')
        await loadScript('https://js.openpay.mx/openpay.v1.min.js')
        await loadScript('https://js.openpay.mx/openpay-data.v1.min.js')
        const op = window.OpenPay
        op.setId(s.openpay!.merchant_id); op.setApiKey(s.openpay!.public_key); op.setSandboxMode(!!s.openpay!.sandbox)
        device.current = op.deviceData.setup()
        setReady(true)
      } catch { setError('No se pudo cargar el formulario de pago. Recarga la página.') }
    })()
  }, [s])

  const submit = async () => {
    setError(null)
    if (!accept) { setError('Acepta la autorización de cobro.'); return }
    const number = f.number.replace(/\D/g, '')
    if (number.length < 15 || !f.name.trim() || !f.month || !f.year || f.cvv.length < 3) { setError('Revisa los datos de la tarjeta.'); return }
    setBusy(true)
    window.OpenPay.token.create(
      { card_number: number, holder_name: f.name.trim(), expiration_month: f.month.padStart(2, '0'), expiration_year: f.year.slice(-2), cvv2: f.cvv },
      async (res: { data: { id: string } }) => {
        const { data, error } = await billing<{ card: { last4: string }; charge: { result: string } | null; message?: string }>({
          action: 'attach_card', token, openpay_token_id: res.data.id, device_session_id: device.current,
        })
        setBusy(false)
        if (error || !data) { setError(data?.message ?? 'No se pudo registrar la tarjeta. Intenta de nuevo.'); return }
        onDone({ last4: data.card.last4, charge: data.charge?.result ?? null })
      },
      (err: { data?: { description?: string } }) => { setBusy(false); setError(err?.data?.description ? `La tarjeta no es válida: ${err.data.description}` : 'La tarjeta no es válida.') },
    )
  }

  return (
    <div className="bg-superficie rounded-2xl border border-primario/40 p-4 space-y-3">
      <div><label className={labelCls}>Nombre como aparece en la tarjeta</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="cc-name" className={inputCls} /></div>
      <div><label className={labelCls}>Número de tarjeta</label><input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" className={inputCls} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className={labelCls}>Mes</label><input value={f.month} onChange={e => setF({ ...f, month: e.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" placeholder="MM" autoComplete="cc-exp-month" className={inputCls} /></div>
        <div><label className={labelCls}>Año</label><input value={f.year} onChange={e => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="AA" autoComplete="cc-exp-year" className={inputCls} /></div>
        <div><label className={labelCls}>CVV</label><input value={f.cvv} onChange={e => setF({ ...f, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" type="password" autoComplete="cc-csc" className={inputCls} /></div>
      </div>
      <Consent checked={accept} onChange={setAccept} s={s} />
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button onClick={submit} disabled={!ready || busy} className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black disabled:opacity-50">
        {busy ? 'Procesando…' : !ready ? 'Cargando…' : 'Registrar tarjeta'}
      </button>
      {s.openpay?.sandbox && <p className="text-amarillo-suave text-xs text-center">Modo pruebas: usa la tarjeta 4111 1111 1111 1111.</p>}
    </div>
  )
}

function StripeForm({ s, token, onDone }: { s: Setup; token: string; onDone: (d: { last4: string; charge: string | null }) => void }) {
  const [name, setName] = useState('')
  const [accept, setAccept] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refs = useRef<{ stripe: any; card: any; secret: string; siId: string } | null>(null)
  const mount = useRef<HTMLDivElement>(null)

  useEffect(() => {
    (async () => {
      try {
        await loadScript('https://js.stripe.com/v3/')
        const { data, error } = await billing<{ client_secret: string; setup_intent_id: string }>({ action: 'stripe_setup_intent', token })
        if (error || !data) { setError('No se pudo preparar el formulario de pago.'); return }
        const stripe = window.Stripe(s.stripe!.publishable_key)
        const card = stripe.elements({ locale: 'es' }).create('card', { hidePostalCode: true, style: { base: { color: '#f4f4f3', fontSize: '16px', '::placeholder': { color: '#7a8a90' } } } })
        card.mount(mount.current)
        refs.current = { stripe, card, secret: data.client_secret, siId: data.setup_intent_id }
        setReady(true)
      } catch { setError('No se pudo cargar el formulario de pago. Recarga la página.') }
    })()
  }, [s, token])

  const submit = async () => {
    setError(null)
    if (!accept) { setError('Acepta la autorización de cobro.'); return }
    if (!refs.current) return
    setBusy(true)
    const r = await refs.current.stripe.confirmCardSetup(refs.current.secret, { payment_method: { card: refs.current.card, billing_details: { name: name || undefined } } })
    if (r.error) { setBusy(false); setError(r.error.message ?? 'La tarjeta no es válida.'); return }
    const { data, error } = await billing<{ card: { last4: string }; charge: { result: string } | null; message?: string }>({ action: 'attach_card', token, setup_intent_id: r.setupIntent.id })
    setBusy(false)
    if (error || !data) { setError(data?.message ?? 'No se pudo registrar la tarjeta.'); return }
    onDone({ last4: data.card.last4, charge: data.charge?.result ?? null })
  }

  return (
    <div className="bg-superficie rounded-2xl border border-primario/40 p-4 space-y-3">
      <div><label className={labelCls}>Nombre en la tarjeta</label><input value={name} onChange={e => setName(e.target.value)} autoComplete="cc-name" className={inputCls} /></div>
      <div><label className={labelCls}>Tarjeta</label><div ref={mount} className={`${inputCls} py-3.5`} /></div>
      <Consent checked={accept} onChange={setAccept} s={s} />
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button onClick={submit} disabled={!ready || busy} className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black disabled:opacity-50">
        {busy ? 'Procesando…' : !ready ? 'Cargando…' : 'Registrar tarjeta'}
      </button>
    </div>
  )
}
