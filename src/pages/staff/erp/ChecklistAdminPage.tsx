import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, money, fmtDate, fmtDateTime, todayMx } from '../../../lib/erp'
import { checklistError, DOW_LONG } from '../../../lib/checklist'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'

// Admin: encargado de turno por FECHA (los días de Ximena cambian cada semana),
// qué desmontar el sábado, e historial de turnos por fecha y persona.

interface PlanDay { date: string; dow: number; lead_id: string | null; teardown_note: string | null; teardown_route_ids: string[]; status: string | null; generated: boolean; has_template: boolean }
interface Plan { today: string; staff: { id: string; name: string; role: string }[]; routes: { id: string; route_number: number; color: string; grade: string; zone: string | null }[]; days: PlanDay[] }
interface HistDay {
  date: string; dow: number; status: string; closed_at: string | null; lead_name: string | null; closed_by_name: string | null
  total: number; done: number; skipped: number; missing: number; photos: number; notes: number; cash_difference_cents: number | null
  by_person: { name: string; n: number }[]
}

const field = input.replace('w-full ', '')
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

export default function ChecklistAdminPage() {
  return (
    <Page title="Turnos" subtitle="Quién es el encargado cada día, qué se desmonta el sábado y cómo quedó cada turno."
      actions={<><Link to="/staff/turno" className={btnSmall}>Ver turno de hoy</Link><Link to="/staff/config/checklist" className={btnSmall}>Editar plantilla</Link></>}>
      <PlanCard />
      <HistoryCard />
    </Page>
  )
}

