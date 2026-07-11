import { useRef, useState, useEffect, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { useVolumeCatalog } from '../../hooks/useVolumeCatalog'
import { supabase } from '../../lib/supabase'
import type { VolumeCatalogItem } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const CANVAS_RES = 360

type DrawMode = 'perimeter' | 'details'

function ShapePreview({ item, size = 56 }: { item: Pick<VolumeCatalogItem, 'shape' | 'details'>; size?: number }) {
  const { shape, details = [] } = item
  if (!shape.length) return <div className="bg-zinc-800 rounded-xl" style={{ width: size, height: size }} />
  const pts = shape.map(p => `${p.x * size},${p.y * size}`).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-xl overflow-hidden bg-zinc-800">
      <polygon points={pts} fill="rgba(110,110,110,0.55)" stroke="rgba(180,180,180,0.6)" strokeWidth={1.5} />
      {details.map((stroke, i) => (
        <polyline
          key={i}
          points={stroke.map(p => `${p.x * size},${p.y * size}`).join(' ')}
          fill="none"
          stroke="rgba(35,35,35,0.9)"
          strokeWidth={Math.max(1, size / 22)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
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

  const [drawMode, setDrawMode] = useState<DrawMode>('perimeter')
  const [savedShape, setSavedShape] = useState<{ x: number; y: number }[]>([])
  const [savedDetails, setSavedDetails] = useState<{ x: number; y: number }[][]>([])
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [retiringAllId, setRetiringAllId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  const hasPerimeter = savedShape.length >= 3
  const isEditing = editingItemId !== null

  // ── Canvas helpers ────────────────────────────────────────────────
  function getScale(): number {
    const c = canvasRef.current
    if (!c) return 1
    const rect = c.getBoundingClientRect()
    return rect.width > 0 ? CANVAS_RES / rect.width : 1
  }

  const redrawCanvas = useCallback((shape: {x:number,y:number}[], details: {x:number,y:number}[][]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const S = CANVAS_RES
    ctx.clearRect(0, 0, S, S)
    if (shape.length < 3) return

    ctx.fillStyle = 'rgba(110,110,110,0.45)'
    ctx.strokeStyle = 'rgba(180,180,180,0.85)'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    shape.forEach((p, i) => {
      const sx = p.x * S, sy = p.y * S
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.strokeStyle = 'rgba(38,38,38,0.92)'
    ctx.lineWidth = 7
    details.forEach(stroke => {
      if (stroke.length < 2) return
      ctx.beginPath()
      stroke.forEach((p, i) => {
        const sx = p.x * S, sy = p.y * S
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
      })
      ctx.stroke()
    })
  }, [])

  useEffect(() => {
    redrawCanvas(savedShape, savedDetails)
  }, [savedShape, savedDetails, redrawCanvas])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = (e as React.TouchEvent).touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function drawLiveStroke(pts: {x:number, y:number}[], scale: number, mode: DrawMode) {
    if (pts.length < 2) return
    const ctx = canvasRef.current!.getContext('2d')!
    redrawCanvas(savedShape, savedDetails)
    if (mode === 'perimeter') {
      ctx.strokeStyle = 'rgba(200,200,200,0.9)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      pts.forEach((p, i) => {
        const sx = p.x * scale, sy = p.y * scale
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
      })
      ctx.stroke()
      if (pts.length >= 3) {
        ctx.beginPath()
        ctx.setLineDash([8, 6])
        ctx.strokeStyle = 'rgba(180,180,180,0.3)'
        ctx.moveTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale)
        ctx.lineTo(pts[0].x * scale, pts[0].y * scale)
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      ctx.strokeStyle = 'rgba(38,38,38,0.92)'
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      pts.forEach((p, i) => {
        const sx = p.x * scale, sy = p.y * scale
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
      })
      ctx.stroke()
    }
  }

  function onStart(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    isDrawing.current = true
    drawPts.current = []
    const p = getPos(e)
    drawPts.current.push(p)
    if (drawMode === 'perimeter' && !isEditing) {
      setSavedShape([])
      setSavedDetails([])
    }
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!isDrawing.current) return
    const p = getPos(e)
    const last = drawPts.current[drawPts.current.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 3) return
    drawPts.current.push(p)
    drawLiveStroke(drawPts.current, getScale(), drawMode)
  }

  function onEnd(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!isDrawing.current) return
    isDrawing.current = false
    const pts = drawPts.current
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const w = rect.width || CANVAS_RES
    const h = rect.height || CANVAS_RES

    if (drawMode === 'perimeter' && !isEditing) {
      if (pts.length < 6) { redrawCanvas(savedShape, savedDetails); return }
      const normalized = pts.map(p => ({ x: p.x / w, y: p.y / h }))
      setSavedShape(normalized)
    } else {
      if (pts.length < 3) { redrawCanvas(savedShape, savedDetails); return }
      const normalized = pts.map(p => ({ x: p.x / w, y: p.y / h }))
      setSavedDetails(prev => [...prev, normalized])
    }
    drawPts.current = []
  }

  function resetAll() {
    setSavedShape([])
    setSavedDetails([])
    setDrawMode('perimeter')
    setName('')
    setQuantity('')
    setSaveError(null)
    setEditingItemId(null)
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, CANVAS_RES, CANVAS_RES)
  }

  function startEdit(item: VolumeCatalogItem) {
    setSavedShape(item.shape)
    setSavedDetails(item.details ?? [])
    setDrawMode('details')
    setName(item.name)
    setQuantity(item.quantity != null ? String(item.quantity) : '')
    setSaveError(null)
    setEditingItemId(item.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveShape() {
    if (!hasPerimeter || !name.trim()) return
    setSaving(true)
    setSaveError(null)
    const payload: Record<string, unknown> = { name: name.trim(), shape: savedShape, details: savedDetails }
    if (quantity) payload.quantity = parseInt(quantity)
    let res = await db.from('volume_catalog').insert(payload)
    if (res?.error) {
      const msg: string = res.error.message ?? ''
      if (msg.includes('details') || msg.includes('column')) {
        const p2: Record<string, unknown> = { name: name.trim(), shape: savedShape }
        if (quantity) p2.quantity = parseInt(quantity)
        res = await db.from('volume_catalog').insert(p2)
      }
    }
    setSaving(false)
    if (res?.error) { setSaveError(res.error.message); return }
    resetAll()
    refetch()
  }

  async function saveEdit() {
    if (!editingItemId || !name.trim()) return
    setSaving(true)
    setSaveError(null)
    const payload: Record<string, unknown> = {
      name: name.trim(),
      details: savedDetails,
      quantity: quantity ? parseInt(quantity) : null,
    }
    const res = await db.from('volume_catalog').update(payload).eq('id', editingItemId)
    setSaving(false)
    if (res?.error) { setSaveError(res.error.message); return }
    resetAll()
    refetch()
  }

  async function retireAllVolumes(item: VolumeCatalogItem) {
    if (!window.confirm(`¿Retirar de la pared todos los volúmenes de tipo "${item.name}"?`)) return
    setRetiringAllId(item.id)
    await db.from('volumes')
      .update({ status: 'retired', retired_at: new Date().toISOString() })
      .eq('catalog_id', item.id)
      .eq('status', 'active')
    setRetiringAllId(null)
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

        {/* Draw / Edit area */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-bold text-base">
              {isEditing ? `Editando: ${name || '…'}` : 'Dibujar nueva forma'}
            </h2>
            {(hasPerimeter || savedDetails.length > 0 || isEditing) && (
              <button onClick={resetAll} className="text-zinc-500 hover:text-zinc-300 text-xs font-bold transition-colors">
                {isEditing ? 'Cancelar' : 'Limpiar'}
              </button>
            )}
          </div>
          <p className="text-zinc-500 text-xs mb-4">
            {isEditing
              ? `Agrega o quita detalles · ${savedDetails.length} trazo${savedDetails.length !== 1 ? 's' : ''}`
              : drawMode === 'perimeter'
              ? 'Dibuja el contorno del volumen con el dedo o el ratón'
              : `Dibuja líneas de detalle · ${savedDetails.length} trazo${savedDetails.length !== 1 ? 's' : ''}`
            }
          </p>

          {/* Mode toggle — solo al crear, no al editar */}
          {hasPerimeter && !isEditing && (
            <div className="flex gap-1 mb-3 bg-zinc-800 p-1 rounded-xl">
              <button
                onClick={() => setDrawMode('perimeter')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  drawMode === 'perimeter' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Contorno
              </button>
              <button
                onClick={() => setDrawMode('details')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  drawMode === 'details' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                + Detalles
              </button>
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={CANVAS_RES}
            height={CANVAS_RES}
            className="rounded-2xl border-2 border-zinc-700 bg-zinc-800 touch-none cursor-crosshair"
            style={{ width: '100%', maxWidth: 300, aspectRatio: '1 / 1', display: 'block', margin: '0 auto' }}
            onMouseDown={onStart}
            onMouseMove={onMove}
            onMouseUp={onEnd}
            onTouchStart={onStart}
            onTouchMove={onMove}
            onTouchEnd={onEnd}
          />

          {(hasPerimeter || isEditing) ? (
            <div className="mt-4 space-y-3">
              {savedDetails.length > 0 && (
                <button
                  onClick={() => setSavedDetails(prev => prev.slice(0, -1))}
                  className="w-full py-2.5 rounded-xl font-bold text-xs bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 border border-zinc-700 transition-all"
                >
                  Deshacer último trazo
                </button>
              )}
              <input
                type="text"
                placeholder="Nombre del volumen (ej. Triángulo grande)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 focus:border-yellow-400/60 transition-all"
              />
              <div className="flex items-center gap-3">
                <label className="text-zinc-500 text-xs font-medium shrink-0">Inventario</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Ilimitado"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className="w-28 bg-zinc-800 text-white rounded-xl px-3 py-2 text-sm outline-none border border-zinc-700/50 focus:border-yellow-400/60 transition-all"
                />
                <span className="text-zinc-600 text-xs">piezas (opcional)</span>
              </div>
              {saveError && (
                <p className="text-red-400 text-xs text-center px-2">{saveError}</p>
              )}
              <button
                onClick={isEditing ? saveEdit : saveShape}
                disabled={saving || !name.trim()}
                className="w-full py-3 rounded-2xl font-bold text-sm bg-yellow-400 text-zinc-950 hover:bg-yellow-300 disabled:opacity-40 transition-all"
              >
                {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Guardar en catálogo'}
              </button>
            </div>
          ) : (
            <p className="text-zinc-600 text-xs text-center mt-4">Dibuja el contorno para continuar</p>
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
                <div key={item.id} className={`flex items-center gap-3 bg-zinc-800 rounded-2xl p-3 ${editingItemId === item.id ? 'ring-2 ring-yellow-400/60' : ''}`}>
                  <ShapePreview item={item} size={56} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold truncate">{item.name}</p>
                    <p className="text-zinc-500 text-xs">
                      {item.quantity != null ? `Inv: ${item.quantity}` : 'Sin límite'}
                      {(item.details?.length ?? 0) > 0 ? ` · ${item.details.length} det.` : ' · sin detalles'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => startEdit(item)}
                      className="text-zinc-400 hover:text-yellow-400 text-xs font-bold transition-colors px-2 py-1 rounded"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => retireAllVolumes(item)}
                      disabled={retiringAllId === item.id}
                      className="text-zinc-500 hover:text-orange-400 text-xs font-bold transition-colors px-2 py-1 rounded disabled:opacity-40"
                    >
                      {retiringAllId === item.id ? '…' : 'Retirar todos'}
                    </button>
                    <button
                      onClick={() => deleteItem(item)}
                      disabled={deletingId === item.id}
                      className="text-zinc-600 hover:text-red-400 text-xs font-bold transition-colors px-2 py-1 rounded disabled:opacity-40"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
