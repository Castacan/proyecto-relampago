import { useState } from 'react'
import { formatPrice, startOnlinePayment } from '../lib/competition'

interface Props {
  folio: string
  email: string
  priceCents: number
  // Link manual configurado por staff. Si existe se usa tal cual; si no,
  // se le pide a Clip un link propio de esta inscripción.
  manualLinkUrl: string | null
}

const buttonClass = 'block w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-base text-center transition-all active:scale-95 disabled:opacity-50'

export default function CompetitionPayButton({ folio, email, priceCents, manualLinkUrl }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (manualLinkUrl) {
    return (
      <a href={manualLinkUrl} target="_blank" rel="noopener noreferrer" className={buttonClass}>
        Pagar {formatPrice(priceCents)}
      </a>
    )
  }

  const pay = async () => {
    setLoading(true)
    setError(null)
    const result = await startOnlinePayment(folio, email)
    if ('url' in result) {
      window.location.href = result.url
      return // se queda en "cargando" mientras el navegador cambia de página
    }
    setLoading(false)
    setError(result.message)
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={pay} disabled={loading} className={buttonClass}>
        {loading ? 'Abriendo pago seguro...' : `Pagar ${formatPrice(priceCents)} con tarjeta`}
      </button>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
    </div>
  )
}
