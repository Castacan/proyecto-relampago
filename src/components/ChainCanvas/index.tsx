import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route, ZoneAnchor } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import {
  CHAIN_H,
  computeChainLayout,
  resolveActiveZone,
  resolveZoneForChainX,
  chainToVirtual,
  virtualToChain,
  type ChainLayout,
} from '../../lib/chain'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const STROKE_W = 8
const MIN_POINT_GAP = 4
const FALLBACK_COLOR = '#1a2433'

function dist2(p1: Touch, p2: Touch) {
  return Math.sqrt((p2.clientX - p1.clientX) ** 2 + (p2.clientY - p1.clientY) ** 2)
}

interface Props {
  zones: Zone[]          // ordenadas por chain_position
  anchors: ZoneAnchor[]
  routes: Route[]
  paintMode: boolean
  drawColor: string
  previewBlob: { path: { x: number; y: number }[] } | null
  isStaff: boolean
  onBlobComplete: (path: { x: number; y: number }[], zoneId: string, chainId: string) => void
  onRouteClick: (route: Route) => void
  onActiveZoneChange?: (zoneId: string | null) => void
}

export default function ChainCanvas({
  zones,
  anchors,
  routes,
  paintMode,
  drawColor,
  previewBlob,
  isStaff,
  onBlobComplete,
  onRouteClick,
  onActiveZoneChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const scaleRef = useRef(1)
  const [size, setSize] = useState({ w: 300, h: 500 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Zone images keyed by zone.id
  const [zoneImages, setZoneImages] = useState<Record<string, HTMLImageElement>>({})

  // Chain layout — recalculated when images load (aspect ratios become known)
  const zonesKey = zones.map(z => z.id).join(',')
  const anchorsKey = anchors.map(a => `${a.zone_a_id}-${a.zone_b_id}`).join(',')
  const layout: ChainLayout = useMemo(
    () => computeChainLayout(zones, anchors, zoneImages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zonesKey, anchorsKey, zoneImages]
  )
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Active zone (based on viewport center)
  const [activeZoneId, setActiveZoneId] = useState<string | null>(
    zones.length > 0 ? zones[0].id : null
  )
  const activeZoneIdRef = useRef(activeZoneId)
  activeZoneIdRef.current = activeZoneId

  // Load zone images
  useEffect(() => {
    zones.forEach(zone => {
      if (!zone.image_url || zoneImages[zone.id]) return
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => setZoneImages(prev => ({ ...prev, [zone.id]: img }))
      img.src = zone.image_url
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesKey])

  // Measure container and set initial scale/position
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === 0 || h === 0) return
      const cw = layoutRef.current.totalW || CHAIN_H * (4 / 3)
      const initScale = w / cw
      scaleRef.current = initScale
      setSize({ w, h })
      setScale(initScale)
      setPos({ x: 0, y: Math.max(0, (h - CHAIN_H * initScale) / 2) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset view when chain layout changes (e.g. images finish loading)
  useEffect(() => {
    const el = containerRef.current
    if (!el || layout.totalW === 0) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w === 0 || h === 0) return
    const initScale = w / layout.totalW
    scaleRef.current = initScale
    setScale(initScale)
    setPos({ x: 0, y: Math.max(0, (h - CHAIN_H * initScale) / 2) })
  }, [layout.totalW])

  // Update active zone whenever position changes
  const updateActiveZone = useCallback((stageX: number, screenW: number) => {
    const stage = stageRef.current
    if (!stage) return
    const s = scaleRef.current
    const viewportCenterX = (screenW / 2 - stageX) / s
    const newActiveId = resolveActiveZone(viewportCenterX, layoutRef.current)
    if (newActiveId !== activeZoneIdRef.current) {
      setActiveZoneId(newActiveId)
      onActiveZoneChange?.(newActiveId)
    }
  }, [onActiveZoneChange])

  // Drawing state
  const drawPointsRef = useRef<number[]>([])
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPoint = useRef({ x: 0, y: 0 })

  // Touch pan + pinch state
  const lastPinchDist = useRef(0)
  const isPinching = useRef(false)
  const isPanning = useRef(false)
  const lastPanPos = useRef({ x: 0, y: 0 })

  const screenToVirtual = useCallback((sx: number, sy: number) => {
    const stage = stageRef.current!
    const s = scaleRef.current
    return { x: (sx - stage.x()) / s, y: (sy - stage.y()) / s }
  }, [])

  const addDrawPoint = useCallback((sx: number, sy: number) => {
    const vp = screenToVirtual(sx, sy)
    if (isDrawing.current) {
      const dx = vp.x - lastDrawPoint.current.x
      const dy = vp.y - lastDrawPoint.current.y
      if (Math.sqrt(dx * dx + dy * dy) < MIN_POINT_GAP) return
    }
    lastDrawPoint.current = vp
    drawPointsRef.current.push(vp.x, vp.y)
    setDrawPoints(prev => [...prev, vp.x, vp.y])
  }, [screenToVirtual])

  const onBlobCompleteRef = useRef(onBlobComplete)
  onBlobCompleteRef.current = onBlobComplete

  function finishDrawing() {
    const pts = drawPointsRef.current
    drawPointsRef.current = []
    setDrawPoints([])
    if (pts.length < 4) return

    const currentLayout = layoutRef.current
    // Determine anchor zone (zone that contains the first point)
    const anchorZoneId = resolveZoneForChainX(pts[0] / currentLayout.totalW, currentLayout)
    const anchorZone = zones.find(z => z.id === anchorZoneId)
    if (!anchorZone || !anchorZone.chain_id) return

    // Normalize all points to chain space
    const chainPath: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) {
      chainPath.push(virtualToChain(pts[i], pts[i + 1], currentLayout))
    }

    onBlobCompleteRef.current(chainPath, anchorZone.id, anchorZone.chain_id)
  }

  // Mouse handlers (desktop)
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
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
    setPos(newPos)
    updateActiveZone(newPos.x, size.w)
  }, [size.w, updateActiveZone])

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

  // Touch handlers (mobile)
  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    const touches = e.evt.touches
    if (touches.length === 2) {
      isPinching.current = true
      isPanning.current = false
      isDrawing.current = false
      lastPinchDist.current = dist2(touches[0], touches[1])
      return
    }
    if (touches.length === 1) {
      const t = touches[0]
      const rect = stageRef.current!.container().getBoundingClientRect()
      if (paintMode) {
        isDrawing.current = true
        addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
      } else {
        isPanning.current = true
        lastPanPos.current = { x: t.clientX, y: t.clientY }
      }
    }
  }, [paintMode, addDrawPoint])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    const touches = e.evt.touches
    if (touches.length === 2) {
      const t1 = touches[0]; const t2 = touches[1]
      const d = dist2(t1, t2)
      if (lastPinchDist.current) {
        const stage = stageRef.current!
        const rect = stage.container().getBoundingClientRect()
        const oldScale = scaleRef.current
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * (d / lastPinchDist.current)))
        const pinchX = (t1.clientX + t2.clientX) / 2 - rect.left
        const pinchY = (t1.clientY + t2.clientY) / 2 - rect.top
        const worldX = (pinchX - stage.x()) / oldScale
        const worldY = (pinchY - stage.y()) / oldScale
        scaleRef.current = newScale
        setScale(newScale)
        const newPos = { x: pinchX - worldX * newScale, y: pinchY - worldY * newScale }
        setPos(newPos)
        updateActiveZone(newPos.x, size.w)
      }
      lastPinchDist.current = d
      return
    }
    if (touches.length === 1 && !isPinching.current) {
      const t = touches[0]
      const rect = stageRef.current!.container().getBoundingClientRect()
      if (paintMode && isDrawing.current) {
        addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
      } else if (!paintMode && isPanning.current) {
        const dx = t.clientX - lastPanPos.current.x
        const dy = t.clientY - lastPanPos.current.y
        lastPanPos.current = { x: t.clientX, y: t.clientY }
        setPos(prev => {
          const newPos = { x: prev.x + dx, y: prev.y + dy }
          updateActiveZone(newPos.x, size.w)
          return newPos
        })
      }
    }
  }, [paintMode, addDrawPoint, size.w, updateActiveZone])

  const handleTouchEnd = useCallback((e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) {
      isPinching.current = false
      lastPinchDist.current = 0
    }
    if (e.evt.touches.length === 0) {
      isPanning.current = false
      if (paintMode && isDrawing.current) {
        isDrawing.current = false
        finishDrawing()
      }
    }
  }, [paintMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Routes: convert chain coords to virtual canvas coords for rendering
  const activeLayout = layout.zones.find(z => z.id === activeZoneId)

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
        draggable={false}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Layer 1: Background — solo la foto activa */}
        <Layer listening={false}>
          {layout.zones.map(zl => {
            const zone = zones.find(z => z.id === zl.id)
            if (!zone) return null
            const isActive = zl.id === activeZoneId
            if (!isActive) return null

            const img = zoneImages[zl.id]
            if (img) {
              return (
                <KonvaImage
                  key={zl.id}
                  x={zl.virtualX}
                  y={0}
                  width={zl.virtualW}
                  height={CHAIN_H}
                  image={img}
                />
              )
            }
            return (
              <Group key={zl.id}>
                <Rect x={zl.virtualX} y={0} width={zl.virtualW} height={CHAIN_H} fill={FALLBACK_COLOR} />
                <Text x={zl.virtualX + 24} y={24} text={zone.name} fontSize={22} fill="rgba(255,255,255,0.2)" fontFamily="sans-serif" />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 2: Route blobs */}
        <Layer>
          {routes.map(route => {
            if (!route.blob_path || route.blob_path.length < 2) return null

            // Convert chain coords to virtual canvas coords
            const flat = route.blob_path.flatMap(p => {
              const v = chainToVirtual(p, layout)
              return [v.x, v.y]
            })

            // Compute centroid for label
            const sumX = route.blob_path.reduce((s, p) => s + p.x, 0)
            const sumY = route.blob_path.reduce((s, p) => s + p.y, 0)
            const centChain = { x: sumX / route.blob_path.length, y: sumY / route.blob_path.length }
            const centV = chainToVirtual(centChain, layout)

            const colorHex = getColorHex(route.color)
            const level = getFreshnessLevel(route.placed_at)
            const freshnessHex = getFreshnessColor(level)
            const days = getDaysOnWall(route.placed_at)

            return (
              <Group key={route.id} onClick={() => onRouteClick(route)} onTap={() => onRouteClick(route)}>
                <Line points={flat} stroke={freshnessHex} strokeWidth={STROKE_W + 6} tension={0.5} lineCap="round" lineJoin="round" opacity={0.35} listening={false} />
                <Line points={flat} stroke={colorHex} strokeWidth={STROKE_W} tension={0.5} lineCap="round" lineJoin="round" opacity={0.92} hitStrokeWidth={32} />
                {isStaff && (
                  <Group x={centV.x} y={centV.y - 28} listening={false}>
                    <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-18} y={-12} width={36} height={16} fill={freshnessHex} cornerRadius={4} />
                    <Text x={-16} y={-9} text={`${days}d`} fontSize={10} fill="#111" fontStyle="bold" fontFamily="sans-serif" width={32} align="center" />
                  </Group>
                )}
                {!isStaff && (
                  <Group x={centV.x} y={centV.y - 28} listening={false}>
                    <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
                    <Rect x={-30} y={-12} width={60} height={16} fill="rgba(0,0,0,0.75)" cornerRadius={4} />
                    <Text x={-28} y={-9} text={getPublicLabel(level)} fontSize={9} fill={freshnessHex} fontStyle="bold" fontFamily="sans-serif" width={56} align="center" />
                  </Group>
                )}
              </Group>
            )
          })}
        </Layer>

        {/* Layer 3: Preview + active draw */}
        <Layer listening={false}>
          {previewBlob && previewBlob.path.length >= 2 && (() => {
            const flat = previewBlob.path.flatMap(p => {
              const v = chainToVirtual(p, layout)
              return [v.x, v.y]
            })
            return (
              <Line
                points={flat}
                stroke={getColorHex(drawColor)}
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

      {/* Indicador de navegación horizontal — aparece cuando hay más de una zona */}
      {layout.zones.length > 1 && !paintMode && activeLayout && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div className="flex items-center gap-1.5">
            {layout.zones.map((zl) => (
              <div
                key={zl.id}
                className="rounded-full transition-all"
                style={{
                  width: zl.id === activeZoneId ? 20 : 6,
                  height: 6,
                  backgroundColor: zl.id === activeZoneId ? '#facc15' : 'rgba(255,255,255,0.25)',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
