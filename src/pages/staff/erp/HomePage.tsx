import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, fmtDate, fmtDateTime, money } from '../../../lib/erp'
import { fmtTime } from '../../../lib/classes'
import { CashAlerts, type CashAlert } from './CashPage'
import { Page, Card, Stat, Spinner, Empty, Badge, btnPrimary, btnGhost } from '../../../components/erp/ui'

interface Dashboard {
  today: string
  is_admin: boolean
  cash: { id: string; opened_at: string; summary: { sales_total: number; sales_count: number; expected_cash: number } } | null
  require_open_cash: boolean
  sales_today: { total_cents: number; count: number }
  classes_today: { id: string; name: string; starts_at: string; capacity: number; taken: number; status: string; color: string | null }[]
  failed_charges: { subscription_id: string; person_id: string; person_name: string; amount_cents: number; status: string; error: string | null; next_attempt_at: string | null; attempt: number; max_attempts: number }[]
  pending_cards: { subscription_id: string; person_id: string; person_name: string; created_at: string }[]
  expiring: { person_id: string; person_name: string; phone: string | null; until: string }[]
  birthdays: { person_id: string; person_name: string }[]
  new_people_week: number
  low_stock?: { id: string; name: string; stock: number; stock_min: number | null }[]
  expenses_due?: { id: string; description: string; payee: string | null; amount_cents: number; due_on: string }[] | null
}

