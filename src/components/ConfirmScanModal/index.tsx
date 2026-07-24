import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../../lib/supabase'
import { getDeviceId } from '../../lib/device'

interface Props {
  qrId: string
  routeId: string
  userId: string
  onConfirmed: () => void
  onClose: () => void
}

type ScanState = 'scanning' | 'mismatch' | 'saving' | 'error'

export default function ConfirmScanModal({ qrId, routeId, userId, onConfirmed, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const mismatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [state, setState] = useState<ScanState>('scanning')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false

    function stop() {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current)
    }

    async function handleMatch() {
      stop()
      setState('saving')
      const { error } = await (supabase as unknown as any).from('scans').insert({
        route_id: routeId,
        device_id: getDeviceId(),
        user_id: userId,
      })
      if (error) {
        setMessage('No se pudo confirmar el escaneo. Intenta de nuevo.')
        setState('error')
        return
      }
      onConfirmed()
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
        const match = code.data.match(/\/q\/([^/?#]+)$/)
        if (match) {
          if (match[1] === qrId) {
            handleMatch()
            return
          }
          setState('mismatch')
          if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current)
          mismatchTimerRef.current = setTimeout(() => setState('scanning'), 1800)
        }
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
      .catch(() => {
        setMessage('No se pudo acceder a la cámara. Verifica los permisos.')
        setState('error')
      })

    return stop
  }, [qrId, routeId, userId])

  function handleClose() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950 flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-zinc-800">
        <span className="text-white font-bold text-sm">Confirmar con QR</span>
        <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all text-xl leading-none">
          ×
        </button>
      </div>

      {(state === 'scanning' || state === 'mismatch') && (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="w-56 h-56 relative">
              <div className={`absolute inset-0 border-2 rounded-2xl transition-colors ${state === 'mismatch' ? 'border-red-500/70' : 'border-yellow-400/60'}`} />
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-yellow-400 rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-yellow-400 rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-yellow-400 rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-yellow-400 rounded-br-2xl" />
            </div>
            {state === 'mismatch' ? (
              <p className="text-red-400 text-sm mt-6 font-semibold">Ese QR no es de esta ruta</p>
            ) : (
              <p className="text-zinc-300 text-sm mt-6">Apunta al QR junto a la ruta</p>
            )}
          </div>
        </div>
      )}

      {state === 'saving' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          <p className="text-zinc-400 text-sm">Confirmando...</p>
        </div>
      )}

      {state === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <span className="text-red-400 text-2xl">!</span>
          </div>
          <p className="text-red-400 text-sm text-center">{message}</p>
          <button
            onClick={handleClose}
            className="w-full bg-zinc-800 text-zinc-300 font-bold text-sm py-3.5 rounded-2xl hover:bg-zinc-700 transition-all"
          >
            Cerrar
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
