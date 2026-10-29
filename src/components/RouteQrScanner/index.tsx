import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Escáner para el cliente: lee el QR de cualquier ruta y avisa su id
// (la página /q/:qrId registra el escaneo y abre la ruta).

interface Props {
  onDetected: (qrId: string) => void
  onClose: () => void
}

export default function RouteQrScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [notRoute, setNotRoute] = useState(false)

  useEffect(() => {
    let stopped = false
    let notRouteTimer: ReturnType<typeof setTimeout> | null = null

    function stop() {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (notRouteTimer) clearTimeout(notRouteTimer)
    }

    function scan() {
      if (stopped) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scan)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        const match = code.data.match(/\/q\/([^/?#]+)\/?(?:[?#].*)?$/)
        if (match) {
          stop()
          onDetected(decodeURIComponent(match[1]))
          return
        }
        setNotRoute(true)
        if (notRouteTimer) clearTimeout(notRouteTimer)
        notRouteTimer = setTimeout(() => setNotRoute(false), 1800)
      }
      rafRef.current = requestAnimationFrame(scan)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.play().then(() => { rafRef.current = requestAnimationFrame(scan) })
        }
      })
      .catch(() => setError('No se pudo acceder a la cámara. Verifica los permisos.'))

    return stop
  }, [onDetected])

  function handleClose() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-fondo flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-zinc-800">
        <span className="text-texto-principal font-bold text-sm">Escanear otra ruta</span>
        <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-xl leading-none">
          ×
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <span className="text-red-400 text-2xl">!</span>
          </div>
          <p className="text-red-400 text-sm text-center">{error}</p>
          <button
            onClick={handleClose}
            className="w-full bg-superficie-alta text-zinc-300 font-bold text-sm py-3.5 rounded-2xl hover:bg-superficie-alta-hover transition-all"
          >
            Cerrar
          </button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="w-56 h-56 relative">
              <div className={`absolute inset-0 border-2 rounded-2xl transition-colors ${notRoute ? 'border-red-500/70' : 'border-primario/60'}`} />
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primario rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primario rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primario rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primario rounded-br-2xl" />
            </div>
            {notRoute
              ? <p className="text-red-400 text-sm mt-6 font-semibold">Ese QR no es de una ruta</p>
              : <p className="text-zinc-300 text-sm mt-6">Apunta al QR junto a la ruta</p>}
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
