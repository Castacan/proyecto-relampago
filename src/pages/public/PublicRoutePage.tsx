import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getPublicLabel } from '../../lib/freshness'
import VoteButtons from '../../components/VoteButtons'

interface RouteData {
  id: string
  color: string
  grade: string
  placed_at: string
  zones: { name: string } | null
  betas: { file_url: string }[]
}

interface QrData {
  id: string
  status: 'available' | 'in_use'
  route_id: string | null
  routes: RouteData | null
}

export default function PublicRoutePage() {
  const { qrId } = useParams<{ qrId: string }>()
  const { session } = useAuth()
  const [qr, setQr] = useState<QrData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showBeta, setShowBeta] = useState(false)

  useEffect(() => {
    if (!qrId) return
    supabase
      .from('qr_codes')
      .select(`id, status, route_id, routes (id, color, grade, placed_at, zones (name), betas (file_url))`)
      .eq('id', qrId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setNotFound(true)
        else setQr(data as unknown as QrData)
        setLoading(false)
      })
  }, [qrId])

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">🤔</div>
      <h1 className="text-white font-bold text-xl mb-2">QR no reconocido</h1>
      <p className="text-zinc-400 text-sm">Este código no existe en el sistema.</p>
    </div>
  )

  // QR disponible (no asignado)
  if (qr!.status === 'available') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">📦</div>
        <h1 className="text-white font-bold text-xl mb-2">Sin ruta asignada</h1>
        <p className="text-zinc-400 text-sm mb-6">Este QR todavía no tiene ruta.</p>
        {session ? (
          <Link
            to={`/staff?qr=${qrId}`}
            className="px-5 py-3 bg-yellow-400 text-zinc-950 font-semibold rounded-xl text-sm"
          >
            🎨 Crear ruta para este QR
          </Link>
        ) : (
          <p className="text-zinc-600 text-xs">Escanea con el app de staff para asignarlo.</p>
        )}
      </div>
    )
  }

  // Ruta retirada (in_use pero routes=null por RLS)
  if (qr!.status === 'in_use' && !qr!.routes) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">🏁</div>
        <h1 className="text-white font-bold text-xl mb-2">Esta ruta ya no está</h1>
        <p className="text-zinc-400 text-sm mb-6">La ruta fue retirada. ¡Hay nuevas esperándote!</p>
        <Link to="/muro" className="px-5 py-3 bg-yellow-400 text-zinc-950 font-semibold rounded-xl text-sm">
          Ver el muro →
        </Link>
      </div>
    )
  }

  const route = qr!.routes!
  const colorHex = getColorHex(route.color)
  const level = getFreshnessLevel(route.placed_at)
  const freshnessHex = getFreshnessColor(level)
  const label = getPublicLabel(level)
  const beta = route.betas?.[0]

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="h-2 shrink-0" style={{ backgroundColor: colorHex }} />

      <div className="flex-1 p-6 flex flex-col max-w-md mx-auto w-full">
        {/* Identidad */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-16 h-16 rounded-full border-2 border-white/20 shrink-0"
            style={{ backgroundColor: colorHex }}
          />
          <div>
            <h1 className="text-white font-bold text-4xl font-mono">{route.grade}</h1>
            <p className="text-zinc-400 text-sm">
              {route.color.charAt(0).toUpperCase() + route.color.slice(1)}
              {route.zones ? ` · ${route.zones.name}` : ''}
            </p>
          </div>
        </div>

        {/* Frescura */}
        <div
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl mb-6 self-start"
          style={{ backgroundColor: freshnessHex + '20', border: `1px solid ${freshnessHex}50` }}
        >
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: freshnessHex }} />
          <span className="font-semibold text-sm" style={{ color: freshnessHex }}>{label}</span>
        </div>

        {/* Beta */}
        <div className="mb-6">
          {!beta ? (
            <div className="p-5 bg-zinc-900 rounded-2xl text-center border border-zinc-800">
              <p className="text-zinc-500 text-sm">Beta no disponible aún</p>
            </div>
          ) : !showBeta ? (
            <button
              onClick={() => setShowBeta(true)}
              className="w-full py-5 bg-zinc-900 text-zinc-300 rounded-2xl font-semibold text-sm border border-zinc-700 active:bg-zinc-800 transition-colors"
            >
              👁 Toca para ver beta
            </button>
          ) : (
            <img src={beta.file_url} alt="Beta de la ruta" className="w-full rounded-2xl" />
          )}
        </div>

        {/* Votación */}
        <div className="mt-auto pt-4">
          <p className="text-zinc-500 text-xs text-center mb-3">¿Qué te pareció?</p>
          <VoteButtons routeId={route.id} />
        </div>
      </div>

      <div className="p-4 flex justify-center">
        <Link to="/muro" className="text-zinc-600 text-xs">Ver todo el muro →</Link>
      </div>
    </div>
  )
}
