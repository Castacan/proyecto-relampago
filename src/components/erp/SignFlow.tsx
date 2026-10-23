import { useState } from 'react'
import SignaturePad from './SignaturePad'
import { erpError } from '../../lib/erp'

// Firma uno por uno los documentos pendientes: se lee el texto completo, se
// escribe el nombre (y el del tutor si es menor) y se firma en el recuadro.
// Lo usan la tablet del gym (staff) y la cuenta del cliente.

export interface SignDoc { id: string; title: string; body: string }
export interface SignPayload { document_id: string; signer_name: string; signature_png: string; guardian_name?: string; guardian_relation?: string; user_agent: string }

export default function SignFlow({ docs, defaultName, isMinor, defaultGuardian, onSign, onDone, light = false }: {
  docs: SignDoc[]; defaultName: string; isMinor: boolean; defaultGuardian?: string | null
  onSign: (p: SignPayload) => Promise<string | null>   // devuelve código de error o null
  onDone: () => void; light?: boolean
}) {
  const [i, setI] = useState(0)
  const [name, setName] = useState(defaultName)
  const [guardian, setGuardian] = useState(defaultGuardian ?? '')
  const [relation, setRelation] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [padKey, setPadKey] = useState(0)

  const doc = docs[i]
  if (!doc) return null
  const text = light ? 'text-zinc-800' : 'text-zinc-200'
  const field = `w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none ${light ? 'bg-white border-zinc-300 text-zinc-900' : 'bg-superficie-alta border-zinc-700/50 text-texto-principal'}`

  const submit = async () => {
    if (!sig) { setError('Falta la firma.'); return }
    setBusy(true); setError(null)
    const err = await onSign({ document_id: doc.id, signer_name: name, signature_png: sig, guardian_name: isMinor ? guardian : undefined,
      guardian_relation: isMinor ? relation : undefined, user_agent: navigator.userAgent })
    setBusy(false)
    if (err) { setError(erpError(err)); return }
    if (i + 1 < docs.length) { setI(i + 1); setSig(null); setAccepted(false); setPadKey(k => k + 1); window.scrollTo({ top: 0 }) }
    else onDone()
  }

  return (
    <div className="space-y-4">
      {docs.length > 1 && <p className={`text-xs font-bold uppercase tracking-widest ${light ? 'text-zinc-500' : 'text-zinc-500'}`}>Documento {i + 1} de {docs.length}</p>}
      <h2 className={`font-black text-xl ${light ? 'text-zinc-900' : 'text-texto-principal'}`}>{doc.title}</h2>
      <div className={`rounded-xl border p-4 max-h-[45vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed ${light ? 'bg-zinc-50 border-zinc-200' : 'bg-fondo/60 border-zinc-800'} ${text}`}>{doc.body}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={`block text-xs font-bold mb-1 ${text}`}>Nombre completo de quien {isMinor ? 'escala (menor)' : 'firma'}</label>
          <input value={name} onChange={e => setName(e.target.value)} className={field} />
        </div>
        {isMinor && <>
          <div>
            <label className={`block text-xs font-bold mb-1 ${text}`}>Madre, padre o tutor que firma</label>
            <input value={guardian} onChange={e => setGuardian(e.target.value)} className={field} />
          </div>
          <div>
            <label className={`block text-xs font-bold mb-1 ${text}`}>Parentesco</label>
            <input value={relation} onChange={e => setRelation(e.target.value)} placeholder="Madre, padre, tutor…" className={field} />
          </div>
        </>}
      </div>
      <label className={`flex items-start gap-2 text-sm ${text}`}>
        <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="accent-primario w-4 h-4 mt-0.5" />
        Leí el documento completo y lo acepto{isMinor ? ' en nombre del menor' : ''}.
      </label>
      <SignaturePad key={padKey} onChange={setSig} />
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button onClick={submit} disabled={busy || !accepted || !sig || name.trim().length < 3}
        className="w-full py-3 rounded-xl bg-primario text-texto-en-acento font-black disabled:opacity-40">
        {busy ? 'Guardando…' : i + 1 < docs.length ? 'Firmar y continuar' : 'Firmar'}
      </button>
    </div>
  )
}
