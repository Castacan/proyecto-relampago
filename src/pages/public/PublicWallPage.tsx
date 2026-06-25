import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ZoneMap from '../../components/ZoneMap'
import ZoneCanvas from '../../components/ZoneCanvas'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { useQrByRoute } from '../../hooks/useQrByRoute'
import type { Route, Zone } from '../../types'

export default function PublicWallPage() {
  const navigate = useNavigate()
  const { zones } = useZones()
  const { routes } = useRoutes()
  const { qrByRoute } = useQrByRoute()

  const [view, setView] = useState<'map' | 'zone'>('map')
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)

  function handleRouteClick(route: Route) {
    const qrId = qrByRoute[route.id]
    if (qrId) navigate(`/q/${qrId}`)
  }

  const zoneRoutes = selectedZone ? routes.filter(r => r.zone_id === selectedZone.id) : []

  return (
    <div className="relative w-full h-screen bg-zinc-950 flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/40 z-10">
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400">⚡</span>
          <span className="text-white font-bold text-sm tracking-wide">Relámpago</span>
        </div>
        <div className="flex items-center gap-1.5 bg-zinc-900 rounded-full px-3 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <span className="text-zinc-300 text-xs">{routes.length} rutas</span>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {view === 'map' ? (
          <ZoneMap
            zones={zones}
            routes={routes}
            onZoneSelect={zone => { setSelectedZone(zone); setView('zone') }}
          />
        ) : selectedZone && (
          <>
            <ZoneCanvas
              zone={selectedZone}
              routes={zoneRoutes}
              paintMode={false}
              drawColor="amarillo"
              previewBlob={null}
              isStaff={false}
              onBlobComplete={() => {}}
              onRouteClick={handleRouteClick}
            />
            <button
              onClick={() => { setView('map'); setSelectedZone(null) }}
              className="absolute top-3 left-3 z-30 flex items-center gap-1.5 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm font-medium"
            >
              <span className="text-base leading-none">←</span>
              <span className="truncate max-w-32">{selectedZone.name}</span>
            </button>

            {zoneRoutes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-zinc-600 text-sm">No hay rutas en esta zona todavía</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
