import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call } from '../../../lib/erp'
import { checklistError, timeRange, DOW_SHORT, KIND_LABELS, type TemplateBlock, type TemplateTask, type TaskKind } from '../../../lib/checklist'
import { Page, Card, Badge, Spinner, Msg, input, label, btnPrimary, btnSmall } from '../../../components/erp/ui'

// Plantilla del checklist (admin). Los bloques comunes se escriben una vez con
// sus días; cada tarea puede limitarse a algunos de esos días (tarea del día,
// extras del viernes). Guardar no cambia los días que ya se generaron.

const field = input.replace('w-full ', '')
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const t5 = (t: string | null) => (t ? t.slice(0, 5) : '')
const newTask = (): TemplateTask => ({ text: '', start_time: null, end_time: null, days: null, requires_photo: false, requires_amount: false, requires_note: false, required: true, kind: 'normal' })
const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a }

function DayChips({ value, allowed, onChange }: { value: number[]; allowed: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {allowed.map(d => (
        <button key={d} type="button" onClick={() => onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d].sort())}
          className={`w-8 h-8 rounded-lg text-xs font-bold border ${value.includes(d) ? 'bg-primario text-texto-en-acento border-primario' : 'border-zinc-700 text-zinc-400'}`}>
          {DOW_SHORT[d]}
        </button>
      ))}
    </div>
  )
}