export default function HomePage() {
  const [d, setD] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [alerts, setAlerts] = useState<CashAlert[]>([])
  const loadAlerts = () => call<{ alerts: CashAlert[] }>('get_cash_alerts').then(({ data }) => setAlerts(data?.alerts ?? []))

  useEffect(() => {
    // Primero los avisos de caja: eso cierra la caja que quedó abierta de otro día.
    loadAlerts().then(() => call<Dashboard>('get_staff_dashboard')).then(({ data, error }) => {
      if (error || !data) { setError('No se pudo cargar el inicio. ¿Ya se corrió el SQL del ERP?'); return }
      setD(data)
    })
  }, [])

  if (error) return <Page title="Inicio"><p className="text-alerta text-sm">{error}</p></Page>
  if (!d) return <Page title="Inicio"><Spinner /></Page>

  return (
    <Page title="Inicio" subtitle={fmtDate(d.today)}
      actions={<><Link to="/staff/vender" className={btnPrimary}>Vender</Link><Link to="/staff/personas" className={btnGhost}>Buscar persona</Link></>}>
      <CashAlerts alerts={alerts} onAck={loadAlerts} />
      {!d.cash && d.require_open_cash && (
        <Card tone="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-texto-principal font-bold">La caja está cerrada</p>
              <p className="text-zinc-400 text-sm">Ábrela al empezar el día para poder cobrar.</p>
            </div>
            <Link to="/staff/caja" className={btnPrimary}>Abrir caja</Link>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Ventas de hoy" value={money(d.sales_today.total_cents)} sub={`${d.sales_today.count} ${d.sales_today.count === 1 ? 'venta' : 'ventas'}`} tone="accent" />
        <Stat label="Caja" value={d.cash ? 'Abierta' : 'Cerrada'} sub={d.cash ? `Efectivo esperado ${money(d.cash.summary.expected_cash)}` : 'Sin abrir'} tone={d.cash ? 'success' : 'alert'} />
        <Stat label="Cobros con problema" value={d.failed_charges.length} sub="domiciliaciones" tone={d.failed_charges.length ? 'alert' : undefined} />
        <Stat label="Personas nuevas" value={d.new_people_week} sub="últimos 7 días" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Clases de hoy" actions={<Link to="/staff/clases" className="text-primario text-xs font-bold">Ver todo</Link>}>
          {d.classes_today.length === 0 ? <Empty>No hay clases hoy.</Empty> : (
            <div className="space-y-2">
              {d.classes_today.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-fondo/60 px-3 py-2" style={{ borderLeft: `4px solid ${c.color ?? '#ff4d15'}` }}>
                  <div>
                    <p className="text-texto-principal text-sm font-bold">{c.name}</p>
                    <p className="text-zinc-400 text-xs">{fmtTime(c.starts_at)}{c.status === 'cancelled' && ' · cancelada'}</p>
                  </div>
                  <span className="text-zinc-200 text-sm font-bold tabular-nums">{c.taken}/{c.capacity}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Cobros de domiciliación con problema" tone={d.failed_charges.length ? 'alert' : undefined}>
          {d.failed_charges.length === 0 ? <Empty>Todo al corriente.</Empty> : (
            <div className="space-y-2">
              {d.failed_charges.map(f => (
                <Link key={f.subscription_id} to={`/staff/personas/${f.person_id}`} className="block rounded-xl bg-fondo/60 px-3 py-2 hover:bg-superficie-alta">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-texto-principal text-sm font-bold">{f.person_name}</span>
                    <span className="text-zinc-200 text-sm font-bold">{money(f.amount_cents)}</span>
                  </div>
                  <p className="text-zinc-400 text-xs">
                    {f.error ?? 'Rechazado'} · intento {f.attempt} de {f.max_attempts}
                    {f.next_attempt_at ? ` · reintento ${fmtDateTime(f.next_attempt_at)}` : ' · ya no se reintenta solo'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Membresías por vencer" actions={<Badge>Sin domiciliación</Badge>}>
          {d.expiring.length === 0 ? <Empty>Nadie vence pronto.</Empty> : (
            <div className="space-y-1">
              {d.expiring.map(e => (
                <Link key={e.person_id} to={`/staff/personas/${e.person_id}`} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-superficie-alta">
                  <span className="text-texto-principal text-sm font-semibold">{e.person_name}</span>
                  <span className="text-zinc-400 text-xs">vence {fmtDate(e.until)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {d.expenses_due && d.expenses_due.length > 0 && (
          <Card title="Pagos por vencer" actions={<Link to="/staff/egresos" className="text-primario text-xs font-bold">Egresos</Link>}>
            <div className="space-y-1">
              {d.expenses_due.map(e => (
                <Link key={e.id} to="/staff/egresos" className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-superficie-alta">
                  <span className="min-w-0">
                    <span className="text-texto-principal text-sm font-semibold">{e.description}</span>
                    <span className={`text-xs ml-2 ${e.due_on < d.today ? 'text-alerta' : 'text-zinc-400'}`}>{e.due_on < d.today ? 'venció' : 'vence'} {fmtDate(e.due_on)}{e.payee ? ` · ${e.payee}` : ''}</span>
                  </span>
                  <span className="text-zinc-200 text-sm font-bold tabular-nums">{money(e.amount_cents)}</span>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {d.low_stock && d.low_stock.length > 0 && (
          <Card title="Por surtir" actions={<Link to="/staff/inventario" className="text-primario text-xs font-bold">Inventario</Link>}>
            <div className="space-y-1">
              {d.low_stock.map(p => (
                <Link key={p.id} to="/staff/inventario" className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-superficie-alta">
                  <span className="text-texto-principal text-sm font-semibold">{p.name}</span>
                  <span className={`text-xs font-bold ${p.stock <= 0 ? 'text-alerta' : 'text-amarillo-suave'}`}>{p.stock <= 0 ? 'agotado' : `quedan ${p.stock}`}{p.stock_min != null ? ` · mínimo ${p.stock_min}` : ''}</span>
                </Link>
              ))}
            </div>
          </Card>
        )}

        <Card title="Pendientes">
          {d.pending_cards.length === 0 && d.birthdays.length === 0 ? <Empty>Nada pendiente.</Empty> : (
            <div className="space-y-1">
              {d.pending_cards.map(p => (
                <Link key={p.subscription_id} to={`/staff/personas/${p.person_id}`} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-superficie-alta">
                  <span className="text-texto-principal text-sm font-semibold">{p.person_name}</span>
                  <span className="text-amarillo-suave text-xs">falta registrar tarjeta</span>
                </Link>
              ))}
              {d.birthdays.map(b => (
                <Link key={b.person_id} to={`/staff/personas/${b.person_id}`} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-superficie-alta">
                  <span className="text-texto-principal text-sm font-semibold">{b.person_name}</span>
                  <span className="text-primario text-xs">cumple años hoy 🎂</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
