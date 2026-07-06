import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ZoneMap from '../../components/ZoneMap'
import ZoneCanvas from '../../components/ZoneCanvas'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { getZoneGroup, getGroupDisplayName } from '../../lib/zoneGroups'
import { ROUTE_COLORS, getColorHex } from '../../lib/colors'
import type { Route, Zone } from '../../types'

type UIState = 'idle' | 'color-pick' | 'drawing' | 'form'

export default function WallPage() {
  const [searchParams] = useSearchParams()
  const assignQrId = searchParams.get('qr') ?? undefined

  const { zones } = useZones()
  const { routes, refetch } = useRoutes()

  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [ui, setUi] = useState<UIState>('idle')
  const [paintColor, setPaintColor] = useState('amarillo')
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [drawingZone, setDrawingZone] = useState<Zone | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)

  // Default to first zone when zones load
  useEffect(() => {
    if (zones.length > 0 && !selectedZone) setSelectedZone(zones[0])
  }, [zones, selectedZone])

  function handleZoneSelect(zone: Zone) {
    setSelectedZone(zone)
    cancelAll()
  }

  function handleBlobComplete(path: { x: number; y: number }[], zone: Zone) {
    setNewBlobPath(path)
    setDrawingZone(zone)
    setUi('form')
  }

  function cancelAll() {
    setUi('idle')
    setNewBlobPath(null)
    setDrawingZone(null)
    setPaintColor('amarillo')
  }

  // Compute the zone group for the selected zone
  const zoneGroup = selectedZone ? getZoneGroup(selectedZone, zones) : []
  const groupRoutes = routes.filter(r => zoneGroup.some(z => z.id === r.zone_id))
  const groupIds = zoneGroup.map(z => z.id)

  if (!selectedZone) return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950">
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="relative w-full h-full">
      {/* ── Main: Zone Canvas ── */}
      <ZoneCanvas
        zones={zoneGroup}
        routes={groupRoutes}
        paintMode={ui === 'drawing'}
        drawColor={paintColor}
        previewBlob={
          ui === 'form' && newBlobPath && drawingZone
            ? { path: newBlobPath, color: paintColor, zone: drawingZone }
            : null
        }
        isStaff={true}
        onBlobComplete={handleBlobComplete}
        onRouteClick={route => { if (ui === 'idle') setSelectedRoute(route) }}
      />

      {/* ── Minimap overlay (top-right) ── */}
      <ZoneMap
        zones={zones}
        routes={routes}
        onZoneSelect={handleZoneSelect}
        mini={true}
        selectedZoneIds={groupIds}
      />

      {/* Zone name (top-left) */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 pointer-events-none">
        <span className="text-white text-sm font-semibold truncate max-w-36">
          {getGroupDisplayName(zoneGroup)}
        </span>
        <span className="text-zinc-500 text-xs font-medium">{groupRoutes.length} rutas</span>
      </div>

      {/* QR assignment banner */}
      {assignQrId && ui !== 'form' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
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
        <div className="absolute bottom-5 left-4 right-4 flex justify-end pointer-events-none z-20">
          {ui === 'idle' ? (
            <button
              onClick={() => setUi('color-pick')}
              className="pointer-events-auto flex items-center gap-2.5 px-6 py-3.5 rounded-2xl font-black text-base shadow-2xl shadow-yellow-400/30 bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all border-2 border-yellow-300/40"
            >
              <span className="text-xl leading-none font-black">+</span>
              Nueva ruta
            </button>
          ) : (
            <button
              onClick={cancelAll}
              className="pointer-events-auto px-6 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {/* Color picker sheet */}
      {ui === 'color-pick' && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={cancelAll}>
          <div className="w-full bg-zinc-900 rounded-t-3xl px-6 pt-6 pb-24 border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />
            <h2 className="text-white font-bold text-lg tracking-tight mb-5">¿De qué color son las presas?</h2>
            <div className="grid grid-cols-5 gap-4 mb-6">
              {ROUTE_COLORS.map(c => (
                <button key={c.key} onClick={() => setPaintColor(c.key)} className="flex flex-col items-center gap-2 group cursor-pointer">
                  <div
                    className={`w-13 h-13 rounded-full transition-all duration-150 ${
                      paintColor === c.key ? 'ring-4 ring-white scale-110 shadow-lg' : 'ring-0 group-hover:ring-2 group-hover:ring-white/40 group-hover:scale-105'
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
          initialZoneId={drawingZone?.id ?? selectedZone.id}
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
    </div>
  )
}