function PlanCard() {
  const [from, setFrom] = useState(todayMx())
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [teardown, setTeardown] = useState<PlanDay | null>(null)
  const [defaultLead, setDefaultLead] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await call<Plan>('get_checklist_plan', { p_from: from, p_to: addDays(from, 13) })
    if (error) { setError(checklistError(error)); return }
    setPlan(data)
    const { data: dl } = await call<{ lead_id: string | null }>('get_checklist_default_lead')
    setDefaultLead(dl?.lead_id ?? null)
  }, [from])
  useEffect(() => { load() }, [load])

  const setLead = async (d: PlanDay, lead: string) => {
    setError(null)
    const { error } = await call('admin_set_checklist_day', { p_date: d.date, p: { lead_id: lead || null } })
    if (error) { setError(checklistError(error)); return }
    load()
  }
  const saveDefaultLead = async (lead: string) => {
    setError(null)
    const { error } = await call('admin_set_checklist_default_lead', { p_profile_id: lead || null })
    if (error) { setError(checklistError(error)); return }
    load()
  }
  if (!plan) return <Card title="Encargados"><Spinner /></Card>
  const routeName = (id: string) => { const r = plan.routes.find(x => x.id === id); return r ? `#${r.route_number} ${r.color} ${r.grade}` : 'ruta ya retirada' }
  return (
    <Card title="Encargado de turno por día" actions={
      <div className="flex gap-1">
        <button onClick={() => setFrom(addDays(from, -7))} className={btnSmall}>←</button>
        <button onClick={() => setFrom(todayMx())} className={btnSmall}>Hoy</button>
        <button onClick={() => setFrom(addDays(from, 7))} className={btnSmall}>→</button>
      </div>}>
      <Msg text={error} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label htmlFor="default-lead" className="text-zinc-300 text-sm font-semibold">Encargado fijo</label>
        <select id="default-lead" value={defaultLead ?? ''} onChange={e => saveDefaultLead(e.target.value)} className={`${field} w-52 py-2`}>
          <option value="">Ninguno (asignar por día)</option>
          {plan.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="text-zinc-500 text-xs w-full">Cada día nuevo lo toma solo. Si un día lo cubre otra persona, cámbialo abajo solo en ese día.</p>
      </div>
      <div className="divide-y divide-zinc-800/80">
        {plan.days.map(d => (
          <div key={d.date} className={`py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${d.date === plan.today ? 'bg-primario/5 -mx-2 px-2 rounded-lg' : ''}`}>
            <div className="w-32 shrink-0">
              <p className="text-texto-principal text-sm font-semibold">{DOW_LONG[d.dow]}</p>
              <p className="text-zinc-500 text-xs">{fmtDate(d.date)}{d.date === plan.today ? ' · hoy' : ''}</p>
            </div>
            {d.has_template ? (
              <select value={d.lead_id ?? ''} onChange={e => setLead(d, e.target.value)} className={`${field} w-44 py-2`} aria-label={`Encargado del ${fmtDate(d.date)}`}>
                <option value="">{d.status === null && defaultLead ? `${plan.staff.find(s => s.id === defaultLead)?.name ?? 'Fijo'} (fijo)` : 'Sin asignar'}</option>
                {plan.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <span className="text-zinc-500 text-sm w-44">Cerrado (sin checklist)</span>}
            {d.status === 'closed' && <Badge cls="text-exito bg-exito/10">Cerrado</Badge>}
            {d.status === 'open' && d.generated && <Badge cls="text-primario bg-primario/10">En curso</Badge>}
            {d.dow === 6 && (
              <button onClick={() => setTeardown(d)} className={`${btnSmall} ml-auto`}>
                Desmontaje: {d.teardown_route_ids.length || d.teardown_note ? `${d.teardown_route_ids.length} rutas${d.teardown_note ? ' + nota' : ''}` : 'sin indicar'}
              </button>
            )}
            {d.dow === 6 && d.teardown_route_ids.length > 0 && (
              <p className="w-full text-zinc-500 text-xs pl-0 sm:pl-[8.75rem]">{d.teardown_route_ids.map(routeName).join(' · ')}</p>
            )}
          </div>
        ))}
      </div>
      {teardown && <TeardownEditor day={teardown} routes={plan.routes} onClose={() => setTeardown(null)} onSaved={() => { setTeardown(null); load() }} />}
    </Card>
  )
}

function TeardownEditor({ day, routes, onClose, onSaved }: { day: PlanDay; routes: Plan['routes']; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<string[]>(day.teardown_route_ids)
  const [note, setNote] = useState(day.teardown_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zones = [...new Set(routes.map(r => r.zone ?? 'Sin zona'))]
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const save = async () => {
    setBusy(true); setError(null)
    const { error } = await call('admin_set_checklist_day', { p_date: day.date, p: { teardown_route_ids: sel, teardown_note: note } })
    setBusy(false)
    if (error) { setError(checklistError(error)); return }
    onSaved()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-superficie rounded-t-3xl sm:rounded-3xl border border-zinc-800 p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-texto-principal font-bold text-lg">Desmontaje del sábado {fmtDate(day.date)}</h2>
          <button onClick={onClose} className="text-zinc-400 text-2xl leading-none">×</button>
        </div>
        <p className="text-zinc-400 text-sm">Marca las rutas a desmontar. El staff las ve en su checklist y, al quitarlas, quedan retiradas en la pared (y su QR libre).</p>
        {zones.map(z => (
          <div key={z}>
            <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest mb-1">{z}</p>
            <div className="flex flex-wrap gap-1.5">
              {routes.filter(r => (r.zone ?? 'Sin zona') === z).map(r => (
                <button key={r.id} onClick={() => toggle(r.id)}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${sel.includes(r.id) ? 'bg-primario text-texto-en-acento border-primario' : 'border-zinc-700 text-zinc-300'}`}>
                  #{r.route_number} {r.color} {r.grade}
                </button>
              ))}
            </div>
          </div>
        ))}
        {routes.length === 0 && <Empty>No hay rutas activas.</Empty>}
        <div>
          <label className={label} htmlFor="td-note">Indicaciones (volúmenes, otras cosas)</label>
          <textarea id="td-note" value={note} onChange={e => setNote(e.target.value)} rows={3} className={input} placeholder="Ej. también el volumen grande de la zona 1" />
        </div>
        <Msg text={error} />
        <div className="flex gap-2">
          <button onClick={onClose} className={`${btnGhost} flex-1`}>Cancelar</button>
          <button onClick={save} disabled={busy} className={`${btnPrimary} flex-1`}>{busy ? 'Guardando…' : `Guardar (${sel.length} rutas)`}</button>
        </div>
      </div>
    </div>
  )
}

function HistoryCard() {
  const [to, setTo] = useState(todayMx())
  const [from, setFrom] = useState(addDays(todayMx(), -30))
  const [person, setPerson] = useState('')
  const [data, setData] = useState<{ staff: { id: string; name: string }[]; days: HistDay[] } | null>(null)
  useEffect(() => {
    call<{ staff: { id: string; name: string }[]; days: HistDay[] }>('get_checklist_history', { p_from: from, p_to: to, p_person: person || null }).then(({ data }) => setData(data))
  }, [from, to, person])
  return (
    <Card title="Historial de turnos">
      <div className="flex flex-wrap gap-2 mb-3">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${field} w-40`} aria-label="Desde" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${field} w-40`} aria-label="Hasta" />
        <select value={person} onChange={e => setPerson(e.target.value)} className={`${field} w-44`} aria-label="Persona">
          <option value="">Todos</option>
          {data?.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {!data ? <Spinner /> : data.days.length === 0 ? <Empty>No hay turnos en esas fechas.</Empty> : (
        <div className="divide-y divide-zinc-800/80">
          {data.days.map(d => (
            <Link key={d.date} to={`/staff/turno/${d.date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-superficie-alta/40 -mx-2 px-2 rounded-lg">
              <div className="w-36">
                <p className="text-texto-principal text-sm font-semibold">{DOW_LONG[d.dow]} {fmtDate(d.date)}</p>
                <p className="text-zinc-500 text-xs">Encargado: {d.lead_name ?? '—'}</p>
              </div>
              <div className="flex-1 min-w-[12rem] text-sm">
                <p className="text-zinc-200">{d.done}/{d.total} hechas
                  {d.missing > 0 && <span className="text-alerta font-semibold"> · {d.missing} obligatorias sin hacer</span>}
                  {d.skipped > 0 && <span className="text-amarillo-suave"> · {d.skipped} con motivo</span>}
                </p>
                <p className="text-zinc-500 text-xs">{d.photos} fotos · {d.notes} reportes{d.by_person.length > 0 && ` · ${d.by_person.map(p => `${p.name} ${p.n}`).join(', ')}`}</p>
              </div>
              <div className="text-right text-xs">
                {d.status === 'closed'
                  ? <p className="text-exito font-semibold">Cerrado {fmtDateTime(d.closed_at)}</p>
                  : <p className="text-alerta font-semibold">No se cerró</p>}
                {d.cash_difference_cents != null && <p className={d.cash_difference_cents ? 'text-alerta' : 'text-zinc-500'}>Caja {d.cash_difference_cents ? `diferencia ${money(d.cash_difference_cents)}` : 'cuadró'}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}
