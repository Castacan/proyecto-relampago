import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Circle, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route, ZoneAnchor, Volume, VolumeCatalogItem } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import { CHAIN_H, computeChainLayout, computeAnchorTransform } from '../../lib/chain'

const TRANSITION_OVERSHOOT = 40
const TRANSITION_MS = 240
const STROKE_W = 8
const MIN_POINT_GAP = 4
const FALLBACK_COLOR = '#1a2433'
const MIN_ZOOM = 0.35
const MAX_ZOOM = 5


interface Props {
  zones: Zone[]
  anchors: ZoneAnchor[]
  routes: Route[]
  volumes?: Volume[]
  paintMode: boolean
  drawColor: string
  previewBlob: { path: { x: number; y: number }[] } | null
  volumePaintMode?: 'perimeter' | 'details' | null
  previewVolumePerimeter?: { x: number; y: number }[] | null
  previewVolumeDetails?: { x: number; y: number }[][]
  repositionMode?: { volumeId: string; zoneId: string; offset: { dx: number; dy: number } } | null
  isStaff: boolean
  onBlobComplete: (path: { x: number; y: number }[], zoneId: string, chainId: string) => void
  onRouteClick: (route: Route) => void
  onVolumePerimeterComplete?: (perimeter: { x: number; y: number }[], zoneId: string, chainId: string) => void
  onVolumeDetailStroke?: (stroke: { x: number; y: number }[]) => void
  onVolumeClick?: (volume: Volume, displayZoneId: string) => void
  onRepositionOffsetChange?: (offset: { dx: number; dy: number }) => void
  // Catalog volume placement
  volPlaceMode?: VolumeCatalogItem | null
  onVolumePlaced?: (perimeter: { x: number; y: number }[], zoneId: string, chainId: string, catalogId: string, details: { x: number; y: number }[][]) => void
  // Adjust mode (move + rotate + scale for catalog volumes)
  adjustMode?: { volumeId: string; zoneId: string; offset: { dx: number; dy: number }; rotation: number; volScale: number } | null
  onAdjustChange?: (changes: { offset?: { dx: number; dy: number }; rotation?: number; volScale?: number }) => void
  onActiveZoneChange?: (zoneId: string | null) => void
  jumpToZoneId?: string | null
}

