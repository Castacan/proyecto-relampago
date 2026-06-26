import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'

export const ZONE_W = 1200
export const ZONE_H = 900

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const STROKE_W = 8
const MIN_POINT_GAP = 4

const ZONE_COLORS = ['#1a2e22', '#1a2433', '#2a1f33', '#332b1a', '#1a3333', '#1f1a33', '#331a26']

function dist2(p1: Touch, p2: Touch) {
  return Math.sqrt((p2.clientX - p1.clientX) ** 2 + (p2.clientY - p1.clientY) ** 2)
}

// Compute pixel layout for a group of zones using canvas_x_start/end proportions.
// All zones are assumed to be adjacent and ordered left-to-right.
function computeGroupLayout(zones: Zone[]): {
  combinedW: number
  offsets: Record<string, { x: number; w: number }>
} {
  if (zones.length === 1) {
    return { combinedW: ZONE_W, offsets: { [zones[0].id]: { x: 0, w: ZONE_W } } }
  }
  const groupStart = zones[0].canvas_x_start
  const groupEnd = zones[zones.length - 1].canvas_x_end
  const groupSpan = groupEnd - groupStart
  // Combined canvas width is proportional — ZONE_W per equal-sized zone
  const combinedW = ZONE_W * zones.length
  const offsets: Record<string, { x: number; w: number }> = {}
  for (const zone of zones) {
    const relStart = (zone.canvas_x_start - groupStart) / groupSpan
    const relEnd = (zone.canvas_x_end - groupStart) / groupSpan
    offsets[zone.id] = {
      x: Math.round(relStart * combinedW),
      w: Math.round((relEnd - relStart) * combinedW),
    }
  }
  return { combinedW, offsets }
}

function toFlatOffset(path: { x: number; y: number }[], offsetX: number, zoneW: number): number[] {
  return path.flatMap(p => [p.x * zoneW + offsetX, p.y * ZONE_H])
}

function centroidOffset(path: { x: number; y: number }[], offsetX: number, zoneW: number) {
  const sum = path.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  return {
    x: (sum.x / path.length) * zoneW + offsetX,
    y: (sum.y / path.length) * ZONE_H,
  }
}

interface Props {
  zones: Zone[]
  routes: Route[]
  paintMode: boolean
  drawColor: string
  previewBlob: { path: { x: number; y: number }[]; color: string; zone?: Zone } | null
  isStaff: boolean
  onBlobComplete: (points: { x: number; y: number }[], zone: Zone) => void
  onRouteClick: (route: Route) => void
}

