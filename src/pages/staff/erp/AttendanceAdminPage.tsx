import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, fmtDate, todayMx } from '../../../lib/erp'
import { DOW_LONG } from '../../../lib/checklist'
import { attendanceError, selfieUrl, timeOf, STATUS, type AttendanceDay, type AttendanceSettings, type Punch, type Summary } from '../../../lib/attendance'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'

// Asistencia (admin): retardos y faltas del mes por empleado, con selfies,
// justificar días, registros a mano y los ajustes (reglas, WiFi del muro, aviso).

interface ReportDay extends AttendanceDay { punches: Punch[] }
interface ReportEmployee {
  id: string; full_name: string; position: string | null; status: string
  has_login: boolean; has_schedule: boolean; consented: boolean; summary: Summary; days: ReportDay[]
}
interface Report { month: string; today: string; settings: AttendanceSettings; networks_count: number; employees: ReportEmployee[] }

const field = input.replace('w-full ', '')
const monthLabel = (m: string) => new Date(m + 'T12:00:00Z').toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const addMonths = (m: string, n: number) => { const x = new Date(m + 'T12:00:00Z'); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10) }

export default function AttendanceAdminPage() {
  const [month, setMonth] = useState(todayMx().slice(0, 8) + '01')
  const [rep, setRep] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await call<Report>('get_attendance_report', { p_month: month })
    if (error || !data) { setError(error === 'server' ? 'No se pudo cargar. ¿Ya se corrió erp_asistencia.sql?' : attendanceError(error)); return }
    setRep(data)
  }, [month])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Asistencia"><p className="text-alerta text-sm">{error}</p></Page>
  if (!rep) return <Page title="Asistencia"><Spinner /></Page>
  const s = rep.settings

  return (
    <Page title="Asistencia" subtitle={`Tolerancia ${s.tolerance_min} min · desde ${s.absence_min} min tarde es falta · ${s.lates_per_absence} retardos al mes = 1 falta.`}
      actions={<button onClick={() => setSettings(v => !v)} className={btnSmall}>{settings ? 'Cerrar ajustes' : 'Ajustes y WiFi'}</button>}>
      {settings && <SettingsCard onChanged={load} />}
      {s.require_wifi && rep.networks_count === 0 && (
        <Card tone="accent"><p className="text-sm text-zinc-200">Nadie puede checar todavía: falta registrar el WiFi del muro. Conéctate al WiFi del gym y en "Ajustes y WiFi" toca "Registrar el WiFi en el que estoy".</p></Card>
      )}
      <Card title={monthLabel(rep.month)} actions={
        <div className="flex gap-1">
          <button onClick={() => setMonth(addMonths(month, -1))} className={btnSmall}>←</button>
          <button onClick={() => setMonth(todayMx().slice(0, 8) + '01')} className={btnSmall}>Este mes</button>
          <button onClick={() => setMonth(addMonths(month, 1))} className={btnSmall}>→</button>
        </div>}>
        {rep.employees.length === 0 ? <Empty>No hay empleados activos. Dalos de alta en <Link to="/staff/empleados" className="underline">Empleados</Link>.</Empty> : (
          <div className="divide-y divide-zinc-800/80">
            <div className="hidden sm:grid grid-cols-[1fr_repeat(4,6.5rem)] gap-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              <span>Empleado</span><span className="text-right">Retardos</span><span className="text-right">Faltas</span><span className="text-right">Por retardos</span><span className="text-right">Total faltas</span>
            </div>
            {rep.employees.map(e => (
              <div key={e.id}>
                <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full text-left py-3 grid grid-cols-2 sm:grid-cols-[1fr_repeat(4,6.5rem)] gap-2 items-center hover:bg-superficie-alta/40 rounded-lg">
                  <span className="col-span-2 sm:col-span-1 min-w-0">
                    <span className="text-texto-principal font-semibold">{e.full_name}</span>
                    <span className="block text-xs text-zinc-500">
                      {[!e.has_login && 'sin usuario del panel', !e.has_schedule && 'sin horario', e.has_login && !e.consented && 'no ha aceptado el aviso'].filter(Boolean).join(' · ') || e.position || ''}
                    </span>
                  </span>
                  <Num label="Retardos" n={e.summary.lates} warn />
                  <Num label="Faltas" n={e.summary.absences} alert />
                  <Num label="Por retardos" n={e.summary.absences_from_lates} alert />
                  <Num label="Total faltas" n={e.summary.total_absences} alert bold />
                </button>
                {open === e.id && <EmployeeDays e={e} onChanged={load} />}
              </div>
            ))}
          </div>
        )}
        <p className="text-zinc-500 text-xs mt-3">El horario de cada quien se pone en Empleados → su ficha → Horario. Antes del {fmtDate(s.counts_from)} no se cuentan faltas.</p>
      </Card>
    </Page>
  )
}

