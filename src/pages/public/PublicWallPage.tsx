import { useNavigate } from 'react-router-dom'
import PanoramaCanvas from '../../components/PanoramaCanvas'
import MiniMap from '../../components/MiniMap'
import { useZones } from '../../hooks/useZones'
import { useRoutes } from '../../hooks/useRoutes'
import { useQrByRoute } from '../../hooks/useQrByRoute'
import type { Route } from '../../types'

export default function PublicWallPage() {
  const navigate = useNavigate()
  const { zones } = useZones()
  const { routes } = useRoutes()
  const { qrByRoute } = useQrByRoute()

  function handleRouteClick(route: Route) {
    const qrId = qrByRoute[route.id]
    if (qrId) navigate(`/q/${qrId}`)
  }

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
        <PanoramaCanvas
          zones={zones}
          routes={routes}
          paintMode={false}
          drawColor="amarillo"
          previewBlob={null}
          isStaff={false}
          onBlobComplete={() => {}}
          onRouteClick={handleRouteClick}
        />
        <MiniMap zones={zones} routes={routes} onZoneClick={() => {}} />

        {routes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-zinc-600 text-sm">Toca un blob de color para ver la ruta</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
