import { useRef, useState, useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { useVolumeCatalog } from '../../hooks/useVolumeCatalog'
import { supabase } from '../../lib/supabase'
import type { VolumeCatalogItem } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const CANVAS_SIZE = 220

function ShapePreview({ shape, size = 56 }: { shape: { x: number; y: number }[]; size?: number }) {
  if (!shape.length) return <div className="bg-zinc-800 rounded-xl" style={{ width: size, height: size }} />
  const pts = shape.map(p => `${p.x * size},${p.y * size}`).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-xl overflow-hidden bg-zinc-800">
      <polygon points={pts} fill="rgba(110,110,110,0.55)" stroke="rgba(180,180,180,0.6)" strokeWidth={1.5} />
    </svg>
  )
}

export default function VolumeCatalogPage() {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const { catalog, loading, refetch } = useVolumeCatalog()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const drawPts = useRef<{ x: number; y: number }[]>([])

  const [savedShape, setSavedShape] = useState<{ x: number; y: number }[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    ctx.strokeStyle = 'rgba(180,180,180,0.85)'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (savedShape.length >= 3) {
      ctx.fillStyle = 'rgba(110,110,110,0.45)'
      ctx.beginPath()
      savedShape.forEach((p, i) => {
        const sx = p.x * CANVAS_SIZE, sy = p.y * CANVAS_SIZE
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }, [savedShape])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function drawLine(pts: { x: number; y: number }[]) {
    const canvas = canvasRef.current
    if (!canvas || pts.length < 2) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    ctx.strokeStyle = 'rgba(180,180,180,0.85)'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.stroke()
    // close hint
    if (pts.length >= 3) {
      ctx.beginPath()
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(180,180,180,0.3)'
      ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      ctx.lineTo(pts[0].x, pts[0].y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  function onStart(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    isDrawing.current = true
    drawPts.current = []
    setSavedShape([])
    const p = getPos(e)
    drawPts.current.push(p)
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!isDrawing.current) return
    const p = getPos(e)
    const last = drawPts.current[drawPts.current.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4) return
    drawPts.current.push(p)
    drawLine(drawPts.current)
  }

  function onEnd(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!isDrawing.current) return
    isDrawing.current = false
    const pts = drawPts.current
    if (pts.length < 6) return
    const normalized = pts.map(p => ({ x: p.x / CANVAS_SIZE, y: p.y / CANVAS_SIZE }))
    setSavedShape(normalized)
  }

  async function saveShape() {
    if (!savedShape.length || !name.trim()) return
    setSaving(true)
    await db.from('volume_catalog').insert({ name: name.trim(), shape: savedShape })
    setSaving(false)
    setName('')
    setSavedShape([])
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    refetch()
  }

  async function deleteItem(item: VolumeCatalogItem) {
    if (!window.confirm(`¿Eliminar "${item.name}" del catálogo?`)) return
    setDeletingId(item.id)
    await db.from('volume_catalog').delete().eq('id', item.id)
    setDeletingId(null)
    refetch()
  }

  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-zinc-950">
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )
  if (profile.role !== 'admin') return <Navigate to="/staff" replace />

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-10">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/staff/admin')} className="text-zinc-400 hover:text-white transition-colors">
            ← Admin
          </button>
          <h1 className="text-white font-black text-xl tracking-tight">Catálogo de Volúmenes</h1>
        </div>

        {/* Draw area */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <h2 className="text-white font-bold text-base mb-1">Dibujar nueva forma</h2>
          <p className="text-zinc-500 text-xs mb-4">Dibuja el contorno del volumen con el dedo o el ratón</p>

          <div className="flex justify-center mb-4">
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="rounded-2xl border-2 border-zinc-700 bg-zinc-800 touch-none cursor-crosshair"
              style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
              onMouseDown={onStart}
              onMouseMove={onMove}
              onMouseUp={onEnd}
              onTouchStart={onStart}
              onTouchMove={onMove}
              onTouchEnd={onEnd}
            />
          </div>

          {savedShape.length >= 3 && (
            <>
              <input
                type="text"
                placeholder="Nombre del volumen (ej. Triángulo grande)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm mb-3 outline-none border border-zinc-700/50 focus:border-yellow-400/60 transition-all"
              />
              <button
                onClick={saveShape}
                disabled={saving || !name.trim()}
                className="w-full py-3 rounded-2xl font-bold text-sm bg-yellow-400 text-zinc-950 hover:bg-yellow-300 disabled:opacity-40 transition-all"
              >
                {saving ? 'Guardando...' : 'Guardar en catálogo'}
              </button>
            </>
          )}

          {!savedShape.length && (
            <p className="text-zinc-600 text-xs text-center">Dibuja una forma para continuar</p>
          )}
        </div>

        {/* Catalog list */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
          <h2 className="text-white font-bold text-base mb-4">Catálogo ({catalog.length})</h2>
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
            </div>
          ) : catalog.length === 0 ? (
            <p className="text-zinc-600 text-xs text-center py-4">Sin formas guardadas</p>
          ) : (
            <div className="space-y-3">
              {catalog.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-zinc-800 rounded-2xl p-3">
                  <ShapePreview shape={item.shape} size={52} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold truncate">{item.name}</p>
                    <p className="text-zinc-500 text-xs">{new Date(item.created_at).toLocaleDateString('es-MX')}</p>
                  </div>
                  <button
                    onClick={() => deleteItem(item)}
                    disabled={deletingId === item.id}
                    className="text-zinc-600 hover:text-red-400 text-xs font-bold transition-colors px-2 py-1 rounded disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
