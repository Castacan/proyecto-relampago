import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ZoneMap from '../../components/ZoneMap'
import ZoneCanvas from '../../components/ZoneCanvas'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { ROUTE_COLORS, getColorHex } from '../../lib/colors'
import type { Route, Zone } from '../../types'

type UIState = 'idle' | 'color-pick' | 'drawing' | 'form'
type ViewMode = 'map' | 'zone'

export default function WallPage() {
  const [searchParams] = useSearchParams()
  const assignQrId = searchParams.get('qr') ?? undefined

  const { zones } = useZones()
  const { routes, refetch } = useRoutes()

  const [view, setView] = useState<ViewMode>('map')
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [ui, setUi] = useState<UIState>('idle')
  const [paintColor, setPaintColor] = useState('amarillo')
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)

  function handleZoneSelect(zone: Zone) {
    setSelectedZone(zone)
    setView('zone')
    setUi('idle')
    setNewBlobPath(null)
  }

  function handleBackToMap() {
    setView('map')
    setSelectedZone(null)
    cancelAll()
  }

  function handleBlobComplete(path: { x: number; y: number }[]) {
    setNewBlobPath(path)
    setUi('form')
  }

  function cancelAll() {
    setUi('idle')
    setNewBlobPath(null)
    setPaintColor('amarillo')
  }

  const zoneRoutes = selectedZone ? routes.filter(r => r.zone_id === selectedZone.id) : []

  return (
    <div className="relative w-full h-full">
      {/* ── Map view ── */}
      {view === 'map' && (
        <ZoneMap
          zones={zones}
          routes={routes}
          onZoneSelect={handleZoneSelect}
          assignQrHint={!!assignQrId}
        />
      )}

      {/* ── Zone view ── */}
      {view === 'zone' && selectedZone && (
        <>
          <ZoneCanvas
            zone={selectedZone}
            routes={zoneRoutes}
            paintMode={ui === 'drawing'}
            drawColor={paintColor}
            previewBlob={ui === 'form' && newBlobPath ? { path: newBlobPath, color: paintColor } : null}
            isStaff={true}
            onBlobComplete={handleBlobComplete}
            onRouteClick={route => { if (ui === 'idle') setSelectedRoute(route) }}
          />

          {/* Back button */}
          <button
            onClick={handleBackToMap}
            className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 text-white text-sm font-semibold pointer-events-auto hover:bg-zinc-800 hover:border-zinc-600 transition-all"
          >
            <span className="text-base leading-none">←</span>
            <span className="truncate max-w-32">{selectedZone.name}</span>
          </button>

          {/* QR assignment banner */}
          {assignQrId && ui !== 'form' && (
            <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none z-20">
              <div className="bg-yellow-400 text-zinc-950 px-5 py-2 rounded-full text-xs font-bold shadow-lg shadow-yellow-400/20">
                QR {assignQrId} — dibuja la ruta para asignarlo
              </div>
            </div>
          )}

          {/* Draw hint */}
          {ui === 'drawing' && (
            <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
              <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
                <div className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: getColorHex(paintColor) }} />
                <span className="text-yellow-400 text-xs font-semibold">Dibuja la ruta con el dedo</span>
              </div>
            </div>
          )}

          {/* Bottom action bar */}
          {(ui === 'idle' || ui === 'color-pick' || ui === 'drawing') && (
            <div className="absolute bottom-5 left-4 right-4 flex items-center justify-between pointer-events-none z-20">
              <div className="pointer-events-auto bg-zinc-900/95 backdrop-blur-sm rounded-full px-4 py-2 border border-zinc-800/60">
                <span className="text-zinc-400 text-xs font-medium">{zoneRoutes.length} rutas</span>
              </div>
              {ui === 'idle' ? (
                <button
                  onClick={() => setUi('color-pick')}
                  className="pointer-events-auto flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm shadow-xl shadow-yellow-400/25 bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all"
                >
                  <span className="text-lg leading-none">+</span>
                  Nueva ruta
                </button>
              ) : (
                <button
                  onClick={cancelAll}
                  className="pointer-events-auto px-5 py-3 rounded-2xl font-semibold text-sm shadow-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}

          {/* Color picker sheet */}
          {ui === 'color-pick' && (
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex items-end z-40" onClick={cancelAll}>
              <div className="w-full bg-zinc-900 rounded-t-3xl p-6 border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
                <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />
                <h2 className="text-white font-bold text-lg tracking-tight mb-5">¿De qué color son las presas?</h2>
                <div className="grid grid-cols-5 gap-4 mb-6">
                  {ROUTE_COLORS.map(c => (
                    <button key={c.key} onClick={() => setPaintColor(c.key)} className="flex flex-col items-center gap-2 group cursor-pointer">
                      <div
                        className={`w-13 h-13 rounded-full transition-all duration-150 ${
                          paintColor === c.key
                            ? 'ring-4 ring-white scale-110 shadow-lg'
                            : 'ring-0 group-hover:ring-2 group-hover:ring-white/40 group-hover:scale-105'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className={`text-[10px] font-medium transition-colors ${paintColor === c.key ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>{c.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setUi('drawing')}
                  className="w-full py-4 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg shadow-yellow-400/20"
                >
                  <div className="w-5 h-5 rounded-full border-2 border-zinc-950/30 shrink-0" style={{ backgroundColor: getColorHex(paintColor) }} />
                  Listo, a dibujar
                </button>
              </div>
            </div>
          )}

          {/* Route form */}
          {ui === 'form' && newBlobPath && (
            <RouteForm
              blobPath={newBlobPath}
              zones={zones}
              initialColor={paintColor}
              initialZoneId={selectedZone.id}
              assignQrId={assignQrId}
              onSave={() => { cancelAll(); refetch() }}
              onCancel={cancelAll}
            />
          )}

          {/* Route detail */}
          {selectedRoute && (
            <RouteDetail
              route={selectedRoute}
              zones={zones}
              onClose={() => setSelectedRoute(null)}
              onUpdate={() => { setSelectedRoute(null); refetch() }}
              onRetire={() => { setSelectedRoute(null); refetch() }}
            />
          )}
        </>
      )}
    </div>
  )
}
