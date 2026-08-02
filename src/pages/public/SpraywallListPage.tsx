import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSpraywallRoutes } from '../../hooks/useSpraywallRoutes'
import { useSpraywallSends } from '../../hooks/useSpraywallSends'
import { useClimber } from '../../hooks/useClimber'
import { GRADES } from '../../lib/colors'

type SendFilter = 'todas' | 'enviadas' | 'pendientes'

export default function SpraywallListPage() {
  const { routes, loading } = useSpraywallRoutes(['active'])
  const { climber } = useClimber()
  const { sentMap } = useSpraywallSends()
  const [gradeFilter, setGradeFilter] = useState<string | null>(null)
  const [sendFilter, setSendFilter] = useState<SendFilter>('todas')

  const filtered = useMemo(() => {
    return routes.filter(r => {
      if (gradeFilter && r.grade !== gradeFilter) return false
      if (climber && sendFilter === 'enviadas' && !sentMap[r.id]) return false
      if (climber && sendFilter === 'pendientes' && sentMap[r.id]) return false
      return true
    })
  }, [routes, gradeFilter, sendFilter, climber, sentMap])

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/40 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-yellow-400 rounded-lg flex items-center justify-center">
            <span className="text-sm leading-none">⚡</span>
          </div>
          <span className="text-white font-bold text-sm tracking-tight">Spraywall</span>
        </div>
        <Link
          to="/muro"
          className="text-zinc-500 hover:text-zinc-300 text-xs font-semibold transition-colors"
        >
          ← Muro
        </Link>
      </header>

      <div className="max-w-md mx-auto w-full px-4 py-5">
        {/* Proponer ruta */}
        <Link
          to="/spraywall/proponer"
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-zinc-900 border border-zinc-700/50 text-zinc-300 font-bold text-sm mb-5 hover:bg-zinc-800 hover:text-white transition-all active:scale-[0.98]"
        >
          <span className="text-lg">+</span>
          Proponer ruta
        </Link>

        {/* Filtro por grado */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setGradeFilter(null)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              gradeFilter === null ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Todos
          </button>
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition-all ${
                gradeFilter === g ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Filtro enviada/pendiente (solo si hay sesión de climber) */}
        {climber && (
          <div className="flex gap-2 mb-5 bg-zinc-900 rounded-2xl p-1 border border-zinc-800/60">
            {(['todas', 'enviadas', 'pendientes'] as SendFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setSendFilter(f)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all ${
                  sendFilter === f ? 'bg-yellow-400 text-zinc-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-10">No hay rutas que coincidan con el filtro.</p>
        )}

        <div className="flex flex-col gap-2.5">
          {filtered.map(route => (
            <Link
              key={route.id}
              to={`/spraywall/${route.id}`}
              className="flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 transition-all active:scale-[0.98]"
            >
              <div className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                <span className="text-white font-black font-mono text-sm">{route.grade}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{route.name}</p>
                <p className="text-zinc-500 text-xs mt-0.5">Por {route.setter_name}</p>
              </div>
              {climber && sentMap[route.id] && (
                <span className="text-green-400 text-lg shrink-0">✓</span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
