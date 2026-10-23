import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, billing, money, fmtDate, scheduleLabel, SUB_STATUS, CHARGE_STATUS } from '../../../lib/erp'
import { Page, Stat, Empty, Spinner, Badge, Msg, btnGhost } from '../../../components/erp/ui'

interface Sub {
  id: string; person_id: string; person_name: string; person_phone: string | null; product_name: string; status: string; provider: string
  price_cents: number; promo_cycles: number; promo_price_cents: number | null; cycles_paid: number; next_charge_on: string
  next_amount_cents: number; card_brand: string | null; card_last4: string | null; cancel_at_period_end: boolean; last_error: string | null
  open_charge: { status: string; attempt: number; max_attempts: number; next_attempt_at: string | null } | null
}

const FILTERS: Record<string, string> = { live: 'Vigentes', past_due: 'Con cobro pendiente', pending_card: 'Esperando tarjeta', cancelled: 'Canceladas', all: 'Todas' }

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[] | null>(null)
  const [filter, setFilter] = useState('live')
  const [isAdmin, setIsAdmin] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const load = useCallback(async () => {
    const { data } = await call<{ subscriptions: Sub[] }>('get_subscriptions_admin')
    setSubs(data?.subscriptions ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin)) }, [])

  const runDue = async () => {
    setRunning(true); setMsg(null)
    const { data, error } = await billing<{ results: { result: string }[] }>({ action: 'run_due' })
    setRunning(false)
    if (error || !data) { setMsg({ text: 'No se pudieron procesar los cobros. ¿Ya está desplegada la función "billing"?', tone: 'error' }); return }
    const r = data.results
    const paid = r.filter(x => x.result === 'paid').length, failed = r.filter(x => x.result === 'failed').length
    setMsg({ text: r.length === 0 ? 'No había cobros pendientes para hoy.' : `Procesados ${r.length}: ${paid} aprobados, ${failed} rechazados.`, tone: 'ok' })
    load()
  }

  const list = (subs ?? []).filter(s => filter === 'all' ? true : filter === 'live' ? s.status !== 'cancelled' : s.status === filter)
  const active = (subs ?? []).filter(s => s.status === 'active')
  const monthly = active.reduce((a, s) => a + s.next_amount_cents, 0)

  return (
    <Page title="Domiciliaciones" subtitle="Cobro automático mensual con tarjeta. Para dar de alta una, ve a la ficha de la persona → Domiciliar."
      actions={isAdmin ? <button onClick={runDue} disabled={running} className={btnGhost}>{running ? 'Cobrando…' : 'Cobrar lo que toca hoy'}</button> : undefined}>
      <Msg text={msg?.text ?? null} tone={msg?.tone} />
      {subs === null ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Activas" value={active.length} tone="success" />
            <Stat label="Ingreso mensual (próximos cobros)" value={money(monthly)} tone="accent" />
            <Stat label="Con cobro pendiente" value={(subs ?? []).filter(s => s.status === 'past_due').length} tone={(subs ?? []).some(s => s.status === 'past_due') ? 'alert' : undefined} />
            <Stat label="Esperando tarjeta" value={(subs ?? []).filter(s => s.status === 'pending_card').length} />
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(FILTERS).map(([k, v]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${filter === k ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta text-zinc-300 border border-zinc-700'}`}>{v}</button>
            ))}
          </div>
          {list.length === 0 ? <Empty>No hay domiciliaciones aquí.</Empty> : (
            <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
              {list.map(s => {
                const st = SUB_STATUS[s.status] ?? SUB_STATUS.active
                return (
                  <Link key={s.id} to={`/staff/personas/${s.person_id}`} className="block px-4 py-3 hover:bg-superficie-alta">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-texto-principal font-bold text-sm">{s.person_name}</span>
                      <span className="flex items-center gap-2">
                        {s.cancel_at_period_end && <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Se cancela</Badge>}
                        <Badge cls={st.cls}>{st.label}</Badge>
                      </span>
                    </div>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {s.product_name} · {scheduleLabel(s.price_cents, s.promo_cycles || null, s.promo_price_cents)} · {s.cycles_paid} {s.cycles_paid === 1 ? 'mes pagado' : 'meses pagados'}
                      {s.card_last4 ? ` · ${s.card_brand ?? ''} •••• ${s.card_last4}` : ''} · {s.provider === 'stripe' ? 'Stripe' : 'Openpay'}
                    </p>
                    {s.status !== 'cancelled' && (
                      <p className="text-zinc-300 text-xs mt-0.5">
                        Próximo cobro {fmtDate(s.next_charge_on)} · {money(s.next_amount_cents)}
                        {s.open_charge && s.open_charge.status !== 'pending' && ` · ${CHARGE_STATUS[s.open_charge.status]} (${s.open_charge.attempt}/${s.open_charge.max_attempts})`}
                      </p>
                    )}
                    {s.status === 'past_due' && s.last_error && <p className="text-alerta text-xs font-semibold mt-0.5">{s.last_error}</p>}
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}
    </Page>
  )
}
