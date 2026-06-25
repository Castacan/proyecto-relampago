import { useState } from 'react'
import PanoramaCanvas from '../../components/PanoramaCanvas'
import MiniMap from '../../components/MiniMap'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { ROUTE_COLORS, getColorHex } from '../../lib/colors'
import type { Route, Zone } from '../../types'

type UIState = 'idle' | 'color-pick' | 'drawing' | 'form'

export default function WallPage() {
  const { zones } = useZones()
  const { routes, refetch } = useRoutes()

  const [ui, setUi] = useState<UIState>('idle')
  const [paintColor, setPaintColor] = useState('amarillo')
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)

  function handleBlobComplete(path: { x: number; y: number }[]) {
    setNewBlobPath(path)
    setUi('form')
  }

  function handleZoneClick(_zone: Zone) { /* zoom to zone — fase futura */ }

  function cancelAll() {
    setUi('idle')
    setNewBlobPath(null)
    setPaintColor('amarillo')
  }

  return (
    <div className="relative w-full h-full">
      <PanoramaCanvas
        zones={zones}
        routes={routes}
        paintMode={ui === 'drawing'}
        drawColor={paintColor}
        previewBlob={ui === 'form' && newBlobPath ? { path: newBlobPath, color: paintColor } : null}
        isStaff={true}
        onBlobComplete={handleBlobComplete}
        onRouteClick={route => { if (ui === 'idle') setSelectedRoute(route) }}
      />

      <MiniMap zones={zones} routes={routes} onZoneClick={handleZoneClick} />

      {/* Draw hint */}
      {ui === 'drawing' && (
        <div className="absolute top-16 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-zinc-950/90 px-4 py-2 rounded-full">
            <div className="w-4 h-4 rounded-full border border-white/30" style={{ backgroundColor: getColorHex(paintColor) }} />
            <span className="text-yellow-400 text-xs">Dibuja la ruta con el dedo</span>
          </div>
        </div>
      )}

      {/* Main action button */}
      {(ui === 'idle' || ui === 'color-pick' || ui === 'drawing') && (
        <div className="absolute bottom-6 right-4">
          {ui === 'idle' ? (
            <button
              onClick={() => setUi('color-pick')}
              className="px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl bg-yellow-400 text-zinc-950"
            >
              + Nueva ruta
            </button>
          ) : (
            <button
              onClick={cancelAll}
              className="px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl bg-zinc-700 text-zinc-300"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {/* Route count */}
      {ui === 'idle' && (
        <div className="absolute bottom-6 left-4 bg-zinc-900/80 rounded-full px-3 py-1.5">
          <span className="text-zinc-400 text-xs">{routes.length} rutas activas</span>
        </div>
      )}

      {/* ── Color picker sheet ── */}
      {ui === 'color-pick' && (
        <div className="absolute inset-0 bg-black/60 flex items-end z-40" onClick={cancelAll}>
          <div className="w-full bg-zinc-900 rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold text-base mb-4">¿De qué color son las presas?</h2>

            <div className="grid grid-cols-5 gap-4 mb-6">
              {ROUTE_COLORS.map(c => (
                <button
                  key={c.key}
                  onClick={() => setPaintColor(c.key)}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div
                    className={`w-12 h-12 rounded-full transition-all ${paintColor === c.key ? 'ring-4 ring-white scale-110' : 'ring-0'}`}
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className={`text-[10px] ${paintColor === c.key ? 'text-white' : 'text-zinc-500'}`}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setUi('drawing')}
              className="w-full py-3.5 rounded-2xl bg-yellow-400 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2"
            >
              <div className="w-5 h-5 rounded-full border-2 border-zinc-950/30" style={{ backgroundColor: getColorHex(paintColor) }} />
              Listo, a dibujar
            </button>
          </div>
        </div>
      )}

      {/* ── Route form ── */}
      {ui === 'form' && newBlobPath && (
        <RouteForm
          blobPath={newBlobPath}
          zones={zones}
          initialColor={paintColor}
          onSave={() => { cancelAll(); refetch() }}
          onCancel={cancelAll}
        />
      )}

      {/* ── Route detail sheet ── */}
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
