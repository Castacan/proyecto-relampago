import { useState } from 'react'
import PanoramaCanvas from '../../components/PanoramaCanvas'
import MiniMap from '../../components/MiniMap'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { ROUTE_COLORS, getColorHex } from '../../lib/colors'
import type { Route, Zone } from '../../types'

export default function WallPage() {
  const { zones } = useZones()
  const { routes, refetch } = useRoutes()
  const [paintMode, setPaintMode] = useState(false)
  const [paintColor, setPaintColor] = useState('amarillo')
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)

  function handleBlobComplete(path: { x: number; y: number }[]) {
    setPaintMode(false)
    setNewBlobPath(path)
  }

  function handleZoneClick(_zone: Zone) { /* zoom to zone — fase futura */ }

  return (
    <div className="relative w-full h-full">
      <PanoramaCanvas
        zones={zones}
        routes={routes}
        paintMode={paintMode}
        drawColor={paintColor}
        previewBlob={newBlobPath ? { path: newBlobPath, color: paintColor } : null}
        isStaff={true}
        onBlobComplete={handleBlobComplete}
        onRouteClick={route => { if (!newBlobPath) setSelectedRoute(route) }}
      />

      <MiniMap zones={zones} routes={routes} onZoneClick={handleZoneClick} />

      {/* Color picker + draw button (paint mode) */}
      {paintMode && (
        <div className="absolute bottom-20 left-0 right-0 flex flex-col items-center gap-3 pointer-events-none">
          <p className="text-yellow-400 text-xs bg-zinc-950/90 px-3 py-1.5 rounded-full pointer-events-none">
            Dibuja la ruta con el dedo
          </p>
          <div className="flex gap-2 bg-zinc-900/95 px-4 py-3 rounded-2xl shadow-xl pointer-events-auto">
            {ROUTE_COLORS.map(c => (
              <button
                key={c.key}
                onClick={() => setPaintColor(c.key)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${paintColor === c.key ? 'border-white scale-125' : 'border-zinc-700'}`}
                style={{ backgroundColor: c.hex }}
                title={c.label}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action button */}
      <div className="absolute bottom-6 right-4 flex flex-col items-end gap-2">
        <button
          onClick={() => { setPaintMode(p => !p); setNewBlobPath(null) }}
          className={`px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl transition-all ${
            paintMode ? 'bg-zinc-700 text-zinc-300' : 'bg-yellow-400 text-zinc-950'
          }`}
        >
          {paintMode ? 'Cancelar' : '+ Nueva ruta'}
        </button>
      </div>

      {/* Route count badge */}
      <div className="absolute bottom-6 left-4 bg-zinc-900/80 rounded-full px-3 py-1.5">
        <span className="text-zinc-400 text-xs">{routes.length} rutas activas</span>
      </div>

      {/* Route form modal */}
      {newBlobPath && (
        <RouteForm
          blobPath={newBlobPath}
          zones={zones}
          initialColor={paintColor}
          onSave={() => { setNewBlobPath(null); refetch() }}
          onCancel={() => setNewBlobPath(null)}
        />
      )}

      {/* Route detail sheet */}
      {selectedRoute && (
        <RouteDetail
          route={selectedRoute}
          zones={zones}
          onClose={() => setSelectedRoute(null)}
          onUpdate={() => { setSelectedRoute(null); refetch() }}
          onRetire={() => { setSelectedRoute(null); refetch() }}
        />
      )}
    </div>
  )
}