export default function ChainCanvas({
  zones, anchors, routes, volumes = [], paintMode, drawColor, previewBlob,
  volumePaintMode = null, previewVolumePerimeter = null, previewVolumeDetails = [],
  repositionMode = null,
  volPlaceMode = null, onVolumePlaced,
  adjustMode = null, onAdjustChange,
  isStaff, onBlobComplete, onRouteClick,
  onVolumePerimeterComplete, onVolumeDetailStroke, onVolumeClick,
  onRepositionOffsetChange,
  onActiveZoneChange, jumpToZoneId,
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

  useEffect(() => {
    if (!jumpToZoneId) return
    const idx = sorted.findIndex(z => z.id === jumpToZoneId)
    if (idx < 0) return
    setActiveIdx(idx)
    panXRef.current = 0; setPanX(0)
    zoomRef.current = 1; setZoom(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToZoneId])

  // ── Pan & Zoom ──────────────────────────────────────────────
  const [panX, setPanX] = useState(0)
  const panXRef = useRef(0)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)

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
    return maxPanXForIdx(idx)
  }

  // ── Animación ────────────────────────────────────────────────
  function animate(from: number, to: number, ms: number, onTick: (v: number) => void, onDone: () => void) {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / ms)
      const ease = 1 - Math.pow(1 - t, 3)
      onTick(from + (to - from) * ease)
      if (t < 1) { animFrameRef.current = requestAnimationFrame(tick) } else { onTick(to); onDone() }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  function startTransitionToNext() {
    if (isTransitioning.current || activeIdx >= sorted.length - 1) return
    isTransitioning.current = true
    const fromTx = transXRef.current
    animate(fromTx, size.w, TRANSITION_MS, v => { transXRef.current = v; setTransX(v) }, () => {
      isTransitioning.current = false
      transXRef.current = 0; setTransX(0)
      panXRef.current = 0; setPanX(0)
      setActiveIdx(i => i + 1)
    })
  }

  function startTransitionToPrev() {
    if (isTransitioning.current || activeIdx <= 0) return
    isTransitioning.current = true
    const exitPanX = maxPanXForIdx(activeIdx - 1)
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
  const velocityX = useRef(0)
  const lastVelX = useRef(0)
  const lastVelTime = useRef(0)

  // ── Dibujo ────────────────────────────────────────────────────
  const drawPointsRef = useRef<number[]>([])
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPt = useRef({ x: 0, y: 0 })
  const onBlobCompleteRef = useRef(onBlobComplete)
  onBlobCompleteRef.current = onBlobComplete
  const onVolumePerimeterCompleteRef = useRef(onVolumePerimeterComplete)
  onVolumePerimeterCompleteRef.current = onVolumePerimeterComplete
  const onVolumeDetailStrokeRef = useRef(onVolumeDetailStroke)
  onVolumeDetailStrokeRef.current = onVolumeDetailStroke

  // ── Reposicionamiento ─────────────────────────────────────────
  // Ref para evitar recrear callbacks en cada frame durante el drag
  const repositionModeRef = useRef(repositionMode)
  repositionModeRef.current = repositionMode
  const repoStartX = useRef(0)
  const repoStartY = useRef(0)
  const repoBaseOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const isRepoDragging = useRef(false)
  const onRepositionOffsetChangeRef = useRef(onRepositionOffsetChange)
  onRepositionOffsetChangeRef.current = onRepositionOffsetChange

  // ── Adjust mode (catalog volumes: move + rotate + scale) ──────
  const adjustModeRef = useRef(adjustMode)
  adjustModeRef.current = adjustMode
  const onAdjustChangeRef = useRef(onAdjustChange)
  onAdjustChangeRef.current = onAdjustChange
  const isAdjustDragging = useRef<'rotation' | 'scale' | 'body' | null>(null)
  const adjustStartAngle = useRef(0)
  const adjustStartRotation = useRef(0)
  const adjustStartScale = useRef(1)
  const adjustStartDist = useRef(50)
  const adjustHandlePosRef = useRef<{ cx: number; cy: number; rotX: number; rotY: number; sclX: number; sclY: number } | null>(null)

  // ── Vol-place mode (catalog) ───────────────────────────────────
  const volPlaceModeRef = useRef(volPlaceMode)
  volPlaceModeRef.current = volPlaceMode
  const onVolumePlacedRef = useRef(onVolumePlaced)
  onVolumePlacedRef.current = onVolumePlaced

  function screenToChain(sx: number, sy: number, panXOverride?: number): { x: number; y: number } {
    const zone = sorted[activeIdx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    const dw = displayWForIdx(activeIdx)
    if (!zl || !dw) return { x: 0, y: 0 }
    const z = zoomRef.current
    const effectivePanX = panXOverride !== undefined ? panXOverride : panXRef.current
    const photoRelX = (sx + effectivePanX) / (dw * z)
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

  function finishVolumePerimeter() {
    const pts = drawPointsRef.current; drawPointsRef.current = []; setDrawPoints([])
    if (pts.length < 6) return
    const zone = sorted[activeIdx]
    if (!zone || !zone.chain_id) return
    const path: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) path.push({ x: pts[i], y: pts[i + 1] })
    onVolumePerimeterCompleteRef.current?.(path, zone.id, zone.chain_id)
  }

  function finishVolumeDetail() {
    const pts = drawPointsRef.current; drawPointsRef.current = []; setDrawPoints([])
    if (pts.length < 4) return
    const path: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) path.push({ x: pts[i], y: pts[i + 1] })
    onVolumeDetailStrokeRef.current?.(path)
  }

  // Refs para tap detection a nivel Stage
  const routesRef = useRef(routes)
  routesRef.current = routes
  const volumesRef = useRef(volumes)
  volumesRef.current = volumes
  const onRouteClickRef = useRef(onRouteClick)
  onRouteClickRef.current = onRouteClick
  const onVolumeClickRef = useRef(onVolumeClick)
  onVolumeClickRef.current = onVolumeClick

  // ── Touch handlers ────────────────────────────────────────────
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchLastX = useRef(0)
  const touchLastY = useRef(0)
  const touchStartPanX = useRef(0)
  const isTouching = useRef(false)
  const touchMoved = useRef(false)

  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches

    if (touches.length === 2) {
      if (transXRef.current !== 0) { transXRef.current = 0; setTransX(0) }
      isPinching.current = true
      isTouching.current = false
      isDrawing.current = false
      isRepoDragging.current = false
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

    // Adjust mode (catalog volumes)
    if (adjustModeRef.current) {
      const rect = stageRef.current!.container().getBoundingClientRect()
      const stageX = t.clientX - rect.left
      const stageY = t.clientY - rect.top
      const hp = adjustHandlePosRef.current
      if (hp) {
        if (Math.hypot(stageX - hp.rotX, stageY - hp.rotY) <= 28) {
          isAdjustDragging.current = 'rotation'
          adjustStartAngle.current = Math.atan2(stageX - hp.cx, -(stageY - hp.cy))
          adjustStartRotation.current = adjustModeRef.current.rotation
          return
        }
        if (Math.hypot(stageX - hp.sclX, stageY - hp.sclY) <= 28) {
          isAdjustDragging.current = 'scale'
          adjustStartDist.current = Math.max(20, Math.hypot(stageX - hp.cx, stageY - hp.cy))
          adjustStartScale.current = adjustModeRef.current.volScale
          return
        }
      }
      isAdjustDragging.current = 'body'
      repoStartX.current = t.clientX
      repoStartY.current = t.clientY
      repoBaseOffset.current = { ...adjustModeRef.current.offset }
      return
    }

    // Reposicionamiento: single touch mueve el volumen
    if (repositionModeRef.current) {
      repoStartX.current = t.clientX
      repoStartY.current = t.clientY
      repoBaseOffset.current = { ...repositionModeRef.current.offset }
      isRepoDragging.current = true
      return
    }

    if (paintMode || volumePaintMode) {
      isDrawing.current = true
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    } else {
      isTouching.current = true
      touchStartX.current = t.clientX
      touchStartY.current = t.clientY
      touchLastX.current = t.clientX
      touchLastY.current = t.clientY
      touchStartPanX.current = panXRef.current
      lastVelX.current = t.clientX
      lastVelTime.current = performance.now()
      velocityX.current = 0
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, sorted.length, size, layout, anchors])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches

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
    touchLastX.current = t.clientX
    touchLastY.current = t.clientY
    touchMoved.current = true

    // Adjust mode
    if (adjustModeRef.current && isAdjustDragging.current) {
      const rect = stageRef.current!.container().getBoundingClientRect()
      const stageX = t.clientX - rect.left
      const stageY = t.clientY - rect.top
      const hp = adjustHandlePosRef.current
      if (isAdjustDragging.current === 'rotation' && hp) {
        const angle = Math.atan2(stageX - hp.cx, -(stageY - hp.cy))
        const delta = angle - adjustStartAngle.current
        onAdjustChangeRef.current?.({ rotation: adjustStartRotation.current + delta * 180 / Math.PI })
      } else if (isAdjustDragging.current === 'scale' && hp) {
        const dist = Math.hypot(stageX - hp.cx, stageY - hp.cy)
        onAdjustChangeRef.current?.({ volScale: Math.max(0.2, Math.min(4, adjustStartScale.current * dist / adjustStartDist.current)) })
      } else if (isAdjustDragging.current === 'body') {
        const dw = displayWForIdx(activeIdx)
        const z = zoomRef.current
        onAdjustChangeRef.current?.({ offset: {
          dx: (t.clientX - repoStartX.current) / (dw * z) + repoBaseOffset.current.dx,
          dy: (t.clientY - repoStartY.current) / (size.h * z) + repoBaseOffset.current.dy,
        }})
      }
      return
    }

    // Reposicionamiento
    if (repositionModeRef.current && isRepoDragging.current) {
      const dw = displayWForIdx(activeIdx)
      const z = zoomRef.current
      const dx = (t.clientX - repoStartX.current) / (dw * z) + repoBaseOffset.current.dx
      const dy = (t.clientY - repoStartY.current) / (size.h * z) + repoBaseOffset.current.dy
      onRepositionOffsetChangeRef.current?.({ dx, dy })
      return
    }

    if ((paintMode || volumePaintMode) && isDrawing.current) {
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
      return
    }

    if (!isTouching.current) return
    const now = performance.now()
    const dt = now - lastVelTime.current
    if (dt > 0) {
      velocityX.current = (t.clientX - lastVelX.current) / dt
    }
    lastVelX.current = t.clientX
    lastVelTime.current = now

    const dx = t.clientX - touchStartX.current
    const rawPanX = touchStartPanX.current - dx
    const limitNext = transitionPanXForIdx(activeIdx)

    if (rawPanX > limitNext && activeIdx < sorted.length - 1) {
      panXRef.current = limitNext
      const peek = rawPanX - limitNext
      transXRef.current = peek; setTransX(peek)
    } else if (rawPanX < 0 && activeIdx > 0) {
      panXRef.current = 0
      transXRef.current = rawPanX; setTransX(rawPanX)
    } else {
      panXRef.current = Math.max(0, Math.min(rawPanX, limitNext))
      if (transXRef.current !== 0) { transXRef.current = 0; setTransX(0) }
    }
    setPanX(panXRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, sorted.length, size, anchors, zoom, layout])

  const handleTouchEnd = useCallback((_e: KonvaEventObject<TouchEvent>) => {
    if (isPinching.current) {
      isPinching.current = false
      return
    }

    // Adjust mode
    if (adjustModeRef.current && isAdjustDragging.current) {
      isAdjustDragging.current = null
      return
    }

    // Reposicionamiento: el fin del drag no hace nada (WallPage guarda en su botón)
    if (repositionModeRef.current && isRepoDragging.current) {
      isRepoDragging.current = false
      return
    }

    if ((paintMode || volumePaintMode) && isDrawing.current) {
      isDrawing.current = false
      if (paintMode) finishDrawing()
      else if (volumePaintMode === 'perimeter') finishVolumePerimeter()
      else finishVolumeDetail()
      return
    }

    if (!isTouching.current) return
    isTouching.current = false

    // Detección de tap: toleramos hasta 12px de movimiento (micro-movimiento táctil normal)
    const tapDx = Math.abs(touchLastX.current - touchStartX.current)
    const tapDy = Math.abs(touchLastY.current - touchStartY.current)
    const isTap = tapDx < 12 && tapDy < 12

    // Vol-place mode: single tap places catalog volume at tapped position
    if (isTap && volPlaceModeRef.current && stageRef.current) {
      const rect = stageRef.current.container().getBoundingClientRect()
      const tapX = touchStartX.current - rect.left
      const tapY = touchStartY.current - rect.top
      // Use pan captured at touchStart (consistent with tapX/tapY, not drifted)
      const tapPanX = touchStartPanX.current
      const catalogItem = volPlaceModeRef.current
      const CATALOG_PX = 100
      // Center on shape centroid so the tap lands on the visual center
      const n = catalogItem.shape.length
      const cxCat = catalogItem.shape.reduce((s, p) => s + p.x, 0) / n
      const cyCat = catalogItem.shape.reduce((s, p) => s + p.y, 0) / n
      const catToScreen = (p: { x: number; y: number }) => ({
        x: tapX + (p.x - cxCat) * CATALOG_PX * 2,
        y: tapY + (p.y - cyCat) * CATALOG_PX * 2,
      })
      const perimeter = catalogItem.shape.map(p => { const s = catToScreen(p); return screenToChain(s.x, s.y, tapPanX) })
      // Convert details to chain-space using the same transform
      const details = (catalogItem.details ?? []).map(stroke =>
        stroke.map(p => { const s = catToScreen(p); return screenToChain(s.x, s.y, tapPanX) })
      )
      const zone = sorted[activeIdx]
      if (zone?.chain_id) {
        onVolumePlacedRef.current?.(perimeter, zone.id, zone.chain_id, catalogItem.id, details)
      }
      return
    }

    if (isTap && !paintMode && !volumePaintMode && !repositionModeRef.current && !adjustModeRef.current && stageRef.current) {
      const rect = stageRef.current.container().getBoundingClientRect()
      const tapPos = { x: touchStartX.current - rect.left, y: touchStartY.current - rect.top }
      const shapes = stageRef.current.getAllIntersections(tapPos)

      // Rutas tienen prioridad (están arriba visualmente)
      const rteShape = shapes.find(s => s.id().startsWith('RTE:'))
      if (rteShape) {
        const route = routesRef.current.find(r => r.id === rteShape.id().slice(4))
        if (route) { onRouteClickRef.current(route); return }
      }

      // Volúmenes
      const volShape = shapes.find(s => s.id().startsWith('VOL:'))
      if (volShape) {
        const raw = volShape.id().slice(4) // quita 'VOL:'
        const sep = raw.lastIndexOf(':')   // último ':' separa volId del zoneId
        const volId = raw.slice(0, sep)
        const displayZoneId = raw.slice(sep + 1)
        const vol = volumesRef.current.find(v => v.id === volId)
        if (vol && onVolumeClickRef.current) {
          onVolumeClickRef.current(vol, displayZoneId)
          return
        }
      }

      // Doble tap → reset zoom
      const now = Date.now()
      if (now - lastTapTime.current < 300) {
        animate(zoomRef.current, 1, 180, v => { zoomRef.current = v; setZoom(v) }, () => {})
        panXRef.current = Math.min(panXRef.current, maxPanXForIdx(activeIdx))
      }
      lastTapTime.current = now
    }

    const tx = transXRef.current
    const vel = velocityX.current
    const fastSwipeNext = vel < -0.35 && activeIdx < sorted.length - 1
    const fastSwipePrev = vel > 0.35 && activeIdx > 0

    if ((tx > TRANSITION_OVERSHOOT || (tx > 5 && fastSwipeNext)) && activeIdx < sorted.length - 1) {
      startTransitionToNext()
    } else if ((tx < -TRANSITION_OVERSHOOT || (tx < -5 && fastSwipePrev)) && activeIdx > 0) {
      startTransitionToPrev()
    } else if (tx !== 0) {
      const from = tx
      animate(from, 0, 180, v => { transXRef.current = v; setTransX(v) }, () => {
        transXRef.current = 0; setTransX(0)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, sorted.length, size, anchors, zoom, layout])

  // Mouse (desktop)
  const handleMouseDown = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (adjustModeRef.current) {
      const p = stageRef.current!.getPointerPosition()!
      const hp = adjustHandlePosRef.current
      if (hp) {
        if (Math.hypot(p.x - hp.rotX, p.y - hp.rotY) <= 28) {
          isAdjustDragging.current = 'rotation'
          adjustStartAngle.current = Math.atan2(p.x - hp.cx, -(p.y - hp.cy))
          adjustStartRotation.current = adjustModeRef.current.rotation
          return
        }
        if (Math.hypot(p.x - hp.sclX, p.y - hp.sclY) <= 28) {
          isAdjustDragging.current = 'scale'
          adjustStartDist.current = Math.max(20, Math.hypot(p.x - hp.cx, p.y - hp.cy))
          adjustStartScale.current = adjustModeRef.current.volScale
          return
        }
      }
      isAdjustDragging.current = 'body'
      repoStartX.current = p.x
      repoStartY.current = p.y
      repoBaseOffset.current = { ...adjustModeRef.current.offset }
      return
    }
    if (repositionModeRef.current) {
      const p = stageRef.current!.getPointerPosition()!
      repoStartX.current = p.x
      repoStartY.current = p.y
      repoBaseOffset.current = { ...repositionModeRef.current.offset }
      isRepoDragging.current = true
      return
    }
    if (!paintMode && !volumePaintMode) return
    isDrawing.current = true
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, sorted.length, size, layout])

  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (adjustModeRef.current && isAdjustDragging.current) {
      const p = stageRef.current!.getPointerPosition()!
      const hp = adjustHandlePosRef.current
      if (isAdjustDragging.current === 'rotation' && hp) {
        const angle = Math.atan2(p.x - hp.cx, -(p.y - hp.cy))
        onAdjustChangeRef.current?.({ rotation: adjustStartRotation.current + (angle - adjustStartAngle.current) * 180 / Math.PI })
      } else if (isAdjustDragging.current === 'scale' && hp) {
        const dist = Math.hypot(p.x - hp.cx, p.y - hp.cy)
        onAdjustChangeRef.current?.({ volScale: Math.max(0.2, Math.min(4, adjustStartScale.current * dist / adjustStartDist.current)) })
      } else if (isAdjustDragging.current === 'body') {
        const dw = displayWForIdx(activeIdx)
        const z = zoomRef.current
        onAdjustChangeRef.current?.({ offset: {
          dx: (p.x - repoStartX.current) / (dw * z) + repoBaseOffset.current.dx,
          dy: (p.y - repoStartY.current) / (size.h * z) + repoBaseOffset.current.dy,
        }})
      }
      return
    }
    if (repositionModeRef.current && isRepoDragging.current) {
      const p = stageRef.current!.getPointerPosition()!
      const dw = displayWForIdx(activeIdx)
      const z = zoomRef.current
      onRepositionOffsetChangeRef.current?.({
        dx: (p.x - repoStartX.current) / (dw * z) + repoBaseOffset.current.dx,
        dy: (p.y - repoStartY.current) / (size.h * z) + repoBaseOffset.current.dy,
      })
      return
    }
    if ((!paintMode && !volumePaintMode) || !isDrawing.current) return
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, layout, size])

  const handleMouseUp = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (adjustModeRef.current && isAdjustDragging.current) {
      isAdjustDragging.current = null
      return
    }
    if (repositionModeRef.current && isRepoDragging.current) {
      isRepoDragging.current = false
      return
    }
    if ((paintMode || volumePaintMode) && isDrawing.current) {
      isDrawing.current = false
      if (paintMode) finishDrawing()
      else if (volumePaintMode === 'perimeter') finishVolumePerimeter()
      else finishVolumeDetail()
      return
    }
    // Vol-place mode (desktop)
    if (!paintMode && !volumePaintMode && volPlaceModeRef.current && stageRef.current) {
      const pos = stageRef.current.getPointerPosition()
      if (pos) {
        const catalogItem = volPlaceModeRef.current
        const CATALOG_PX = 100
        const n = catalogItem.shape.length
        const cxCat = catalogItem.shape.reduce((s, p) => s + p.x, 0) / n
        const cyCat = catalogItem.shape.reduce((s, p) => s + p.y, 0) / n
        const catToScreen = (p: { x: number; y: number }) => ({
          x: pos.x + (p.x - cxCat) * CATALOG_PX * 2,
          y: pos.y + (p.y - cyCat) * CATALOG_PX * 2,
        })
        const perimeter = catalogItem.shape.map(p => { const s = catToScreen(p); return screenToChain(s.x, s.y) })
        const details = (catalogItem.details ?? []).map(stroke =>
          stroke.map(p => { const s = catToScreen(p); return screenToChain(s.x, s.y) })
        )
        const zone = sorted[activeIdx]
        if (zone?.chain_id) {
          onVolumePlacedRef.current?.(perimeter, zone.id, zone.chain_id, catalogItem.id, details)
        }
      }
      return
    }
    // Click idle en desktop → detectar ruta/volumen
    if (!paintMode && !volumePaintMode && !repositionModeRef.current && !adjustModeRef.current && stageRef.current) {
      const pos = stageRef.current.getPointerPosition()
      if (pos) {
        const shapes = stageRef.current.getAllIntersections(pos)
        const rteShape = shapes.find(s => s.id().startsWith('RTE:'))
        if (rteShape) {
          const route = routesRef.current.find(r => r.id === rteShape.id().slice(4))
          if (route) { onRouteClickRef.current(route); return }
        }
        const volShape = shapes.find(s => s.id().startsWith('VOL:'))
        if (volShape) {
          const raw = volShape.id().slice(4)
          const sep = raw.lastIndexOf(':')
          const vol = volumesRef.current.find(v => v.id === raw.slice(0, sep))
          if (vol && onVolumeClickRef.current) {
            onVolumeClickRef.current(vol, raw.slice(sep + 1)); return
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, volumePaintMode, activeIdx, sorted, layout])

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
    if (img) {
      return <KonvaImage key={zone.id} x={screenOffsetX} y={yOffset} width={dw} height={size.h * zoom} image={img} />
    }
    return (
      <Group key={zone.id}>
        <Rect x={screenOffsetX} y={0} width={size.w} height={size.h} fill={FALLBACK_COLOR} />
        <Text x={screenOffsetX + 24} y={24} text={zone.name} fontSize={22} fill="rgba(255,255,255,0.2)" fontFamily="sans-serif" />
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

  // ── Volume rendering ──────────────────────────────────────────

  function renderVolumes(idx: number, localPanX: number) {
    const zone = sorted[idx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    if (!zone || !zl) return null

    const dw = displayWForIdx(idx)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photoClipFunc = (ctx: any) => {
      ctx.rect(-localPanX, yOffset, dw * zoom, size.h * zoom)
    }

    function renderVolume(
      vol: Volume,
      converter: (p: { x: number; y: number }) => { x: number; y: number },
      displayZoneId: string,
      _isOwnZone: boolean,
      keySuffix = ''
    ) {
      if (!vol.perimeter || vol.perimeter.length < 3) return null

      const repo = repositionModeRef.current
      const isRepositioning = repo?.volumeId === vol.id && repo?.zoneId === displayZoneId
      const adj = adjustModeRef.current
      const isAdjusting = adj?.volumeId === vol.id && adj?.zoneId === displayZoneId

      // Offset: adjust (live) > reposition (live) > stored
      let effectiveConverter = converter
      const storedOffset = vol.zone_offsets?.[displayZoneId]
      const activeOffset = isAdjusting ? adj!.offset
        : isRepositioning ? repo!.offset : storedOffset
      if (activeOffset && (activeOffset.dx !== 0 || activeOffset.dy !== 0)) {
        const off = activeOffset
        effectiveConverter = (p) => {
          const raw = converter(p)
          return {
            x: raw.x + off.dx * dw * zoom,
            y: raw.y + off.dy * size.h * zoom,
          }
        }
      }

      const perimeterPts = vol.perimeter.flatMap(p => { const s = effectiveConverter(p); return [s.x, s.y] })
      const hasClickHandler = !!onVolumeClickRef.current && !repo && !adj

      // Use live values from adjustMode when adjusting, stored values otherwise
      const rotation = isAdjusting ? adj!.rotation : (vol.rotation ?? 0)
      const volScale = isAdjusting ? adj!.volScale : (vol.vol_scale ?? 1)
      const hasCatalogTransform = (!!vol.catalog_id || isAdjusting) && (rotation !== 0 || volScale !== 1 || isAdjusting)

      let cx = 0, cy = 0
      if (hasCatalogTransform || isAdjusting) {
        const n = perimeterPts.length / 2
        for (let i = 0; i < perimeterPts.length; i += 2) { cx += perimeterPts[i]; cy += perimeterPts[i + 1] }
        cx /= n; cy /= n
      }

      // Update handle positions for the adjust-mode volume
      if (isAdjusting) {
        const HANDLE_DIST = 75
        const rot = adjustModeRef.current!.rotation
        const rotRad = rot * Math.PI / 180
        adjustHandlePosRef.current = {
          cx, cy,
          rotX: cx + HANDLE_DIST * Math.sin(rotRad),
          rotY: cy - HANDLE_DIST * Math.cos(rotRad),
          sclX: cx + HANDLE_DIST * Math.sin(rotRad + Math.PI / 2),
          sclY: cy - HANDLE_DIST * Math.cos(rotRad + Math.PI / 2),
        }
      }

      if (hasCatalogTransform) {
        const relPts = perimeterPts.map((v, i) => i % 2 === 0 ? v - cx : v - cy)
        const relDetails = (vol.details ?? []).map(stroke =>
          stroke.flatMap(p => { const s = effectiveConverter(p); return [s.x - cx, s.y - cy] })
        )
        return (
          <Group key={vol.id + keySuffix} x={cx} y={cy} rotation={rotation} scaleX={volScale} scaleY={volScale}>
            <Line
              id={hasClickHandler ? `VOL:${vol.id}:${displayZoneId}` : ''}
              points={relPts}
              closed={true}
              fill={isRepositioning ? 'rgba(110,110,110,0.60)' : 'rgba(110,110,110,0.42)'}
              stroke={isRepositioning ? 'rgba(250,204,21,0.9)' : isAdjusting ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.75)'}
              strokeWidth={isRepositioning || isAdjusting ? 3 : 2.5}
              tension={0.3} lineCap="round"
              hitStrokeWidth={hasClickHandler ? 20 : 0}
              listening={hasClickHandler}
            />
            {relDetails.map((pts, i) => (
              <Line key={i} points={pts} stroke="rgba(55,55,55,0.92)" strokeWidth={5} tension={0.5} lineCap="round" lineJoin="round" listening={false} />
            ))}
          </Group>
        )
      }

      return (
        <Group key={vol.id + keySuffix}>
          <Line
            id={hasClickHandler ? `VOL:${vol.id}:${displayZoneId}` : ''}
            points={perimeterPts}
            closed={true}
            fill={isRepositioning ? 'rgba(110,110,110,0.60)' : 'rgba(110,110,110,0.42)'}
            stroke={isRepositioning ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.75)'}
            strokeWidth={isRepositioning ? 3 : 2.5}
            tension={0.3}
            lineCap="round"
            hitStrokeWidth={hasClickHandler ? 20 : 0}
            listening={hasClickHandler}
          />
          {(vol.details ?? []).map((stroke, i) => {
            const pts = stroke.flatMap(p => { const s = effectiveConverter(p); return [s.x, s.y] })
            return <Line key={i} points={pts} stroke="rgba(55,55,55,0.92)" strokeWidth={5} tension={0.5} lineCap="round" lineJoin="round" listening={false} />
          })}
        </Group>
      )
    }

    function renderCrossVolumeGroup(
      xVols: Volume[],
      converter: (p: { x: number; y: number }) => { x: number; y: number },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clipFn: ((ctx: any) => void) | undefined,
      keySuffix: string
    ) {
      if (!xVols.length) return null
      const nodes = xVols.map(v => renderVolume(v, converter, zone.id, false, keySuffix))
      return clipFn
        ? <Group clipFunc={clipFn}>{nodes}</Group>
        : <>{nodes}</>
    }

    const ownVolumes = volumes.filter(v => v.chain_id && v.perimeter?.length && v.zone_id === zone.id)
    const ownConverter = (p: { x: number; y: number }) => chainToScreen(p, idx, localPanX)

    const prevZone = sorted[idx - 1]
    const prevAnchor = prevZone ? anchors.find(a => a.zone_a_id === prevZone.id && a.zone_b_id === zone.id) : null
    const prevPairs = prevAnchor?.point_pairs ?? []
    const zl_prev = prevZone ? layout.zones.find(z => z.id === prevZone.id) : null
    let prevCrossVolumes: Volume[] = []
    let prevCrossConverter: ((p: { x: number; y: number }) => { x: number; y: number }) | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prevClipFunc: ((ctx: any) => void) | undefined = undefined

    if (prevPairs.length >= 3 && zl_prev) {
      const t = computeAnchorTransform(prevPairs)
      prevCrossVolumes = volumes.filter(v => v.chain_id && v.perimeter?.length && v.zone_id === prevZone!.id)
      prevCrossConverter = (p: { x: number; y: number }) => {
        const relX_A = (p.x * layout.totalW - zl_prev.virtualX) / zl_prev.virtualW
        const { x: relX_B, y: relY_B } = t.aToB({ x: relX_A, y: p.y })
        return { x: relX_B * dw * zoom - localPanX, y: yOffset + relY_B * size.h * zoom }
      }
      prevClipFunc = photoClipFunc
    }

    const nextZone = sorted[idx + 1]
    const nextAnchor = nextZone ? anchors.find(a => a.zone_a_id === zone.id && a.zone_b_id === nextZone.id) : null
    const nextPairs = nextAnchor?.point_pairs ?? []
    const zl_next = nextZone ? layout.zones.find(z => z.id === nextZone.id) : null
    let nextCrossVolumes: Volume[] = []
    let nextCrossConverter: ((p: { x: number; y: number }) => { x: number; y: number }) | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nextClipFunc: ((ctx: any) => void) | undefined = undefined

    if (nextPairs.length >= 3 && zl_next) {
      const t = computeAnchorTransform(nextPairs)
      nextCrossVolumes = volumes.filter(v => v.chain_id && v.perimeter?.length && v.zone_id === nextZone!.id)
      nextCrossConverter = (p: { x: number; y: number }) => {
        const relX_B = (p.x * layout.totalW - zl_next.virtualX) / zl_next.virtualW
        const { x: relX_A, y: relY_A } = t.bToA({ x: relX_B, y: p.y })
        return { x: relX_A * dw * zoom - localPanX, y: yOffset + relY_A * size.h * zoom }
      }
      nextClipFunc = photoClipFunc
    }

    return (
      <>
        {ownVolumes.map(v => renderVolume(v, ownConverter, zone.id, true))}
        {prevCrossConverter && renderCrossVolumeGroup(prevCrossVolumes, prevCrossConverter, prevClipFunc, '_prev')}
        {nextCrossConverter && renderCrossVolumeGroup(nextCrossVolumes, nextCrossConverter, nextClipFunc, '_next')}
      </>
    )
  }

  // ── Route rendering ───────────────────────────────────────────

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
      const colorHex = getColorHex(route.color)
      const level = getFreshnessLevel(route.placed_at)
      const freshnessHex = getFreshnessColor(level)
      const days = getDaysOnWall(route.placed_at)
      const bd = badgeMap.get(route.id + keySuffix)
      return (
        <Group key={route.id + keySuffix}>
          <Line points={flat} stroke={freshnessHex} strokeWidth={STROKE_W + 6} tension={0.5} lineCap="round" lineJoin="round" opacity={0.35} listening={false} />
          <Line id={`RTE:${route.id}`} points={flat} stroke={colorHex} strokeWidth={STROKE_W} tension={0.5} lineCap="round" lineJoin="round" opacity={0.92} hitStrokeWidth={32} />
          {bd && isStaff && (
            <>
              <Line points={[bd.bx, bd.by + BADGE_H, bd.anchorX, bd.anchorY]} stroke={freshnessHex} strokeWidth={1.5} opacity={0.7} listening={false} />
              <Rect x={bd.bx - BADGE_W / 2} y={bd.by} width={BADGE_W} height={BADGE_H} fill={freshnessHex} cornerRadius={4} listening={false} />
              <Text x={bd.bx - BADGE_W / 2 + 2} y={bd.by + 3} text={`${days}d`} fontSize={10} fill="#111" fontStyle="bold" fontFamily="sans-serif" width={BADGE_W - 4} align="center" listening={false} />
            </>
          )}
          {bd && !isStaff && (
            <>
              <Line points={[bd.bx, bd.by + BADGE_H, bd.anchorX, bd.anchorY]} stroke={freshnessHex} strokeWidth={1.5} opacity={0.7} listening={false} />
              <Rect x={bd.bx - BADGE_W / 2} y={bd.by} width={BADGE_W} height={BADGE_H} fill="rgba(0,0,0,0.75)" cornerRadius={4} listening={false} />
              <Text x={bd.bx - BADGE_W / 2 + 2} y={bd.by + 3} text={getPublicLabel(level)} fontSize={9} fill={freshnessHex} fontStyle="bold" fontFamily="sans-serif" width={BADGE_W - 4} align="center" listening={false} />
            </>
          )}
        </Group>
      )
    }

    const ownRoutes = routes.filter(r =>
      r.chain_id && r.blob_path?.length && r.zone_id === zone.id
    )
    const ownConverter = (p: { x: number; y: number }) => chainToScreen(p, idx, localPanX)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photoClipFunc = (ctx: any) => {
      ctx.rect(-localPanX, yOffset, dw * zoom, size.h * zoom)
    }

    function renderCrossGroup(
      xRoutes: Route[],
      converter: (p: { x: number; y: number }) => { x: number; y: number },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clipFn: ((ctx: any) => void) | undefined,
      keySuffix: string
    ) {
      if (!xRoutes.length) return null
      const nodes = xRoutes.map(r => renderRoute(r, converter, keySuffix))
      return clipFn
        ? <Group clipFunc={clipFn}>{nodes}</Group>
        : <>{nodes}</>
    }

    const prevZone = sorted[idx - 1]
    const prevAnchor = prevZone ? anchors.find(a => a.zone_a_id === prevZone.id && a.zone_b_id === zone.id) : null
    const prevPairs = prevAnchor?.point_pairs ?? []
    const zl_prev = prevZone ? layout.zones.find(z => z.id === prevZone.id) : null
    let prevCrossRoutes: Route[] = []
    let prevCrossConverter: ((p: { x: number; y: number }) => { x: number; y: number }) | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prevClipFunc: ((ctx: any) => void) | undefined = undefined

    if (prevPairs.length >= 3 && zl_prev) {
      const t = computeAnchorTransform(prevPairs)
      prevCrossRoutes = routes.filter(r => r.chain_id && r.blob_path?.length && r.zone_id === prevZone!.id)
      prevCrossConverter = (p: { x: number; y: number }) => {
        const relX_A = (p.x * layout.totalW - zl_prev.virtualX) / zl_prev.virtualW
        const { x: relX_B, y: relY_B } = t.aToB({ x: relX_A, y: p.y })
        return { x: relX_B * dw * zoom - localPanX, y: yOffset + relY_B * size.h * zoom }
      }
      prevClipFunc = photoClipFunc
    }

    const nextZone = sorted[idx + 1]
    const nextAnchor = nextZone ? anchors.find(a => a.zone_a_id === zone.id && a.zone_b_id === nextZone.id) : null
    const nextPairs = nextAnchor?.point_pairs ?? []
    const zl_next = nextZone ? layout.zones.find(z => z.id === nextZone.id) : null
    let nextCrossRoutes: Route[] = []
    let nextCrossConverter: ((p: { x: number; y: number }) => { x: number; y: number }) | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nextClipFunc: ((ctx: any) => void) | undefined = undefined

    if (nextPairs.length >= 3 && zl_next) {
      const t = computeAnchorTransform(nextPairs)
      nextCrossRoutes = routes.filter(r => r.chain_id && r.blob_path?.length && r.zone_id === nextZone!.id)
      nextCrossConverter = (p: { x: number; y: number }) => {
        const relX_B = (p.x * layout.totalW - zl_next.virtualX) / zl_next.virtualW
        const { x: relX_A, y: relY_A } = t.bToA({ x: relX_B, y: p.y })
        return { x: relX_A * dw * zoom - localPanX, y: yOffset + relY_A * size.h * zoom }
      }
      nextClipFunc = photoClipFunc
    }

    // ── Badge layout: ancla en punto más alto + separación sin colisiones ────
    const BADGE_W = isStaff ? 38 : 62
    const BADGE_H = 16
    const LINE_BASE = 26
    const GAP = 5

    const routeDefs: Array<{
      route: Route
      converter: (p: { x: number; y: number }) => { x: number; y: number }
      key: string
    }> = [
      ...ownRoutes.map(r => ({ route: r, converter: ownConverter, key: r.id })),
      ...(prevCrossConverter
        ? prevCrossRoutes.map(r => ({ route: r, converter: prevCrossConverter!, key: r.id + '_prev' }))
        : []),
      ...(nextCrossConverter
        ? nextCrossRoutes.map(r => ({ route: r, converter: nextCrossConverter!, key: r.id + '_next' }))
        : []),
    ]

    const badges = routeDefs.map(({ route, converter, key }) => {
      const pts = route.blob_path.map(p => converter(p))
      const top = pts.reduce((best, p) => p.y < best.y ? p : best, pts[0])
      return { key, anchorX: top.x, anchorY: top.y, bx: top.x, by: top.y - LINE_BASE - BADGE_H }
    })

    for (let iter = 0; iter < 60; iter++) {
      let moved = false
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const a = badges[i], b = badges[j]
          const ox = BADGE_W + GAP - Math.abs(a.bx - b.bx)
          const oy = BADGE_H + GAP - Math.abs(a.by - b.by)
          if (ox > 0 && oy > 0) {
            moved = true
            if (ox <= oy) {
              const push = ox / 2 + 1
              if (a.bx <= b.bx) { a.bx -= push; b.bx += push }
              else { a.bx += push; b.bx -= push }
            } else {
              const push = oy + 2
              if (a.by >= b.by) a.by -= push
              else b.by -= push
            }
          }
        }
      }
      if (!moved) break
    }

    // Pull-down: conector máximo 50px. Después, separación horizontal para resolver solapamientos nuevos.
    const MAX_PULL = 50
    for (const b of badges) {
      b.by = Math.max(b.anchorY - MAX_PULL - BADGE_H, b.by)
      b.by = Math.max(8, b.by)
    }
    for (let iter = 0; iter < 30; iter++) {
      let moved = false
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const a = badges[i], b = badges[j]
          if (Math.abs(a.by - b.by) >= BADGE_H + GAP) continue
          const ox = BADGE_W + GAP - Math.abs(a.bx - b.bx)
          if (ox > 0) {
            moved = true
            const push = ox / 2 + 1
            if (a.bx <= b.bx) { a.bx -= push; b.bx += push }
            else { a.bx += push; b.bx -= push }
          }
        }
      }
      if (!moved) break
    }

    const badgeMap = new Map(badges.map(b => [b.key, b]))
    // ──────────────────────────────────────────────────────────────────────────

    return (
      <>
        {ownRoutes.map(r => renderRoute(r, ownConverter))}
        {prevCrossConverter && renderCrossGroup(prevCrossRoutes, prevCrossConverter, prevClipFunc, '_prev')}
        {nextCrossConverter && renderCrossGroup(nextCrossRoutes, nextCrossConverter, nextClipFunc, '_next')}
      </>
    )
  }

  const effectivePanX = panX + transX
  const showPrevPeek = transX < 0 && activeIdx > 0
  const showNextPeek = transX > 0 && activeIdx < sorted.length - 1
  const prevExitPanX = showPrevPeek ? maxPanXForIdx(activeIdx - 1) : 0
  const nextEntryPanX = 0

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

  const previewVolPerimScreenPts = previewVolumePerimeter && previewVolumePerimeter.length >= 3
    ? previewVolumePerimeter.flatMap(p => { const s = chainToScreen(p, activeIdx, panX); return [s.x, s.y] })
    : []

  const previewVolDetailsScreenPts = previewVolumeDetails.map(stroke =>
    stroke.flatMap(p => { const s = chainToScreen(p, activeIdx, panX); return [s.x, s.y] })
  )

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
        {/* Photo layer */}
        <Layer listening={false}>
          {showPrevPeek && renderPhoto(activeIdx - 1, -prevExitPanX - size.w - transX)}
          {showNextPeek && renderPhoto(activeIdx + 1, size.w - nextEntryPanX - transX)}
          {renderPhoto(activeIdx, -effectivePanX)}
        </Layer>

        {/* Volumes + Routes (volumes primero = debajo de rutas) */}
        <Layer>
          {showPrevPeek && renderVolumes(activeIdx - 1, prevExitPanX + size.w + transX)}
          {showNextPeek && renderVolumes(activeIdx + 1, nextEntryPanX + transX - size.w)}
          {renderVolumes(activeIdx, effectivePanX)}
          {showPrevPeek && renderRoutes(activeIdx - 1, prevExitPanX + size.w + transX)}
          {showNextPeek && renderRoutes(activeIdx + 1, nextEntryPanX + transX - size.w)}
          {renderRoutes(activeIdx, effectivePanX)}
        </Layer>

        {/* Adjust mode handles layer */}
        {adjustMode && adjustHandlePosRef.current && (
          <Layer listening={false}>
            {(() => {
              const hp = adjustHandlePosRef.current!
              return (
                <>
                  <Line points={[hp.cx, hp.cy, hp.rotX, hp.rotY]} stroke="rgba(251,146,60,0.5)" strokeWidth={1.5} dash={[4, 3]} />
                  <Line points={[hp.cx, hp.cy, hp.sclX, hp.sclY]} stroke="rgba(96,165,250,0.5)" strokeWidth={1.5} dash={[4, 3]} />
                  <Circle x={hp.rotX} y={hp.rotY} radius={14} fill="#f97316" stroke="#fff" strokeWidth={2} />
                  <Text x={hp.rotX - 6} y={hp.rotY - 6} text="↻" fontSize={13} fill="#fff" fontFamily="sans-serif" listening={false} />
                  <Circle x={hp.sclX} y={hp.sclY} radius={14} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
                  <Text x={hp.sclX - 6} y={hp.sclY - 6} text="⤡" fontSize={12} fill="#fff" fontFamily="sans-serif" listening={false} />
                  <Circle x={hp.cx} y={hp.cy} radius={8} fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />
                </>
              )
            })()}
          </Layer>
        )}

        {/* Drawing preview layer */}
        <Layer listening={false}>
          {previewScreenPts.length >= 4 && (
            <Line points={previewScreenPts} stroke={getColorHex(drawColor)} strokeWidth={STROKE_W}
              tension={0.5} lineCap="round" lineJoin="round" opacity={0.75} dash={[20, 8]} />
          )}
          {paintMode && drawScreenPts.length >= 4 && (
            <Line points={drawScreenPts} stroke={getColorHex(drawColor)} strokeWidth={STROKE_W}
              tension={0.5} lineCap="round" lineJoin="round" opacity={0.85} />
          )}

          {previewVolPerimScreenPts.length >= 6 && (
            <Line points={previewVolPerimScreenPts} closed={true}
              fill="rgba(110,110,110,0.38)" stroke="rgba(170,170,170,0.75)" strokeWidth={2.5}
              tension={0.3} lineCap="round" />
          )}
          {previewVolDetailsScreenPts.map((pts, i) =>
            pts.length >= 4 && (
              <Line key={i} points={pts} stroke="rgba(55,55,55,0.95)" strokeWidth={5} tension={0.5} lineCap="round" lineJoin="round" />
            )
          )}
          {volumePaintMode === 'perimeter' && drawScreenPts.length >= 4 && (
            <>
              <Line points={drawScreenPts} stroke="rgba(180,180,180,0.88)" strokeWidth={3} tension={0.3} lineCap="round" />
              <Line
                points={[drawScreenPts[drawScreenPts.length - 2], drawScreenPts[drawScreenPts.length - 1], drawScreenPts[0], drawScreenPts[1]]}
                stroke="rgba(180,180,180,0.28)" strokeWidth={2} dash={[8, 6]}
              />
            </>
          )}
          {volumePaintMode === 'details' && drawScreenPts.length >= 4 && (
            <Line points={drawScreenPts} stroke="rgba(55,55,55,0.95)" strokeWidth={5} tension={0.5} lineCap="round" lineJoin="round" />
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
