import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { call, money, fmtDate, fmtDateTime, toCents } from '../../../lib/erp'
import { checklistError, checklistPhotoUrl, uploadChecklistPhoto, timeRange, hhmm, DOW_LONG, type ChecklistDay, type DayTask } from '../../../lib/checklist'
import { Card, Spinner, Msg, MoneyField, input, label, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'

// Checklist del turno: el staff marca cada tarea (quién y a qué hora queda
// guardado), sube fotos, captura montos, reporta en el momento y el
// encargado cierra el turno con la bitácora. Pensado para el celular.

const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' }) : '')

interface Block { key: string; title: string; start: string | null; end: string | null; note: string | null; tasks: DayTask[] }

export default function ChecklistPage() {
  const { date } = useParams()
  const [day, setDay] = useState<ChecklistDay | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<DayTask | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(nowHHMM())

  const load = useCallback(async () => {
    const { data, error } = date ? await call<ChecklistDay>('get_checklist_day', { p_date: date }) : await call<ChecklistDay>('get_checklist_today')
    if (error || !data) { setLoadError(checklistError(error)); return }
    setLoadError(null); setDay(data)
  }, [date])
  useEffect(() => { setDay(null); load() }, [load])
  // Se refresca solo (para ver en vivo lo que marcan los demás).
  useEffect(() => {
    const t = setInterval(() => { setNow(nowHHMM()); if (document.visibilityState === 'visible' && !sheet && !noteOpen) load() }, 20000)
    return () => clearInterval(t)
  }, [load, sheet, noteOpen])

  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = []
    for (const t of day?.tasks ?? []) {
      const key = `${t.block_position}-${t.block_title}`
      let b = out.find(x => x.key === key)
      if (!b) { b = { key, title: t.block_title, start: t.block_start, end: t.block_end, note: t.block_note, tasks: [] }; out.push(b) }
      b.tasks.push(t)
    }
    return out
  }, [day])

  if (loadError) return <div className="p-6"><Msg text={loadError} /></div>
  if (!day) return <Spinner />

  const isToday = day.date === day.today
  const editable = day.status === 'open' && (isToday || day.is_admin) && day.generated
  const req = day.tasks.filter(t => t.required)
  const reqDone = req.filter(t => t.done_at || t.skipped_reason).length
  const pct = req.length ? Math.round((reqDone / req.length) * 100) : 0
  const iAmLead = !day.lead_id || day.lead_id === day.me || day.is_admin
  const blockDone = (b: Block) => b.tasks.every(t => t.done_at || t.skipped_reason)
  const blockNow = (b: Block) => !!b.start && b.start.slice(0, 5) <= now && now < (b.end && b.end !== b.start ? b.end.slice(0, 5) : '99')
  const isOpen = (b: Block) => openBlocks[b.key] ?? (!blockDone(b) || !isToday)

  const quick = async (t: DayTask) => {
    if (!editable) { setSheet(t); return }
    if (t.done_at || t.skipped_reason || t.requires_photo || t.requires_amount || t.requires_note || t.kind !== 'normal') { setSheet(t); return }
    setBusy(t.id); setError(null)
    const { error } = await call('checklist_complete_task', { p_task_id: t.id, p: {} })
    setBusy(null)
    if (error) { setError(checklistError(error)); return }
    load()
  }

  return (
    <div className="h-full overflow-y-auto bg-fondo px-3 sm:px-6 pt-4 pb-28">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-texto-principal font-black text-2xl tracking-tight">{isToday ? 'Turno de hoy' : 'Turno'}</h1>
            <p className="text-zinc-400 text-sm">{DOW_LONG[day.dow]} {fmtDate(day.date)} · Encargado: <span className="text-texto-principal font-semibold">{day.lead_name ?? 'sin asignar'}</span></p>
          </div>
          {day.is_admin && <Link to="/staff/turnos" className={btnSmall}>Plan e historial</Link>}
        </div>

        {!day.generated ? (
          <Card><p className="text-zinc-400 text-sm">{day.date > day.today ? 'Este día todavía no empieza: el checklist se genera ese día.' : 'Ese día no hubo checklist.'}</p></Card>
        ) : day.tasks.length === 0 ? (
          <Card><p className="text-zinc-400 text-sm">Hoy no hay checklist ({DOW_LONG[day.dow].toLowerCase()}). Si debería haber, el admin lo agrega en la plantilla.</p></Card>
        ) : (
          <>
            {/* Avance */}
            <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-texto-principal font-bold">{reqDone} de {req.length} obligatorias</p>
                <p className={`font-black text-xl tabular-nums ${pct === 100 ? 'text-exito' : 'text-primario'}`}>{pct}%</p>
              </div>
              <div className="h-2.5 bg-superficie-alta rounded-full mt-2 overflow-hidden"><div className={`h-full rounded-full ${pct === 100 ? 'bg-exito' : 'bg-primario'}`} style={{ width: `${pct}%` }} /></div>
              {day.status === 'closed' && <p className="text-exito text-sm font-semibold mt-2">Turno cerrado por {day.closed_by_name ?? '—'} · {fmtDateTime(day.closed_at)}</p>}
            </div>

            {day.cash_open_other_day && <Msg text="Hay una caja abierta de otro día. Ciérrala en Caja antes de contar el fondo de hoy." />}

            {/* Bitácora anterior + reglas */}
            {isToday && day.prev && (day.prev.log || day.prev.notes.length > 0) && <PrevLog prev={day.prev} />}
            <details className="bg-superficie rounded-2xl border border-zinc-800/80 p-4">
              <summary className="text-texto-principal font-semibold text-sm cursor-pointer">Reglas del turno</summary>
              <ul className="mt-2 space-y-1.5 text-zinc-300 text-sm list-disc pl-5">{day.rules.split('\n').filter(Boolean).map((r, i) => <li key={i}>{r}</li>)}</ul>
            </details>

            {editable && isToday && (
              <button onClick={() => setNoteOpen(true)} className="w-full py-3.5 rounded-2xl border-2 border-dashed border-amarillo-suave/50 text-amarillo-suave font-bold text-sm">
                ⚠ Reportar algo ahora (se rompió, se acabó, incidente)
              </button>
            )}
            <Msg text={error} />

            {/* Bloques */}
            {blocks.map(b => {
              const done = b.tasks.filter(t => t.done_at || t.skipped_reason).length
              const current = isToday && day.status === 'open' && blockNow(b)
              return (
                <section key={b.key} className={`bg-superficie rounded-2xl border ${current ? 'border-primario/70' : 'border-zinc-800/80'} overflow-hidden`}>
                  <button onClick={() => setOpenBlocks(o => ({ ...o, [b.key]: !isOpen(b) }))} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-500 text-xs font-bold">{timeRange(b.start, b.end) || 'Al cerrar'}{current && <span className="text-primario"> · AHORA</span>}</p>
                      <p className="text-texto-principal font-bold">{b.title}</p>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${done === b.tasks.length ? 'text-exito' : 'text-zinc-400'}`}>{done}/{b.tasks.length}</span>
                  </button>
                  {isOpen(b) && (
                    <div className="border-t border-zinc-800/80">
                      {b.note && <p className="px-4 pt-2 text-zinc-500 text-xs">{b.note}</p>}
                      {b.tasks.map(t => <TaskRow key={t.id} t={t} busy={busy === t.id} onTap={() => quick(t)} onMore={() => setSheet(t)} />)}
                      {b.tasks.some(t => t.kind === 'teardown') && <Teardown day={day} editable={editable && isToday} onChange={load} />}
                    </div>
                  )}
                </section>
              )
            })}

            {/* Reportes del momento */}
            {day.notes.length > 0 && (
              <Card title={`Reportes del día (${day.notes.length})`}>
                <div className="space-y-3">
                  {day.notes.map(n => (
                    <div key={n.id} className="flex gap-3">
                      {n.photo_path && <Thumb path={n.photo_path} />}
                      <div className="min-w-0">
                        <p className="text-texto-principal text-sm">{n.text}</p>
                        <p className="text-zinc-500 text-xs">{n.by ?? '—'} · {timeOf(n.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {day.cash && (
              <p className="text-zinc-500 text-xs px-1">
                Caja: fondo {money(day.cash.opening_cents)}
                {day.cash.closed_at != null && <> · contado {money(day.cash.counted_cents)} · esperado {money(day.cash.expected_cents)} · diferencia <span className={day.cash.difference_cents ? 'text-alerta font-bold' : ''}>{money(day.cash.difference_cents)}</span></>}
              </p>
            )}

            <CloseShift day={day} editable={editable} canClose={iAmLead} onDone={load} />
            {day.is_admin && <AdminDayActions day={day} onDone={load} />}
          </>
        )}
      </div>

      {sheet && <TaskSheet t={day.tasks.find(x => x.id === sheet.id) ?? sheet} day={day} editable={editable} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load() }} />}
      {noteOpen && <NoteSheet date={day.date} onClose={() => setNoteOpen(false)} onDone={() => { setNoteOpen(false); load() }} />}
    </div>
  )
}

function TaskRow({ t, busy, onTap, onMore }: { t: DayTask; busy: boolean; onTap: () => void; onMore: () => void }) {
  const done = !!t.done_at
  const skipped = !done && !!t.skipped_reason
  return (
    <div className="flex items-stretch border-b border-zinc-800/60 last:border-b-0">
      <button onClick={onTap} disabled={busy} className="flex-1 flex items-start gap-3 px-4 py-3.5 text-left active:bg-superficie-alta/60 disabled:opacity-60 min-h-[56px]">
        <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-sm font-black ${
          done ? 'bg-exito border-exito text-fondo' : skipped ? 'border-alerta text-alerta' : 'border-zinc-600'}`}>
          {done ? '✓' : skipped ? '✕' : busy ? '…' : ''}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] leading-snug ${done ? 'text-zinc-400' : 'text-texto-principal'}`}>
            {t.start_time && <span className="text-primario font-bold">{timeRange(t.start_time, t.end_time)} · </span>}{t.text}
            {!t.required && <span className="text-zinc-500 text-xs"> (opcional)</span>}
          </span>
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-xs">
            {!done && t.requires_photo && <span className="text-amarillo-suave font-semibold">📷 Foto</span>}
            {!done && (t.requires_amount || t.kind === 'cash_open' || t.kind === 'cash_close') && <span className="text-amarillo-suave font-semibold">$ Monto</span>}
            {!done && t.requires_note && <span className="text-amarillo-suave font-semibold">✎ Reporte</span>}
            {done && <span className="text-zinc-500">{t.done_by_name ?? '—'} · {timeOf(t.done_at)}{t.photo_path ? ' · 📷' : ''}{t.amount_cents != null ? ` · ${money(t.amount_cents)}` : ''}</span>}
            {done && t.note && <span className="text-zinc-400 w-full">“{t.note}”</span>}
            {skipped && <span className="text-alerta w-full">No se hizo: {t.skipped_reason} ({t.skipped_by_name})</span>}
          </span>
        </span>
      </button>
      <button onClick={onMore} aria-label="Más opciones" className="px-3 text-zinc-500 hover:text-texto-principal text-lg">⋯</button>
    </div>
  )
}

function Thumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { checklistPhotoUrl(path).then(setUrl) }, [path])
  if (!url) return <div className="w-16 h-16 rounded-lg bg-superficie-alta shrink-0" />
  return <a href={url} target="_blank" rel="noreferrer" className="shrink-0"><img src={url} alt="Foto" className="w-16 h-16 rounded-lg object-cover border border-zinc-700" /></a>
}

function PhotoField({ date, path, onChange }: { date: string; path: string | null; onChange: (p: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pick = async (f: File | undefined) => {
    if (!f) return
    setUploading(true); setErr(null)
    const { path: p, error } = await uploadChecklistPhoto(date, f)
    setUploading(false)
    if (error) { setErr(error); return }
    onChange(p)
  }
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <div className="flex items-center gap-3">
        {path && <Thumb path={path} />}
        <button type="button" onClick={() => ref.current?.click()} disabled={uploading} className={`${btnGhost} flex-1 py-3.5`}>
          {uploading ? 'Subiendo…' : path ? 'Cambiar foto' : '📷 Tomar foto'}
        </button>
      </div>
      <Msg text={err} />
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-superficie rounded-t-3xl sm:rounded-3xl border border-zinc-800 p-5 pb-8 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-texto-principal font-bold text-lg leading-snug">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 text-2xl leading-none px-1">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function TaskSheet({ t, day, editable, onClose, onDone }: { t: DayTask; day: ChecklistDay; editable: boolean; onClose: () => void; onDone: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [skipMode, setSkipMode] = useState(false)
  const [needsNote, setNeedsNote] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = !!t.done_at
  const cashOpenDone = t.kind === 'cash_open' && !!day.cash
  const cashCloseDone = t.kind === 'cash_close' && !!day.cash?.closed_at && !day.cash_open_other_day
  const askAmount = !done && ((t.kind === 'cash_open' && !cashOpenDone) || (t.kind === 'cash_close' && !cashCloseDone) || (t.kind === 'normal' && t.requires_amount))
  const canUndo = editable && (done || !!t.skipped_reason) && (day.is_admin || (t.done_by ?? t.skipped_by) === day.me)

  const complete = async () => {
    setError(null)
    if (t.requires_photo && !photo) { setError('Toma la foto primero.'); return }
    if (askAmount && amount === '') { setError('Escribe el monto.'); return }
    setBusy(true)
    const { data, error } = await call<{ expected_cash?: number }>('checklist_complete_task', {
      p_task_id: t.id, p: { photo_path: photo, amount_cents: askAmount ? toCents(amount) : null, note: note.trim() || null },
    })
    setBusy(false)
    if (error === 'difference_needs_note') { setNeedsNote(data?.expected_cash ?? null); setError(`No cuadra: se esperaban ${money(data?.expected_cash)}. Escribe en la nota por qué.`); return }
    if (error) { setError(checklistError(error)); return }
    onDone()
  }
  const skip = async () => {
    setBusy(true); setError(null)
    const { error } = await call('checklist_skip_task', { p_task_id: t.id, p_reason: reason })
    setBusy(false)
    if (error) { setError(checklistError(error)); return }
    onDone()
  }
  const undo = async () => {
    setBusy(true); setError(null)
    const { error } = await call('checklist_undo_task', { p_task_id: t.id })
    setBusy(false)
    if (error) { setError(checklistError(error)); return }
    onDone()
  }

  return (
    <Sheet title={t.text} onClose={onClose}>
      {t.start_time && <p className="text-primario text-sm font-bold -mt-2">{timeRange(t.start_time, t.end_time)}</p>}
      {done || t.skipped_reason ? (
        <div className="space-y-3">
          {done ? (
            <p className="text-exito font-semibold text-sm">✓ Hecha por {t.done_by_name ?? '—'} a las {timeOf(t.done_at)}{t.amount_cents != null ? ` · ${money(t.amount_cents)}` : ''}</p>
          ) : (
            <p className="text-alerta font-semibold text-sm">No se hizo: {t.skipped_reason} ({t.skipped_by_name})</p>
          )}
          {t.note && <p className="text-zinc-300 text-sm">“{t.note}”</p>}
          {t.photo_path && <Thumb path={t.photo_path} />}
          {(t.kind === 'cash_open' || t.kind === 'cash_close') && done && <p className="text-zinc-500 text-xs">Desmarcarla no cambia la Caja.</p>}
          {canUndo && <button onClick={undo} disabled={busy} className={`${btnGhost} w-full py-3`}>Desmarcar</button>}
        </div>
      ) : !editable ? (
        <p className="text-zinc-400 text-sm">Pendiente.</p>
      ) : skipMode ? (
        <div className="space-y-3">
          <label className={label} htmlFor="skip-reason">¿Por qué no se hizo?</label>
          <textarea id="skip-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} className={input} placeholder="Ej. se acabó el líquido de trapear" autoFocus />
          <div className="flex gap-2">
            <button onClick={() => setSkipMode(false)} className={`${btnGhost} flex-1 py-3`}>Volver</button>
            <button onClick={skip} disabled={busy || reason.trim().length < 3} className={`${btnPrimary} flex-1 py-3`}>Guardar motivo</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {t.kind === 'cash_open' && (cashOpenDone
            ? <p className="text-zinc-300 text-sm">La caja de hoy ya se abrió con <b>{money(day.cash?.opening_cents)}</b>. Solo falta la foto.</p>
            : <p className="text-zinc-400 text-sm">Cuenta el efectivo del fondo. Al guardar se abre la caja de hoy con ese monto.</p>)}
          {t.kind === 'cash_close' && (cashCloseDone
            ? <p className="text-zinc-300 text-sm">El corte de hoy ya se hizo: contado <b>{money(day.cash?.counted_cents)}</b>. Solo falta la foto.</p>
            : <p className="text-zinc-400 text-sm">Cuenta todo el efectivo de la caja. Al guardar se hace el corte en la app; si no cuadra te pedirá explicar la diferencia.</p>)}
          {t.requires_photo && <PhotoField date={day.date} path={photo} onChange={setPhoto} />}
          {askAmount && <MoneyField id="task-amount" label={t.kind === 'cash_open' ? 'Fondo contado' : t.kind === 'cash_close' ? 'Efectivo contado' : 'Monto'} value={amount} onChange={setAmount} />}
          {(t.requires_note || t.kind === 'cash_close' || !t.requires_photo) && (
            <div>
              <label className={label} htmlFor="task-note">{t.requires_note ? 'Reporte (obligatorio)' : needsNote != null ? 'Explica la diferencia (obligatorio)' : 'Nota (opcional)'}</label>
              <textarea id="task-note" value={note} onChange={e => setNote(e.target.value)} rows={t.requires_note ? 4 : 2} className={input} />
            </div>
          )}
          {!t.requires_photo && <details><summary className="text-zinc-400 text-xs cursor-pointer">Agregar foto (opcional)</summary><div className="mt-2"><PhotoField date={day.date} path={photo} onChange={setPhoto} /></div></details>}
          <Msg text={error} />
          <button onClick={complete} disabled={busy} className={`${btnPrimary} w-full py-4 text-base`}>{busy ? 'Guardando…' : '✓ Hecha'}</button>
          <button onClick={() => setSkipMode(true)} className="w-full text-zinc-400 text-sm font-semibold py-2">No se pudo hacer…</button>
        </div>
      )}
      {(done || t.skipped_reason) && <Msg text={error} />}
    </Sheet>
  )
}

function NoteSheet({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    const { error } = await call('checklist_add_note', { p_text: text, p_photo_path: photo })
    setBusy(false)
    if (error) { setError(checklistError(error)); return }
    onDone()
  }
  return (
    <Sheet title="Reportar algo" onClose={onClose}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} className={input} autoFocus placeholder="¿Qué se rompió, faltó o se acabó? ¿Qué pasó?" />
      <PhotoField date={date} path={photo} onChange={setPhoto} />
      <Msg text={error} />
      <button onClick={save} disabled={busy || text.trim().length < 3} className={`${btnPrimary} w-full py-4 text-base`}>{busy ? 'Enviando…' : 'Enviar reporte'}</button>
    </Sheet>
  )
}

function PrevLog({ prev }: { prev: NonNullable<ChecklistDay['prev']> }) {
  return (
    <details open className="bg-superficie rounded-2xl border border-zinc-800/80 p-4">
      <summary className="text-texto-principal font-semibold text-sm cursor-pointer">Bitácora del turno anterior · {DOW_LONG[new Date(prev.date + 'T12:00:00').getDay() || 7]} {fmtDate(prev.date)}</summary>
      <div className="mt-2 space-y-2 text-sm">
        {prev.log && (
          <>
            <p><span className="text-zinc-500">Qué pasó:</span> <span className="text-zinc-200">{prev.log.happened}</span></p>
            <p><span className="text-zinc-500">Quedó pendiente:</span> <span className="text-zinc-200">{prev.log.pending}</span></p>
            <p><span className="text-zinc-500">Se rompió o se acabó:</span> <span className="text-zinc-200">{prev.log.broken}</span></p>
          </>
        )}
        {prev.notes.length > 0 && <div><p className="text-zinc-500">Reportes:</p><ul className="list-disc pl-5 text-zinc-200">{prev.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
      </div>
    </details>
  )
}

function Teardown({ day, editable, onChange }: { day: ChecklistDay; editable: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const retire = async (id: string) => {
    setBusy(id); setError(null)
    const { error } = await call('checklist_retire_route', { p_route_id: id })
    setBusy(null)
    if (error) { setError(checklistError(error)); return }
    onChange()
  }
  return (
    <div className="mx-4 my-3 rounded-xl bg-superficie-alta/50 border border-zinc-700/50 p-3 space-y-2">
      <p className="text-texto-principal text-sm font-bold">Lo que pidió Inge desmontar</p>
      {!day.teardown_note && day.teardown_routes.length === 0 && <p className="text-amarillo-suave text-sm">Todavía no hay indicación. Pregúntale antes de desmontar.</p>}
      {day.teardown_note && <p className="text-zinc-200 text-sm whitespace-pre-line">{day.teardown_note}</p>}
      {day.teardown_routes.map(r => (
        <div key={r.id} className="flex items-center gap-3">
          <span className="flex-1 text-sm text-zinc-200">#{r.route_number} · {r.color} {r.grade}{r.zone ? ` · ${r.zone}` : ''}</span>
          {r.status === 'retired'
            ? <span className="text-exito text-xs font-bold">Desmontada</span>
            : editable && <button onClick={() => retire(r.id)} disabled={busy === r.id} className={btnSmall}>{busy === r.id ? '…' : 'Ya la desmonté'}</button>}
        </div>
      ))}
      <Msg text={error} />
    </div>
  )
}

function CloseShift({ day, editable, canClose, onDone }: { day: ChecklistDay; editable: boolean; canClose: boolean; onDone: () => void }) {
  const [log, setLog] = useState({ happened: '', pending: '', broken: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string[]>([])

  if (day.status === 'closed') {
    return day.log ? (
      <Card title="Bitácora del turno" tone="success">
        <div className="space-y-1.5 text-sm">
          <p><span className="text-zinc-500">Qué pasó:</span> <span className="text-zinc-200">{day.log.happened}</span></p>
          <p><span className="text-zinc-500">Quedó pendiente:</span> <span className="text-zinc-200">{day.log.pending}</span></p>
          <p><span className="text-zinc-500">Se rompió o se acabó:</span> <span className="text-zinc-200">{day.log.broken}</span></p>
        </div>
      </Card>
    ) : null
  }
  if (!editable) return null
  const close = async () => {
    setBusy(true); setError(null); setPending([])
    const { data, error } = await call<{ pending?: string[] }>('checklist_close_day', { p: { date: day.date, ...log } })
    setBusy(false)
    if (error) { setError(checklistError(error)); setPending(data?.pending ?? []); return }
    onDone()
  }
  const field = (k: keyof typeof log, l: string, ph: string) => (
    <div>
      <label className={label} htmlFor={`log-${k}`}>{l}</label>
      <textarea id={`log-${k}`} value={log[k]} onChange={e => setLog({ ...log, [k]: e.target.value })} rows={2} className={input} placeholder={ph} />
    </div>
  )
  return (
    <Card title="Bitácora y cierre del turno" tone="accent">
      <div className="space-y-3">
        {field('happened', 'Qué pasó', 'Cómo estuvo el turno, incidentes, objetos olvidados…')}
        {field('pending', 'Qué quedó pendiente', 'Si no hubo, escribe "nada"')}
        {field('broken', 'Qué se rompió o se acabó', 'Si no hubo, escribe "nada"')}
        <Msg text={error} />
        {pending.length > 0 && <ul className="list-disc pl-5 text-amarillo-suave text-sm">{pending.slice(0, 15).map((p, i) => <li key={i}>{p}</li>)}{pending.length > 15 && <li>y {pending.length - 15} más…</li>}</ul>}
        {canClose
          ? <button onClick={close} disabled={busy} className={`${btnPrimary} w-full py-4 text-base`}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button>
          : <p className="text-zinc-400 text-sm">Solo {day.lead_name} (encargado de hoy) puede cerrar el turno.</p>}
      </div>
    </Card>
  )
}

function AdminDayActions({ day, onDone }: { day: ChecklistDay; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const started = day.tasks.some(t => t.done_at || t.skipped_reason)
  const run = async (fn: string) => {
    setMsg(null)
    const { error } = await call(fn, { p_date: day.date })
    if (error) { setMsg(checklistError(error)); return }
    onDone()
  }
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {day.status === 'closed' && <button onClick={() => run('admin_reopen_checklist_day')} className={btnSmall}>Reabrir turno</button>}
      {day.status === 'open' && !started && <button onClick={() => run('admin_regenerate_checklist_day')} className={btnSmall}>Volver a generar con la plantilla actual</button>}
      <Msg text={msg} />
      {day.status === 'open' && day.date === day.today && <p className="text-zinc-500 text-xs w-full">Se actualiza solo cada 20 segundos · {hhmm(nowHHMM())}</p>}
    </div>
  )
}
