import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { getGradePoints } from '../../lib/points'
import { getDeviceId } from '../../lib/device'
import ConfirmScanModal from '../ConfirmScanModal'
import type { Climber, Route } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  route: Route
  qrId: string
  climber: Climber | null
  climberLoading: boolean
  onNeedAuth: () => void
  onNeedOnboarding: () => void
}

type SendState = 'idle' | 'loading' | 'success' | 'already_sent' | 'no_scan' | 'error'

interface SuccessData {
  points_daily: number
  points_monthly: number
}

export default function SendButton({ route, qrId, climber, climberLoading, onNeedAuth, onNeedOnboarding }: Props) {
  const { session } = useAuth()
  const [sendState, setSendState] = useState<SendState>('idle')
  const [successData, setSuccessData] = useState<SuccessData | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)

  const pts = getGradePoints(route.grade)

  // Check if already sent today on mount
  useEffect(() => {
    if (!session?.user || !climber) return
    const todayUTC = new Date()
    todayUTC.setHours(0, 0, 0, 0)
    db.from('sends')
      .select('id')
      .eq('route_id', route.id)
      .eq('user_id', session.user.id)
      .gte('sent_at', todayUTC.toISOString())
      .limit(1)
      .then(({ data }: { data: { id: string }[] | null }) => {
        if (data && data.length > 0) setSendState('already_sent')
      })
  }, [session?.user?.id, climber, route.id])

  async function handleSend() {
    if (!session?.user) { onNeedAuth(); return }
    if (!climber) { onNeedOnboarding(); return }
    setSendState('loading')
    const result = await db.rpc('submit_send', {
      p_route_id: route.id,
      p_device_id: getDeviceId(),
    })
    const res = result.data as { success?: boolean; error?: string; points_daily?: number; points_monthly?: number } | null
    if (!res) { setSendState('error'); return }
    if (res.error === 'already_sent_today') setSendState('already_sent')
    else if (res.error === 'no_recent_scan') setSendState('no_scan')
    else if (res.error) setSendState('error')
    else if (res.success) {
      setSuccessData({ points_daily: res.points_daily!, points_monthly: res.points_monthly! })
      setSendState('success')
    }
  }

  function handleScanConfirmed() {
    setScanModalOpen(false)
    handleSend()
  }

  // Mientras carga la info del climber, no mostramos nada
  if (climberLoading && session?.user) return null

  return (
    <div className="mb-6">
      {/* Sin sesión → CTA login */}
      {!session?.user && (
        <button
          onClick={onNeedAuth}
          className="w-full py-4 rounded-2xl bg-zinc-800 border border-zinc-700/50 text-zinc-300 font-bold text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] hover:bg-zinc-700"
        >
          <span className="text-lg">⚡</span>
          Inicia sesión para sumar {pts} {pts === 1 ? 'punto' : 'puntos'}
        </button>
      )}

      {/* Con sesión pero sin perfil → completar perfil */}
      {session?.user && !climber && !climberLoading && (
        <button
          onClick={onNeedOnboarding}
          className="w-full py-4 rounded-2xl bg-zinc-800 border border-zinc-700/50 text-zinc-300 font-bold text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] hover:bg-zinc-700"
        >
          <span className="text-lg">⚡</span>
          Completa tu perfil para sumar {pts} {pts === 1 ? 'punto' : 'puntos'}
        </button>
      )}

      {/* Listo para mandar */}
      {climber && sendState === 'idle' && (
        <button
          onClick={handleSend}
          className="w-full py-5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-black text-lg transition-all active:scale-[0.97] shadow-lg shadow-yellow-400/25 flex items-center justify-center gap-3"
        >
          <span className="text-xl">🏆</span>
          YA LO COMPLETÉ
          <span className="text-sm font-bold bg-zinc-950/15 px-2 py-0.5 rounded-lg">+{pts} pts</span>
        </button>
      )}

      {climber && sendState === 'loading' && (
        <div className="w-full py-5 rounded-2xl bg-yellow-400/50 text-zinc-950 font-black text-lg flex items-center justify-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-zinc-950/50 border-t-transparent animate-spin" />
          Registrando...
        </div>
      )}

      {sendState === 'success' && successData && (
        <div className="w-full py-4 rounded-2xl bg-zinc-800 border border-green-500/30 text-center">
          <p className="text-green-400 font-black text-xl mb-1">+{successData.points_daily} pts</p>
          <p className="text-zinc-400 text-sm">
            {successData.points_monthly > 0
              ? `También suma al mensual (+${successData.points_monthly} pts)`
              : 'Ya habías mandado esta ruta este mes — no suma al mensual'}
          </p>
        </div>
      )}

      {sendState === 'already_sent' && (
        <div className="w-full py-4 rounded-2xl bg-zinc-800 border border-zinc-700/50 text-center">
          <p className="text-zinc-300 font-bold text-base">✓ Ya la marcaste hoy</p>
          <p className="text-zinc-600 text-xs mt-1">Puedes volver a marcarla mañana.</p>
        </div>
      )}

      {sendState === 'no_scan' && (
        <div className="w-full">
          <div className="py-3.5 rounded-2xl bg-zinc-800 border border-orange-500/30 text-center mb-3">
            <p className="text-orange-400 font-bold text-sm">Confirma que estás junto a la ruta</p>
            <p className="text-zinc-500 text-xs mt-0.5">Escanea el QR de la ruta para confirmar el send.</p>
          </div>
          <button
            onClick={() => setScanModalOpen(true)}
            className="w-full py-4 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-black text-sm transition-all active:scale-[0.97] mb-2"
          >
            📷 Escanear QR
          </button>
          <button onClick={() => setSendState('idle')} className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
            Cancelar
          </button>
        </div>
      )}

      {sendState === 'error' && (
        <div className="w-full">
          <div className="py-3.5 rounded-2xl bg-zinc-800 border border-red-500/30 text-center mb-3">
            <p className="text-red-400 font-bold text-sm">Algo salió mal</p>
          </div>
          <button onClick={() => setSendState('idle')} className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
            Intentar de nuevo
          </button>
        </div>
      )}

      {scanModalOpen && session?.user && (
        <ConfirmScanModal
          qrId={qrId}
          routeId={route.id}
          userId={session.user.id}
          onConfirmed={handleScanConfirmed}
          onClose={() => setScanModalOpen(false)}
        />
      )}
    </div>
  )
}
