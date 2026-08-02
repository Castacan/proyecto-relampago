import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { useSpraywallSettings } from '../../hooks/useSpraywallSettings'
import { useSpraywallSends } from '../../hooks/useSpraywallSends'
import SpraywallCanvas from '../../components/SpraywallCanvas'
import SpraywallLegend from '../../components/SpraywallLegend'
import SpraywallSendButton from '../../components/SpraywallSendButton'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'
import type { SpraywallRoute } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export default function SpraywallRoutePage() {
  const { routeId } = useParams<{ routeId: string }>()
  const { session } = useAuth()
  const { climber, loading: climberLoading, refetch: refetchClimber } = useClimber()
  const { settings, loading: settingsLoading } = useSpraywallSettings()
  const { sentMap, toggle } = useSpraywallSends()
  const [route, setRoute] = useState<SpraywallRoute | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [authSheetOpen, setAuthSheetOpen] = useState(false)

  useEffect(() => {
    if (!routeId) return
    db.from('spraywall_routes').select('*').eq('id', routeId).single()
      .then(({ data, error }: { data: SpraywallRoute | null; error: unknown }) => {
        if (error || !data) setNotFound(true)
        else setRoute(data)
        setLoading(false)
      })
  }, [routeId])

  if (loading || settingsLoading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  if (notFound || !route) return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">🤔</div>
      <h1 className="text-white font-black text-xl mb-2 tracking-tight">Ruta no encontrada</h1>
      <Link to="/spraywall" className="text-yellow-400 text-sm font-semibold mt-4">← Volver al listado</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-1">
        <Link to="/spraywall" className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
          ← Spraywall
        </Link>
        {session?.user && (
          <Link to="/mi-cuenta" className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 text-xs font-black hover:border-zinc-500 transition-colors">
            {climber?.display_name?.[0]?.toUpperCase() ?? '⚡'}
          </Link>
        )}
      </div>

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full px-5 py-4">
        <div className="mb-5">
          <h1 className="text-white font-black text-2xl tracking-tight">{route.name}</h1>
          <p className="text-zinc-400 text-sm font-medium mt-1">
            <span className="font-mono font-bold text-white">{route.grade}</span>
            <span className="text-zinc-600"> · Por {route.setter_name}</span>
          </p>
        </div>

        <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800/60 mb-5">
          {settings?.photo_url ? (
            <SpraywallCanvas
              photoUrl={settings.photo_url}
              photoW={settings.photo_w}
              photoH={settings.photo_h}
              holds={route.holds}
              mode="view"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">Sin foto configurada</div>
          )}
        </div>

        <div className="mb-6">
          <SpraywallLegend />
        </div>

        {route.notes && (
          <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800/60 rounded-2xl">
            <p className="text-zinc-400 text-sm">{route.notes}</p>
          </div>
        )}

        <SpraywallSendButton
          climber={climber}
          climberLoading={climberLoading}
          sent={!!sentMap[route.id]}
          sentAt={sentMap[route.id]}
          onToggle={() => toggle(route.id)}
          onNeedAuth={() => setAuthSheetOpen(true)}
        />
      </div>

      <div className="flex items-center justify-center px-5 py-4 border-t border-zinc-800/40">
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400 text-xs">⚡</span>
          <span className="text-zinc-600 text-xs font-medium">Jaibamuro</span>
        </div>
      </div>

      <ClimberAuthSheet
        isOpen={authSheetOpen}
        onClose={() => setAuthSheetOpen(false)}
        onDone={() => { setAuthSheetOpen(false); refetchClimber() }}
      />
    </div>
  )
}
