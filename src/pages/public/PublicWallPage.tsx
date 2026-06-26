import { useState, useEffect } from 'react'
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

  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)

  // Default to first zone when zones load
  useEffect(() => {
    if (zones.length > 0 && !selectedZone) {
      setSelectedZone(zones[0])
    }
  }, [zones, selectedZone])

  function handleRouteClick(route: Route) {
    const qrId = qrByRoute[route.id]
    if (qrId) navigate(`/q/${qrId}`)
  }

  const zoneRoutes = selectedZone ? routes.filter(r => r.zone_id === selectedZone.id) : []

  return (
    <div className="relative w-full h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-13 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/40 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-yellow-400 rounded-lg flex items-center justify-center">
            <span className="text-sm leading-none">⚡</span>
          </div>
          <span className="text-white font-bold text-sm tracking-tight">Relámpago</span>
        </div>
        <div className="flex items-center gap-2 bg-zinc-900 rounded-full px-3.5 py-1.5 border border-zinc-800/60">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <span className="text-zinc-300 text-xs font-semibold">{routes.length} rutas</span>
        </div>
      </header>

      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden">
        {!selectedZone ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
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

            {/* Minimap overlay (top-right) */}
            <ZoneMap
              zones={zones}
              routes={routes}
              onZoneSelect={zone => setSelectedZone(zone)}
              mini={true}
              selectedZoneId={selectedZone.id}
            />

            {/* Zone name (top-left) */}
            <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 pointer-events-none">
              <span className="text-white text-sm font-semibold truncate max-w-32">{selectedZone.name}</span>
              <span className="text-zinc-500 text-xs font-medium">{zoneRoutes.length} rutas</span>
            </div>

            {zoneRoutes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-zinc-600 text-sm font-medium">No hay rutas en esta zona todavía</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
