import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import ZoneMap from '../../components/ZoneMap'
import ChainCanvas from '../../components/ChainCanvas'
import RouteForm from '../../components/RouteForm'
import RouteDetail from '../../components/RouteDetail'
import VolumeDetail from '../../components/VolumeDetail'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { useVolumes } from '../../hooks/useVolumes'
import { useChain } from '../../hooks/useChain'
import { ROUTE_COLORS, getColorHex } from '../../lib/colors'
import type { Route, Volume, Zone } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type UIState =
  | 'idle'
  | 'color-pick' | 'drawing' | 'review' | 'form'
  | 'vol-perimeter' | 'vol-perimeter-review' | 'vol-details'
  | 'vol-action' | 'vol-reposition'

export default function WallPage() {
  const [searchParams] = useSearchParams()
  const assignQrId = searchParams.get('qr') ?? undefined

  const { zones: allZones } = useZones()
  const { routes, refetch: refetchRoutes } = useRoutes()
  const { volumes, refetch: refetchVolumes } = useVolumes()

  const defaultChainId = allZones.find(z => z.chain_id)?.chain_id ?? null
  const { zones: chainZones, anchors, loading: chainLoading } = useChain(defaultChainId)

  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [jumpZoneId, setJumpZoneId] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
  const [selectedVolume, setSelectedVolume] = useState<Volume | null>(null)
  const [ui, setUi] = useState<UIState>('idle')

  // Route drawing state
  const [paintColor, setPaintColor] = useState('amarillo')
  const [newBlobPath, setNewBlobPath] = useState<{ x: number; y: number }[] | null>(null)
  const [newBlobZoneId, setNewBlobZoneId] = useState<string | null>(null)
  const [newBlobChainId, setNewBlobChainId] = useState<string | null>(null)

  // Volume drawing state
  const [volPerimeter, setVolPerimeter] = useState<{ x: number; y: number }[] | null>(null)
  const [volDetails, setVolDetails] = useState<{ x: number; y: number }[][]>([])
  const [volZoneId, setVolZoneId] = useState<string | null>(null)
  const [volChainId, setVolChainId] = useState<string | null>(null)

  // Volume action sheet (cross-zone tap)
  const [actionVol, setActionVol] = useState<Volume | null>(null)
  const [actionDisplayZoneId, setActionDisplayZoneId] = useState<string | null>(null)

  // Volume reposition state
  const [repoVolume, setRepoVolume] = useState<Volume | null>(null)
  const [repoZoneId, setRepoZoneId] = useState<string | null>(null)
  const [repoOffset, setRepoOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  useEffect(() => {
    if (chainZones.length > 0 && !activeZoneId) {
      setActiveZoneId(chainZones[0].id)
    }
  }, [chainZones, activeZoneId])

  const activeZone: Zone | null = chainZones.find(z => z.id === activeZoneId) ?? null

  function cancelAll() {
    setUi('idle')
    setNewBlobPath(null)
    setNewBlobZoneId(null)
    setNewBlobChainId(null)
    setPaintColor('amarillo')
    setVolPerimeter(null)
    setVolDetails([])
    setVolZoneId(null)
    setVolChainId(null)
    setActionVol(null)
    setActionDisplayZoneId(null)
    setRepoVolume(null)
    setRepoZoneId(null)
    setRepoOffset({ dx: 0, dy: 0 })
  }

  function handleBlobComplete(path: { x: number; y: number }[], zoneId: string, chainId: string) {
    setNewBlobPath(path)
    setNewBlobZoneId(zoneId)
    setNewBlobChainId(chainId)
    setUi('review')
  }

  function handleVolumePerimeterComplete(perimeter: { x: number; y: number }[], zoneId: string, chainId: string) {
    setVolPerimeter(perimeter)
    setVolZoneId(zoneId)
    setVolChainId(chainId)
    setUi('vol-perimeter-review')
  }

  function handleVolumeDetailStroke(stroke: { x: number; y: number }[]) {
    setVolDetails(prev => [...prev, stroke])
  }

  async function saveVolume(withDetails = true) {
    if (!volPerimeter || !volZoneId || !volChainId) return
    await db.from('volumes').insert({
      zone_id: volZoneId,
      chain_id: volChainId,
      perimeter: volPerimeter,
      details: withDetails ? volDetails : [],
    })
    cancelAll()
    refetchVolumes()
  }

  function handleVolumeClick(vol: Volume, displayZoneId: string) {
    if (ui !== 'idle') return
    setActionVol(vol)
    setActionDisplayZoneId(displayZoneId)
    setUi('vol-action')
  }

  function startReposition() {
    if (!actionVol || !actionDisplayZoneId) return
    setRepoVolume(actionVol)
    setRepoZoneId(actionDisplayZoneId)
    setRepoOffset(actionVol.zone_offsets?.[actionDisplayZoneId] ?? { dx: 0, dy: 0 })
    setActionVol(null)
    setActionDisplayZoneId(null)
    setUi('vol-reposition')
  }

  async function saveReposition() {
    if (!repoVolume || !repoZoneId) return
    const newOffsets = { ...(repoVolume.zone_offsets ?? {}), [repoZoneId]: repoOffset }
    await db.from('volumes').update({ zone_offsets: newOffsets }).eq('id', repoVolume.id)
    cancelAll()
    refetchVolumes()
  }

  if (chainLoading || allZones.length === 0) return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950">
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  if (!defaultChainId || chainZones.length === 0) return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 px-8 text-center">
      <div>
        <p className="text-zinc-400 text-sm font-medium mb-2">No hay cadenas configuradas.</p>
        <p className="text-zinc-600 text-xs">Ve a Admin → Calibración para configurar las zonas.</p>
      </div>
    </div>
  )

  const volPaintMode: 'perimeter' | 'details' | null =
    ui === 'vol-perimeter' ? 'perimeter' :
    ui === 'vol-details' ? 'details' : null

  return (
    <div className="relative w-full h-full">
      {/* Canvas principal */}
      <ChainCanvas
        zones={chainZones}
        anchors={anchors}
        routes={routes}
        volumes={volumes}
        paintMode={ui === 'drawing'}
        drawColor={paintColor}
        previewBlob={(ui === 'review' || ui === 'form') && newBlobPath ? { path: newBlobPath } : null}
        volumePaintMode={volPaintMode}
        previewVolumePerimeter={
          (ui === 'vol-perimeter-review' || ui === 'vol-details') ? volPerimeter : null
        }
        previewVolumeDetails={ui === 'vol-details' ? volDetails : []}
        isStaff={true}
        onBlobComplete={handleBlobComplete}
        onRouteClick={route => { if (ui === 'idle') setSelectedRoute(route) }}
        onVolumePerimeterComplete={handleVolumePerimeterComplete}
        onVolumeDetailStroke={handleVolumeDetailStroke}
        onVolumeClick={handleVolumeClick}
        repositionMode={ui === 'vol-reposition' && repoVolume && repoZoneId
          ? { volumeId: repoVolume.id, zoneId: repoZoneId, offset: repoOffset }
          : null}
        onRepositionOffsetChange={setRepoOffset}
        onActiveZoneChange={setActiveZoneId}
        jumpToZoneId={jumpZoneId}
      />

      {/* Minimap */}
      <ZoneMap
        zones={allZones}
        routes={routes}
        onZoneSelect={zone => {
          const inChain = chainZones.find(z => z.id === zone.id)
          if (inChain) setJumpZoneId(zone.id)
        }}
        mini={true}
        selectedZoneIds={activeZoneId ? [activeZoneId] : []}
      />

      {/* Badge zona activa */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 pointer-events-none">
        <span className="text-white text-sm font-semibold truncate max-w-36">
          {activeZone?.name ?? '—'}
        </span>
        <span className="text-zinc-500 text-xs font-medium">{routes.length} rutas</span>
      </div>

      {/* QR assignment banner */}
      {assignQrId && ui !== 'form' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="bg-yellow-400 text-zinc-950 px-5 py-2 rounded-full text-xs font-bold shadow-lg shadow-yellow-400/20">
            QR {assignQrId} — dibuja la ruta para asignarlo
          </div>
        </div>
      )}

      {/* Draw hint — route */}
      {ui === 'drawing' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
            <div className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: getColorHex(paintColor) }} />
            <span className="text-yellow-400 text-xs font-semibold">Dibuja la ruta con el dedo</span>
          </div>
        </div>
      )}

      {/* Review hint — route */}
      {ui === 'review' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
            <div className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: getColorHex(paintColor) }} />
            <span className="text-white text-xs font-semibold">¿Se ve bien?</span>
          </div>
        </div>
      )}

      {/* Draw hint — volume perimeter */}
      {ui === 'vol-perimeter' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
            <div className="w-3 h-3 rounded-full bg-zinc-400 shrink-0" />
            <span className="text-zinc-200 text-xs font-semibold">Dibuja el perímetro del volumen</span>
          </div>
        </div>
      )}

      {/* Review hint — volume perimeter */}
      {ui === 'vol-perimeter-review' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
            <div className="w-3 h-3 rounded-full bg-zinc-400 shrink-0" />
            <span className="text-white text-xs font-semibold">¿Se ve bien el perímetro?</span>
          </div>
        </div>
      )}

      {/* Draw hint — volume details */}
      {ui === 'vol-details' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-zinc-800/60 shadow-xl">
            <div className="w-3 h-3 rounded-full bg-zinc-600 shrink-0" />
            <span className="text-zinc-200 text-xs font-semibold">Dibuja detalles · {volDetails.length} trazo{volDetails.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Reposition hint */}
      {ui === 'vol-reposition' && (
        <div className="absolute top-14 left-0 right-0 flex justify-center pointer-events-none z-20">
          <div className="flex items-center gap-2.5 bg-zinc-950/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-yellow-400/40 shadow-xl">
            <div className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
            <span className="text-yellow-400 text-xs font-semibold">Arrastra el volumen a su posición correcta</span>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      {(ui === 'idle' || ui === 'color-pick' || ui === 'drawing' || ui === 'review'
        || ui === 'vol-perimeter' || ui === 'vol-perimeter-review' || ui === 'vol-details'
        || ui === 'vol-reposition') && (
        <div className="absolute bottom-5 left-4 right-4 flex justify-end pointer-events-none z-20">

          {ui === 'idle' ? (
            <div className="flex gap-2.5 pointer-events-auto">
              <button
                onClick={() => setUi('vol-perimeter')}
                className="flex items-center gap-2 px-4 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                <div className="w-4 h-4 rounded bg-zinc-500/60 border border-zinc-400/50" />
                Volumen
              </button>
              <button
                onClick={() => setUi('color-pick')}
                className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl font-black text-base shadow-2xl shadow-yellow-400/30 bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all border-2 border-yellow-300/40"
              >
                <span className="text-xl leading-none font-black">+</span>
                Nueva ruta
              </button>
            </div>

          ) : ui === 'review' ? (
            <div className="flex gap-3 pointer-events-auto">
              <button
                onClick={() => { setNewBlobPath(null); setUi('drawing') }}
                className="px-5 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Rehacer
              </button>
              <button
                onClick={() => setUi('form')}
                className="px-6 py-3.5 rounded-2xl font-bold text-sm shadow-2xl shadow-yellow-400/30 bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all border-2 border-yellow-300/40"
              >
                Continuar →
              </button>
            </div>

          ) : ui === 'vol-perimeter-review' ? (
            <div className="flex gap-2 pointer-events-auto">
              <button
                onClick={() => { setVolPerimeter(null); setUi('vol-perimeter') }}
                className="px-4 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Rehacer
              </button>
              <button
                onClick={() => { setVolDetails([]); setUi('vol-details') }}
                className="px-4 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-700 text-zinc-200 border-2 border-zinc-600 hover:bg-zinc-600 hover:text-white active:scale-95 transition-all"
              >
                + Detalles
              </button>
              <button
                onClick={() => saveVolume(false)}
                className="px-5 py-3.5 rounded-2xl font-bold text-sm shadow-2xl bg-zinc-300 text-zinc-900 hover:bg-white active:scale-95 transition-all"
              >
                Guardar
              </button>
            </div>

          ) : ui === 'vol-details' ? (
            <div className="flex gap-3 pointer-events-auto">
              <button
                onClick={cancelAll}
                className="px-4 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => saveVolume(true)}
                className="px-6 py-3.5 rounded-2xl font-bold text-sm shadow-2xl bg-zinc-300 text-zinc-900 hover:bg-white active:scale-95 transition-all"
              >
                Listo
              </button>
            </div>

          ) : ui === 'vol-reposition' ? (
            <div className="flex gap-3 pointer-events-auto">
              <button
                onClick={cancelAll}
                className="px-4 py-3.5 rounded-2xl font-bold text-sm shadow-xl bg-zinc-800 text-zinc-300 border-2 border-zinc-700 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={saveReposition}
                className="px-6 py-3.5 rounded-2xl font-bold text-sm shadow-2xl bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all border-2 border-yellow-300/40"
              >
                Guardar posición
              </button>
            </div>

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

      {/* Volume action sheet */}
      {ui === 'vol-action' && actionVol && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={cancelAll}>
          <div className="w-full bg-zinc-900 rounded-t-3xl px-6 pt-6 pb-24 border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />
            <h2 className="text-white font-bold text-lg tracking-tight mb-6">Volumen</h2>
            <button
              onClick={startReposition}
              className="w-full py-4 rounded-2xl bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm flex items-center justify-center gap-2.5 transition-all mb-3"
            >
              <span className="text-base">↔</span>
              Mover en esta zona
            </button>
            <button
              onClick={() => { setSelectedVolume(actionVol); cancelAll() }}
              className="w-full py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm flex items-center justify-center gap-2.5 transition-all mb-3"
            >
              <span className="text-base">···</span>
              Ver detalles / Retirar
            </button>
            <button
              onClick={cancelAll}
              className="w-full py-3.5 rounded-2xl text-zinc-500 font-semibold text-sm transition-all hover:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Route form */}
      {ui === 'form' && newBlobPath && newBlobZoneId && (
        <RouteForm
          blobPath={newBlobPath}
          zones={allZones}
          initialColor={paintColor}
          initialZoneId={newBlobZoneId}
          initialChainId={newBlobChainId ?? undefined}
          assignQrId={assignQrId}
          onSave={() => { cancelAll(); refetchRoutes() }}
          onCancel={cancelAll}
        />
      )}

      {/* Route detail */}
      {selectedRoute && (
        <RouteDetail
          route={selectedRoute}
          zones={allZones}
          onClose={() => setSelectedRoute(null)}
          onUpdate={() => { setSelectedRoute(null); refetchRoutes() }}
          onRetire={() => { setSelectedRoute(null); refetchRoutes() }}
        />
      )}

      {/* Volume detail */}
      {selectedVolume && (
        <VolumeDetail
          volume={selectedVolume}
          zones={allZones}
          onClose={() => setSelectedVolume(null)}
          onRetire={() => { setSelectedVolume(null); refetchVolumes() }}
        />
      )}
    </div>
  )
}
