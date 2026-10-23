import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, money, fmtDateTime, todayMx, csvDownload } from '../../../lib/erp'
import { Page, Card, Empty, Spinner, input, label, btnGhost } from '../../../components/erp/ui'

// Bitácora (admin): quién del staff hizo qué y cuándo, y cuánto vendió cada quien.

interface Row { at: string; actor_id: string | null; actor: string | null; action: string; entity: string | null; entity_id: string | null; after: Record<string, unknown> | null; before: Record<string, unknown> | null; person?: string | null }
interface Data { staff: { id: string; name: string; role: string }[]; rows: Row[]; sales_by_staff: { actor: string; count: number; total_cents: number; voided: number }[] }

// Nombre legible de cada acción registrada.
const ACTIONS: Record<string, string> = {
  sale: 'Venta', sale_void: 'Anuló una venta', cash_open: 'Abrió caja', cash_close: 'Cerró caja (corte)',
  person_create: 'Registró persona', person_update: 'Editó datos de persona', person_save: 'Guardó datos de persona',
  membership_void: 'Anuló membresía', membership_set: 'Cambió membresía', product_save: 'Guardó producto / precio',
  subscription_create: 'Creó domiciliación', subscription_cancel: 'Canceló domiciliación', subscription_resume: 'Quitó cancelación de domiciliación',
  subscription_link: 'Generó link de tarjeta', erp_settings: 'Cambió ajustes', integrations_update: 'Cambió integraciones de pago',
  expense_create: 'Registró egreso', expense_update: 'Editó egreso', expense_pay: 'Pagó egreso', expense_cancel: 'Canceló egreso',
  expense_recurring_save: 'Guardó gasto recurrente', document_signed: 'Firmó responsiva/reglamento en tablet', legal_document_version: 'Publicó versión de documento',
  file_upload: 'Subió archivo', file_delete: 'Borró archivo', access_block: 'Bloqueó acceso', access_unblock: 'Desbloqueó acceso',
  employee_save: 'Guardó empleado', employee_pay: 'Registró pago de nómina', email_automation_save: 'Cambió correo automático',
  stock_purchase: 'Entrada de inventario', stock_adjust: 'Ajuste de inventario', stock_consumption: 'Salida de inventario (consumo)', stock_initial: 'Existencia inicial',
  access_granted: 'Registró entrada', access_denied: 'Entrada negada', access_override: 'Dejó pasar con autorización',
  booking_create: 'Reservó clase', booking_cancel: 'Canceló reserva', attendance: 'Marcó asistencia', booking_paid: 'Cobró clase',
  session_cancel: 'Canceló sesión de clase', class_type_save: 'Guardó tipo de clase', schedule_save: 'Guardó horario',
}
const actionLabel = (a: string) => ACTIONS[a] ?? a.replace(/_/g, ' ')

function detail(r: Row): string {
  const a = r.after ?? {}
  const parts: string[] = []
  if (r.person) parts.push(r.person)
  if (typeof a.product === 'string') parts.push(`${a.product} ${Number(a.quantity) > 0 ? '+' : ''}${a.quantity} (quedan ${a.stock_after})`)
  if (typeof a.reason === 'string' && a.reason) parts.push(`motivo: ${a.reason}`)
  if (typeof a.note === 'string' && a.note) parts.push(a.note)
  if (typeof a.description === 'string') parts.push(a.description)
  if (a.amount_cents != null && !isNaN(Number(a.amount_cents))) parts.push(money(Number(a.amount_cents)))
  if (Array.isArray(a.reasons) && a.reasons.length) parts.push((a.reasons as string[]).join(', '))
  if (typeof a.name === 'string') parts.push(a.name)
  if (typeof a.full_name === 'string') parts.push(a.full_name)
  if (typeof a.file === 'string') parts.push(a.file)
  if (a.opening_cents != null) parts.push(`fondo ${money(Number(a.opening_cents))}`)
  if (a.counted != null) parts.push(`contado ${money(Number(a.counted))}, esperado ${money(Number(a.expected))}`)
  if (Array.isArray(a.items)) parts.push(`${(a.items as unknown[]).length} artículo(s)`)
  return parts.join(' · ')
}

export default function AuditPage() {
  const [from, setFrom] = useState(todayMx().slice(0, 8) + '01')
  const [to, setTo] = useState(todayMx())
  const [actor, setActor] = useState('')
  const [area, setArea] = useState('')
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setD(null)
    const { data, error } = await call<Data>('get_audit_log', { p_from: from, p_to: to, p_actor: actor || null, p_area: area || null })
    if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin puede ver la bitácora.' : 'No se pudo cargar. ¿Ya se corrió erp_crm.sql?'); return }
    setError(null); setD(data)
  }, [from, to, actor, area])
  useEffect(() => { load() }, [load])

  const personLink = (r: Row) => r.entity_id && (r.entity === 'person' || r.entity === 'access') ? `/staff/personas/${r.entity_id}` : null
  const exportCsv = () => d && csvDownload(`bitacora_${from}_${to}.csv`, [
    ['Fecha', 'Quién', 'Acción', 'Detalle'], ...d.rows.map(r => [fmtDateTime(r.at), r.actor ?? 'Sistema / cliente', actionLabel(r.action), detail(r)]),
  ])

  return (
    <Page title="Bitácora" subtitle="Quién del staff hizo qué y cuándo. Los registros no se pueden borrar ni editar."
      actions={<button onClick={exportCsv} disabled={!d?.rows.length} className={btnGhost}>Descargar CSV</button>}>
      {error && <p className="text-alerta text-sm">{error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div><label className={label}>Desde</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={input} /></div>
        <div><label className={label}>Hasta</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={input} /></div>
        <div><label className={label}>Quién</label>
          <select value={actor} onChange={e => setActor(e.target.value)} className={input}>
            <option value="">Todos</option>{(d?.staff ?? []).map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
          </select></div>
        <div><label className={label}>Qué</label>
          <select value={area} onChange={e => setArea(e.target.value)} className={input}>
            <option value="">Cambios + inventario</option><option value="cambios">Solo cambios</option><option value="inventario">Solo inventario</option><option value="acceso">Entradas (acceso)</option>
          </select></div>
      </div>

      {!d ? (!error && <Spinner />) : (
        <>
          <Card title="Ventas por persona del staff">
            {d.sales_by_staff.length === 0 ? <Empty>Sin ventas en esas fechas.</Empty> : (
              <div className="divide-y divide-zinc-800/80">
                {d.sales_by_staff.map(s => (
                  <div key={s.actor} className="py-2 flex justify-between text-sm">
                    <span className="text-zinc-200 font-semibold">{s.actor}</span>
                    <span className="text-zinc-400">{s.count} ventas · <span className="text-texto-principal font-bold">{money(s.total_cents)}</span>{s.voided ? ` · ${s.voided} anuladas` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title={`Movimientos (${d.rows.length})`}>
            {d.rows.length === 0 ? <Empty>Nada registrado en esas fechas.</Empty> : (
              <div className="divide-y divide-zinc-800/80">
                {d.rows.map((r, i) => {
                  const link = personLink(r)
                  return (
                    <div key={i} className="py-2 text-sm flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-texto-principal"><span className="font-semibold">{r.actor ?? 'Sistema / cliente'}</span> · {actionLabel(r.action)}</p>
                        <p className="text-zinc-500 text-xs truncate">{link ? <Link to={link} className="text-primario">{detail(r) || 'ver ficha'}</Link> : detail(r)}</p>
                      </div>
                      <span className="text-zinc-500 text-xs shrink-0">{fmtDateTime(r.at)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
