import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { isOwner } from '../../lib/owner'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface RouteRow {
  route_id: string
  color: string
  grade: string
  zone_name: string | null
  send_count?: number
  scan_count?: number
}

interface Insights {
  climbers_total: number
  climbers_new_7d: number
  climbers_new_30d: number
  active_climbers: number
  climbers_by_week: { week_start: string; count: number }[]
  sends_total: number
  sends_7d: number
  sends_30d: number
  sends_by_day: { day: string; count: number }[]
  scans_30d: number
  top_routes_by_sends: RouteRow[]
  top_routes_by_scans: RouteRow[]
  votes_up: number
  votes_down: number
  peak_hours: { hour: number; count: number }[]
  peak_weekdays: { dow: number; count: number }[]
  retained_climbers: number
  error?: string
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] // Postgres DOW: 0=domingo

function StatCard({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="bg-superficie rounded-2xl p-4 border border-zinc-800/80 flex-1 min-w-0">
      <div className="text-primario font-black text-3xl tabular-nums leading-none mb-1">{value}</div>
      <div className="text-texto-principal text-xs font-bold">{label}</div>
      {sub && <div className="text-zinc-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-superficie rounded-2xl p-4 border border-zinc-800/80">
      <h2 className="text-texto-principal font-bold text-base mb-4">{title}</h2>
      {children}
    </div>
  )
}

// Sparkline de barras finas para series largas (días, horas, semanas)
function SparkBars({ items, labelEvery = 1 }: { items: { label: string; count: number }[]; labelEvery?: number }) {
  const max = Math.max(...items.map(i => i.count), 1)
  const H = 64
  return (
    <div className="flex items-end gap-[3px]">
      {items.map((item, i) => {
        const h = item.count > 0 ? Math.max(3, Math.round((item.count / max) * H)) : 1
        return (
          <div key={item.label + i} className="flex-1 flex flex-col items-center min-w-0">
            <div className="w-full flex items-end justify-center" style={{ height: H }}>
              <div
                className="w-full rounded-t transition-all duration-500"
                style={{ height: h, backgroundColor: item.count > 0 ? '#ff4d15' : '#3f3f46', opacity: item.count > 0 ? 1 : 0.5 }}
                title={`${item.label}: ${item.count}`}
              />
            </div>
            {i % labelEvery === 0 && (
              <span className="text-zinc-600 text-[8px] mt-1 whitespace-nowrap">{item.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RouteRankList({ items, countKey }: { items: RouteRow[]; countKey: 'send_count' | 'scan_count' }) {
  if (items.length === 0) return <p className="text-zinc-500 text-xs">Sin datos todavía.</p>
  return (
    <div className="space-y-2">
      {items.map((r, i) => (
        <div key={r.route_id} className="flex items-center gap-3">
          <span className="text-zinc-600 text-xs font-black w-4 shrink-0 text-right">{i + 1}</span>
          <div className="w-4 h-4 rounded-full ring-1 ring-zinc-600 shrink-0" style={{ backgroundColor: getColorHex(r.color) }} />
          <span className="text-texto-principal text-xs font-bold shrink-0">{r.grade}</span>
          <span className="text-zinc-500 text-xs truncate flex-1">{r.zone_name ?? '—'}</span>
          <span className="text-primario text-sm font-black tabular-nums shrink-0">{r[countKey] ?? 0}</span>
        </div>
      ))}
    </div>
  )
}

export default function InsightsPage() {
  const { profile, email } = useProfile()
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allowed = profile?.role === 'admin' && isOwner(email)

  useEffect(() => {
    if (!allowed) return
    db.rpc('get_admin_insights').then(({ data, error }: { data: Insights | null; error: unknown }) => {
      if (error || !data || data.error) {
        setError('No se pudieron cargar los datos.')
      } else {
        setData(data)
      }
      setLoading(false)
    })
  }, [allowed])

  if (profile === null || email === null) return (
    <div className="flex justify-center items-center h-full bg-fondo">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )
  if (!allowed) return <Navigate to="/staff" replace />

  if (loading) return (
    <div className="flex justify-center items-center h-full bg-fondo">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )

  if (error || !data) return (
    <div className="h-full flex items-center justify-center bg-fondo px-6">
      <p className="text-zinc-400 text-sm text-center">{error ?? 'Sin datos.'}</p>
    </div>
  )

  const conversionRate = data.scans_30d > 0 ? Math.round((data.sends_30d / data.scans_30d) * 100) : 0
  const retentionRate = data.active_climbers > 0 ? Math.round((data.retained_climbers / data.active_climbers) * 100) : 0

  const sendsByDayItems = data.sends_by_day.map(d => ({
    label: d.day.slice(8, 10), // día del mes
    count: d.count,
  }))

  const hoursItems = Array.from({ length: 24 }, (_, h) => ({
    label: String(h),
    count: data.peak_hours.find(p => p.hour === h)?.count ?? 0,
  }))

  const weekdayItems = Array.from({ length: 7 }, (_, dow) => ({
    label: WEEKDAY_LABELS[dow],
    count: data.peak_weekdays.find(p => p.dow === dow)?.count ?? 0,
  }))

  const weeksItems = data.climbers_by_week.map(w => ({
    label: w.week_start.slice(5, 10),
    count: w.count,
  }))

  const votesTotal = data.votes_up + data.votes_down || 1

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="px-4 pt-5 pb-10">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-1">Insights</h1>
        <p className="text-zinc-500 text-xs mb-5">Solo visible para ti — datos de clientes y desempeño.</p>

        <div className="space-y-4">
          {/* KPIs clientes */}
          <div className="flex gap-3">
            <StatCard value={data.climbers_total} label="Clientes registrados" />
            <StatCard value={data.climbers_new_7d} label="Nuevos" sub="últimos 7 días" />
            <StatCard value={data.active_climbers} label="Activos" sub="con ≥1 envío" />
          </div>

          {/* KPIs actividad */}
          <div className="flex gap-3">
            <StatCard value={data.sends_7d} label="Envíos" sub="últimos 7 días" />
            <StatCard value={`${conversionRate}%`} label="Conversión" sub="escaneos → envíos (30d)" />
            <StatCard value={`${retentionRate}%`} label="Retención" sub="activos en ≥2 semanas" />
          </div>

          {/* Envíos por día */}
          <Section title="Envíos — últimos 30 días">
            <SparkBars items={sendsByDayItems} labelEvery={5} />
          </Section>

          {/* Clientes nuevos por semana */}
          <Section title="Clientes nuevos por semana">
            <SparkBars items={weeksItems} labelEvery={1} />
          </Section>

          {/* Horas pico */}
          <Section title="Horas pico">
            <SparkBars items={hoursItems} labelEvery={3} />
          </Section>

          {/* Días pico */}
          <Section title="Días de la semana">
            <SparkBars items={weekdayItems} labelEvery={1} />
          </Section>

          {/* Rutas más enviadas */}
          <Section title="Rutas más enviadas">
            <RouteRankList items={data.top_routes_by_sends} countKey="send_count" />
          </Section>

          {/* Rutas más escaneadas */}
          <Section title="Rutas más escaneadas">
            <RouteRankList items={data.top_routes_by_scans} countKey="scan_count" />
          </Section>

          {/* Votos */}
          <Section title="Votos">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-zinc-400 text-xs font-medium w-16 shrink-0">👍 Buenas</span>
              <div className="flex-1 h-6 rounded-full overflow-hidden bg-superficie-alta">
                <div className="h-full rounded-full bg-exito" style={{ width: `${(data.votes_up / votesTotal) * 100}%` }} />
              </div>
              <span className="text-texto-principal text-sm font-black w-8 text-right tabular-nums">{data.votes_up}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-zinc-400 text-xs font-medium w-16 shrink-0">👎 Malas</span>
              <div className="flex-1 h-6 rounded-full overflow-hidden bg-superficie-alta">
                <div className="h-full rounded-full bg-alerta" style={{ width: `${(data.votes_down / votesTotal) * 100}%` }} />
              </div>
              <span className="text-texto-principal text-sm font-black w-8 text-right tabular-nums">{data.votes_down}</span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
