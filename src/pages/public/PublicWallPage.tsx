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
      <header className="shrink-0 flex items-center px-4 py-3 border-b border-zinc-900">
        <span className="text-white font-bold text-lg">⚡ Relámpago</span>
        <span className="ml-3 text-zinc-500 text-sm">{routes.length} rutas activas</span>
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
      </div>
    </div>
  )
}
