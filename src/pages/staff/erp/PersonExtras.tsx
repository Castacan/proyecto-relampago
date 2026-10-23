import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'react-qr-code'
import {
  call, erpError, money, fmtDate, fmtDateTime, ACCESS_REASONS, ACCESS_OK_BY,
  uploadExpedienteFile, expedienteUrl, removeExpedienteFile,
} from '../../../lib/erp'
import { Card, Badge, Spinner, Msg, input, btnSmall, btnDanger } from '../../../components/erp/ui'
import SignFlow from '../../../components/erp/SignFlow'

// Secciones extra de la ficha de la persona (erp_crm.sql): cargos próximos e
// intentos de la domiciliación, responsivas y documentos, acceso.

// ---------------------------------------------------------------------------
// Domiciliación: cargos próximos + intentos
// ---------------------------------------------------------------------------
interface HistEvent { id: string; kind: string; created_at: string; cycle: number | null; attempt: number | null; error_code: string | null; error_message: string | null; provider_charge_id: string | null; card: string | null }
interface History { upcoming: { cycle: number; date: string; amount_cents: number; promo: boolean }[]; events: HistEvent[] }

const EVENT_LABELS: Record<string, { label: string; cls: string }> = {
  attempt_paid: { label: 'Cobro aprobado', cls: 'text-exito' },
  attempt_failed: { label: 'Cobro rechazado', cls: 'text-alerta' },
  attempt_needs_action: { label: 'Banco pidió autenticar', cls: 'text-amarillo-suave' },
  card_attached: { label: 'Tarjeta registrada', cls: 'text-zinc-200' },
  cancelled_at_period_end: { label: 'Se canceló al terminar el periodo', cls: 'text-zinc-400' },
  email_sent: { label: 'Correo enviado', cls: 'text-zinc-400' },
  email_error: { label: 'Correo no se pudo enviar', cls: 'text-alerta' },
}

