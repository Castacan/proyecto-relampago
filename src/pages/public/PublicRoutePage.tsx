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
      <p className="text-zinc-500 text-sm">Este código no existe en el sistema.</p>
    </div>
  )

  // QR disponible
  if (qr!.status === 'available') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-5 text-3xl">📦</div>
        <h1 className="text-white font-bold text-xl mb-2">Sin ruta asignada</h1>
        <p className="text-zinc-500 text-sm mb-8">Este QR todavía no tiene ruta.</p>
        {session ? (
          <Link
            to={`/staff?qr=${qrId}`}
            className="px-6 py-3.5 bg-yellow-400 text-zinc-950 font-bold rounded-2xl text-sm shadow-lg shadow-yellow-400/20 active:scale-95 transition-transform"
          >
            🎨 Crear ruta para este QR
          </Link>
        ) : (
          <p className="text-zinc-600 text-xs">Pídele a un setter que lo asigne.</p>
        )}
      </div>
    )
  }

  // Ruta retirada
  if (qr!.status === 'in_use' && !qr!.routes) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-5 text-3xl">🏁</div>
        <h1 className="text-white font-bold text-xl mb-2">Esta ruta ya no está</h1>
        <p className="text-zinc-500 text-sm mb-8">La ruta fue retirada. ¡Hay nuevas esperándote!</p>
        <Link
          to="/muro"
          className="px-6 py-3.5 bg-yellow-400 text-zinc-950 font-bold rounded-2xl text-sm shadow-lg shadow-yellow-400/20 active:scale-95 transition-transform"
        >
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
      {/* Color bar top */}
      <div className="h-1.5 shrink-0" style={{ backgroundColor: colorHex }} />

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full px-5 py-6">

        {/* Route identity */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-16 h-16 rounded-2xl shrink-0 shadow-lg"
            style={{ backgroundColor: colorHex, boxShadow: `0 8px 24px ${colorHex}40` }}
          />
          <div>
            <h1 className="text-white font-black text-5xl font-mono leading-none">{route.grade}</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {route.color.charAt(0).toUpperCase() + route.color.slice(1)}
              {route.zones ? <span className="text-zinc-600"> · {route.zones.name}</span> : ''}
            </p>
          </div>
        </div>

        {/* Freshness badge */}
        <div
          className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl mb-6 self-start border"
          style={{
            backgroundColor: freshnessHex + '15',
            borderColor: freshnessHex + '40',
          }}
        >
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: freshnessHex }} />
          <span className="font-bold text-sm" style={{ color: freshnessHex }}>{label}</span>
        </div>

        {/* Beta */}
        <div className="mb-6">
          {!beta ? (
            <div className="py-6 bg-zinc-900 rounded-2xl text-center border border-zinc-800/60">
              <p className="text-3xl mb-2">🎬</p>
              <p className="text-zinc-600 text-sm">Beta no disponible aún</p>
            </div>
          ) : !showBeta ? (
            <button
              onClick={() => setShowBeta(true)}
              className="w-full py-5 bg-zinc-900 rounded-2xl border border-zinc-700/60 active:bg-zinc-800 transition-colors"
            >
              <p className="text-2xl mb-1">👁</p>
              <p className="text-zinc-300 text-sm font-semibold">Ver beta</p>
              <p className="text-zinc-600 text-xs mt-0.5">toca para revelar</p>
            </button>
          ) : (
            <img src={beta.file_url} alt="Beta de la ruta" className="w-full rounded-2xl shadow-xl" />
          )}
        </div>

        {/* Vote section */}
        <div className="mt-auto">
          <p className="text-zinc-600 text-xs text-center mb-3 uppercase tracking-widest">¿Qué te pareció?</p>
          <VoteButtons routeId={route.id} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/40">
        <div className="flex items-center gap-1">
          <span className="text-yellow-400 text-xs">⚡</span>
          <span className="text-zinc-600 text-xs">Relámpago</span>
        </div>
        <Link to="/muro" className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors">
          Ver todo el muro →
        </Link>
      </div>
    </div>
  )
}
