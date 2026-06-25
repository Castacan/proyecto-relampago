import { useState } from 'react'
import PanoramaCanvas from '../../components/PanoramaCanvas'
import MiniMap from '../../components/MiniMap'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import type { Route, Zone } from '../../types'

export default function WallPage() {
  const { zones } = useZones()
  const { routes, refetch } = useRoutes()
  const [paintMode, setPaintMode] = useState(false)
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)

  function handleBlobComplete(path: { x: number; y: number }[]) {
    setPaintMode(false)
    setNewBlobPath(path)
  }

  function handleZoneClick(zone: Zone) {
    // Jump the canvas to this zone — pass the event up via a ref if needed
    // For now, this is a no-op placeholder; the canvas handles its own viewport
    void zone
  }

  return (
    <div className="relative w-full h-full">
      <PanoramaCanvas
        zones={zones}
        routes={routes}
        paintMode={paintMode}
        isStaff={true}
        onBlobComplete={handleBlobComplete}
        onRouteClick={setSelectedRoute}
      />

      <MiniMap zones={zones} routes={routes} onZoneClick={handleZoneClick} />

      {/* Paint mode button */}
      <div className="absolute bottom-6 right-4 flex flex-col items-end gap-2">
        {paintMode && (
          <p className="text-yellow-400 text-xs bg-zinc-950/90 px-3 py-1.5 rounded-full">
            Dibuja la ruta con el dedo
          </p>
        )}
        <button
          onClick={() => setPaintMode(p => !p)}
          className={`px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl transition-all ${
            paintMode
              ? 'bg-zinc-700 text-zinc-300'
              : 'bg-yellow-400 text-zinc-950'
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
          onRetire={() => { setSelectedRoute(null); refetch() }}
        />
      )}
    </div>
  )
}
