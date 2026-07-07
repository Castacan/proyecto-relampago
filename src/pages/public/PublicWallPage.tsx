import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ZoneMap from '../../components/ZoneMap'
import ChainCanvas from '../../components/ChainCanvas'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { useQrByRoute } from '../../hooks/useQrByRoute'
import { useChain } from '../../hooks/useChain'
import type { Route } from '../../types'

export default function PublicWallPage() {
  const navigate = useNavigate()
  const { zones: allZones } = useZones()
  const { routes } = useRoutes()
  const { qrByRoute } = useQrByRoute()

  const defaultChainId = allZones.find(z => z.chain_id)?.chain_id ?? null
  const { zones: chainZones, anchors, loading: chainLoading } = useChain(defaultChainId)

  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)

  function handleRouteClick(route: Route) {
    const qrId = qrByRoute[route.id]
    if (qrId) navigate(`/q/${qrId}`)
  }

  return (
    <div className="relative w-full h-screen bg-zinc-950 flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/40 z-10">
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

      <div className="relative flex-1 overflow-hidden min-h-0">
        {chainLoading || !defaultChainId ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <ChainCanvas
              zones={chainZones}
              anchors={anchors}
              routes={routes}
              paintMode={false}
              drawColor="amarillo"
              previewBlob={null}
              isStaff={false}
              onBlobComplete={() => {}}
              onRouteClick={handleRouteClick}
              onActiveZoneChange={setActiveZoneId}
            />

            <ZoneMap
              zones={allZones}
              routes={routes}
              onZoneSelect={() => {}}
              mini={true}
              selectedZoneIds={activeZoneId ? [activeZoneId] : []}
            />

            {activeZoneId && (
              <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 pointer-events-none">
                <span className="text-white text-sm font-semibold truncate max-w-36">
                  {chainZones.find(z => z.id === activeZoneId)?.name ?? '—'}
                </span>
              </div>
            )}

            {routes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-zinc-600 text-sm font-medium">No hay rutas todavía</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