export default function ChecklistTemplatePage() {
  const [blocks, setBlocks] = useState<TemplateBlock[] | null>(null)
  const [rules, setRules] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [filter, setFilter] = useState<number | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)

  const load = async () => {
    const { data, error } = await call<{ rules: string; blocks: TemplateBlock[] }>('get_checklist_template')
    if (error || !data) { setMsg({ text: checklistError(error), tone: 'error' }); return }
    setBlocks(data.blocks); setRules(data.rules); setDirty(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (!blocks) return <Page title="Plantilla del checklist"><Msg text={msg?.text ?? null} />{!msg && <Spinner />}</Page>

  const upd = (next: TemplateBlock[]) => { setBlocks(next); setDirty(true); setMsg(null) }
  const updBlock = (i: number, patch: Partial<TemplateBlock>) => upd(blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)))
  const updTask = (i: number, j: number, patch: Partial<TemplateTask>) =>
    updBlock(i, { tasks: blocks[i].tasks.map((t, k) => (k === j ? { ...t, ...patch } : t)) })

  const save = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await call<{ block?: number; task?: number }>('admin_save_checklist_template', { p: { rules, blocks } })
    setBusy(false)
    if (error) {
      const where = data?.block ? ` (bloque ${data.block}${data.task ? `, tarea ${data.task}` : ''})` : ''
      setMsg({ text: checklistError(error) + where, tone: 'error' }); return
    }
    setMsg({ text: 'Plantilla guardada. Se usa a partir del siguiente día que empiece.', tone: 'ok' })
    load()
  }

  const visible = (b: TemplateBlock) => filter == null || b.days.includes(filter)
  const taskVisible = (b: TemplateBlock, t: TemplateTask) => filter == null || (t.days ?? b.days).includes(filter)

  return (
    <Page title="Plantilla del checklist" width="max-w-3xl"
      subtitle={<>Lo que el staff ve cada día. Editarla no cambia días que ya empezaron (para hoy, si nadie ha marcado nada, usa “Volver a generar” en el <Link to="/staff/turno" className="text-primario underline">turno de hoy</Link>).</>}
      actions={<button onClick={save} disabled={busy || !dirty} className={btnPrimary}>{busy ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}</button>}>
      {msg && <Msg text={msg.text} tone={msg.tone} />}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-400 text-sm">Ver cómo queda:</span>
        <button onClick={() => setFilter(null)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${filter == null ? 'bg-primario text-texto-en-acento border-primario' : 'border-zinc-700 text-zinc-300'}`}>Todo</button>
        {ALL_DAYS.map(d => (
          <button key={d} onClick={() => setFilter(d)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${filter === d ? 'bg-primario text-texto-en-acento border-primario' : 'border-zinc-700 text-zinc-300'}`}>{DOW_SHORT[d]}</button>
        ))}
      </div>

      <Card title="Reglas del turno (texto para el staff, una por línea)">
        <textarea value={rules} onChange={e => { setRules(e.target.value); setDirty(true) }} rows={6} className={input} />
      </Card>

      {blocks.map((b, i) => !visible(b) ? null : (
        <section key={b.id ?? `new-${i}`} className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <label className={label}>Bloque</label>
              <input value={b.title} onChange={e => updBlock(i, { title: e.target.value })} className={input} />
            </div>
            <div className="w-36"><label className={label}>Desde</label><input type="time" value={t5(b.start_time)} onChange={e => updBlock(i, { start_time: e.target.value || null })} className={input} /></div>
            <div className="w-36"><label className={label}>Hasta</label><input type="time" value={t5(b.end_time)} onChange={e => updBlock(i, { end_time: e.target.value || null })} className={input} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DayChips value={b.days} allowed={ALL_DAYS} onChange={days => updBlock(i, { days, tasks: b.tasks.map(t => (t.days ? { ...t, days: t.days.filter(d => days.includes(d)) } : t)) })} />
            <input value={b.note ?? ''} onChange={e => updBlock(i, { note: e.target.value || null })} placeholder="Nota del bloque (opcional)" className={`${field} flex-1 min-w-[10rem] py-2`} />
            <div className="flex gap-1">
              <button onClick={() => upd(move(blocks, i, -1))} className={btnSmall} aria-label="Subir bloque">↑</button>
              <button onClick={() => upd(move(blocks, i, 1))} className={btnSmall} aria-label="Bajar bloque">↓</button>
              <button onClick={() => { if (window.confirm(`¿Borrar el bloque "${b.title}" y sus ${b.tasks.length} tareas?`)) upd(blocks.filter((_, k) => k !== i)) }} className={`${btnSmall} text-alerta`}>Borrar</button>
            </div>
          </div>

          <div className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
            {b.tasks.map((t, j) => {
              if (!taskVisible(b, t)) return null
              const key = `${i}-${j}`
              const open = openTask === key
              return (
                <div key={t.id ?? key} className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button onClick={() => updBlock(i, { tasks: move(b.tasks, j, -1) })} className="text-zinc-500 hover:text-texto-principal text-xs leading-none px-1" aria-label="Subir">▲</button>
                      <button onClick={() => updBlock(i, { tasks: move(b.tasks, j, 1) })} className="text-zinc-500 hover:text-texto-principal text-xs leading-none px-1" aria-label="Bajar">▼</button>
                    </div>
                    <input value={t.text} onChange={e => updTask(i, j, { text: e.target.value })} placeholder="Qué hay que hacer" className={`${field} py-2 flex-1 min-w-0`} />
                    <button onClick={() => setOpenTask(open ? null : key)} className={btnSmall}>{open ? 'Listo' : 'Opciones'}</button>
                    <button onClick={() => updBlock(i, { tasks: b.tasks.filter((_, k) => k !== j) })} className="text-zinc-500 hover:text-alerta px-1 text-lg" aria-label="Borrar tarea">×</button>
                  </div>
                  {!open && (
                    <div className="flex flex-wrap gap-1 mt-1 pl-7">
                      {t.days && <Badge>{t.days.map(d => DOW_SHORT[d]).join(' ')}</Badge>}
                      {t.start_time && <Badge>{timeRange(t.start_time, t.end_time)}</Badge>}
                      {t.requires_photo && <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Foto</Badge>}
                      {t.requires_amount && <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Monto</Badge>}
                      {t.requires_note && <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Reporte</Badge>}
                      {!t.required && <Badge>Opcional</Badge>}
                      {t.kind !== 'normal' && <Badge cls="text-primario bg-primario/10">{KIND_LABELS[t.kind]}</Badge>}
                    </div>
                  )}
                  {open && (
                    <div className="mt-2 pl-7 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-zinc-300">
                          <input type="checkbox" checked={t.days == null} onChange={e => updTask(i, j, { days: e.target.checked ? null : [...b.days] })} />
                          Todos los días del bloque
                        </label>
                        {t.days && <DayChips value={t.days} allowed={b.days} onChange={days => updTask(i, j, { days })} />}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="w-36"><label className={label}>Hora</label><input type="time" value={t5(t.start_time)} onChange={e => updTask(i, j, { start_time: e.target.value || null })} className={input} /></div>
                        <div className="w-36"><label className={label}>Hasta (opcional)</label><input type="time" value={t5(t.end_time)} onChange={e => updTask(i, j, { end_time: e.target.value || null })} className={input} /></div>
                        <div className="w-48"><label className={label}>Tipo</label>
                          <select value={t.kind} onChange={e => { const kind = e.target.value as TaskKind; updTask(i, j, { kind, requires_amount: kind === 'cash_open' || kind === 'cash_close' ? true : t.requires_amount }) }} className={input}>
                            {(Object.keys(KIND_LABELS) as TaskKind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-zinc-300">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={t.requires_photo} onChange={e => updTask(i, j, { requires_photo: e.target.checked })} />Pide foto</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={t.requires_amount} disabled={t.kind !== 'normal'} onChange={e => updTask(i, j, { requires_amount: e.target.checked })} />Pide monto</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={t.requires_note} onChange={e => updTask(i, j, { requires_note: e.target.checked })} />Pide reporte escrito</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={t.required} onChange={e => updTask(i, j, { required: e.target.checked })} />Obligatoria</label>
                      </div>
                      {t.kind === 'cash_open' && <p className="text-zinc-500 text-xs">Al marcarla se abre la Caja de la app con el fondo contado (o usa la caja ya abierta).</p>}
                      {t.kind === 'cash_close' && <p className="text-zinc-500 text-xs">Al marcarla se hace el corte en la Caja; si no cuadra pide explicación.</p>}
                      {t.kind === 'teardown' && <p className="text-zinc-500 text-xs">Muestra las rutas que elegiste en Turnos → Desmontaje.</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <button onClick={() => { updBlock(i, { tasks: [...b.tasks, { ...newTask(), days: filter && b.days.includes(filter) && b.days.length > 1 ? [filter] : null }] }); setOpenTask(`${i}-${b.tasks.length}`) }} className={btnSmall}>
            + Tarea{filter ? ` (solo ${DOW_SHORT[filter]})` : ''}
          </button>
        </section>
      ))}

      <button onClick={() => upd([...blocks, { title: 'Nuevo bloque', start_time: null, end_time: null, days: filter ? [filter] : [1, 2, 3, 4, 5], note: null, tasks: [newTask()] }])} className={btnSmall}>
        + Bloque
      </button>
      {dirty && (
        <div className="sticky bottom-3 flex justify-end">
          <button onClick={save} disabled={busy} className={`${btnPrimary} shadow-xl`}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      )}
    </Page>
  )
}
