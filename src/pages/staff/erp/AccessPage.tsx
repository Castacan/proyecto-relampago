import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { call, erpError, fmtDate, fmtDateTime, expedienteUrl, ACCESS_REASONS, ACCESS_OK_BY } from '../../../lib/erp'
import type { IndexedFace } from '../../../lib/face'
import { FaceScanner, FaceEnroll } from '../../../components/erp/FaceCamera'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'

// Recepción: la webcam reconoce al cliente y muestra su perfil (membresía activa
// o no); el recepcionista le da entrada o lo manda a cobrar. También se busca
// por nombre / celular. Clientes nuevos: QR a /registro y luego su foto aquí.

interface Decision {
  result?: string; allowed: boolean; reasons: string[]; ok_by: string | null; membership_until: string | null
  person: { id: string; full_name: string; photo_path: string | null; access_code: string; block_reason: string | null; is_minor: boolean }
  pending_documents: { title: string }[]; last_entry: string | null
}
interface Today { require_documents: boolean; unique_today: number; events: { id: string; created_at: string; result: string; reasons: string[]; method: string; note: string | null; person_id: string | null; person_name: string | null; by: string | null }[] }
interface PersonRow { id: string; full_name: string; phone: string | null; email: string | null }
interface Pending { id: string; full_name: string; phone: string | null; email: string | null; created_at: string; consent: boolean; pending_documents: number }

const CAM_KEY = 'jm-acceso-camara'

