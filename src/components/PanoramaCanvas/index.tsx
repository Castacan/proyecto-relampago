import { useRef, useState, useCallback, useEffect } from 'react'
import { Stage, Layer, Line, Rect, Text, Group } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'

export const WALL_WIDTH = 3500
export const WALL_HEIGHT = 800
const MIN_SCALE = 0.1
const MAX_SCALE = 6
const STROKE_W = 20
const MIN_POINT_GAP = 8  // min world pixels between captured points

const ZONE_COLORS = ['#1a2e22','#1a2433','#2a1f33','#332b1a','#1a3333','#1f1a33','#331a26']

function dist2(p1: Touch, p2: Touch) {
  return Math.sqrt((p2.clientX - p1.clientX) ** 2 + (p2.clientY - p1.clientY) ** 2)
}

function toFlat(path: { x: number; y: number }[]): number[] {
  return path.flatMap(p => [p.x * WALL_WIDTH, p.y * WALL_HEIGHT])
}

function centroid(path: { x: number; y: number }[]): { x: number; y: number } {
  const sum = path.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  return { x: (sum.x / path.length) * WALL_WIDTH, y: (sum.y / path.length) * WALL_HEIGHT }
}

interface Props {
  zones: Zone[]
  routes: Route[]
  paintMode: boolean
  drawColor: string
  previewBlob: { path: { x: number; y: number }[]; color: string } | null
  isStaff: boolean
  onBlobComplete: (points: { x: number; y: number }[]) => void
  onRouteClick: (route: Route) => void
}

