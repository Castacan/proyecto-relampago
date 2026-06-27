import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../../lib/supabase'

interface Props {
  routeId: string
  onAssigned: (qrId: string) => void
  onClose: () => void
}

type ScanState = 'scanning' | 'detected' | 'confirming' | 'error'

export default function QrScanner({ routeId, onAssigned, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const [state, setState] = useState<ScanState>('scanning')
  const [detectedId, setDetectedId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let stopped = false

    function stop() {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
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
          stop()
          setDetectedId(match[1])
          setState('detected')
          return
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
  }, [])

  function handleClose() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onClose()
  }

  async function handleConfirm() {
    if (!detectedId) return
    setSaving(true)
    const { data: qr } = await supabase
      .from('qr_codes')
      .select('id, status')
      .eq('id', detectedId)
      .single()

    if (!qr) {
      setMessage('Este QR no existe en el sistema.')
      setState('error')
      setSaving(false)
      return
    }
    if (qr.status === 'in_use') {
      setMessage('Este QR ya está asignado a otra ruta.')
      setState('error')
      setSaving(false)
      return
    }

    await supabase.from('qr_codes').update({ status: 'in_use', route_id: routeId }).eq('id', detectedId)
    setSaving(false)
    onAssigned(detectedId)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-zinc-800">
        <span className="text-white font-bold text-sm">Escanear QR</span>
        <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all text-xl leading-none">
          ×
        </button>
      </div>

      {/* Camera view */}
      {state === 'scanning' && (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="w-56 h-56 relative">
              <div className="absolute inset-0 border-2 border-yellow-400/60 rounded-2xl" />
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-yellow-400 rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-yellow-400 rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-yellow-400 rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-yellow-400 rounded-br-2xl" />
            </div>
            <p className="text-zinc-300 text-sm mt-6">Apunta al código QR del papel</p>
          </div>
        </div>
      )}

      {/* Detected */}
      {state === 'detected' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-16 h-16 rounded-full bg-yellow-400/15 border border-yellow-400/30 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
              <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
              <rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/>
              <rect x="7" y="14" width="3" height="3"/><path d="M14 14h3v3"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white font-bold mb-1">QR detectado</p>
            <p className="text-zinc-500 text-[11px] font-mono break-all">{detectedId}</p>
          </div>
          <p className="text-zinc-400 text-sm text-center">¿Asignar este QR a la ruta actual?</p>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full bg-yellow-400 text-zinc-950 font-black text-sm py-3.5 rounded-2xl hover:bg-yellow-300 transition-all disabled:opacity-50 shadow-lg shadow-yellow-400/20"
          >
            {saving ? 'Asignando...' : 'Confirmar asignación'}
          </button>
          <button
            onClick={handleClose}
            className="w-full bg-zinc-800 text-zinc-300 font-bold text-sm py-3.5 rounded-2xl hover:bg-zinc-700 transition-all"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Error */}
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