export default function AccessPage() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PersonRow[] | null>(null)
  const [dec, setDec] = useState<Decision | null>(null)
  const [via, setVia] = useState<'face' | 'manual'>('manual')
  const [hasFace, setHasFace] = useState<boolean | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [today, setToday] = useState<Today | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [faces, setFaces] = useState<IndexedFace[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [override, setOverride] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(() => { try { return localStorage.getItem(CAM_KEY) !== 'off' } catch { return true } })
  const [newClient, setNewClient] = useState(false)
  const [enrolling, setEnrolling] = useState<{ id: string; full_name: string } | null>(null)
  const ignore = useRef<{ id: string; until: number } | null>(null)
  const shownId = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadToday = useCallback(async () => { const { data } = await call<Today>('get_access_today'); setToday(data) }, [])
  const loadPending = useCallback(async () => { const { data } = await call<{ people: Pending[] }>('get_reception_pending'); setPending(data?.people ?? []) }, [])
  const loadFaces = useCallback(async () => { const { data } = await call<{ faces: IndexedFace[] }>('get_face_index'); setFaces(data?.faces ?? []) }, [])
  useEffect(() => {
    loadToday(); loadPending(); loadFaces()
    call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin))
  }, [loadToday, loadPending, loadFaces])

  const show = async (d: Decision, how: 'face' | 'manual') => {
    setDec(d); setVia(how); setOverride(''); setResults(null); setQ(''); setError(null)
    shownId.current = d.person.id
    setPhoto(d.person.photo_path ? await expedienteUrl(d.person.photo_path, 600) : null)
    call<{ has_face: boolean }>('get_face_status', { p_person_id: d.person.id }).then(({ data }) => setHasFace(data?.has_face ?? null))
  }
  // Vista previa (aún no registra la entrada).
  const preview = async (personId: string, how: 'face' | 'manual') => {
    const { data, error } = await call<Decision>('staff_access_status', { p_person_id: personId })
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    show(data, how)
  }
  const checkIn = async (personId: string | null, code: string | null, method: 'manual' | 'qr' | 'face', reason?: string) => {
    setError(null)
    const { data, error } = await call<Decision>('staff_check_in', { p_person_id: personId, p_code: code, p_method: method, p_override_reason: reason ?? null })
    if (error || !data) { setError(erpError(error ?? undefined)); return }
    show(data, method === 'face' ? 'face' : 'manual'); loadToday(); inputRef.current?.focus()
  }
  const onMatch = useCallback((id: string) => {
    if (ignore.current && ignore.current.id === id && ignore.current.until > Date.now()) return
    if (shownId.current === id) return
    preview(id, 'face')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const dismiss = (notThisPerson = false) => {
    if (dec && notThisPerson) ignore.current = { id: dec.person.id, until: Date.now() + 20000 }
    setDec(null); shownId.current = null
  }
  const submit = async () => {
    const v = q.trim()
    if (!v) return
    if (/^JM[A-Z0-9]{8}$/i.test(v)) { checkIn(null, v.toUpperCase(), 'qr'); return }
    const { data } = await call<{ people: PersonRow[] }>('admin_search_people', { p_query: v })
    setResults(data?.people ?? [])
  }
  const toggleDocs = async () => {
    if (!today) return
    await call('admin_set_access_settings', { p_require_documents: !today.require_documents })
    loadToday()
  }
  const toggleCamera = () => setCamera(c => { try { localStorage.setItem(CAM_KEY, c ? 'off' : 'on') } catch { /* sin almacenamiento */ } return !c })

  const registered = dec?.result === 'granted' || dec?.result === 'override'
  const denied = dec?.result === 'denied'
  const isPreview = dec && !dec.result
  const registroUrl = `${window.location.origin}/registro`

  return (
    <Page title="Acceso" subtitle="Que el cliente se asome a la cámara, o búscalo por nombre o celular." width="max-w-6xl"
      actions={<>
        <button onClick={() => setNewClient(v => !v)} className={btnPrimary}>{newClient ? 'Cerrar' : '+ Cliente nuevo'}</button>
        {isAdmin && today && <button onClick={toggleDocs} className={btnSmall}>{today.require_documents ? 'Pide responsiva firmada ✓' : 'No pide responsiva'}</button>}
      </>}>

      {newClient && (
        <Card title="Cliente nuevo" tone="accent">
          <div className="flex flex-wrap gap-5 items-center">
            <div className="bg-white p-3 rounded-2xl"><QRCode value={registroUrl} size={170} /></div>
            <div className="flex-1 min-w-[16rem] space-y-2 text-sm text-zinc-300">
              <p className="text-texto-principal font-bold text-base">1. Que escanee este QR con su celular</p>
              <p>Crea su cuenta con su correo, llena sus datos y firma la responsiva, el reglamento y el aviso de privacidad. Liga: <span className="font-mono text-zinc-200">{registroUrl.replace(/^https?:\/\//, '')}</span></p>
              <p className="text-texto-principal font-bold text-base pt-1">2. Cuando termine, aparece abajo en "Nuevos sin foto"</p>
              <p>Tócalo, tómale la foto con la webcam y luego hazle su primera venta.</p>
              <p className="text-zinc-400 text-xs pt-1">¿No trae celular? Regístralo tú en <Link to="/staff/personas" className="underline">Personas → + Nueva persona</Link> y en su ficha → Documentos que firme en la pantalla.</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-3">
          {camera && !enrolling ? <FaceScanner faces={faces} paused={false} onMatch={onMatch} />
            : <div className="rounded-2xl bg-superficie-alta/50 aspect-video grid place-items-center text-zinc-500 text-sm">{enrolling ? 'Cámara en uso para la foto' : 'Cámara apagada'}</div>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-zinc-500 text-xs">{faces.length} {faces.length === 1 ? 'cara registrada' : 'caras registradas'}</p>
            <button onClick={toggleCamera} className={btnSmall}>{camera ? 'Apagar cámara' : 'Encender cámara'}</button>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="Nombre o celular" className={`${input} text-lg py-3`} />
            <button onClick={submit} className={btnPrimary}>Buscar</button>
          </div>
          {results && (
            <Card>
              {results.length === 0 ? <Empty>No encontramos a nadie.</Empty> : (
                <div className="divide-y divide-zinc-800/80">
                  {results.map(p => (
                    <button key={p.id} onClick={() => preview(p.id, 'manual')} className="w-full text-left py-2.5 flex justify-between gap-3 hover:bg-superficie-alta px-2 rounded-lg">
                      <span className="text-texto-principal font-semibold">{p.full_name}</span>
                      <span className="text-zinc-500 text-sm">{p.phone ?? p.email ?? ''} →</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-3">
          <Msg text={error} />
          {!dec ? (
            <div className="rounded-2xl border-2 border-dashed border-zinc-700/60 p-8 text-center text-zinc-500 text-sm">Aquí sale el perfil de quien llega.</div>
          ) : (
            <section className={`rounded-2xl border-2 p-5 ${registered ? 'border-exito bg-exito/10' : denied ? 'border-alerta bg-alerta/10' : dec.allowed ? 'border-exito/60 bg-superficie' : 'border-amarillo-suave/60 bg-superficie'}`}>
              <div className="flex gap-4 items-center">
                <div className="w-28 h-28 rounded-2xl overflow-hidden bg-fondo/60 shrink-0 flex items-center justify-center">
                  {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-zinc-500 text-xs">Sin foto</span>}
                </div>
                <div className="min-w-0">
                  {isPreview && via === 'face' && <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Reconocido por la cámara</p>}
                  {!isPreview && <p className={`font-black text-2xl ${registered ? 'text-exito' : 'text-alerta'}`}>{dec.result === 'override' ? 'PASA (autorizado)' : registered ? 'ENTRADA REGISTRADA' : 'NO PUEDE PASAR'}</p>}
                  <p className="text-texto-principal font-bold text-2xl leading-tight">{dec.person.full_name} {dec.person.is_minor && <Badge cls="text-texto-en-acento bg-amarillo-suave">Menor</Badge>}</p>
                  {dec.allowed ? (
                    <p className="text-exito font-semibold">{dec.ok_by === 'membership' ? `Membresía activa hasta ${fmtDate(dec.membership_until)}` : ACCESS_OK_BY[dec.ok_by ?? ''] ?? 'Al corriente'}</p>
                  ) : (
                    <p className="text-alerta font-semibold">{dec.reasons.map(r => (r === 'no_membership' ? 'Sin membresía activa' : ACCESS_REASONS[r] ?? r) + (r === 'blocked' && dec.person.block_reason ? `: ${dec.person.block_reason}` : '')).join(' · ')}</p>
                  )}
                  {dec.pending_documents.length > 0 && <p className="text-amarillo-suave text-sm">Falta firmar: {dec.pending_documents.map(d => d.title).join(', ')}</p>}
                  <p className="text-zinc-500 text-xs">Última visita: {dec.last_entry ? fmtDateTime(dec.last_entry) : 'nunca'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {isPreview && dec.allowed && <button onClick={() => checkIn(dec.person.id, null, via)} className={`${btnPrimary} py-3 px-6 text-base`}>Dar entrada</button>}
                {(isPreview || denied) && dec.reasons.includes('no_membership') && <Link to={`/staff/vender?persona=${dec.person.id}`} className={`${btnPrimary} py-3 px-6 text-base`}>Cobrar</Link>}
                <Link to={`/staff/personas/${dec.person.id}`} className={btnGhost}>Ver ficha{dec.pending_documents.length > 0 ? ' / firmar' : ''}</Link>
                {hasFace === false && <button onClick={() => setEnrolling({ id: dec.person.id, full_name: dec.person.full_name })} className={btnGhost}>📷 Registrar su cara</button>}
                {isPreview && via === 'face' && <button onClick={() => dismiss(true)} className={btnGhost}>No es esta persona</button>}
                <button onClick={() => dismiss()} className={btnGhost}>Listo</button>
              </div>
              {!registered && !dec.allowed && !dec.reasons.includes('blocked') && (
                <div className="flex gap-2 mt-3">
                  <input value={override} onChange={e => setOverride(e.target.value)} placeholder="Dejar pasar de todos modos: ¿por qué?" className={input} />
                  <button onClick={() => checkIn(dec.person.id, null, via, override)} disabled={override.trim().length < 3} className={btnSmall}>Dejar pasar</button>
                </div>
              )}
            </section>
          )}

          {pending.length > 0 && (
            <Card title="Nuevos sin foto">
              <div className="divide-y divide-zinc-800/80">
                {pending.map(p => (
                  <div key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link to={`/staff/personas/${p.id}`} className="text-texto-principal font-semibold hover:text-primario">{p.full_name}</Link>
                      <p className="text-zinc-500 text-xs">{fmtDateTime(p.created_at)} · {p.pending_documents ? `faltan ${p.pending_documents} firmas` : 'firmas completas'}</p>
                    </div>
                    {p.consent ? <button onClick={() => setEnrolling({ id: p.id, full_name: p.full_name })} className={btnSmall}>📷 Tomar foto</button>
                      : <span className="text-amarillo-suave text-xs text-right">Falta firmar el aviso de privacidad</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {enrolling && (
        <FaceEnroll person={enrolling} faces={faces} onCancel={() => setEnrolling(null)}
          onDone={() => {
            const id = enrolling.id
            setEnrolling(null); loadFaces(); loadPending()
            preview(id, 'manual')
          }} />
      )}

      {!today ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Personas hoy" value={today.unique_today} tone="accent" />
            <Stat label="Entradas registradas" value={today.events.filter(e => e.result !== 'denied').length} />
            <Stat label="Negadas" value={today.events.filter(e => e.result === 'denied').length} tone={today.events.some(e => e.result === 'denied') ? 'alert' : undefined} />
            <Stat label="Con autorización" value={today.events.filter(e => e.result === 'override').length} />
          </div>
          <Card title="Entradas de hoy">
            {today.events.length === 0 ? <Empty>Nadie ha entrado hoy.</Empty> : (
              <div className="divide-y divide-zinc-800/80">
                {today.events.map(e => (
                  <div key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      {e.person_id ? <Link to={`/staff/personas/${e.person_id}`} className="text-texto-principal font-semibold hover:text-primario">{e.person_name}</Link> : <span className="text-zinc-400">Código desconocido</span>}
                      <p className="text-zinc-500 text-xs">{fmtDateTime(e.created_at)} · {e.method === 'qr' ? 'QR' : e.method === 'face' ? 'cara' : e.method === 'device' ? 'torniquete' : 'manual'}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</p>
                    </div>
                    {e.result === 'granted' ? <Badge cls="text-exito bg-exito/10">Entró</Badge>
                      : e.result === 'override' ? <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Autorizado</Badge>
                      : <Badge cls="text-white bg-alerta">{e.reasons.map(r => ACCESS_REASONS[r] ?? r).join(', ') || 'Negado'}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
