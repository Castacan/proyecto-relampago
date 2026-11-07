import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { useProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'

// Recepción del día de la competencia (2026-11-05): QR para el check-in, quién ya firmó,
// ver/imprimir lo que firmó cada quien y editar los documentos que se firman.
// RPCs en src/supabase/competencia_checkin.sql. Página pública: /competencia/checkin.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Doc { id: string; title: string; body: string; sort_order: number; active: boolean; signed: number }
interface Person {
  registration_id: string; bib: number | null; full_name: string; time_slot_id: string | null; shirt_size: string
  checked_in_at: string | null; is_minor: boolean; signed: number; last_signed_at: string | null
  pending_payment?: boolean   // pagará en efectivo el día del evento (competencia_pendientes.sql)
}
interface Slot { id: string; label: string }
interface Data { documents: Doc[]; people: Person[]; slots: Slot[] }
interface Signature {
  document_title: string; document_body: string; signer_name: string; signature_png: string
  is_minor: boolean; guardian_name: string | null; guardian_relation: string | null; signed_at: string
}

const smallBtn = 'text-zinc-200 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all disabled:opacity-50'
const primaryBtn = 'text-xs font-bold px-3 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento transition-all disabled:opacity-50'
const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
const card = 'bg-superficie rounded-2xl border border-zinc-800/80'
const fmt = (iso: string) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' })

const CHECKIN_URL = `${typeof window !== 'undefined' ? window.location.origin : 'https://app.jaibamuro.com'}/competencia/checkin`

export default function CompetitionCheckinAdminPage() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [slot, setSlot] = useState('all')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [viewing, setViewing] = useState<Person | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('get_competition_checkin_admin', { p_slug: COMPETITION_SLUG })
    if (error || !data) { setError('No se pudo cargar. ¿Ya se corrió competencia_checkin.sql?'); return }
    if (data.error) { setError(data.error === 'forbidden' ? 'Solo un admin puede ver esto.' : 'No se encontró.'); return }
    setError(null); setData(data)
  }, [])

  // Se actualiza solo cada 10 s: la gente firma en su celular.
  useEffect(() => {
    if (!isAdmin) return
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [isAdmin, load])

  const activeDocs = data?.documents.filter(d => d.active).length ?? 0
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.people ?? []).filter(p => {
      if (slot !== 'all' && p.time_slot_id !== slot) return false
      if (pendingOnly && p.checked_in_at) return false
      if (!q) return true
      return p.full_name.toLowerCase().includes(q) || String(p.bib ?? '') === q.replace('#', '')
    })
  }, [data, search, slot, pendingOnly])

  if (profile && !isAdmin) return <Navigate to="/staff" replace />

  const done = data?.people.filter(p => p.checked_in_at).length ?? 0
  const slotName = (id: string | null) => data?.slots.find(s => s.id === id)?.label ?? 'Sin horario'

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="max-w-4xl mx-auto w-full px-4 py-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="text-texto-principal font-black text-2xl tracking-tight">Check-in</h1>
            <p className="text-zinc-400 text-xs truncate">
              <Link to="/staff/competencia" className="text-primario font-bold">Inscripciones</Link>
              {' · '}<Link to="/staff/competencia/puntos" className="text-primario font-bold">Puntos</Link>
              {' · '}<Link to="/staff/competencia/rifa" className="text-primario font-bold">Rifa</Link>
              {' · '}<Link to="/staff/competencia/imprimir" className="text-primario font-bold">Imprimir</Link>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setShowQr(true)} className={primaryBtn}>Mostrar QR</button>
            <button onClick={() => setEditing(v => !v)} className={smallBtn}>{editing ? 'Listo' : 'Documentos'}</button>
          </div>
        </div>

        {error && <p className="text-alerta text-xs mb-3">{error}</p>}

        <div className={`${card} p-4 mb-4 text-sm text-zinc-300 space-y-1`}>
          <p className="text-texto-principal font-bold">Cómo funciona</p>
          <p>1. Llega la persona y dice su nombre: búscala aquí y dile su <b>número</b>.</p>
          <p>2. Que escanee el QR (o entre a <span className="font-mono text-primario">app.jaibamuro.com/competencia/checkin</span>), escriba su primer nombre y ese número.</p>
          <p>3. Lee y firma en su celular. Si es menor, también firma su tutor.</p>
          <p>4. Cuando aquí salga <span className="text-exito font-bold">Check-in ✓</span> (o te enseñe su pantalla verde), entrégale playera y número.</p>
          {data && activeDocs === 0 && <p className="text-alerta font-bold pt-1">Aún no hay documentos activos: nadie puede hacer check-in. Agrégalos en "Documentos".</p>}
        </div>

        {editing && data && <DocEditor docs={data.documents} onChanged={load} />}

        {data && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Stat label="Check-in" value={`${done}/${data.people.length}`} />
              <Stat label="Documentos a firmar" value={String(activeDocs)} />
              <Stat label="Menores" value={String(data.people.filter(p => p.is_minor).length)} />
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o número..." className={`${inputClass} flex-1 min-w-[12rem]`} />
              <select value={slot} onChange={e => setSlot(e.target.value)} className={`${inputClass} w-auto`}>
                <option value="all">Todos los horarios</option>
                {data.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} className="accent-primario" /> Solo pendientes
              </label>
            </div>

            <div className={`${card} divide-y divide-zinc-800/60`}>
              {rows.map(p => (
                <div key={p.registration_id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-primario font-black tabular-nums text-xl w-14 shrink-0">{p.bib != null ? `#${p.bib}` : '—'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-texto-principal font-bold text-sm truncate">
                      {p.full_name}{p.is_minor && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-amarillo-suave bg-amarillo-suave/10">Menor</span>}
                      {p.pending_payment && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-alerta bg-alerta/10">Paga en efectivo</span>}
                    </p>
                    <p className="text-zinc-400 text-[11px] truncate">{slotName(p.time_slot_id)} · talla {p.shirt_size} · firmó {p.signed}/{activeDocs}</p>
                  </div>
                  {p.checked_in_at
                    ? <span className="text-exito font-black text-xs shrink-0">Check-in ✓ {hora(p.checked_in_at)}</span>
                    : <span className="text-zinc-500 font-bold text-xs shrink-0">Pendiente</span>}
                  {p.signed > 0 && <button onClick={() => setViewing(p)} className={`${smallBtn} shrink-0`}>Ver firmas</button>}
                </div>
              ))}
              {rows.length === 0 && <p className="text-zinc-400 text-sm px-4 py-3">Nadie con ese filtro.</p>}
            </div>
          </>
        )}
      </div>

      {showQr && (
        <div className="fixed inset-0 z-50 bg-fondo flex flex-col items-center justify-center gap-6 p-6 text-center" onClick={() => setShowQr(false)}>
          <p className="text-texto-principal font-black text-3xl">Check-in · JAM</p>
          <div className="bg-white p-6 rounded-3xl"><QRCode value={CHECKIN_URL} size={320} /></div>
          <p className="text-zinc-300 font-bold text-lg">Escanea, escribe tu primer nombre y tu número, y firma.</p>
          <p className="text-zinc-500 text-sm">Toca para cerrar</p>
        </div>
      )}
      {viewing && <SignaturesModal person={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${card} p-3`}>
      <p className="text-zinc-400 text-[11px] font-semibold">{label}</p>
      <p className="font-black text-2xl leading-tight tabular-nums text-texto-principal">{value}</p>
    </div>
  )
}

function SignaturesModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const [sigs, setSigs] = useState<Signature[] | null>(null)
  useEffect(() => {
    db.rpc('admin_checkin_signatures', { p_registration_id: person.registration_id })
      .then(({ data }: { data: { signatures?: Signature[] } | null }) => setSigs(data?.signatures ?? []))
  }, [person.registration_id])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto p-4 print:p-0 print:bg-white" onClick={onClose}>
      <div className="max-w-2xl mx-auto bg-white text-zinc-900 rounded-2xl p-6 print:rounded-none" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4 print:hidden">
          <p className="font-black text-lg">Firmas de #{person.bib} {person.full_name}</p>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="text-xs font-bold px-3 py-2 rounded-xl bg-zinc-900 text-white">Imprimir</button>
            <button onClick={onClose} className="text-xs font-bold px-3 py-2 rounded-xl bg-zinc-200">Cerrar</button>
          </div>
        </div>
        {!sigs ? <p className="text-sm">Cargando…</p> : sigs.map((s, i) => (
          <div key={i} className="mb-8 break-inside-avoid">
            <p className="font-black text-xl">{s.document_title}</p>
            <p className="text-xs text-zinc-500 mb-2">JAM · Jaibas Al Muro · #{person.bib} {person.full_name}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed border-y border-zinc-200 py-3">{s.document_body}</div>
            <div className="mt-3 text-sm">
              <img src={s.signature_png} alt="Firma" className="h-24 border-b border-zinc-400" />
              <p><b>{s.signer_name}</b>{s.is_minor && ' (menor de edad)'}</p>
              {s.is_minor && <p>Firma también: <b>{s.guardian_name}</b>{s.guardian_relation ? ` (${s.guardian_relation})` : ''}</p>}
              <p className="text-zinc-500 text-xs">Firmado el {fmt(s.signed_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DocEditor({ docs, onChanged }: { docs: Doc[]; onChanged: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (id: string | null, t: string, b: string, active: boolean, sort: number | null) => {
    setSaving(true); setErr(null)
    const { data, error } = await db.rpc('admin_checkin_save_document', {
      p_slug: COMPETITION_SLUG, p_id: id, p_title: t, p_body: b, p_sort_order: sort, p_active: active,
    })
    setSaving(false)
    if (error || !data || data.error) { setErr('No se pudo guardar. Revisa el título y el texto.'); return false }
    onChanged()
    return true
  }

  return (
    <div className={`${card} p-4 mb-4 space-y-4`}>
      <p className="text-texto-principal text-sm font-bold">Documentos que se firman (en este orden)</p>
      <p className="text-zinc-400 text-[11px]">
        Cada firma guarda una copia exacta del texto que se firmó. Si cambias un texto después, las firmas anteriores no cambian;
        quien ya firmó no vuelve a firmar ese documento. Un documento nuevo sí se le pide a quien vuelva a entrar.
      </p>
      {docs.map(d => <DocRow key={d.id} doc={d} disabled={saving} onSave={(t, b, a) => save(d.id, t, b, a, null)} />)}
      <div className="pt-3 border-t border-zinc-800/60 space-y-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título (ej. Responsiva)" className={inputClass} maxLength={160} />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Texto completo del documento" rows={8} className={inputClass} />
        <button onClick={async () => { if (await save(null, title, body, true, null)) { setTitle(''); setBody('') } }}
          disabled={saving || !title.trim() || !body.trim()} className={primaryBtn}>Agregar documento</button>
      </div>
      {err && <p className="text-alerta text-xs">{err}</p>}
    </div>
  )
}

function DocRow({ doc, disabled, onSave }: { doc: Doc; disabled: boolean; onSave: (title: string, body: string, active: boolean) => Promise<boolean> }) {
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const changed = title !== doc.title || body !== doc.body
  return (
    <div className={`space-y-2 ${doc.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} className={`${inputClass} flex-1`} maxLength={160} aria-label="Título" />
        <span className="text-zinc-400 text-[11px] shrink-0">{doc.signed} firmas</span>
      </div>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className={inputClass} aria-label="Texto" />
      <div className="flex gap-2">
        {changed && <button onClick={() => onSave(title, body, doc.active)} disabled={disabled} className={primaryBtn}>Guardar cambios</button>}
        <button onClick={() => onSave(doc.title, doc.body, !doc.active)} disabled={disabled} className={smallBtn}>
          {doc.active ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>
  )
}