function Num({ label: l, n, warn, alert, bold }: { label: string; n: number; warn?: boolean; alert?: boolean; bold?: boolean }) {
  const cls = n > 0 ? (alert ? 'text-alerta' : warn ? 'text-amarillo-suave' : 'text-texto-principal') : 'text-zinc-500'
  return (
    <span className={`sm:text-right tabular-nums ${cls} ${bold ? 'font-bold' : ''}`}>
      <span className="sm:hidden text-zinc-500 text-xs font-normal">{l}: </span>{n}
    </span>
  )
}

function EmployeeDays({ e, onChanged }: { e: ReportEmployee; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const excuse = async (day: string, current: string | null) => {
    const note = current ? '' : window.prompt('Motivo (permiso, incapacidad, cambio de día…)')
    if (note === null) return
    if (!current && !note.trim()) return
    const { error } = await call('admin_excuse_day', { p_employee_id: e.id, p_day: day, p_note: note })
    if (error) { setError(attendanceError(error)); return }
    onChanged()
  }
  const del = async (p: Punch) => {
    if (!window.confirm(`¿Borrar la ${p.kind === 'in' ? 'entrada' : 'salida'} de las ${timeOf(p.at)}?`)) return
    const { error } = await call('admin_delete_punch', { p_id: p.id })
    if (error) { setError(attendanceError(error)); return }
    onChanged()
  }
  return (
    <div className="pb-4 space-y-2">
      <div className="flex gap-2">
        <button onClick={() => setAdding(v => !v)} className={btnSmall}>{adding ? 'Cerrar' : '+ Registro a mano'}</button>
      </div>
      {adding && <ManualPunch employeeId={e.id} onDone={() => { setAdding(false); onChanged() }} />}
      <Msg text={error} />
      {e.days.length === 0 ? <Empty>Sin días este mes (¿tiene horario?).</Empty> : e.days.map(d => (
        <div key={d.day_date} className="rounded-xl bg-superficie-alta/40 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-zinc-200">{DOW_LONG[d.dow]} {fmtDate(d.day_date)} <span className="text-zinc-500 text-xs">{d.start_time ? `entra ${d.start_time.slice(0, 5)}` : ''}</span></span>
            <span className="flex items-center gap-2">
              <Badge cls={STATUS[d.status].cls}>{STATUS[d.status].label}{d.status === 'late' || d.status === 'absent_late' ? ` · ${d.minutes_late} min` : ''}</Badge>
              {d.status !== 'extra' && d.status !== 'pending' && (
                <button onClick={() => excuse(d.day_date, d.excuse)} className="text-xs font-bold text-zinc-400 hover:text-texto-principal">{d.excuse ? 'Quitar justificación' : 'Justificar'}</button>
              )}
            </span>
          </div>
          {d.excuse && <p className="text-zinc-400 text-xs mt-1">Justificado: {d.excuse}</p>}
          {d.punches.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-2">
              {d.punches.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  {p.photo_path ? <Selfie path={p.photo_path} /> : <div className="w-12 h-12 rounded-lg bg-superficie-alta grid place-items-center text-[10px] text-zinc-500">a mano</div>}
                  <div className="text-xs">
                    <p className="text-texto-principal font-bold">{p.kind === 'in' ? 'Entrada' : 'Salida'} {timeOf(p.at)}</p>
                    {p.note && <p className="text-zinc-400 max-w-[12rem] truncate" title={p.note}>{p.note}</p>}
                    <button onClick={() => del(p)} className="text-zinc-500 hover:text-alerta font-bold">Borrar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Selfie({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { selfieUrl(path).then(setUrl) }, [path])
  if (!url) return <div className="w-12 h-12 rounded-lg bg-superficie-alta shrink-0" />
  return <a href={url} target="_blank" rel="noreferrer" className="shrink-0"><img src={url} alt="Selfie" className="w-12 h-12 rounded-lg object-cover border border-zinc-700" /></a>
}

function ManualPunch({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [f, setF] = useState({ kind: 'in', date: todayMx(), time: '09:00', note: '' })
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const { error } = await call('admin_add_punch', { p_employee_id: employeeId, p_kind: f.kind, p_at: `${f.date} ${f.time}`, p_note: f.note })
    if (error) { setError(attendanceError(error)); return }
    onDone()
  }
  return (
    <div className="rounded-xl border border-zinc-700/50 p-3 space-y-2">
      <div className="grid sm:grid-cols-4 gap-2">
        <div><label className={label}>Tipo</label>
          <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} className={input}><option value="in">Entrada</option><option value="out">Salida</option></select></div>
        <div><label className={label}>Día</label><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className={input} /></div>
        <div><label className={label}>Hora</label><input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} className={input} /></div>
        <div><label className={label}>Motivo</label><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Se le olvidó checar…" className={input} /></div>
      </div>
      <Msg text={error} />
      <button onClick={save} disabled={!f.note.trim()} className={btnPrimary}>Guardar registro</button>
    </div>
  )
}

interface FullSettings extends AttendanceSettings {
  consent_text: string; my_ip: string | null; my_ip_at_gym: boolean
  networks: { id: string; net: string; label: string | null; created_at: string }[]
}

function SettingsCard({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<FullSettings | null>(null)
  const [f, setF] = useState({ tolerance_min: '', absence_min: '', lates_per_absence: '', counts_from: '', require_wifi: true, consent_text: '' })
  const [netLabel, setNetLabel] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const load = useCallback(async () => {
    const { data } = await call<FullSettings>('get_attendance_settings')
    if (!data) return
    setS(data)
    setF({ tolerance_min: String(data.tolerance_min), absence_min: String(data.absence_min), lates_per_absence: String(data.lates_per_absence),
      counts_from: data.counts_from, require_wifi: data.require_wifi, consent_text: data.consent_text })
  }, [])
  useEffect(() => { load() }, [load])
  if (!s) return <Card title="Ajustes"><Spinner /></Card>

  const save = async () => {
    setMsg(null)
    const p: Record<string, unknown> = { tolerance_min: Number(f.tolerance_min), absence_min: Number(f.absence_min), lates_per_absence: Number(f.lates_per_absence),
      counts_from: f.counts_from, require_wifi: f.require_wifi }
    if (f.consent_text.trim() !== s.consent_text) {
      if (!window.confirm('Cambiaste el aviso: todos los empleados tendrán que aceptarlo de nuevo antes de checar. ¿Seguir?')) return
      p.consent_text = f.consent_text
    }
    const { error } = await call('admin_save_attendance_settings', { p })
    if (error) { setMsg({ text: attendanceError(error), tone: 'error' }); return }
    setMsg({ text: 'Guardado.', tone: 'ok' }); load(); onChanged()
  }
  const addNet = async () => {
    setMsg(null)
    const { data, error } = await call<{ net: string }>('admin_add_current_network', { p_label: netLabel })
    if (error || !data) { setMsg({ text: attendanceError(error), tone: 'error' }); return }
    setMsg({ text: `Listo: se registró la red ${data.net}.`, tone: 'ok' }); setNetLabel(''); load(); onChanged()
  }
  const removeNet = async (id: string) => {
    if (!window.confirm('¿Quitar esta red? Desde ahí ya no se podrá checar.')) return
    await call('admin_remove_network', { p_id: id }); load(); onChanged()
  }
  const num = (k: 'tolerance_min' | 'absence_min' | 'lates_per_absence', l: string) => (
    <div><label className={label}>{l}</label><input type="number" min={0} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} className={input} /></div>
  )

  return (
    <Card title="Ajustes de asistencia" tone="accent">
      <div className="space-y-5">
        <section>
          <p className="text-zinc-200 text-sm font-bold mb-1">WiFi del muro</p>
          <p className="text-zinc-400 text-xs mb-2">Solo se puede checar desde estas redes. Para registrar la del gym, entra aquí conectado al WiFi del muro (sin datos móviles) y toca el botón. Si el internet del gym cambia de IP, vuelve a registrarla.</p>
          <p className="text-xs mb-2">Tu red ahora: <span className="text-texto-principal font-mono">{s.my_ip ?? 'desconocida'}</span> {s.my_ip_at_gym ? <Badge cls="text-exito bg-exito/10">registrada</Badge> : <Badge>no registrada</Badge>}</p>
          {s.networks.length > 0 && (
            <div className="divide-y divide-zinc-800/80 mb-2">
              {s.networks.map(n => (
                <div key={n.id} className="py-1.5 flex justify-between gap-3 text-sm">
                  <span className="text-zinc-300"><span className="font-mono">{n.net}</span>{n.label ? ` · ${n.label}` : ''} <span className="text-zinc-500 text-xs">· {fmtDate(n.created_at.slice(0, 10))}</span></span>
                  <button onClick={() => removeNet(n.id)} className="text-zinc-500 hover:text-alerta text-xs font-bold">Quitar</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input value={netLabel} onChange={e => setNetLabel(e.target.value)} placeholder="Nombre (ej. WiFi recepción)" className={`${field} flex-1 min-w-[10rem]`} />
            <button onClick={addNet} disabled={s.my_ip_at_gym} className={btnGhost}>Registrar el WiFi en el que estoy</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 mt-3">
            <input type="checkbox" checked={f.require_wifi} onChange={e => setF({ ...f, require_wifi: e.target.checked })} />
            Exigir el WiFi del muro para checar
          </label>
        </section>
        <section>
          <p className="text-zinc-200 text-sm font-bold mb-2">Reglas</p>
          <div className="grid sm:grid-cols-4 gap-3">
            {num('tolerance_min', 'Tolerancia (min)')}
            {num('absence_min', 'Falta desde (min tarde)')}
            {num('lates_per_absence', 'Retardos = 1 falta')}
            <div><label className={label}>Contar desde</label><input type="date" value={f.counts_from} onChange={e => setF({ ...f, counts_from: e.target.value })} className={input} /></div>
          </div>
        </section>
        <section>
          <p className="text-zinc-200 text-sm font-bold mb-1">Aviso de uso de la foto (versión {s.consent_version})</p>
          <p className="text-zinc-400 text-xs mb-2">Cada empleado lo acepta con su nombre antes de su primer registro. Es un borrador: revísalo (o con tu abogado) antes de usarlo.</p>
          <textarea value={f.consent_text} onChange={e => setF({ ...f, consent_text: e.target.value })} rows={8} className={input} />
        </section>
        <Msg text={msg?.text ?? null} tone={msg?.tone} />
        <button onClick={save} className={btnPrimary}>Guardar ajustes</button>
      </div>
    </Card>
  )
}
