import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { call } from '../../../lib/erp'

// Hoja imprimible de una firma: el texto exacto de la versión firmada, quién,
// cuándo y la firma. Sirve como comprobante (o para guardarla en PDF).

interface Sig {
  id: string; title: string; body: string; version: number; signer_name: string; is_minor: boolean; guardian_name: string | null
  guardian_relation: string | null; signature_png: string; channel: string; signed_at: string; user_agent: string | null; collected_by_name: string | null
  person: { full_name: string; email: string | null; phone: string | null; birth_date: string | null }
}

export default function SignaturePage() {
  const { id } = useParams()
  const [s, setS] = useState<Sig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { call<Sig>('get_signature', { p_signature_id: id }).then(({ data, error }) => error || !data ? setError('No se encontró la firma.') : setS(data)) }, [id])
  if (error) return <div className="p-8 text-zinc-700">{error}</div>
  if (!s) return <div className="p-8 text-zinc-500">Cargando…</div>
  const when = new Date(s.signed_at).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' })
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-8 print:py-0">
        <div className="flex justify-between items-start mb-6 print:hidden">
          <p className="text-zinc-500 text-sm">Comprobante de firma electrónica</p>
          <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-bold">Imprimir / guardar PDF</button>
        </div>
        <h1 className="text-2xl font-black">{s.title}</h1>
        <p className="text-zinc-500 text-sm mb-4">Jaibamuro · versión {s.version}</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed border-y border-zinc-200 py-4">{s.body}</div>
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-zinc-500">Persona</p>
            <p className="font-bold">{s.person.full_name}</p>
            <p className="text-zinc-600">{[s.person.phone, s.person.email].filter(Boolean).join(' · ')}</p>
            {s.person.birth_date && <p className="text-zinc-600">Nacimiento: {s.person.birth_date}{s.is_minor ? ' (menor de edad)' : ''}</p>}
          </div>
          <div>
            <p className="text-zinc-500">Firmó</p>
            <p className="font-bold">{s.is_minor && s.guardian_name ? `${s.guardian_name}${s.guardian_relation ? ` (${s.guardian_relation})` : ''}, en nombre de ${s.signer_name}` : s.signer_name}</p>
            <p className="text-zinc-600">{when}</p>
            <p className="text-zinc-600">{s.channel === 'staff_tablet' ? `En recepción${s.collected_by_name ? `, con ${s.collected_by_name}` : ''}` : 'Desde su cuenta en la app'}</p>
          </div>
        </div>
        <div className="mt-6">
          <img src={s.signature_png} alt="Firma" className="h-32 w-auto border-b border-zinc-400" />
          <p className="text-zinc-500 text-xs mt-1">Firma</p>
        </div>
        <p className="text-zinc-400 text-[10px] mt-8 break-all">Folio de firma {s.id}{s.user_agent ? ` · ${s.user_agent}` : ''}</p>
      </div>
    </div>
  )
}
