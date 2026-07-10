import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { useRoutes } from '../../hooks/useRoutes'
import { useZones } from '../../hooks/useZones'
import { supabase } from '../../lib/supabase'
import { ROUTE_COLORS, GRADES } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import type { Route, Zone } from '../../types'

// ── Zone grouping ─────────────────────────────────────────────────────────────
const ZONE_GROUPS = [
  { label: 'Pared Izquierda',   kw: ['pared izq', 'fondo izq',  'pared-izq',       'fondo-izq']       },
  { label: 'Flanco Túnel Izq',  kw: ['tunel izq', 'túnel izq',  'flanco-tunel-izq', 'tunel-izquierdo'] },
  { label: 'Desplome',          kw: ['desplome']                                                         },
  { label: 'Flanco Túnel Der',  kw: ['tunel der', 'túnel der',  'flanco-tunel-der', 'tunel-derecho']   },
  { label: 'Pared Derecha',     kw: ['pared der', 'fondo der',  'pared-der',        'fondo-der']       },
]

function getZoneGroup(zone: Zone): string {
  const s = (zone.name + ' ' + zone.slug).toLowerCase()
  return ZONE_GROUPS.find(g => g.kw.some(k => s.includes(k)))?.label ?? zone.name
}

// Rutas retiradas ANTES de esta fecha = rutas de prueba, no contar en históricas
const HISTORICAL_CUTOFF = '2026-07-11'

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 flex-1 min-w-0">
      <div className="text-yellow-400 font-black text-3xl tabular-nums leading-none mb-1">{value}</div>
      <div className="text-white text-xs font-bold">{label}</div>
      {sub && <div className="text-zinc-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Barra horizontal (zonas) ─────────────────────────────────────────────────
function BarChart({ items }: { items: { label: string; count: number; barColor: string }[] }) {
  const max = Math.max(...items.map(d => d.count), 1)
  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="text-zinc-400 text-xs font-medium w-28 shrink-0 truncate text-right leading-none">
            {item.label}
          </span>
          <div className="flex-1 h-6 rounded-full overflow-hidden bg-zinc-800">
            {item.count > 0 && (
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(item.count / max) * 100}%`, backgroundColor: item.barColor }}
              />
            )}
          </div>
          <span className={`text-sm font-black w-6 shrink-0 text-right tabular-nums ${item.count === 0 ? 'text-zinc-700' : 'text-white'}`}>
            {item.count}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Columnas verticales (grados / colores) ───────────────────────────────────
interface ColItem { label: string; count: number; barColor: string; showDot?: boolean }

function ColumnChart({ items }: { items: ColItem[] }) {
  const max = Math.max(...items.map(d => d.count), 1)
  const BAR_H = 88
  return (
    <div className="flex items-end gap-0.5">
      {items.map(item => {
        const hasCount = item.count > 0
        const barH = hasCount ? Math.max(6, Math.round((item.count / max) * BAR_H)) : 2
        return (
          <div key={item.label} className="flex-1 flex flex-col items-center">
            <span className={`text-sm font-black tabular-nums leading-none mb-1.5 ${hasCount ? 'text-white' : 'text-zinc-700'}`}>
              {item.count}
            </span>
            <div className="w-full flex items-end justify-center" style={{ height: BAR_H }}>
              <div
                className="w-full rounded-t transition-all duration-500"
                style={{ height: barH, backgroundColor: hasCount ? item.barColor : '#3f3f46', opacity: hasCount ? 1 : 0.5 }}
              />
            </div>
            {item.showDot ? (
              <div className="w-4 h-4 rounded-full mt-2 ring-1 ring-zinc-600 shrink-0" style={{ backgroundColor: item.barColor }} />
            ) : (
              <span className={`text-[9px] font-bold mt-1.5 ${hasCount ? 'text-zinc-300' : 'text-zinc-600'}`}>{item.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function StatsPage() {
  const { profile } = useProfile()
  const { routes, loading } = useRoutes()   // solo activas
  const { zones } = useZones()

  const [view, setView] = useState<'current' | 'historical'>('current')
  const [allRoutes, setAllRoutes] = useState<Route[]>([])
  const [loadingAll, setLoadingAll] = useState(false)
  const [fetchedAll, setFetchedAll] = useState(false)

  // Fetch lazy: solo cuando se cambia a históricas por primera vez
  useEffect(() => {
    if (view === 'historical' && !fetchedAll && !loadingAll) {
      setLoadingAll(true)
      supabase.from('routes').select('*').order('placed_at', { ascending: false })
        .then(({ data }) => {
          setAllRoutes((data ?? []) as Route[])
          setLoadingAll(false)
          setFetchedAll(true)
        })
    }
  }, [view, fetchedAll, loadingAll])

  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-zinc-950">
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )
  if (profile.role !== 'admin') return <Navigate to="/staff" replace />

  // Históricas = activas ahora + retiradas desde el cutoff (excluye rutas de prueba ya retiradas)
  const historicalRoutes = allRoutes.filter(r =>
    r.status === 'active' ||
    (r.status === 'retired' && r.retired_at != null && r.retired_at >= HISTORICAL_CUTOFF)
  )

  const displayRoutes = view === 'current' ? routes : historicalRoutes
  const isLoading = loading || (view === 'historical' && loadingAll)

  // ── Zonas agrupadas ────────────────────────────────────────────────────────
  const zoneGroupMap: Record<string, string> = {}
  zones.forEach(z => { zoneGroupMap[z.id] = getZoneGroup(z) })

  const countsByGroup: Record<string, number> = {}
  displayRoutes.forEach(r => {
    const label = zoneGroupMap[r.zone_id]
    if (label) countsByGroup[label] = (countsByGroup[label] ?? 0) + 1
  })
  const zoneItems = ZONE_GROUPS.map(g => ({
    label: g.label, count: countsByGroup[g.label] ?? 0, barColor: '#a1a1aa',
  }))

  // ── Colores ────────────────────────────────────────────────────────────────
  const countsByColor: Record<string, number> = {}
  displayRoutes.forEach(r => { countsByColor[r.color] = (countsByColor[r.color] ?? 0) + 1 })
  const colorItems: ColItem[] = ROUTE_COLORS.map(c => ({
    label: c.label, count: countsByColor[c.key] ?? 0, barColor: c.hex, showDot: true,
  }))

  // ── Grados ─────────────────────────────────────────────────────────────────
  const countsByGrade: Record<string, number> = {}
  displayRoutes.forEach(r => { countsByGrade[r.grade] = (countsByGrade[r.grade] ?? 0) + 1 })
  const gradeItems: ColItem[] = GRADES.map(g => ({
    label: g, count: countsByGrade[g] ?? 0, barColor: '#facc15',
  }))

  // ── Cálculos vista actual ──────────────────────────────────────────────────
  const activeDays = routes.map(r => getDaysOnWall(r.placed_at))
  const avgDays = activeDays.length ? Math.round(activeDays.reduce((a, b) => a + b, 0) / activeDays.length) : 0
  const maxDays = activeDays.length ? Math.max(...activeDays) : 0
  const freshnessGroups = { green: 0, yellow: 0, red: 0 }
  routes.forEach(r => { freshnessGroups[getFreshnessLevel(r.placed_at)]++ })
  const totalF = routes.length || 1

  // ── Cálculos vista histórica ───────────────────────────────────────────────
  const activeNow   = historicalRoutes.filter(r => r.status === 'active').length
  const retiredSince = historicalRoutes.filter(r => r.status === 'retired').length

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-10">
        <h1 className="text-white font-black text-2xl tracking-tight mb-4">Dashboard</h1>

        {/* Toggle Actuales / Históricas */}
        <div className="flex gap-1 mb-5 bg-zinc-900 p-1 rounded-2xl border border-zinc-800/80">
          {(['current', 'historical'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                view === v
                  ? 'bg-yellow-400 text-zinc-950 shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {v === 'current' ? 'Actuales' : 'Históricas'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center pt-16">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">

            {/* Cards */}
            {view === 'current' ? (
              <div className="flex gap-3">
                <StatCard value={routes.length} label="Rutas activas" />
                <StatCard value={`${avgDays}d`} label="Promedio" sub="días en pared" />
                <StatCard value={`${maxDays}d`} label="La más vieja" sub="días en pared" />
              </div>
            ) : (
              <div className="flex gap-3">
                <StatCard value={historicalRoutes.length} label="Total rutas" sub="desde jul 2026" />
                <StatCard value={activeNow} label="Activas" sub="en el muro ahora" />
                <StatCard value={retiredSince} label="Retiradas" sub="desde jul 2026" />
              </div>
            )}

            {/* Por zona */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Por zona</h2>
              <BarChart items={zoneItems} />
            </div>

            {/* Por color */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Por color</h2>
              <ColumnChart items={colorItems} />
            </div>

            {/* Por grado */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Por grado</h2>
              <ColumnChart items={gradeItems} />
            </div>

            {/* Frescura — solo en vista actual, al fondo */}
            {view === 'current' && (
              <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                <h2 className="text-white font-bold text-base mb-4">Frescura</h2>
                <div className="flex h-5 rounded-full overflow-hidden mb-4 gap-px">
                  {(['green', 'yellow', 'red'] as const).map(level => {
                    const count = freshnessGroups[level]
                    if (!count) return null
                    return (
                      <div
                        key={level}
                        className="h-full transition-all duration-500"
                        style={{ width: `${(count / totalF) * 100}%`, backgroundColor: getFreshnessColor(level) }}
                      />
                    )
                  })}
                </div>
                <div className="flex gap-5">
                  {(['green', 'yellow', 'red'] as const).map(level => (
                    <div key={level} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getFreshnessColor(level) }} />
                      <span className="text-zinc-400 text-xs">{getPublicLabel(level)}</span>
                      <span className="text-white text-base font-black tabular-nums">{freshnessGroups[level]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
