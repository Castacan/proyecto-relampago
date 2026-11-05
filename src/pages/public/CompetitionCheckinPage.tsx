import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'
import { erpError } from '../../lib/erp'
import SignFlow, { type SignDoc, type SignPayload } from '../../components/erp/SignFlow'
import logoHorizontal from '../../assets/logo-horizontal.png'

// Check-in del día de la competencia (pedido del dueño, 2026-11-05). Se abre con el QR de
// recepción. El competidor escribe su primer nombre y el NÚMERO que le da el staff en ese
// momento (nadie más lo conoce), firma los documentos y queda hecho su check-in.
// RPCs en src/supabase/competencia_checkin.sql.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const inputClass = 'w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-base outline-none border border-zinc-700/50 focus:border-primario/60 transition-all placeholder:text-zinc-500'
const labelClass = 'block text-zinc-300 text-xs font-bold mb-1.5'

interface Session {
  token: string; full_name: string; bib: number; is_minor: boolean
  checked_in_at: string | null; documents: SignDoc[]
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' })

export default function CompetitionCheckinPage() {
  const [name, setName] = useState('')
  const [bib, setBib] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [doneAt, setDoneAt] = useState<string | null>(null)

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(bib)
    if (!name.trim() || !Number.isInteger(n) || n < 1) { setError('Escribe tu primer nombre y tu número.'); return }
    setBusy(true); setError(null)
    const { data, error: err } = await db.rpc('competition_checkin_start', { p_slug: COMPETITION_SLUG, p_bib: n, p_first_name: name })
    setBusy(false)
    if (err || !data || data.error) { setError(erpError(data?.error, 'No se pudo conectar. Intenta de nuevo.')); return }
    setSession(data)
    if (data.documents.length === 0 && data.checked_in_at) setDoneAt(data.checked_in_at)
    window.scrollTo({ top: 0 })
  }

  const sign = async (p: SignPayload) => {
    const { data, error: err } = await db.rpc('competition_checkin_sign', {
      p_token: session!.token, p_document_id: p.document_id, p_signer_name: p.signer_name, p_signature_png: p.signature_png,
      p_guardian_name: p.guardian_name ?? null, p_guardian_relation: p.guardian_relation ?? null, p_user_agent: p.user_agent,
    })
    if (err || !data) return 'network'
    if (data.error) return data.error
    if (data.checked_in_at) setDoneAt(data.checked_in_at)
    return null
  }

  return (
    <div className="min-h-screen bg-fondo">
      <div className="max-w-xl mx-auto px-4 py-6">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-8 mb-5" />

        {doneAt && session ? (
          <div className="rounded-3xl bg-exito/15 border-2 border-exito px-5 py-8 text-center">
            <p className="text-6xl" aria-hidden>✅</p>
            <p className="text-exito font-black text-3xl mt-3">¡Check-in listo!</p>
            <p className="text-texto-principal font-black text-2xl mt-4">{session.full_name}</p>
            <p className="text-primario font-black text-5xl mt-2 tabular-nums">#{session.bib}</p>
            <p className="text-zinc-300 font-semibold mt-3">Firmado a las {hora(doneAt)}</p>
            <p className="text-texto-principal font-bold mt-6">Muestra esta pantalla en recepción para recibir tu playera y tu número.</p>
            <p className="text-zinc-400 text-sm mt-4">Cada zona que saques es un boleto para la rifa. ¡Mucha suerte!</p>
          </div>
        ) : session ? (
          <div className="rounded-2xl bg-superficie border border-zinc-800 p-4">
            <p className="text-zinc-400 text-sm">Hola, <span className="text-texto-principal font-bold">{session.full_name}</span> · #{session.bib}</p>
            <p className="text-zinc-300 text-sm mb-4">Lee y firma {session.documents.length === 1 ? 'el documento' : `los ${session.documents.length} documentos`} para hacer tu check-in.
              {session.is_minor && ' Como eres menor de edad, también firma tu madre, padre o tutor.'}</p>
            {session.documents.length === 0 && <p className="text-texto-principal font-bold">Ya firmaste todo. Pide al staff de recepción que revise tu check-in.</p>}
            <SignFlow docs={session.documents} defaultName={session.full_name} isMinor={session.is_minor}
              onSign={sign} onDone={() => { if (!doneAt) setDoneAt(new Date().toISOString()) }} />
          </div>
        ) : (
          <form onSubmit={start} className="rounded-2xl bg-superficie border border-zinc-800 p-5 space-y-4">
            <div>
              <h1 className="text-texto-principal font-black text-2xl">Check-in · JAM</h1>
              <p className="text-zinc-400 text-sm mt-1">Escribe tu primer nombre y el número que te dio el staff de recepción.</p>
            </div>
            <div>
              <label htmlFor="ci-name" className={labelClass}>Primer nombre</label>
              <input id="ci-name" value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" placeholder="Ej. Camila" className={inputClass} />
            </div>
            <div>
              <label htmlFor="ci-bib" className={labelClass}>Número de participante</label>
              <input id="ci-bib" value={bib} onChange={e => setBib(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Te lo dan en recepción" className={inputClass} />
            </div>
            {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
            <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-primario text-texto-en-acento font-black disabled:opacity-50">
              {busy ? 'Buscando…' : 'Continuar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
