import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface SendRow {
  id: string
  sent_at: string
  points_daily: number
  points_monthly: number
  climber_id: string
  display_name: string | null
  email: string | null
  route_id: string
  grade: string
  color: string
  zone_name: string | null
  route_number: number | null
  visible_in_leaderboard: boolean
}

export default function SendsPage() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'

  const [sends, setSends] = useState<SendRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingClimberId, setTogglingClimberId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchSends = () => {
    if (!isAdmin) return
    setLoading(true)
    db.rpc('get_recent_sends', { p_search: debouncedSearch || null, p_limit: 50 })
      .then(({ data, error }: { data: SendRow[] | null; error: unknown }) => {
        if (error) {
          setError('No se pudieron cargar los envíos.')
        } else {
          setError(null)
          setSends(data ?? [])
        }
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchSends()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, debouncedSearch])

  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-fondo">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )
  if (!isAdmin) return <Navigate to="/staff" replace />

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const { data, error } = await db.rpc('delete_send', { p_send_id: id })
    setDeletingId(null)
    setConfirmingId(null)
    if (error || (data && data.error && data.error !== 'not_found')) {
      setError('No se pudo eliminar el envío.')
      return
    }
    // success o not_found: en ambos casos ya no existe, quitar de la lista local
    setSends(prev => prev.filter(s => s.id !== id))
  }

  // Excluir/incluir a un climber de TODOS los leaderboards (staff/TV/imagen
  // de ganador) — para gente de staff probando la app o que hizo trampa.
  // Actualiza climbers.visible_in_leaderboard vía RPC (climbers no tiene
  // policies RLS documentadas, ver comentario en schema.sql), y refleja el
  // cambio en todas las filas de ese climber en la lista local.
  const handleToggleVisibility = async (climberId: string, currentlyVisible: boolean) => {
    setTogglingClimberId(climberId)
    const { data, error } = await db.rpc('set_climber_visibility', { p_climber_id: climberId, p_visible: !currentlyVisible })
    setTogglingClimberId(null)
    if (error || data?.error) {
      setError('No se pudo cambiar la visibilidad en el leaderboard.')
      return
    }
    setSends(prev => prev.map(s => s.climber_id === climberId ? { ...s, visible_in_leaderboard: !currentlyVisible } : s))
  }

  return (
    <div className="h-full overflow-y-auto bg-fondo px-4 pt-5 pb-10">
      <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-1">Envíos</h1>
      <p className="text-zinc-500 text-xs mb-5">Ver y moderar envíos recientes.</p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setConfirmingId(null) }}
          placeholder="Buscar por nombre, correo, grado o zona..."
          className="flex-1 min-w-0 bg-superficie border border-zinc-800/80 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primario/60"
        />
        <button
          onClick={fetchSends}
          className="shrink-0 text-zinc-300 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all"
        >
          Actualizar
        </button>
      </div>

      {error && <p className="text-alerta text-xs mb-3">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
        </div>
      ) : sends.length === 0 ? (
        <p className="text-zinc-500 text-xs">
          {debouncedSearch ? `Sin resultados para "${debouncedSearch}".` : 'Sin envíos recientes.'}
        </p>
      ) : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60">
          {sends.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-4 h-4 rounded-full ring-1 ring-zinc-600 shrink-0" style={{ backgroundColor: getColorHex(s.color) }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-texto-principal font-bold">{s.grade}</span>
                  <span className="text-zinc-500 text-xs truncate">{s.zone_name ?? '—'}</span>
                  {s.route_number != null && (
                    <span className="text-zinc-600 text-[10px]">#{s.route_number}</span>
                  )}
                </div>
                <div className="text-zinc-400 text-xs truncate">
                  {s.display_name ?? 'Sin alias'}
                  {s.email && <span className="text-zinc-600"> · {s.email}</span>}
                  {!s.visible_in_leaderboard && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase text-alerta bg-alerta/10 px-1.5 py-0.5 rounded">Oculto</span>
                  )}
                </div>
                <div className="text-zinc-600 text-[10px] mt-0.5">
                  {new Date(s.sent_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {' · '}
                  <span className="tabular-nums">{s.points_daily}d / {s.points_monthly}m pts</span>
                </div>
              </div>

              {confirmingId === s.id ? (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-alerta text-white disabled:opacity-60"
                  >
                    {deletingId === s.id ? '...' : '¿Confirmar?'}
                  </button>
                  <button
                    onClick={() => setConfirmingId(null)}
                    className="text-zinc-500 hover:text-zinc-300 text-[10px]"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <button
                    onClick={() => setConfirmingId(s.id)}
                    className="text-zinc-400 hover:text-alerta text-xs font-semibold px-3 py-1.5 rounded-lg bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all"
                  >
                    Eliminar
                  </button>
                  <button
                    onClick={() => handleToggleVisibility(s.climber_id, s.visible_in_leaderboard)}
                    disabled={togglingClimberId === s.climber_id}
                    title="Excluir o incluir a esta persona en todos los leaderboards (staff probando, trampa, etc.)"
                    className="text-zinc-500 hover:text-texto-principal text-[10px] font-semibold px-3 py-1 rounded-lg bg-superficie-alta/50 hover:bg-superficie-alta-hover border border-zinc-800/60 transition-all disabled:opacity-60"
                  >
                    {togglingClimberId === s.climber_id ? '...' : s.visible_in_leaderboard ? 'Excluir del leaderboard' : 'Reincluir'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
