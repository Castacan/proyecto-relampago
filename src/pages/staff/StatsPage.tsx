import { Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { useRoutes } from '../../hooks/useRoutes'
import { useZones } from '../../hooks/useZones'
import { ROUTE_COLORS, GRADES } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'

function StatCard({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 flex-1 min-w-0">
      <div className="text-yellow-400 font-black text-3xl tabular-nums leading-none mb-1">{value}</div>
      <div className="text-white text-xs font-bold">{label}</div>
      {sub && <div className="text-zinc-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  )
}

function BarChart({ items }: { items: { label: string; count: number; barColor: string; emptyColor?: string }[] }) {
  const max = Math.max(...items.map(d => d.count), 1)
  return (
    <div className="space-y-2.5">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="text-zinc-400 text-xs font-medium w-20 shrink-0 truncate leading-none text-right">
            {item.label}
          </span>
          <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ backgroundColor: item.emptyColor ?? '#27272a' }}>
            {item.count > 0 && (
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(item.count / max) * 100}%`, backgroundColor: item.barColor }}
              />
            )}
          </div>
          <span className={`text-xs font-bold w-5 shrink-0 text-right tabular-nums ${item.count === 0 ? 'text-zinc-700' : 'text-white'}`}>
            {item.count}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function StatsPage() {
  const { profile } = useProfile()
  const { routes, loading: routesLoading } = useRoutes()
  const { zones } = useZones()

  // profile null = todavía cargando
  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-zinc-950">
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  if (profile.role !== 'admin') return <Navigate to="/staff" replace />

  const loading = routesLoading

  // ── Cálculos ─────────────────────────────────────────────────
  const days = routes.map(r => getDaysOnWall(r.placed_at))
  const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0
  const maxDays = days.length ? Math.max(...days) : 0

  const freshnessGroups = { green: 0, yellow: 0, red: 0 }
  routes.forEach(r => { freshnessGroups[getFreshnessLevel(r.placed_at)]++ })
  const totalF = routes.length || 1

  const countsByZone: Record<string, number> = {}
  routes.forEach(r => { countsByZone[r.zone_id] = (countsByZone[r.zone_id] ?? 0) + 1 })
  const zoneItems = Object.entries(countsByZone)
    .map(([zoneId, count]) => ({
      label: zones.find(z => z.id === zoneId)?.name ?? '—',
      count,
      barColor: '#a1a1aa',
    }))
    .sort((a, b) => b.count - a.count)

  const countsByColor: Record<string, number> = {}
  routes.forEach(r => { countsByColor[r.color] = (countsByColor[r.color] ?? 0) + 1 })
  const colorItems = ROUTE_COLORS
    .filter(c => countsByColor[c.key])
    .map(c => ({ label: c.label, count: countsByColor[c.key], barColor: c.hex }))
    .sort((a, b) => b.count - a.count)

  const countsByGrade: Record<string, number> = {}
  routes.forEach(r => { countsByGrade[r.grade] = (countsByGrade[r.grade] ?? 0) + 1 })
  const gradeItems = GRADES
    .filter(g => countsByGrade[g])
    .map(g => ({ label: g, count: countsByGrade[g], barColor: '#facc15', emptyColor: '#18181b' }))

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-10">
        <h1 className="text-white font-black text-2xl tracking-tight mb-5">Dashboard</h1>

        {loading ? (
          <div className="flex justify-center pt-16">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">

            {/* Resumen */}
            <div className="flex gap-3">
              <StatCard value={routes.length} label="Rutas activas" />
              <StatCard value={`${avgDays}d`} label="Promedio" sub="días en pared" />
              <StatCard value={`${maxDays}d`} label="La más vieja" sub="días en pared" />
            </div>

            {/* Frescura */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Frescura</h2>

              {/* Barra apilada */}
              <div className="flex h-6 rounded-full overflow-hidden mb-3 gap-px">
                {(['green', 'yellow', 'red'] as const).map(level => {
                  const count = freshnessGroups[level]
                  const pct = (count / totalF) * 100
                  if (!count) return null
                  return (
                    <div
                      key={level}
                      className="h-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: getFreshnessColor(level) }}
                    />
                  )
                })}
              </div>

              {/* Leyenda */}
              <div className="flex gap-4">
                {(['green', 'yellow', 'red'] as const).map(level => (
                  <div key={level} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getFreshnessColor(level) }} />
                    <span className="text-zinc-400 text-xs">{getPublicLabel(level)}</span>
                    <span className="text-white text-xs font-bold tabular-nums">{freshnessGroups[level]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Por zona */}
            {zoneItems.length > 0 && (
              <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                <h2 className="text-white font-bold text-base mb-4">Por zona</h2>
                <BarChart items={zoneItems} />
              </div>
            )}

            {/* Por color */}
            {colorItems.length > 0 && (
              <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                <h2 className="text-white font-bold text-base mb-4">Por color</h2>
                <BarChart items={colorItems} />
              </div>
            )}

            {/* Por grado */}
            {gradeItems.length > 0 && (
              <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                <h2 className="text-white font-bold text-base mb-4">Por grado</h2>
                <BarChart items={gradeItems} />
              </div>
            )}

            {routes.length === 0 && (
              <p className="text-zinc-600 text-sm font-medium text-center pt-8">Sin rutas activas</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