export function SubscriptionHistory({ subscriptionId }: { subscriptionId: string }) {
  const [h, setH] = useState<History | null>(null)
  const [tab, setTab] = useState<'upcoming' | 'events'>('upcoming')
  useEffect(() => { call<History>('get_subscription_history', { p_subscription_id: subscriptionId }).then(({ data }) => setH(data)) }, [subscriptionId])
  if (!h) return <Spinner />
  return (
    <div className="mt-3 rounded-xl bg-fondo/60 p-3">
      <div className="flex gap-3 mb-2 text-xs font-bold">
        <button onClick={() => setTab('upcoming')} className={tab === 'upcoming' ? 'text-primario' : 'text-zinc-400'}>Cargos próximos</button>
        <button onClick={() => setTab('events')} className={tab === 'events' ? 'text-primario' : 'text-zinc-400'}>Historial de intentos ({h.events.filter(e => e.kind.startsWith('attempt_')).length})</button>
      </div>
      {tab === 'upcoming' ? (
        h.upcoming.length === 0 ? <p className="text-zinc-500 text-xs">No hay cargos programados.</p> : (
          <div className="divide-y divide-zinc-800/60">
            {h.upcoming.map(u => (
              <div key={u.cycle} className="py-1.5 flex justify-between text-xs">
                <span className="text-zinc-300">Mes {u.cycle} · {fmtDate(u.date)}{u.promo && <span className="text-primario"> · promo</span>}</span>
                <span className="text-zinc-200 font-bold tabular-nums">{money(u.amount_cents)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        h.events.length === 0 ? <p className="text-zinc-500 text-xs">Sin intentos todavía.</p> : (
          <div className="divide-y divide-zinc-800/60 max-h-64 overflow-y-auto">
            {h.events.map(e => {
              const l = EVENT_LABELS[e.kind] ?? { label: e.kind, cls: 'text-zinc-300' }
              return (
                <div key={e.id} className="py-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className={`font-semibold ${l.cls}`}>{l.label}{e.cycle ? ` · mes ${e.cycle}` : ''}{e.attempt ? ` · intento ${e.attempt}` : ''}{e.card ? ` · ${e.card}` : ''}</span>
                    <span className="text-zinc-500 shrink-0">{fmtDateTime(e.created_at)}</span>
                  </div>
                  {(e.error_message || e.provider_charge_id) && (
                    <p className="text-zinc-500">{e.error_message ?? ''}{e.error_code ? ` (código ${e.error_code})` : ''}{e.provider_charge_id ? ` · ref ${e.provider_charge_id}` : ''}</p>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Responsivas y documentos
// ---------------------------------------------------------------------------
interface DocCurrent { id: string; doc_key: string; version: number; title: string; body: string; required: boolean }
interface Signature { id: string; doc_key: string; version: number; title: string; signer_name: string; guardian_name: string | null; guardian_relation: string | null; is_minor: boolean; channel: string; signed_at: string; collected_by: string | null; is_current: boolean }
interface FileRow { id: string; path: string; file_name: string; label: string | null; mime: string | null; size_bytes: number | null; created_at: string; uploaded_by: string | null }
interface PersonDocs { current: DocCurrent[]; pending: { id: string; title: string; signed_older: boolean }[]; signatures: Signature[]; files: FileRow[] }

export function DocumentsCard({ personId, fullName, isMinor, guardianName, isAdmin, onSigned }: { personId: string; fullName: string; isMinor: boolean; guardianName: string | null; isAdmin: boolean; onSigned?: () => void }) {
  const [d, setD] = useState<PersonDocs | null>(null)
  const [signing, setSigning] = useState(false)
  const load = useCallback(async () => {
    const { data } = await call<PersonDocs>('get_person_documents', { p_person_id: personId })
    setD(data)
  }, [personId])
  useEffect(() => { load() }, [load])
  if (!d) return <Card title="Responsiva y documentos"><Spinner /></Card>

  const pendingDocs = d.current.filter(c => d.pending.some(p => p.id === c.id))
  return (
    <Card title={<span className="flex items-center gap-2">Responsiva y documentos {d.pending.length > 0 ? <Badge cls="text-white bg-alerta">Falta firmar {d.pending.length}</Badge> : <Badge cls="text-exito bg-exito/10">Al corriente</Badge>}</span>}
      tone={d.pending.length > 0 ? 'alert' : undefined}
      actions={pendingDocs.length > 0 && !signing ? <button onClick={() => setSigning(true)} className={btnSmall}>Firmar en esta tablet</button> : undefined}>
      {signing ? (
        <div className="rounded-xl bg-white p-4">
          <SignFlow light docs={pendingDocs} defaultName={fullName} isMinor={isMinor} defaultGuardian={guardianName}
            onSign={async (p) => { const { error } = await call('staff_sign_document', { p_person_id: personId, p }); return error }}
            onDone={() => { setSigning(false); load(); onSigned?.() }} />
          <button onClick={() => setSigning(false)} className="mt-3 text-sm font-semibold text-zinc-500">Cancelar</button>
        </div>
      ) : (
        <>
          {d.pending.length > 0 && (
            <p className="text-sm text-zinc-300 mb-2">Falta: {d.pending.map(p => p.title + (p.signed_older ? ' (versión nueva)' : '')).join(', ')}. Pásale la tablet para que firme, o que lo haga desde su cuenta en la app.</p>
          )}
          {d.signatures.length === 0 ? <p className="text-zinc-500 text-sm">Sin firmas todavía.</p> : (
            <div className="divide-y divide-zinc-800/80">
              {d.signatures.map(s => (
                <div key={s.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className={s.is_current ? 'text-texto-principal font-semibold' : 'text-zinc-500'}>{s.title} <span className="text-zinc-500 font-normal">v{s.version}</span></p>
                    <p className="text-zinc-500 text-xs">{fmtDateTime(s.signed_at)} · firmó {s.signer_name}{s.guardian_name ? ` (tutor: ${s.guardian_name}${s.guardian_relation ? `, ${s.guardian_relation}` : ''})` : ''} · {s.channel === 'staff_tablet' ? `tablet${s.collected_by ? ` con ${s.collected_by}` : ''}` : 'desde su cuenta'}</p>
                  </div>
                  <Link to={`/staff/firma/${s.id}`} target="_blank" className={btnSmall}>Ver / imprimir</Link>
                </div>
              ))}
            </div>
          )}
          <FilesBox ownerKind="person" ownerId={personId} files={d.files} canDelete={isAdmin} onChanged={load} />
        </>
      )}
    </Card>
  )
}

export function FilesBox({ ownerKind, ownerId, files, canDelete, onChanged }: { ownerKind: 'person' | 'employee'; ownerId: string; files: FileRow[]; canDelete: boolean; onChanged: () => void }) {
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    const up = await uploadExpedienteFile(ownerKind, ownerId, file)
    if (up.error || !up.path) { setBusy(false); setError(up.error); return }
    const { error } = await call('staff_register_file', { p_owner_kind: ownerKind, p_owner_id: ownerId, p_path: up.path, p_file_name: file.name, p_label: label, p_mime: file.type, p_size: file.size })
    setBusy(false)
    if (error) { await removeExpedienteFile(up.path); setError(erpError(error)); return }
    setLabel(''); if (inputRef.current) inputRef.current.value = ''
    onChanged()
  }
  const open = async (f: FileRow) => {
    const url = await expedienteUrl(f.path)
    if (url) window.open(url, '_blank', 'noopener'); else setError('No se pudo abrir el archivo.')
  }
  const del = async (f: FileRow) => {
    const { data, error } = await call<{ path: string }>('admin_delete_file', { p_file_id: f.id })
    if (error) { setError(erpError(error)); return }
    if (data?.path) await removeExpedienteFile(data.path)
    onChanged()
  }

  return (
    <div className="mt-4 pt-3 border-t border-zinc-800/80">
      <p className="text-zinc-400 text-xs font-bold mb-2">Archivos (INE, responsiva en papel, certificado médico…)</p>
      {files.length > 0 && (
        <div className="space-y-1 mb-3">
          {files.map(f => (
            <div key={f.id} className="flex items-center justify-between gap-2 text-sm rounded-xl bg-fondo/60 px-3 py-2">
              <button onClick={() => open(f)} className="text-left min-w-0">
                <p className="text-texto-principal font-semibold truncate">{f.label ?? f.file_name}</p>
                <p className="text-zinc-500 text-xs truncate">{f.file_name} · {fmtDate(f.created_at.slice(0, 10))}{f.uploaded_by ? ` · ${f.uploaded_by}` : ''}{f.size_bytes ? ` · ${Math.ceil(f.size_bytes / 1024)} KB` : ''}</p>
              </button>
              {canDelete && <button onClick={() => del(f)} className="text-zinc-500 hover:text-alerta text-xs font-bold">Quitar</button>}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="¿Qué es? (ej. INE)" className={`${input} max-w-[14rem]`} />
        <label className={`${btnSmall} cursor-pointer`}>
          {busy ? 'Subiendo…' : 'Subir archivo o foto'}
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" disabled={busy} onChange={e => upload(e.target.files?.[0])} />
        </label>
      </div>
      <Msg text={error} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
interface AccessStatus {
  allowed: boolean; reasons: string[]; ok_by: string | null; membership_until: string | null
  person: { id: string; full_name: string; photo_path: string | null; access_code: string; block_reason: string | null; is_minor: boolean }
  last_entry: string | null
  recent: { created_at: string; result: string; reasons: string[]; method: string; by: string | null; note: string | null }[]
}

export function AccessCard({ personId, isAdmin }: { personId: string; isAdmin: boolean }) {
  const [a, setA] = useState<AccessStatus | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [reason, setReason] = useState('')
  const [overriding, setOverriding] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const load = useCallback(async () => {
    const { data } = await call<AccessStatus>('staff_access_status', { p_person_id: personId })
    setA(data)
    if (data?.person.photo_path) setPhoto(await expedienteUrl(data.person.photo_path, 3600)); else setPhoto(null)
  }, [personId])
  useEffect(() => { load() }, [load])
  if (!a) return <Card title="Acceso"><Spinner /></Card>

  const blocked = a.reasons.includes('blocked')
  const checkIn = async (override?: string) => {
    const { data, error } = await call<{ result: string }>('staff_check_in', { p_person_id: personId, p_code: null, p_method: 'manual', p_override_reason: override ?? null })
    if (error || !data) { setMsg({ text: erpError(error ?? undefined), tone: 'error' }); return }
    setMsg(data.result === 'denied' ? { text: 'Entrada negada (quedó registrada).', tone: 'error' } : { text: 'Entrada registrada.', tone: 'ok' })
    load()
  }
  const setBlock = async (b: boolean, newCode = false) => {
    const { error } = await call('admin_set_access', { p_person_id: personId, p_blocked: b, p_reason: reason, p_new_code: newCode })
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    setBlocking(false); setReason(''); load()
  }
  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const up = await uploadExpedienteFile('person', personId, file)
    if (up.error || !up.path) { setMsg({ text: up.error ?? 'No se pudo subir.', tone: 'error' }); return }
    const { error } = await call('staff_set_photo', { p_person_id: personId, p_path: up.path })
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    load()
  }

  return (
    <Card title={<span className="flex items-center gap-2">Acceso {a.allowed ? <Badge cls="text-exito bg-exito/10">Puede entrar</Badge> : <Badge cls="text-white bg-alerta">No puede entrar</Badge>}</span>}>
      <div className="flex gap-4">
        <label className="shrink-0 w-20 h-20 rounded-xl bg-fondo/60 border border-zinc-700/50 overflow-hidden flex items-center justify-center cursor-pointer" title="Tomar o subir foto (para el reconocimiento facial)">
          {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-zinc-500 text-[10px] text-center px-1">Foto<br />(tocar)</span>}
          <input type="file" accept="image/*" capture="user" className="hidden" onChange={e => uploadPhoto(e.target.files?.[0])} />
        </label>
        <div className="min-w-0 text-sm space-y-0.5">
          {a.allowed ? <p className="text-exito font-semibold">{ACCESS_OK_BY[a.ok_by ?? ''] ?? 'Al corriente'}</p>
            : a.reasons.map(r => <p key={r} className="text-alerta font-semibold">{ACCESS_REASONS[r] ?? r}{r === 'blocked' && a.person.block_reason ? `: ${a.person.block_reason}` : ''}</p>)}
          <p className="text-zinc-400 text-xs">Código: <span className="font-mono text-zinc-200">{a.person.access_code}</span> · última entrada {a.last_entry ? fmtDateTime(a.last_entry) : 'nunca'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={() => checkIn()} className={btnSmall}>Registrar entrada</button>
        {!a.allowed && !blocked && <button onClick={() => setOverriding(v => !v)} className={btnSmall}>Dejar pasar de todos modos</button>}
        <button onClick={() => setShowQr(v => !v)} className={btnSmall}>{showQr ? 'Ocultar QR' : 'QR de entrada'}</button>
        {isAdmin && (blocked
          ? <button onClick={() => setBlock(false)} className={btnSmall}>Desbloquear</button>
          : <button onClick={() => setBlocking(v => !v)} className={btnSmall}>Bloquear acceso</button>)}
        {isAdmin && <button onClick={() => setBlock(blocked, true)} className={btnSmall} title="Si perdió su QR o se lo pasó a alguien">Nuevo código</button>}
      </div>
      {showQr && (
        <div className="mt-3 inline-block bg-white p-3 rounded-xl">
          <QRCode value={a.person.access_code} size={140} />
        </div>
      )}
      {overriding && (
        <div className="flex gap-2 mt-3">
          <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="¿Por qué pasa? (ej. paga al salir, clase muestra)" className={input} />
          <button onClick={() => { checkIn(overrideReason); setOverriding(false); setOverrideReason('') }} disabled={overrideReason.trim().length < 3} className={btnSmall}>Dejar pasar</button>
        </div>
      )}
      {blocking && (
        <div className="flex gap-2 mt-3">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (ej. adeudo, conducta)" className={input} />
          <button onClick={() => setBlock(true)} className={btnDanger}>Bloquear</button>
        </div>
      )}
      {msg && <div className="mt-2"><Msg text={msg.text} tone={msg.tone} /></div>}
      {a.recent.length > 0 && (
        <details className="mt-3">
          <summary className="text-zinc-400 text-xs font-bold cursor-pointer">Últimas entradas ({a.recent.length})</summary>
          <div className="mt-1 divide-y divide-zinc-800/60">
            {a.recent.map((r, k) => (
              <div key={k} className="py-1.5 flex justify-between gap-2 text-xs">
                <span className={r.result === 'denied' ? 'text-alerta' : r.result === 'override' ? 'text-amarillo-suave' : 'text-exito'}>
                  {r.result === 'granted' ? 'Entró' : r.result === 'override' ? `Pasó con autorización${r.note ? `: ${r.note}` : ''}` : `Negado: ${r.reasons.map(x => ACCESS_REASONS[x] ?? x).join(', ')}`}
                </span>
                <span className="text-zinc-500 shrink-0">{fmtDateTime(r.created_at)}{r.by ? ` · ${r.by}` : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {!a.allowed && a.reasons.includes('no_membership') && <p className="text-zinc-500 text-xs mt-2">Puede entrar con membresía, pase del día o clase de hoy.</p>}
    </Card>
  )
}
