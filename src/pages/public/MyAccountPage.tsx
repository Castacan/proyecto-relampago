import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { getColorHex } from '../../lib/colors'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'

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

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function MyAccountPage() {
  const navigate = useNavigate()
  const { session, loading: authLoading } = useAuth()
  const { climber, loading: climberLoading, refetch: refetchClimber } = useClimber()

  const [stats, setStats] = useState<MyStats | null>(null)
  const [sends, setSends] = useState<MySend[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // Edit profile
  const [editName, setEditName] = useState('')
  const [editVisible, setEditVisible] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Auth sheet (for unauthenticated visitors)
  const [authSheetOpen, setAuthSheetOpen] = useState(false)

  // Load stats and sends when climber is ready
  useEffect(() => {
    if (!session?.user || !climber) return
    setLoadingData(true)
    Promise.all([
      db.rpc('get_my_stats'),
      db.rpc('get_my_sends', { lim: 20 }),
    ]).then(([statsRes, sendsRes]: [{ data: MyStats }, { data: MySend[] }]) => {
      setStats(statsRes.data)
      setSends(sendsRes.data ?? [])
      setLoadingData(false)
    })
  }, [session?.user?.id, climber])

  // Sync edit fields when climber loads
  useEffect(() => {
    if (!climber) return
    setEditName(climber.display_name)
    setEditVisible(climber.visible_in_leaderboard)
  }, [climber?.display_name, climber?.visible_in_leaderboard])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/muro')
  }

  async function handleSaveProfile() {
    if (!session?.user || !editName.trim()) return
    setSaving(true)
    setSaveSuccess(false)
    await db.from('climbers').upsert({
      id: session.user.id,
      email: session.user.email ?? '',
      display_name: editName.trim(),
      visible_in_leaderboard: editVisible,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    setSaveSuccess(true)
    refetchClimber()
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const now = nowMX()
  const monthLabel = `${MONTHS_ES[now.getMonth()]} ${now.getFullYear()}`

  // Loading auth
  if (authLoading || climberLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
      </div>
    )
  }

  // No session → prompt to log in
  if (!session?.user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-5">⚡</div>
        <h1 className="text-white font-black text-xl tracking-tight mb-2">Tu cuenta</h1>
        <p className="text-zinc-500 text-sm mb-8">Inicia sesión para ver tus puntos y estadísticas.</p>
        <button
          onClick={() => setAuthSheetOpen(true)}
          className="px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold rounded-2xl text-sm active:scale-95 transition-all"
        >
          Iniciar sesión
        </button>
        <Link to="/muro" className="mt-4 text-zinc-600 text-sm hover:text-zinc-400 transition-colors">
          ← Volver al muro
        </Link>
        <ClimberAuthSheet
          isOpen={authSheetOpen}
          onClose={() => setAuthSheetOpen(false)}
          onDone={() => { setAuthSheetOpen(false); refetchClimber() }}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <Link to="/muro" className="text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
          ← Muro
        </Link>
        <h1 className="text-white font-black text-base tracking-tight">Mi cuenta</h1>
        <button
          onClick={handleLogout}
          className="text-zinc-600 hover:text-red-400 text-sm font-medium transition-colors"
        >
          Salir
        </button>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-5 py-6 space-y-6">

        {/* Nombre / alias */}
        <div>
          <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest mb-3">Tu alias</p>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3">
            <input
              type="text"
              value={editName}
              onChange={e => { setEditName(e.target.value); setSaveSuccess(false) }}
              maxLength={24}
              placeholder="Tu nombre o alias"
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-yellow-400/60 transition-all placeholder:text-zinc-600"
            />
            <button
              onClick={() => setEditVisible(v => !v)}
              className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-zinc-800 border border-zinc-700/50 text-left hover:bg-zinc-700 transition-all"
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${editVisible ? 'bg-yellow-400 border-yellow-400' : 'border-zinc-600'}`}>
                {editVisible && <span className="text-zinc-950 text-xs font-black">✓</span>}
              </div>
              <div>
                <p className="text-white text-sm font-semibold">Aparecer en el leaderboard</p>
                <p className="text-zinc-500 text-xs">Tu nombre se mostrará en la pantalla del gym.</p>
              </div>
            </button>
            <button
              onClick={handleSaveProfile}
              disabled={saving || !editName.trim() || (editName.trim() === climber?.display_name && editVisible === climber?.visible_in_leaderboard)}
              className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm transition-all disabled:opacity-40 active:scale-95"
            >
              {saving ? 'Guardando...' : saveSuccess ? '✓ Guardado' : 'Guardar cambios'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div>
          <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest mb-3">Puntos</p>
          {loadingData ? (
            <div className="h-24 bg-zinc-900 rounded-2xl border border-zinc-800/60 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Hoy"
                points={stats?.daily_points ?? 0}
                rank={stats?.daily_rank ?? null}
              />
              <StatCard
                label={monthLabel}
                points={stats?.monthly_points ?? 0}
                rank={stats?.monthly_rank ?? null}
              />
            </div>
          )}
        </div>

        {/* Sends history */}
        <div>
          <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest mb-3">Últimas rutas</p>
          {loadingData ? (
            <div className="h-20 bg-zinc-900 rounded-2xl border border-zinc-800/60 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
            </div>
          ) : sends.length === 0 ? (
            <div className="py-8 bg-zinc-900 rounded-2xl border border-zinc-800/60 text-center">
              <p className="text-zinc-600 text-sm">Aún no has marcado ninguna ruta.</p>
              <p className="text-zinc-700 text-xs mt-1">¡Escanea un QR y completa tu primer send!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sends.map(send => (
                <SendRow key={send.id} send={send} />
              ))}
            </div>
          )}
        </div>

        {/* Email info */}
        <div className="pb-4">
          <p className="text-zinc-700 text-xs text-center">{session.user.email}</p>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, points, rank }: { label: string; points: number; rank: number | null }) {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4">
      <p className="text-zinc-500 text-xs font-semibold mb-2 truncate">{label}</p>
      <p className="text-yellow-400 font-black text-3xl leading-none">{points}</p>
      <p className="text-zinc-600 text-xs mt-1">pts</p>
      {rank !== null && (
        <p className="text-zinc-400 text-xs font-semibold mt-2">#{rank} en el ranking</p>
      )}
    </div>
  )
}

function SendRow({ send }: { send: MySend }) {
  const colorHex = getColorHex(send.color)
  const date = new Date(send.sent_at)
  const label = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })

  return (
    <div className="flex items-center gap-3 bg-zinc-900 rounded-xl border border-zinc-800/50 px-4 py-3">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorHex }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-white font-black text-base font-mono">{send.grade}</span>
          <span className="text-zinc-500 text-xs truncate">{send.zone_name ?? send.color}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-yellow-400 text-sm font-bold">+{send.points_daily}</p>
        <p className="text-zinc-600 text-xs">{label}</p>
      </div>
    </div>
  )
}
