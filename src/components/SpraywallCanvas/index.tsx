import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Circle, Text, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { SpraywallHold } from '../../types'
import { getHoldHex, type HoldRole } from '../../lib/spraywall'

interface Props {
  photoUrl: string
  photoW?: number | null
  photoH?: number | null
  holds: SpraywallHold[]
  mode: 'view' | 'edit'
  activeRole?: HoldRole
  selectedIndex?: number | null
  onSelectIndex?: (i: number | null) => void
  onHoldsChange?: (holds: SpraywallHold[]) => void
}

// Zoom (2026-08-26): el usuario señaló que con muchos agarres apretados en
// una foto de alta resolución, sin poder acercarse es imposible tocar el
// correcto. Rueda del mouse + pellizco de 2 dedos + botones +/− centran el
// zoom en el punto tocado/apuntado; el pan es el `draggable` nativo de
// Konva Stage (distingue solo automáticamente entre arrastrar el fondo
// —pan— y arrastrar un agarre —mover el agarre—, según qué nodo recibe el
// toque). Coordenadas de agarres se leen con `getRelativePointerPosition()`,
// que ya deshace el zoom/pan del Stage, así que `toNormalized` no cambia.
const MIN_ZOOM = 1
const MAX_ZOOM = 6
const WHEEL_STEP = 1.08
const BUTTON_STEP = 1.5

