import { useCallback, useEffect, useRef, useState } from 'react'
import { call, fmtDate } from '../../../lib/erp'
import { hhmm, DOW_LONG } from '../../../lib/checklist'
import { attendanceError, uploadSelfie, timeOf, STATUS, type MyAttendance } from '../../../lib/attendance'
import { Page, Card, Badge, Empty, Spinner, Msg, Stat, input, label, btnPrimary } from '../../../components/erp/ui'

// Mi asistencia (todo el staff): checar entrada/salida desde el celular con selfie,
// dentro del WiFi del muro. También muestra cómo va el mes.

export default function MyAttendancePage() {
  const [d, setD] = useState<MyAttendance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await call<MyAttendance>('get_my_attendance')
    if (error || !data) { setError(error === 'server' ? 'No se pudo cargar. ¿Ya se corrió erp_asistencia.sql?' : attendanceError(error)); return }
    setD(data)
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <Page title="Mi asistencia"><p className="text-alerta text-sm">{error}</p></Page>
  if (!d) return <Page title="Mi asistencia"><Spinner /></Page>
  if (!d.employee) return (
    <Page title="Mi asistencia">
      <Card><p className="text-zinc-300 text-sm">{attendanceError('not_employee')}</p></Card>
    </Page>
  )
  if (d.needs_consent) return <Page title="Mi asistencia" width="max-w-xl"><Consent d={d} onDone={load} /></Page>

  return (
    <Page title="Mi asistencia" subtitle={d.employee.full_name} width="max-w-xl">
      <PunchCard d={d} onDone={load} />
      <MonthCard d={d} />
    </Page>
  )
}

function Consent({ d, onDone }: { d: MyAttendance; onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const accept = async () => {
    setBusy(true); setError(null)
    const { error } = await call('attendance_accept_consent', { p_typed_name: name })
    setBusy(false)
    if (error) { setError(attendanceError(error)); return }
    onDone()
  }
  return (
    <Card title="Antes de tu primer registro" tone="accent">
      <p className="text-zinc-300 text-sm whitespace-pre-line max-h-80 overflow-y-auto mb-4">{d.consent_text}</p>
      <label htmlFor="consent-name" className={label}>Escribe tu nombre completo para aceptar</label>
      <input id="consent-name" value={name} onChange={e => { setName(e.target.value); setError(null) }} className={input} autoComplete="name" />
      <Msg text={error} />
      <button onClick={accept} disabled={busy || name.trim().length < 3} className={`${btnPrimary} w-full mt-3 py-3.5`}>{busy ? 'Guardando…' : 'Acepto'}</button>
    </Card>
  )
}

function PunchCard({ d, onDone }: { d: MyAttendance; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const punches = d.punches_today ?? []
  const kind: 'in' | 'out' = punches.length && punches[punches.length - 1].kind === 'in' ? 'out' : 'in'
  const wifiOk = d.at_gym || !d.settings?.require_wifi
  const today = d.today ?? ''

  const pick = async (f: File | undefined) => {
    if (!f || !d.employee) return
    setBusy(true); setMsg(null)
    const up = await uploadSelfie(today, d.employee.id, f)
    if (up.error || !up.path) { setBusy(false); setMsg({ text: up.error ?? 'Error', tone: 'error' }); return }
    const { data, error } = await call<{ at: string; status: string; minutes_late: number | null }>('attendance_punch', { p_kind: kind, p_photo_path: up.path })
    setBusy(false)
    if (error || !data) { setMsg({ text: attendanceError(error), tone: 'error' }); return }
    let text = `${kind === 'in' ? 'Entrada' : 'Salida'} registrada a las ${timeOf(data.at)}.`
    if (kind === 'in' && data.status === 'late') text += ` Retardo de ${data.minutes_late} min.`
    if (kind === 'in' && data.status === 'absent_late') text += ` Llegaste ${data.minutes_late} min tarde: cuenta como falta.`
    setMsg({ text, tone: kind === 'in' && data.status !== 'ok' && data.status !== 'extra' ? 'error' : 'ok' })
    onDone()
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-texto-principal font-bold">{DOW_LONG[new Date(today + 'T12:00:00Z').getUTCDay() || 7]} {fmtDate(today)}</p>
          <p className="text-zinc-400 text-sm">{d.schedule_today ? `Tu horario: ${hhmm(d.schedule_today.start_time)}${d.schedule_today.end_time ? ` a ${hhmm(d.schedule_today.end_time)}` : ''}` : 'Hoy no tienes horario.'}</p>
        </div>
        {d.settings?.require_wifi && (
          d.at_gym ? <Badge cls="text-exito bg-exito/10">En el WiFi del muro</Badge> : <Badge cls="text-alerta bg-alerta/10">Fuera del WiFi del muro</Badge>
        )}
      </div>
      {!wifiOk && <p className="text-zinc-400 text-sm mb-3">Conéctate al WiFi del muro (apaga los datos móviles) y toca "Revisar de nuevo".</p>}
      <input ref={ref} type="file" accept="image/*" capture="user" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {wifiOk ? (
        <button onClick={() => ref.current?.click()} disabled={busy} className={`${btnPrimary} w-full py-5 text-lg`}>
          {busy ? 'Registrando…' : kind === 'in' ? '📷 Checar entrada' : '📷 Checar salida'}
        </button>
      ) : (
        <button onClick={() => { setMsg(null); onDone() }} className={`${btnPrimary} w-full py-4`}>Revisar de nuevo</button>
      )}
      <p className="text-zinc-500 text-xs mt-2">Se abre la cámara de frente: tómate una foto de tu cara.</p>
      {msg && <div className="mt-3"><Msg text={msg.text} tone={msg.tone} /></div>}
      {punches.length > 0 && (
        <div className="mt-4 border-t border-zinc-800/80 pt-3 space-y-1">
          {punches.map(p => (
            <p key={p.id} className="text-sm text-zinc-300 flex justify-between">
              <span>{p.kind === 'in' ? 'Entrada' : 'Salida'}{p.source === 'admin' ? ' (la puso el admin)' : ''}</span>
              <span className="font-bold text-texto-principal tabular-nums">{timeOf(p.at)}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  )
}

function MonthCard({ d }: { d: MyAttendance }) {
  const s = d.summary
  const st = d.settings
  if (!s || !st) return null
  return (
    <Card title="Este mes">
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Retardos" value={s.lates} sub={`${st.lates_per_absence} = 1 falta`} />
        <Stat label="Faltas" value={s.absences} />
        <Stat label="Total de faltas" value={s.total_absences} sub={s.absences_from_lates ? `${s.absences_from_lates} por retardos` : undefined} tone={s.total_absences ? 'alert' : undefined} />
      </div>
      <p className="text-zinc-500 text-xs mb-3">Tolerancia {st.tolerance_min} min. Desde {st.absence_min} min tarde cuenta como falta.</p>
      {(d.days ?? []).length === 0 ? <Empty>Sin días registrados este mes.</Empty> : (
        <div className="divide-y divide-zinc-800/80">
          {(d.days ?? []).map(x => (
            <div key={x.day_date} className="py-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-300">{DOW_LONG[x.dow]} {fmtDate(x.day_date)}</span>
              <span className="flex items-center gap-2">
                <span className="text-zinc-400 tabular-nums text-xs">{x.first_in ? timeOf(x.first_in) : ''}{x.last_out ? ` – ${timeOf(x.last_out)}` : ''}</span>
                <Badge cls={STATUS[x.status].cls}>{STATUS[x.status].label}{x.status === 'late' ? ` ${x.minutes_late} min` : ''}</Badge>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
