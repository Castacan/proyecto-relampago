import { useEffect, useRef, useState } from 'react'

// Recuadro para firmar con el dedo, el mouse o la pluma. Devuelve un PNG en
// base64 (data:image/png;base64,…) o null si está vacío.
export default function SignaturePad({ onChange, height = 180 }: { onChange: (png: string | null) => void; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const w = c.parentElement?.clientWidth ?? 400
      c.width = Math.floor(w * ratio); c.height = Math.floor(height * ratio)
      c.style.width = `${w}px`; c.style.height = `${height}px`
      const ctx = c.getContext('2d')!
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'
      setEmpty(true); onChange(null)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true; last.current = pos(e)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return
    const ctx = canvas.current!.getContext('2d')!
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false; last.current = null
    if (!empty) onChange(canvas.current!.toDataURL('image/png'))
  }
  const clear = () => {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true); onChange(null)
  }

  return (
    <div>
      <div className="relative rounded-xl bg-white overflow-hidden border-2 border-dashed border-zinc-400">
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          className="block touch-none cursor-crosshair" aria-label="Recuadro para firmar" />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-zinc-400 text-sm">Firma aquí con el dedo</span>}
        <span className="pointer-events-none absolute left-4 right-4 bottom-8 border-b border-zinc-300" />
      </div>
      <button type="button" onClick={clear} className="mt-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200">Borrar firma</button>
    </div>
  )
}