export default function PanoramaCanvas({ zones, routes, paintMode, drawColor, previewBlob, isStaff, onBlobComplete, onRouteClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const scaleRef = useRef(1)
  const [size, setSize] = useState({ w: 300, h: 500 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Drawing state
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPoint = useRef({ x: 0, y: 0 })

  // Touch pinch state
  const lastPinchDist = useRef(0)
  const isPinching = useRef(false)

  // Measure container once mounted
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const initScale = w / WALL_WIDTH
      scaleRef.current = initScale
      setSize({ w, h })
      setScale(initScale)
      setPos({ x: 0, y: Math.max(0, (h - WALL_HEIGHT * initScale) / 2) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- Zoom via scroll wheel ---
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = scaleRef.current
    const pointer = stage.getPointerPosition()!
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    const factor = e.evt.deltaY < 0 ? 1.12 : 0.9
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor))
    scaleRef.current = newScale
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
    setScale(newScale)
    setPos(newPos)
  }, [])

  // --- Stage drag end (sync pos) ---
  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    setPos({ x: e.target.x(), y: e.target.y() })
  }, [])

  // --- Drawing helpers ---
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const stage = stageRef.current!
    const s = scaleRef.current
    return { x: (sx - stage.x()) / s, y: (sy - stage.y()) / s }
  }, [])

  const addDrawPoint = useCallback((sx: number, sy: number) => {
    const wp = screenToWorld(sx, sy)
    if (isDrawing.current) {
      const dx = wp.x - lastDrawPoint.current.x
      const dy = wp.y - lastDrawPoint.current.y
      if (Math.sqrt(dx * dx + dy * dy) < MIN_POINT_GAP) return
    }
    lastDrawPoint.current = wp
    setDrawPoints(prev => [...prev, wp.x, wp.y])
  }, [screenToWorld])

  // --- Mouse events (desktop) ---
  const handleMouseDown = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode) return
    isDrawing.current = true
    const stage = stageRef.current!
    const p = stage.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  }, [paintMode, addDrawPoint])

  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode || !isDrawing.current) return
    const stage = stageRef.current!
    const p = stage.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  }, [paintMode, addDrawPoint])

  const handleMouseUp = useCallback(() => {
    if (!paintMode || !isDrawing.current) return
    isDrawing.current = false
    finishDrawing()
  }, [paintMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Touch events (mobile) ---
  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (e.evt.touches.length === 2) {
      isPinching.current = true
      lastPinchDist.current = dist2(e.evt.touches[0], e.evt.touches[1])
      return
    }
    if (paintMode && e.evt.touches.length === 1) {
      const t = e.evt.touches[0]
      const rect = stageRef.current!.container().getBoundingClientRect()
      isDrawing.current = true
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    }
  }, [paintMode, addDrawPoint])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (e.evt.touches.length === 2) {
      const d = dist2(e.evt.touches[0], e.evt.touches[1])
      if (lastPinchDist.current) {
        const oldScale = scaleRef.current
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * (d / lastPinchDist.current)))
        scaleRef.current = newScale
        setScale(newScale)
      }
      lastPinchDist.current = d
      return
    }
    if (paintMode && e.evt.touches.length === 1 && isDrawing.current && !isPinching.current) {
      const t = e.evt.touches[0]
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    }
  }, [paintMode, addDrawPoint])

  const handleTouchEnd = useCallback((e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) {
      isPinching.current = false
      lastPinchDist.current = 0
    }
    if (paintMode && isDrawing.current) {
      isDrawing.current = false
      finishDrawing()
    }
  }, [paintMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function finishDrawing() {
    setDrawPoints(prev => {
      if (prev.length < 4) return []
      const normalized: { x: number; y: number }[] = []
      for (let i = 0; i < prev.length; i += 2) {
        normalized.push({ x: prev[i] / WALL_WIDTH, y: prev[i + 1] / WALL_HEIGHT })
      }
      onBlobComplete(normalized)
      return []
    })
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden touch-none select-none">
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable={!paintMode}
        onDragEnd={handleDragEnd}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Capa 1: Fondo del muro (placeholders por zona) */}
        <Layer listening={false}>
          {zones.map((zone, i) => {
            const x = zone.canvas_x_start * WALL_WIDTH
            const w = (zone.canvas_x_end - zone.canvas_x_start) * WALL_WIDTH
            return (
              <Group key={zone.id}>
                <Rect x={x} y={0} width={w} height={WALL_HEIGHT} fill={ZONE_COLORS[i % ZONE_COLORS.length]} />
                <Rect x={x + w - 1} y={0} width={2} height={WALL_HEIGHT} fill="rgba(255,255,255,0.08)" />
                <Text x={x + 12} y={12} text={zone.name} fontSize={13} fill="rgba(255,255,255,0.25)" fontFamily="sans-serif" />
              </Group>
            )
          })}
          <Rect x={0} y={WALL_HEIGHT - 2} width={WALL_WIDTH} height={2} fill="rgba(255,255,255,0.08)" />
        </Layer>

        {/* Capa 2: Blobs de rutas existentes */}
        <Layer>
          {routes.map(route => {
            if (!route.blob_path || route.blob_path.length < 2) return null
            const flat = toFlat(route.blob_path)
            const colorHex = getColorHex(route.color)
            const level = getFreshnessLevel(route.placed_at)
            const freshnessHex = getFreshnessColor(level)
            const days = getDaysOnWall(route.placed_at)
            const c = centroid(route.blob_path)

            return (
              <Group key={route.id} onClick={() => onRouteClick(route)} onTap={() => onRouteClick(route)}>
                {/* Halo de frescura */}
                <Line points={flat} stroke={freshnessHex} strokeWidth={STROKE_W + 8} tension={0.5} lineCap="round" lineJoin="round" opacity={0.35} listening={false} />
                {/* Blob principal */}
                <Line points={flat} stroke={colorHex} strokeWidth={STROKE_W} tension={0.5} lineCap="round" lineJoin="round" opacity={0.92} hitStrokeWidth={40} />
                {/* Tag de días (staff) */}
                {isStaff && (
                  <Group x={c.x} y={c.y - 36} listening={false}>
                    <Line points={[0, 4, 0, 22]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-22} y={-14} width={44} height={18} fill={freshnessHex} cornerRadius={5} />
                    <Text x={-20} y={-11} text={`${days}d`} fontSize={12} fill="#111" fontStyle="bold" fontFamily="sans-serif" width={40} align="center" />
                  </Group>
                )}
                {/* Etiqueta pública (Crudo / Al dente / Quemada) */}
                {!isStaff && (
                  <Group x={c.x} y={c.y - 36} listening={false}>
                    <Line points={[0, 4, 0, 22]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-38} y={-14} width={76} height={18} fill="rgba(0,0,0,0.75)" cornerRadius={5} />
                    <Text x={-36} y={-11} text={getPublicLabel(level)} fontSize={11} fill={freshnessHex} fontStyle="bold" fontFamily="sans-serif" width={72} align="center" />
                  </Group>
                )}
              </Group>
            )
          })}
        </Layer>

        {/* Capa 3: Preview blob (mientras el form está abierto) + trazo activo */}
        <Layer listening={false}>
          {previewBlob && previewBlob.path.length >= 2 && (
            <Line
              points={toFlat(previewBlob.path)}
              stroke={getColorHex(previewBlob.color)}
              strokeWidth={STROKE_W}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              opacity={0.75}
              dash={[30, 12]}
            />
          )}
          {paintMode && drawPoints.length >= 4 && (
            <Line
              points={drawPoints}
              stroke={getColorHex(drawColor)}
              strokeWidth={STROKE_W}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              opacity={0.85}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}