export default function ZoneCanvas({ zones, routes, paintMode, drawColor, previewBlob, isStaff, onBlobComplete, onRouteClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const scaleRef = useRef(1)
  const [size, setSize] = useState({ w: 300, h: 500 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Always-current refs to avoid stale closures in stable callbacks
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const onBlobCompleteRef = useRef(onBlobComplete)
  onBlobCompleteRef.current = onBlobComplete

  // Group layout (combined canvas dimensions)
  const zonesKey = zones.map(z => z.id).join(',')
  const { combinedW, offsets } = useMemo(() => computeGroupLayout(zones), [zonesKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets
  const combinedWRef = useRef(combinedW)
  combinedWRef.current = combinedW

  // Zone images keyed by zone.id
  const [zoneImages, setZoneImages] = useState<Record<string, HTMLImageElement>>({})
  useEffect(() => {
    zones.forEach(zone => {
      if (!zone.image_url) return
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => setZoneImages(prev => ({ ...prev, [zone.id]: img }))
      img.src = zone.image_url
    })
  }, [zonesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drawing state
  const drawPointsRef = useRef<number[]>([])
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPoint = useRef({ x: 0, y: 0 })

  // Touch pinch state
  const lastPinchDist = useRef(0)
  const isPinching = useRef(false)

  // Measure container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === 0 || h === 0) return
      const cw = combinedWRef.current
      const initScale = w / cw
      scaleRef.current = initScale
      setSize({ w, h })
      setScale(initScale)
      setPos({ x: 0, y: Math.max(0, (h - ZONE_H * initScale) / 2) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset view when zones group changes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w === 0 || h === 0) return
    const initScale = w / combinedW
    scaleRef.current = initScale
    setScale(initScale)
    setPos({ x: 0, y: Math.max(0, (h - ZONE_H * initScale) / 2) })
  }, [zonesKey, combinedW])

  // Zoom via scroll wheel
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
    setScale(newScale)
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [])

  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    setPos({ x: e.target.x(), y: e.target.y() })
  }, [])

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
    drawPointsRef.current.push(wp.x, wp.y)
    setDrawPoints(prev => [...prev, wp.x, wp.y])
  }, [screenToWorld])

  function finishDrawing() {
    const pts = drawPointsRef.current
    drawPointsRef.current = []
    setDrawPoints([])

    if (pts.length < 4) return

    // Detect which zone the stroke started in
    const firstWorldX = pts[0]
    const currentZones = zonesRef.current
    const currentOffsets = offsetsRef.current

    let drawZone = currentZones[0]
    let layout = { x: 0, w: ZONE_W }

    for (const zone of currentZones) {
      const zl = currentOffsets[zone.id]
      if (zl && firstWorldX >= zl.x && firstWorldX < zl.x + zl.w) {
        drawZone = zone
        layout = zl
        break
      }
    }

    const normalized: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) {
      normalized.push({
        x: (pts[i] - layout.x) / layout.w,  // no x-clamp: blob can span adjacent zones
        y: Math.max(0, Math.min(1, pts[i + 1] / ZONE_H)),
      })
    }

    onBlobCompleteRef.current(normalized, drawZone)
  }

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
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleRef.current * (d / lastPinchDist.current)))
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

  const handleTouchEnd = useCallback((_e: KonvaEventObject<TouchEvent>) => {
    isPinching.current = false
    lastPinchDist.current = 0
    if (paintMode && isDrawing.current) {
      isDrawing.current = false
      finishDrawing()
    }
  }, [paintMode]) // eslint-disable-line react-hooks/exhaustive-deps

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
        {/* Layer 1: Zone backgrounds */}
        <Layer listening={false}>
          {zones.map(zone => {
            const layout = offsets[zone.id] ?? { x: 0, w: ZONE_W }
            const img = zoneImages[zone.id]
            if (img) {
              return (
                <KonvaImage
                  key={zone.id}
                  x={layout.x}
                  y={0}
                  width={layout.w}
                  height={ZONE_H}
                  image={img}
                />
              )
            }
            return (
              <Group key={zone.id}>
                <Rect
                  x={layout.x}
                  y={0}
                  width={layout.w}
                  height={ZONE_H}
                  fill={ZONE_COLORS[zone.order_index % ZONE_COLORS.length]}
                />
                <Text
                  x={layout.x + 24}
                  y={24}
                  text={zone.name}
                  fontSize={22}
                  fill="rgba(255,255,255,0.2)"
                  fontFamily="sans-serif"
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 2: Route blobs */}
        <Layer>
          {routes.map(route => {
            if (!route.blob_path || route.blob_path.length < 2) return null
            const layout = offsets[route.zone_id]
            if (!layout) return null

            const flat = toFlatOffset(route.blob_path, layout.x, layout.w)
            const colorHex = getColorHex(route.color)
            const level = getFreshnessLevel(route.placed_at)
            const freshnessHex = getFreshnessColor(level)
            const days = getDaysOnWall(route.placed_at)
            const c = centroidOffset(route.blob_path, layout.x, layout.w)

            return (
              <Group key={route.id} onClick={() => onRouteClick(route)} onTap={() => onRouteClick(route)}>
                <Line points={flat} stroke={freshnessHex} strokeWidth={STROKE_W + 6} tension={0.5} lineCap="round" lineJoin="round" opacity={0.35} listening={false} />
                <Line points={flat} stroke={colorHex} strokeWidth={STROKE_W} tension={0.5} lineCap="round" lineJoin="round" opacity={0.92} hitStrokeWidth={32} />
                {isStaff && (
                  <Group x={c.x} y={c.y - 28} listening={false}>
                    <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-18} y={-12} width={36} height={16} fill={freshnessHex} cornerRadius={4} />
                    <Text x={-16} y={-9} text={`${days}d`} fontSize={10} fill="#111" fontStyle="bold" fontFamily="sans-serif" width={32} align="center" />
                  </Group>
                )}
                {!isStaff && (
                  <Group x={c.x} y={c.y - 28} listening={false}>
                    <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-30} y={-12} width={60} height={16} fill="rgba(0,0,0,0.75)" cornerRadius={4} />
                    <Text x={-28} y={-9} text={getPublicLabel(level)} fontSize={9} fill={freshnessHex} fontStyle="bold" fontFamily="sans-serif" width={56} align="center" />
                  </Group>
                )}
              </Group>
            )
          })}
        </Layer>

        {/* Layer 3: Preview blob + active draw */}
        <Layer listening={false}>
          {previewBlob && previewBlob.path.length >= 2 && (() => {
            const previewZone = previewBlob.zone
            const layout = previewZone ? (offsets[previewZone.id] ?? { x: 0, w: ZONE_W }) : { x: 0, w: ZONE_W }
            return (
              <Line
                points={toFlatOffset(previewBlob.path, layout.x, layout.w)}
                stroke={getColorHex(previewBlob.color)}
                strokeWidth={STROKE_W}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                opacity={0.75}
                dash={[20, 8]}
              />
            )
          })()}
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