export default function SpraywallCanvas({
  photoUrl, photoW, photoH, holds, mode,
  activeRole, selectedIndex = null, onSelectIndex, onHoldsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  const [zoom, setZoomState] = useState(1)
  const zoomRef = useRef(1)
  function setZoom(v: number) { zoomRef.current = v; setZoomState(v) }

  const [stagePos, setStagePosState] = useState({ x: 0, y: 0 })
  const stagePosRef = useRef({ x: 0, y: 0 })
  function setStagePos(p: { x: number; y: number }) { stagePosRef.current = p; setStagePosState(p) }

  const pinchStart = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; pos: { x: number; y: number } } | null>(null)

  useEffect(() => {
    if (!photoUrl) return
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => setImg(image)
    image.src = photoUrl
  }, [photoUrl])

  // Foto distinta (otra ruta, u otra versión) → zoom/pan de vuelta a fit.
  useEffect(() => {
    setZoom(1)
    setStagePos({ x: 0, y: 0 })
  }, [photoUrl])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const naturalW = img?.naturalWidth || photoW || 4
  const naturalH = img?.naturalHeight || photoH || 3
  const fitScale = Math.min(size.w / naturalW, size.h / naturalH) || 1
  const dw = naturalW * fitScale
  const dh = naturalH * fitScale
  const offsetX = (size.w - dw) / 2
  const offsetY = (size.h - dh) / 2
  const radius = Math.max(9, dw * 0.022)

  function toNormalized(px: number, py: number): { x: number; y: number } | null {
    const x = (px - offsetX) / dw
    const y = (py - offsetY) / dh
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }

  // Mantiene fijo el punto de la foto bajo `point` (coords de pantalla,
  // relativas al contenedor) mientras cambia el zoom por `factor`.
  function zoomAt(point: { x: number; y: number }, factor: number) {
    const prevZoom = zoomRef.current
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor))
    if (newZoom === prevZoom) return
    const prevPos = stagePosRef.current
    const sx = (point.x - prevPos.x) / prevZoom
    const sy = (point.y - prevPos.y) / prevZoom
    setZoom(newZoom)
    setStagePos({ x: point.x - sx * newZoom, y: point.y - sy * newZoom })
  }

  function resetZoom() {
    setZoom(1)
    setStagePos({ x: 0, y: 0 })
  }

  // Rueda del mouse → zoom centrado en el cursor (PC).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pellizco de 2 dedos → zoom centrado en el punto medio (touch). El pan
  // de 1 dedo lo maneja Konva solo via Stage draggable — aquí solo hace
  // falta cancelar ese drag nativo si un segundo dedo se une a medio gesto.
  function handleTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const touches = e.evt.touches
    if (touches.length !== 2) { pinchStart.current = null; return }
    e.evt.preventDefault()
    stageRef.current?.stopDrag()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const [t1, t2] = [touches[0], touches[1]]
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
    const mid = { x: (t1.clientX + t2.clientX) / 2 - rect.left, y: (t1.clientY + t2.clientY) / 2 - rect.top }

    if (!pinchStart.current) {
      pinchStart.current = { dist, zoom: zoomRef.current, mid, pos: stagePosRef.current }
      return
    }
    const factor = dist / pinchStart.current.dist
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStart.current.zoom * factor))
    const start = pinchStart.current
    const sx = (start.mid.x - start.pos.x) / start.zoom
    const sy = (start.mid.y - start.pos.y) / start.zoom
    setZoom(newZoom)
    setStagePos({ x: start.mid.x - sx * newZoom, y: start.mid.y - sy * newZoom })
  }
  function handleTouchEnd() { pinchStart.current = null }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (mode !== 'edit' || !activeRole || !onHoldsChange) return
    if (e.target !== e.target.getStage()) return
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    if (!pos) return
    const norm = toNormalized(pos.x, pos.y)
    if (!norm) return
    onHoldsChange([...holds, { x: norm.x, y: norm.y, role: activeRole }])
    onSelectIndex?.(holds.length)
  }

  function handleDragMove(i: number, e: Konva.KonvaEventObject<DragEvent>) {
    if (!onHoldsChange) return
    const norm = toNormalized(e.target.x(), e.target.y())
    if (!norm) return
    const next = [...holds]
    next[i] = { ...next[i], x: norm.x, y: norm.y }
    onHoldsChange(next)
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-superficie overflow-hidden">
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={zoom}
        scaleY={zoom}
        draggable={zoom > 1}
        onDragMove={e => setStagePos({ x: e.target.x(), y: e.target.y() })}
        onDragEnd={e => setStagePos({ x: e.target.x(), y: e.target.y() })}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          {img && <KonvaImage image={img} x={offsetX} y={offsetY} width={dw} height={dh} />}
          {holds.map((h, i) => {
            const cx = offsetX + h.x * dw
            const cy = offsetY + h.y * dh
            const isSelected = mode === 'edit' && selectedIndex === i
            return (
              <Circle
                key={i}
                x={cx}
                y={cy}
                radius={radius}
                stroke={isSelected ? '#FACC15' : getHoldHex(h.role)}
                strokeWidth={isSelected ? 4 : 3}
                fill="transparent"
                draggable={mode === 'edit'}
                onClick={mode === 'edit' ? () => onSelectIndex?.(i) : undefined}
                onTap={mode === 'edit' ? () => onSelectIndex?.(i) : undefined}
                onDragMove={mode === 'edit' ? e => handleDragMove(i, e) : undefined}
              />
            )
          })}
          {holds.map((h, i) => h.label ? (
            <Text
              key={`label-${i}`}
              x={offsetX + h.x * dw + radius + 3}
              y={offsetY + h.y * dh - 7}
              text={h.label}
              fontSize={13}
              fontStyle="bold"
              fill="#ffffff"
              shadowColor="#000000"
              shadowBlur={3}
              shadowOpacity={0.9}
            />
          ) : null)}
        </Layer>
      </Stage>

      {/* Controles de zoom — overlay HTML, no Konva, para no interferir con
          los gestos del Stage. Botones dan control preciso además de rueda/pellizco. */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-fondo/90 backdrop-blur-sm rounded-xl border border-zinc-800/60 p-1 pointer-events-auto">
        {zoom !== 1 && (
          <button
            type="button"
            onClick={resetZoom}
            className="px-2 h-7 rounded-lg text-zinc-400 hover:text-texto-principal hover:bg-superficie-alta text-[10px] font-bold transition-all"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        <button
          type="button"
          onClick={() => zoomAt({ x: size.w / 2, y: size.h / 2 }, 1 / BUTTON_STEP)}
          disabled={zoom <= MIN_ZOOM}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-300 hover:bg-superficie-alta disabled:opacity-30 disabled:cursor-not-allowed font-black text-base leading-none transition-all"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => zoomAt({ x: size.w / 2, y: size.h / 2 }, BUTTON_STEP)}
          disabled={zoom >= MAX_ZOOM}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-300 hover:bg-superficie-alta disabled:opacity-30 disabled:cursor-not-allowed font-black text-base leading-none transition-all"
        >
          +
        </button>
      </div>
    </div>
  )
}
