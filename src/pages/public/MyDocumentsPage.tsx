import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call } from '../../lib/erp'
import { useAuth } from '../../lib/auth'
import SignFlow from '../../components/erp/SignFlow'

// /firmar: el cliente lee y firma su responsiva y el reglamento desde su celular.

interface MyDocs {
  person: { full_name: string; is_minor: boolean; guardian_name: string | null } | null
  documents: { id: string; doc_key: string; version: number; title: string; body: string; required: boolean; signed_at: string | null }[]
}

export default function MyDocumentsPage() {
  const { session, loading } = useAuth()
  const user = session?.user
  const [d, setD] = useState<MyDocs | null>(null)
  const [done, setDone] = useState(false)
  const load = useCallback(async () => { const { data } = await call<MyDocs>('get_my_documents'); setD(data) }, [])
  useEffect(() => { if (user) load() }, [user, load])

  const wrap = (children: React.ReactNode) => (
    <div className="min-h-screen bg-fondo px-4 py-6"><div className="max-w-xl mx-auto space-y-4">
      <Link to="/mi-cuenta" className="text-zinc-400 text-sm">← Mi cuenta</Link>
      {children}
    </div></div>
  )
  if (loading) return wrap(<p className="text-zinc-400">Cargando…</p>)
  if (!user) return wrap(<p className="text-zinc-300">Inicia sesión para firmar tus documentos. <Link to="/mi-cuenta" className="text-primario font-bold">Entrar</Link></p>)
  if (!d) return wrap(<p className="text-zinc-400">Cargando…</p>)
  if (!d.person) return wrap(<p className="text-zinc-300">Primero completa tus datos en <Link to="/clases" className="text-primario font-bold">Clases</Link> (nombre y celular) y regresa aquí.</p>)

  const pending = d.documents.filter(x => x.required && !x.signed_at)
  if (done || pending.length === 0) return wrap(
    <div className="bg-superficie rounded-2xl border border-exito/50 p-5 space-y-2">
      <p className="text-exito font-black text-xl">¡Listo! Tus documentos están firmados.</p>
      {d.documents.filter(x => x.signed_at).map(x => <p key={x.id} className="text-zinc-300 text-sm">✓ {x.title}</p>)}
      <Link to="/mi-cuenta" className="inline-block mt-2 px-4 py-2.5 rounded-xl bg-primario text-texto-en-acento font-bold text-sm">Volver a mi cuenta</Link>
    </div>
  )
  return wrap(
    <div className="bg-white rounded-2xl p-5">
      <SignFlow light docs={pending} defaultName={d.person.full_name} isMinor={d.person.is_minor} defaultGuardian={d.person.guardian_name}
        onSign={async p => { const { error } = await call('sign_my_document', { p }); return error }}
        onDone={() => { setDone(true); load() }} />
    </div>
  )
}
