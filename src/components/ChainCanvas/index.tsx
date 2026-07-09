import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route, ZoneAnchor } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import { CHAIN_H, computeChainLayout, computeAnchorTransform } from '../../lib/chain'
import type { AnchorTransform } from '../../lib/chain'

const TRANSITION_OVERSHOOT = 40
const TRANSITION_MS = 240
const STROKE_W = 8
const MIN_POINT_GAP = 4
const FALLBACK_COLOR = '#1a2433'
const MIN_ZOOM = 0.8
const MAX_ZOOM = 5

function sortPolygon(pts: { x: number; y: number }[]) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
}

interface Props {
  zones: Zone[]
  anchors: ZoneAnchor[]
  routes: Route[]
  paintMode: boolean
  drawColor: string
  previewBlob: { path: { x: number; y: number }[] } | null
  isStaff: boolean
  onBlobComplete: (path: { x: number; y: number }[], zoneId: string, chainId: string) => void
  onRouteClick: (route: Route) => void
  onActiveZoneChange?: (zoneId: string | null) => void
  jumpToZoneId?: string | null
}

export default function ChainCanvas({
  zones, anchors, routes, paintMode, drawColor, previewBlob,
  isStaff, onBlobComplete, onRouteClick, onActiveZoneChange, jumpToZoneId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 300, h: 500 })

  const sorted = useMemo(() => [...zones].sort((a, b) => a.chain_position - b.chain_position), [zones])
  const zonesKey = zones.map(z => z.id).join(',')

  const [zoneImages, setZoneImages] = useState<Record<string, HTMLImageElement>>({})
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

  const layout = useMemo(
    () => computeChainLayout(zones, anchors, zoneImages),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [zonesKey, anchors, zoneImages]
  )

  // ── Zona activa ────────────────────────────────────────────
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => {
    onActiveZoneChange?.(sorted[activeIdx]?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, sorted.length])

  // Salto desde minimap externo
  useEffect(() => {
    if (!jumpToZoneId) return
    const idx = sorted.findIndex(z => z.id === jumpToZoneId)
    if (idx < 0) return
    setActiveIdx(idx)
    panXRef.current = 0
    setPanX(0)
    zoomRef.current = 1
    setZoom(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToZoneId])

  // ── Pan & Zoom ──────────────────────────────────────────────
  const [panX, setPanX] = useState(0)
  const panXRef = useRef(0)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)

  // yOffset: centra verticalmente cuando zoom > 1
  const yOffset = (size.h - size.h * zoom) / 2

  const [transX, setTransX] = useState(0)
  const transXRef = useRef(0)
  const isTransitioning = useRef(false)
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function displayWForIdx(idx: number): number {
    const zone = sorted[idx]
    const img = zone && zoneImages[zone.id]
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return size.h * (img.naturalWidth / img.naturalHeight)
    }
    return size.h * (4 / 3)
  }

  function maxPanXForIdx(idx: number): number {
    return Math.max(0, displayWForIdx(idx) * zoomRef.current - size.w)
  }

  function transitionPanXForIdx(idx: number): number {
    if (idx >= sorted.length - 1) return maxPanXForIdx(idx)
    const za = sorted[idx], zb = sorted[idx + 1]
    const anchor = anchors.find(a => a.zone_a_id === za?.id && a.zone_b_id === zb?.id)
    const transform = computeAnchorTransform(anchor?.point_pairs ?? [])
    if (transform.aTransitionX >= 1) return maxPanXForIdx(idx)
    return Math.max(0, transform.aTransitionX * displayWForIdx(idx) * zoomRef.current - size.w)
  }

  // ── Animación ────────────────────────────────────────────────
  function animate(from: number, to: number, ms: number, onTick: (v: number) => void, onDone: () => void) {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / ms)
      const ease = 1 - Math.pow(1 - t, 3)
      const val = from + (to - from) * ease
      onTick(val)
      if (t < 1) { animFrameRef.current = requestAnimationFrame(tick) } else { onTick(to); onDone() }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  function startTransitionToNext() {
    if (isTransitioning.current || activeIdx >= sorted.length - 1) return
    isTransitioning.current = true
    const za = sorted[activeIdx], zb = sorted[activeIdx + 1]
    const anchor = anchors.find(a => a.zone_a_id === za?.id && a.zone_b_id === zb?.id)
    const transform = computeAnchorTransform(anchor?.point_pairs ?? [])
    const nextDW = displayWForIdx(activeIdx + 1)
    const entryPanX = Math.max(0, Math.min(transform.bEntryX * nextDW * zoomRef.current, Math.max(0, nextDW * zoomRef.current - size.w)))
    // Comienza desde el transX actual (puede ser > 0 si viene del peek en vivo)
    const fromTx = transXRef.current
    animate(fromTx, size.w, TRANSITION_MS, v => { transXRef.current = v; setTransX(v) }, () => {
      isTransitioning.current = false
      transXRef.current = 0; setTransX(0)
      panXRef.current = entryPanX; setPanX(entryPanX)
      setActiveIdx(i => i + 1)
    })
  }

  function startTransitionToPrev() {
    if (isTransitioning.current || activeIdx <= 0) return
    isTransitioning.current = true
    const za = sorted[activeIdx - 1], zb = sorted[activeIdx]
    const anchor = anchors.find(a => a.zone_a_id === za?.id && a.zone_b_id === zb?.id)
    const transform = computeAnchorTransform(anchor?.point_pairs ?? [])
    const prevDW = displayWForIdx(activeIdx - 1)
    const exitPanX = Math.max(0, Math.min(
      transform.aTransitionX * prevDW * zoomRef.current - size.w * 0.3,
      maxPanXForIdx(activeIdx - 1)
    ))
    // Comienza desde el transX actual (puede ser < 0 si viene del peek en vivo)
    const fromTx = transXRef.current
    animate(fromTx, -size.w, TRANSITION_MS, v => { transXRef.current = v; setTransX(v) }, () => {
      isTransitioning.current = false
      transXRef.current = 0; setTransX(0)
      panXRef.current = exitPanX; setPanX(exitPanX)
      setActiveIdx(i => i - 1)
    })
  }

  // ── Pinch & velocity state ────────────────────────────────────
  const startPinchDist = useRef(0)
  const startPinchZoom = useRef(1)
  const startPinchMidX = useRef(0)
  const startPinchPanX = useRef(0)
  const isPinching = useRef(false)
  const lastTapTime = useRef(0)
  const velocityX = useRef(0)      // px/ms, negativo = swipe hacia siguiente
  const lastVelX = useRef(0)
  const lastVelTime = useRef(0)

  // ── Dibujo ────────────────────────────────────────────────────
  const drawPointsRef = useRef<number[]>([])
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPt = useRef({ x: 0, y: 0 })
  const onBlobCompleteRef = useRef(onBlobComplete)
  onBlobCompleteRef.current = onBlobComplete

  function screenToChain(sx: number, sy: number): { x: number; y: number } {
    const zone = sorted[activeIdx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    const dw = displayWForIdx(activeIdx)
    if (!zl || !dw) return { x: 0, y: 0 }
    const z = zoomRef.current
    const photoRelX = (sx + panXRef.current) / (dw * z)
    const photoRelY = (sy - (size.h - size.h * z) / 2) / (size.h * z)
    const virtualX = zl.virtualX + photoRelX * zl.virtualW
    return {
      x: layout.totalW > 0 ? virtualX / layout.totalW : 0,
      y: Math.max(0, Math.min(1, photoRelY)),
    }
  }

  function addDrawPoint(sx: number, sy: number) {
    const ch = screenToChain(sx, sy)
    const vx = ch.x * layout.totalW
    const vy = ch.y * CHAIN_H
    if (isDrawing.current) {
      const dx = vx - lastDrawPt.current.x; const dy = vy - lastDrawPt.current.y
      if (Math.sqrt(dx * dx + dy * dy) < MIN_POINT_GAP) return
    }
    lastDrawPt.current = { x: vx, y: vy }
    drawPointsRef.current.push(ch.x, ch.y)
    setDrawPoints(prev => [...prev, ch.x, ch.y])
  }

  function finishDrawing() {
    const pts = drawPointsRef.current; drawPointsRef.current = []; setDrawPoints([])
    if (pts.length < 4) return
    const zone = sorted[activeIdx]
    if (!zone || !zone.chain_id) return
    const path: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) path.push({ x: pts[i], y: pts[i + 1] })
    onBlobCompleteRef.current(path, zone.id, zone.chain_id)
  }

  // ── Touch handlers ────────────────────────────────────────────
  const touchStartX = useRef(0)
  const touchStartPanX = useRef(0)
  const isTouching = useRef(false)
  const touchMoved = useRef(false)

  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches

    if (touches.length === 2) {
      // Pinch start — cancela cualquier peek en curso
      if (transXRef.current !== 0) { transXRef.current = 0; setTransX(0) }
      isPinching.current = true
      isTouching.current = false
      isDrawing.current = false
      const rect = stageRef.current!.container().getBoundingClientRect()
      const t1 = touches[0], t2 = touches[1]
      startPinchDist.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      startPinchZoom.current = zoomRef.current
      startPinchMidX.current = (t1.clientX + t2.clientX) / 2 - rect.left
      startPinchPanX.current = panXRef.current
      return
    }

    if (touches.length !== 1) return
    isPinching.current = false
    touchMoved.current = false
    const t = touches[0]

    if (paintMode) {
      isDrawing.current = true
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    } else {
      isTouching.current = true
      touchStartX.current = t.clientX
      touchStartPanX.current = panXRef.current
      lastVelX.current = t.clientX
      lastVelTime.current = performance.now()
      velocityX.current = 0
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, layout, anchors])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches

    // Pinch zoom
    if (touches.length === 2 && isPinching.current) {
      const t1 = touches[0], t2 = touches[1]
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startPinchZoom.current * dist / startPinchDist.current))
      const photoXAtMid = (startPinchPanX.current + startPinchMidX.current) / startPinchZoom.current
      const newPanX = Math.max(0, Math.min(
        photoXAtMid * newZoom - startPinchMidX.current,
        displayWForIdx(activeIdx) * newZoom - size.w
      ))
      zoomRef.current = newZoom; setZoom(newZoom)
      panXRef.current = newPanX; setPanX(newPanX)
      return
    }

    if (touches.length !== 1 || isPinching.current) return
    const t = touches[0]
    touchMoved.current = true

    if (paintMode && isDrawing.current) {
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
      return
    }

    if (!isTouching.current) return
    const now = performance.now()
    const dt = now - lastVelTime.current
    if (dt > 0) {
      velocityX.current = (t.clientX - lastVelX.current) / dt  // px/ms
    }
    lastVelX.current = t.clientX
    lastVelTime.current = now

    const dx = t.clientX - touchStartX.current
    const rawPanX = touchStartPanX.current - dx
    const limitNext = transitionPanXForIdx(activeIdx)

    if (rawPanX > limitNext && activeIdx < sorted.length - 1) {
      // Más allá del límite → bloquea foto actual, peek foto siguiente en tiempo real
      panXRef.current = limitNext
      const peek = rawPanX - limitNext
      transXRef.current = peek; setTransX(peek)
    } else if (rawPanX < 0 && activeIdx > 0) {
      // Antes del inicio → bloquea en 0, peek foto anterior en tiempo real
      panXRef.current = 0
      transXRef.current = rawPanX; setTransX(rawPanX)  // negativo
    } else {
      // Pan normal: limpia cualquier peek previo
      panXRef.current = Math.max(0, Math.min(rawPanX, limitNext))
      if (transXRef.current !== 0) { transXRef.current = 0; setTransX(0) }
    }
    setPanX(panXRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, anchors, zoom])

  const handleTouchEnd = useCallback((_e: KonvaEventObject<TouchEvent>) => {
    if (isPinching.current) {
      isPinching.current = false
      return
    }

    if (paintMode && isDrawing.current) {
      isDrawing.current = false; finishDrawing(); return
    }

    if (!isTouching.current) return
    isTouching.current = false

    // Double-tap to reset zoom
    if (!touchMoved.current) {
      const now = Date.now()
      if (now - lastTapTime.current < 300) {
        animate(zoomRef.current, 1, 180, v => { zoomRef.current = v; setZoom(v) }, () => {})
        panXRef.current = Math.min(panXRef.current, maxPanXForIdx(activeIdx))
      }
      lastTapTime.current = now
    }

    const tx = transXRef.current
    const vel = velocityX.current  // negativo = hacia siguiente, positivo = hacia anterior
    const fastSwipeNext = vel < -0.35 && activeIdx < sorted.length - 1
    const fastSwipePrev = vel > 0.35 && activeIdx > 0

    if ((tx > TRANSITION_OVERSHOOT || (tx > 5 && fastSwipeNext)) && activeIdx < sorted.length - 1) {
      startTransitionToNext()
    } else if ((tx < -TRANSITION_OVERSHOOT || (tx < -5 && fastSwipePrev)) && activeIdx > 0) {
      startTransitionToPrev()
    } else if (tx !== 0) {
      // Snap-back: cancela el peek y vuelve al límite
      const from = tx
      animate(from, 0, 180, v => { transXRef.current = v; setTransX(v) }, () => {
        transXRef.current = 0; setTransX(0)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, anchors, zoom])

  // Mouse (desktop)
  const handleMouseDown = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode) return
    isDrawing.current = true
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, layout])

  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode || !isDrawing.current) return
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, layout])

  const handleMouseUp = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode || !isDrawing.current) return
    isDrawing.current = false; finishDrawing()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted])

  // Rueda del ratón → zoom en PC
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const midX = e.clientX - rect.left
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * delta))
      const photoXAtMid = (panXRef.current + midX) / zoomRef.current
      const idx = activeIdxRef.current
      const dw = displayWForIdxStable(idx)
      const newPanX = Math.max(0, Math.min(photoXAtMid * newZoom - midX, dw * newZoom - sizeRef.current.w))
      zoomRef.current = newZoom; setZoom(newZoom)
      panXRef.current = newPanX; setPanX(newPanX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx
  const sizeRef = useRef(size)
  sizeRef.current = size
  const zoneImagesRef = useRef(zoneImages)
  zoneImagesRef.current = zoneImages
  const sortedRef = useRef(sorted)
  sortedRef.current = sorted

  function displayWForIdxStable(idx: number): number {
    const zone = sortedRef.current[idx]
    const img = zone && zoneImagesRef.current[zone.id]
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return sizeRef.current.h * (img.naturalWidth / img.naturalHeight)
    }
    return sizeRef.current.h * (4 / 3)
  }

  // ── Render helpers ────────────────────────────────────────────

  function renderPhoto(idx: number, screenOffsetX: number) {
    const zone = sorted[idx]
    if (!zone) return null
    const img = zoneImages[zone.id]
    const dw = displayWForIdx(idx) * zoom
    const x = screenOffsetX
    if (img) {
      return <KonvaImage key={zone.id} x={x} y={yOffset} width={dw} height={size.h * zoom} image={img} />
    }
    return (
      <Group key={zone.id}>
        <Rect x={x} y={0} width={size.w} height={size.h} fill={FALLBACK_COLOR} />
        <Text x={x + 24} y={24} text={zone.name} fontSize={22} fill="rgba(255,255,255,0.2)" fontFamily="sans-serif" />
      </Group>
    )
  }

  function chainToScreen(p: { x: number; y: number }, idx: number, localPanX: number): { x: number; y: number } {
    const zone = sorted[idx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    const dw = displayWForIdx(idx)
    if (!zl || !dw) return { x: 0, y: 0 }
    const virtualX = p.x * layout.totalW
    const relX = (virtualX - zl.virtualX) / zl.virtualW
    return {
      x: relX * dw * zoom - localPanX,
      y: yOffset + p.y * size.h * zoom,
    }
  }

  function renderRoutes(idx: number, localPanX: number) {
    const zone = sorted[idx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    if (!zone || !zl) return null

    const dw = displayWForIdx(idx)

    function renderRoute(
      route: Route,
      converter: (p: { x: number; y: number }) => { x: number; y: number },
      keySuffix = ''
    ) {
      if (!route.blob_path || route.blob_path.length < 2) return null
      const flat = route.blob_path.flatMap(p => { const s = converter(p); return [s.x, s.y] })
      const centS = converter({
        x: route.blob_path.reduce((s, p) => s + p.x, 0) / route.blob_path.length,
        y: route.blob_path.reduce((s, p) => s + p.y, 0) / route.blob_path.length,
      })
      const colorHex = getColorHex(route.color)
      const level = getFreshnessLevel(route.placed_at)
      const freshnessHex = getFreshnessColor(level)
      const days = getDaysOnWall(route.placed_at)
      return (
        <Group key={route.id + keySuffix} onClick={() => onRouteClick(route)} onTap={() => onRouteClick(route)}>
          <Line points={flat} stroke={freshnessHex} strokeWidth={STROKE_W + 6} tension={0.5} lineCap="round" lineJoin="round" opacity={0.35} listening={false} />
          <Line points={flat} stroke={colorHex} strokeWidth={STROKE_W} tension={0.5} lineCap="round" lineJoin="round" opacity={0.92} hitStrokeWidth={32} />
          {isStaff ? (
            <Group x={centS.x} y={centS.y - 28} listening={false}>
              <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
              <Rect x={-18} y={-12} width={36} height={16} fill={freshnessHex} cornerRadius={4} />
              <Text x={-16} y={-9} text={`${days}d`} fontSize={10} fill="#111" fontStyle="bold" fontFamily="sans-serif" width={32} align="center" />
            </Group>
          ) : (
            <Group x={centS.x} y={centS.y - 28} listening={false}>
              <Line points={[0, 4, 0, 18]} stroke={freshnessHex} strokeWidth={2} />
              <Rect x={-30} y={-12} width={60} height={16} fill="rgba(0,0,0,0.75)" cornerRadius={4} />
              <Text x={-28} y={-9} text={getPublicLabel(level)} fontSize={9} fill={freshnessHex} fontStyle="bold" fontFamily="sans-serif" width={56} align="center" />
            </Group>
          )}
        </Group>
      )
    }

    // Own-zone routes
    const ownRoutes = routes.filter(r =>
      r.chain_id && r.blob_path?.length && r.zone_id === zone.id
    )
    const ownConverter = (p: { x: number; y: number }) => chainToScreen(p, idx, localPanX)

    // Cross-zone: routes from prevZone shown in this zone via aToB transform + B-polygon clip
    const prevZone = sorted[idx - 1]
    const prevAnchor = prevZone
      ? anchors.find(a => a.zone_a_id === prevZone.id && a.zone_b_id === zone.id)
      : null
    const pairs = prevAnchor?.point_pairs ?? []
    const zl_A = prevZone ? layout.zones.find(z => z.id === prevZone.id) : null

    let crossZoneRoutes: Route[] = []
    let crossConverter: ((p: { x: number; y: number }) => { x: number; y: number }) | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let crossClipFunc: ((ctx: any) => void) | undefined = undefined

    if (pairs.length >= 3 && zl_A) {
      const transform: AnchorTransform = computeAnchorTransform(pairs)
      crossZoneRoutes = routes.filter(r =>
        r.chain_id && r.blob_path?.length && r.zone_id === prevZone!.id
      )
      crossConverter = (p: { x: number; y: number }) => {
        const relX_A = (p.x * layout.totalW - zl_A.virtualX) / zl_A.virtualW
        const { x: relX_B, y: relY_B } = transform.aToB({ x: relX_A, y: p.y })
        return {
          x: relX_B * dw * zoom - localPanX,
          y: yOffset + relY_B * size.h * zoom,
        }
      }
      const bPts = pairs.map(p => p.b)
      if (bPts.length >= 3) {
        const bPoly = sortPolygon(bPts).map(b => ({
          x: b.x * dw * zoom - localPanX,
          y: yOffset + b.y * size.h * zoom,
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        crossClipFunc = (ctx: any) => {
          ctx.beginPath()
          ctx.moveTo(bPoly[0].x, bPoly[0].y)
          for (let i = 1; i < bPoly.length; i++) ctx.lineTo(bPoly[i].x, bPoly[i].y)
          ctx.closePath()
        }
      }
    }

    return (
      <>
        {ownRoutes.map(r => renderRoute(r, ownConverter))}
        {crossConverter && crossZoneRoutes.length > 0 && (
          crossClipFunc
            ? (
              <Group clipFunc={crossClipFunc}>
                {crossZoneRoutes.map(r => renderRoute(r, crossConverter!, '_cross'))}
              </Group>
            )
            : crossZoneRoutes.map(r => renderRoute(r, crossConverter!, '_cross'))
        )}
      </>
    )
  }

  const effectivePanX = panX + transX

  const showPrevPeek = transX < 0 && activeIdx > 0
  const showNextPeek = transX > 0 && activeIdx < sorted.length - 1

  const prevExitPanX = (() => {
    if (!showPrevPeek) return 0
    const za = sorted[activeIdx - 1], zb = sorted[activeIdx]
    const anchor = anchors.find(a => a.zone_a_id === za?.id && a.zone_b_id === zb?.id)
    const t = computeAnchorTransform(anchor?.point_pairs ?? [])
    return Math.max(0, t.aTransitionX * displayWForIdx(activeIdx - 1) * zoom - size.w * 0.3)
  })()

  const nextEntryPanX = (() => {
    if (!showNextPeek) return 0
    const za = sorted[activeIdx], zb = sorted[activeIdx + 1]
    const anchor = anchors.find(a => a.zone_a_id === za?.id && a.zone_b_id === zb?.id)
    const t = computeAnchorTransform(anchor?.point_pairs ?? [])
    return Math.max(0, Math.min(t.bEntryX * displayWForIdx(activeIdx + 1) * zoom, maxPanXForIdx(activeIdx + 1)))
  })()

  const drawScreenPts = drawPoints.length >= 4
    ? (() => {
        const flat: number[] = []
        for (let i = 0; i < drawPoints.length; i += 2) {
          const s = chainToScreen({ x: drawPoints[i], y: drawPoints[i + 1] }, activeIdx, panX)
          flat.push(s.x, s.y)
        }
        return flat
      })()
    : []

  const previewScreenPts = previewBlob && previewBlob.path.length >= 2
    ? previewBlob.path.flatMap(p => { const s = chainToScreen(p, activeIdx, panX); return [s.x, s.y] })
    : []

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden touch-none select-none">
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        draggable={false}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Layer listening={false}>
          {showPrevPeek && renderPhoto(activeIdx - 1, -prevExitPanX - size.w - transX)}
          {showNextPeek && renderPhoto(activeIdx + 1, size.w - nextEntryPanX - transX)}
          {renderPhoto(activeIdx, -effectivePanX)}
        </Layer>

        <Layer>
          {showPrevPeek && renderRoutes(activeIdx - 1, prevExitPanX + size.w + transX)}
          {showNextPeek && renderRoutes(activeIdx + 1, nextEntryPanX + transX - size.w)}
          {renderRoutes(activeIdx, effectivePanX)}
        </Layer>

        <Layer listening={false}>
          {previewScreenPts.length >= 4 && (
            <Line points={previewScreenPts} stroke={getColorHex(drawColor)} strokeWidth={STROKE_W}
              tension={0.5} lineCap="round" lineJoin="round" opacity={0.75} dash={[20, 8]} />
          )}
          {paintMode && drawScreenPts.length >= 4 && (
            <Line points={drawScreenPts} stroke={getColorHex(drawColor)} strokeWidth={STROKE_W}
              tension={0.5} lineCap="round" lineJoin="round" opacity={0.85} />
          )}
        </Layer>
      </Stage>

      {/* Indicador de zona */}
      {sorted.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div className="flex items-center gap-1.5">
            {sorted.map((z, i) => (
              <div key={z.id} className="rounded-full transition-all duration-300" style={{
                width: i === activeIdx ? 20 : 6, height: 6,
                backgroundColor: i === activeIdx ? '#facc15' : 'rgba(255,255,255,0.25)',
              }} />
            ))}
          </div>
        </div>
      )}

      {/* Indicador de zoom */}
      {zoom !== 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-zinc-900/80 backdrop-blur-sm text-zinc-400 text-[10px] font-bold px-2.5 py-1 rounded-full border border-zinc-700/50">
            {Math.round(zoom * 100)}% · doble tap para resetear
          </div>
        </div>
      )}
    </div>
  )
}
