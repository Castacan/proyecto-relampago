import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import ZoneMap from '../../components/ZoneMap'
import ChainCanvas from '../../components/ChainCanvas'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { useVolumes } from '../../hooks/useVolumes'
import { useQrByRoute } from '../../hooks/useQrByRoute'
import { useChain } from '../../hooks/useChain'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import logoHorizontal from '../../assets/logo-horizontal.png'
import type { Route } from '../../types'

export default function PublicWallPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { climber, refetch: refetchClimber } = useClimber()
  const { zones: allZones } = useZones()
  const { routes } = useRoutes()
  const { volumes } = useVolumes()
  const { qrByRoute } = useQrByRoute()

  const defaultChainId = allZones.find(z => z.chain_id)?.chain_id ?? null
  const { zones: chainZones, anchors, loading: chainLoading } = useChain(defaultChainId)

  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [jumpZoneId, setJumpZoneId] = useState<string | null>(null)
  const [authSheetOpen, setAuthSheetOpen] = useState(false)

  function handleRouteClick(route: Route) {
    const qrId = qrByRoute[route.id]
    if (qrId) navigate(`/q/${qrId}`)
  }

  return (
    <div className="relative w-full h-screen bg-fondo flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 bg-fondo/95 backdrop-blur-sm border-b border-zinc-800/40 z-10">
        <div className="flex items-center gap-2">
          <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-superficie rounded-full px-3.5 py-1.5 border border-zinc-800/60">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-zinc-300 text-xs font-semibold">{routes.length} rutas</span>
          </div>
          <Link
            to="/spraywall"
            className="bg-superficie rounded-full px-3.5 py-1.5 border border-zinc-800/60 text-zinc-300 text-xs font-semibold hover:text-texto-principal hover:border-zinc-700 transition-colors"
          >
            Spraywall
          </Link>
          {session?.user ? (
            <Link
              to="/mi-cuenta"
              className="w-7 h-7 rounded-full bg-superficie-alta border border-zinc-700/60 flex items-center justify-center text-zinc-300 text-xs font-black hover:border-zinc-500 transition-colors"
            >
              {climber?.display_name?.[0]?.toUpperCase() ?? '⚡'}
            </Link>
          ) : (
            <button
              onClick={() => setAuthSheetOpen(true)}
              className="bg-primario hover:bg-primario-hover text-texto-en-acento rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors"
            >
              Entrar
            </button>
          )}
          <Link
            to="/login"
            title="Acceso staff"
            aria-label="Acceso staff"
            className="text-zinc-700 hover:text-zinc-500 text-xs transition-colors px-1"
          >
            ⚙
          </Link>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden min-h-0">
        {chainLoading || !defaultChainId ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <ChainCanvas
              zones={chainZones}
              anchors={anchors}
              routes={routes}
              volumes={volumes}
              paintMode={false}
              drawColor="amarillo"
              previewBlob={null}
              isStaff={false}
              onBlobComplete={() => {}}
              onRouteClick={handleRouteClick}
              onActiveZoneChange={setActiveZoneId}
              jumpToZoneId={jumpZoneId}
            />

            {showMap ? (
              <ZoneMap
                zones={allZones}
                routes={routes}
                onZoneSelect={zone => {
                  const inChain = chainZones.find(z => z.id === zone.id)
                  if (inChain) setJumpZoneId(zone.id)
                }}
                mini={true}
                selectedZoneIds={activeZoneId ? [activeZoneId] : []}
                onCollapse={() => setShowMap(false)}
              />
            ) : (
              <button
                onClick={() => setShowMap(true)}
                className="absolute top-3 right-3 z-30 bg-fondo/95 backdrop-blur-sm border border-zinc-800/60 rounded-xl px-3 py-2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <span className="text-[9px] font-bold uppercase tracking-widest">Mapa</span>
              </button>
            )}

            {activeZoneId && (
              <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-superficie/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-3.5 py-2.5 pointer-events-none">
                <span className="text-texto-principal text-sm font-semibold truncate max-w-36">
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

      <ClimberAuthSheet
        isOpen={authSheetOpen}
        onClose={() => setAuthSheetOpen(false)}
        onDone={() => { setAuthSheetOpen(false); refetchClimber() }}
      />
    </div>
  )
}
