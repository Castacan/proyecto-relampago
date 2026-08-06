import { useEffect, useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'
import logoHorizontal from '../../assets/logo-horizontal.png'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface MyStats {
  daily_points: number
  monthly_points: number
  daily_rank: number | null
  monthly_rank: number | null
}

interface MySend {
  id: string
  sent_at: string
  points_daily: number
  points_monthly: number
  grade: string
  color: string
  zone_name: string | null
}

function nowMX() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
}

function greeting(): string {
  const h = nowMX().getHours()
  if (h < 12) return 'Buen día'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function relativeDate(iso: string): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const sentMX = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const diffDays = Math.round((startOfDay(nowMX()) - startOfDay(sentMX)) / 86_400_000)
  if (diffDays <= 0) return 'hoy'
  if (diffDays === 1) return 'ayer'
  return `hace ${diffDays} días`
}

export default function HubPage() {
  const { session, loading: authLoading } = useAuth()
  const { climber, loading: climberLoading } = useClimber()

  const [stats, setStats] = useState<MyStats | null>(null)
  const [sends, setSends] = useState<MySend[]>([])
  const [loadingData, setLoadingData] = useState(false)

  useEffect(() => {
    if (!session?.user || !climber) return
    setLoadingData(true)
    Promise.all([
      db.rpc('get_my_stats'),
      db.rpc('get_my_sends', { lim: 5 }),
    ]).then(([statsRes, sendsRes]: [{ data: MyStats }, { data: MySend[] }]) => {
      setStats(statsRes.data)
      setSends(sendsRes.data ?? [])
      setLoadingData(false)
    })
  }, [session?.user?.id, climber])

  if (authLoading || climberLoading) {
    return (
      <div className="min-h-screen bg-fondo flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" />
      </div>
    )
  }

  // Sin sesión → vista pública del muro (comportamiento sin cambio)
  if (!session?.user) return <Navigate to="/muro" replace />

  const alias = climber?.display_name ?? session.user.email?.split('@')[0] ?? 'ahí'
  const hasEverSent = loadingData || sends.length > 0

  return (
    <div className="min-h-screen bg-fondo flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-1">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        <Link
          to="/mi-cuenta"
          className="w-8 h-8 rounded-full bg-superficie-alta border border-zinc-700/60 flex items-center justify-center text-zinc-300 text-xs font-black hover:border-zinc-500 transition-colors"
        >
          {alias[0]?.toUpperCase() ?? '⚡'}
        </Link>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-5 py-6">
        {/* Saludo */}
        <div className="mb-6">
          <p className="text-zinc-500 text-xs font-semibold mb-1">{greeting()}</p>
          <h1 className="text-texto-principal font-black text-2xl tracking-tight">Hola, {alias}</h1>
        </div>

        {/* Tu progreso */}
        {loadingData ? (
          <div className="h-28 bg-superficie rounded-2xl border border-zinc-800/60 flex items-center justify-center mb-6">
            <div className="w-5 h-5 rounded-full border-2 border-primario border-t-transparent animate-spin" />
          </div>
        ) : !hasEverSent ? (
          <div className="mb-6 py-6 px-5 bg-superficie rounded-2xl border border-zinc-800/60 text-center">
            <p className="text-texto-principal font-bold text-sm mb-1">Empieza a sumar puntos</p>
            <p className="text-zinc-500 text-xs">Escanea el QR de una ruta y marca tu primer send.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4">
              <p className="text-zinc-500 text-xs font-semibold mb-2">Hoy</p>
              <p className="text-primario font-black text-3xl leading-none">{stats?.daily_points ?? 0}</p>
              <p className="text-zinc-600 text-xs mt-1">pts</p>
              {stats?.daily_rank !== null && stats?.daily_rank !== undefined && (
                <p className="text-zinc-400 text-xs font-semibold mt-2">#{stats.daily_rank} en el ranking</p>
              )}
            </div>
            <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4">
              <p className="text-zinc-500 text-xs font-semibold mb-2">Este mes</p>
              <p className="text-primario font-black text-3xl leading-none">{stats?.monthly_points ?? 0}</p>
              <p className="text-zinc-600 text-xs mt-1">pts</p>
              {stats?.monthly_rank !== null && stats?.monthly_rank !== undefined && (
                <p className="text-zinc-400 text-xs font-semibold mt-2">#{stats.monthly_rank} en el ranking</p>
              )}
            </div>
          </div>
        )}

        {/* Botones grandes */}
        <div className="space-y-2.5 mb-6">
          <Link
            to="/muro"
            className="flex items-center justify-between px-5 py-4 bg-superficie-alta hover:bg-superficie-alta-hover rounded-2xl border border-zinc-700/50 transition-all"
          >
            <span className="text-texto-principal font-bold text-sm">Ver el muro</span>
            <span className="text-zinc-400 text-sm">→</span>
          </Link>
          <Link
            to="/leaderboard"
            className="flex items-center justify-between px-5 py-4 bg-superficie-alta hover:bg-superficie-alta-hover rounded-2xl border border-zinc-700/50 transition-all"
          >
            <span className="text-texto-principal font-bold text-sm">Leaderboard</span>
            <span className="text-zinc-400 text-sm">→</span>
          </Link>
          <Link
            to="/mi-cuenta"
            className="flex items-center justify-between px-5 py-4 bg-superficie-alta hover:bg-superficie-alta-hover rounded-2xl border border-zinc-700/50 transition-all"
          >
            <span className="text-texto-principal font-bold text-sm">Mi cuenta</span>
            <span className="text-zinc-400 text-sm">→</span>
          </Link>
        </div>

        {/* Últimas rutas */}
        {sends.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest">Últimas rutas que mandaste</p>
              <Link to="/mi-cuenta" className="text-primario text-xs font-bold">Ver todo</Link>
            </div>
            <div className="space-y-2">
              {sends.slice(0, 5).map(send => (
                <div key={send.id} className="flex items-center gap-3 bg-superficie rounded-xl border border-zinc-800/50 px-4 py-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getColorHex(send.color) }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-texto-principal font-black text-base font-mono">{send.grade}</span>
                      <span className="text-zinc-500 text-xs truncate">{send.zone_name ?? send.color}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-primario text-sm font-bold">+{send.points_daily}</p>
                    <p className="text-zinc-600 text-xs">{relativeDate(send.sent_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer discreto */}
      <div className="shrink-0 flex items-center justify-center px-5 py-4 border-t border-zinc-800/40">
        <a
          href="https://instagram.com/jaibamuro"
          target="_blank"
          rel="noreferrer"
          className="text-zinc-600 hover:text-zinc-400 text-xs font-medium transition-colors"
        >
          @jaibamuro
        </a>
      </div>
    </div>
  )
}
