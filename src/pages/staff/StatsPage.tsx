import { useRoutes } from '../../hooks/useRoutes'
import { ROUTE_COLORS, GRADES } from '../../lib/colors'

interface BarItem {
  label: string
  count: number
  barColor: string
  emptyColor?: string
}

function BarChart({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map(d => d.count), 1)
  return (
    <div className="space-y-2.5">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="text-zinc-400 text-xs font-mono w-14 text-right shrink-0 leading-none">
            {item.label}
          </span>
          <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ backgroundColor: item.emptyColor ?? '#27272a' }}>
            {item.count > 0 && (
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(item.count / max) * 100}%`,
                  backgroundColor: item.barColor,
                }}
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
  const { routes, loading } = useRoutes()

  const countsByGrade = GRADES.reduce((acc, g) => {
    acc[g] = routes.filter(r => r.grade === g).length
    return acc
  }, {} as Record<string, number>)

  const countsByColor = ROUTE_COLORS.reduce((acc, c) => {
    acc[c.key] = routes.filter(r => r.color === c.key).length
    return acc
  }, {} as Record<string, number>)

  const gradeItems: BarItem[] = GRADES.map(g => ({
    label: g,
    count: countsByGrade[g],
    barColor: '#facc15',
    emptyColor: '#18181b',
  }))

  const colorItems: BarItem[] = ROUTE_COLORS
    .filter(c => countsByColor[c.key] > 0)
    .map(c => ({
      label: c.label,
      count: countsByColor[c.key],
      barColor: c.hex,
    }))

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-white font-black text-2xl tracking-tight">Estadísticas</h1>
          {!loading && (
            <span className="bg-zinc-800 text-zinc-300 text-xs font-bold px-3 py-1.5 rounded-full border border-zinc-700">
              {routes.length} rutas activas
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center pt-16">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Por grado */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Por grado</h2>
              <BarChart items={gradeItems} />
            </div>

            {/* Por color */}
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
              <h2 className="text-white font-bold text-base mb-4">Por color</h2>
              {colorItems.length === 0 ? (
                <p className="text-zinc-600 text-sm font-medium">Sin rutas activas</p>
              ) : (
                <BarChart items={colorItems} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
