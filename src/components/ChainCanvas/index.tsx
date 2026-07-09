import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route, ZoneAnchor } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import { CHAIN_H, computeChainLayout, type ChainLayout } from '../../lib/chain'

const SWIPE_THRESHOLD = 0.32   // fracción del ancho de pantalla para disparar transición
const STROKE_W = 8
const MIN_POINT_GAP = 4
const FALLBACK_COLOR = '#1a2433'

interface PhotoRect { x: number; y: number; w: number; h: number }

function computePhotoRect(cw: number, ch: number, nw: number, nh: number): PhotoRect {
  if (!nw || !nh) return { x: 0, y: 0, w: cw, h: ch }
  const cAR = cw / ch
  const pAR = nw / nh
  if (cAR > pAR) {
    const h = ch; const w = h * pAR
    return { x: (cw - w) / 2, y: 0, w, h }
  } else {
    const w = cw; const h = w / pAR
    return { x: 0, y: (ch - h) / 2, w, h }
  }
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
}

export default function ChainCanvas({
  zones, anchors, routes, paintMode, drawColor, previewBlob,
  isStaff, onBlobComplete, onRouteClick, onActiveZoneChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 300, h: 500 })

  // Zonas ordenadas
  const sorted = useMemo(
    () => [...zones].sort((a, b) => a.chain_position - b.chain_position),
    [zones]
  )

  // Imágenes cargadas
  const [zoneImages, setZoneImages] = useState<Record<string, HTMLImageElement>>({})
  const zonesKey = zones.map(z => z.id).join(',')
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

  // Layout — solo necesario para coordenadas de rutas
  const layout: ChainLayout = useMemo(
    () => computeChainLayout(zones, anchors, zoneImages),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [zonesKey, anchors, zoneImages]
  )

  // Zona activa (índice)
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => {
    const zone = sorted[activeIdx]
    if (zone) onActiveZoneChange?.(zone.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, sorted.length])

  // Swipe state
  const [swipeX, setSwipeX] = useState(0)
  const swipeXRef = useRef(0)
  const swipeStartX = useRef(0)
  const isSwiping = useRef(false)
  const animFrameRef = useRef<number | null>(null)

  // Medir contenedor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth, h: el.offsetHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Animación de swipe hacia target
  function animateTo(target: number, onDone?: () => void) {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    const start = swipeXRef.current
    const duration = 220
    const startTime = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - startTime) / duration)
      const ease = 1 - Math.pow(1 - t, 3)  // cubic ease out
      const val = start + (target - start) * ease
      swipeXRef.current = val
      setSwipeX(val)
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        swipeXRef.current = target
        setSwipeX(target)
        onDone?.()
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  function triggerTransition(dir: 1 | -1) {
    const target = dir === 1 ? -size.w : size.w
    animateTo(target, () => {
      setActiveIdx(i => {
        const next = Math.max(0, Math.min(sorted.length - 1, i + dir))
        return next
      })
      swipeXRef.current = 0
      setSwipeX(0)
    })
  }

  // ── Dibujo ────────────────────────────────────────────────
  const drawPointsRef = useRef<number[]>([])
  const [drawPoints, setDrawPoints] = useState<number[]>([])
  const isDrawing = useRef(false)
  const lastDrawPt = useRef({ x: 0, y: 0 })

  const onBlobCompleteRef = useRef(onBlobComplete)
  onBlobCompleteRef.current = onBlobComplete

  function screenToChain(sx: number, sy: number): { x: number; y: number } {
    const zone = sorted[activeIdx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    const img = zone && zoneImages[zone.id]
    const pr = computePhotoRect(size.w, size.h, img?.naturalWidth ?? 4, img?.naturalHeight ?? 3)
    if (!zl || !pr.w || !pr.h) return { x: 0, y: 0 }
    const photoRelX = (sx - swipeXRef.current - pr.x) / pr.w
    const photoRelY = (sy - pr.y) / pr.h
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
      const dx = vx - lastDrawPt.current.x
      const dy = vy - lastDrawPt.current.y
      if (Math.sqrt(dx * dx + dy * dy) < MIN_POINT_GAP) return
    }
    lastDrawPt.current = { x: vx, y: vy }
    drawPointsRef.current.push(ch.x, ch.y)
    setDrawPoints(prev => [...prev, ch.x, ch.y])
  }

  function finishDrawing() {
    const pts = drawPointsRef.current
    drawPointsRef.current = []
    setDrawPoints([])
    if (pts.length < 4) return
    const zone = sorted[activeIdx]
    if (!zone || !zone.chain_id) return
    const path: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length; i += 2) path.push({ x: pts[i], y: pts[i + 1] })
    onBlobCompleteRef.current(path, zone.id, zone.chain_id)
  }

  // ── Touch handlers ────────────────────────────────────────
  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    const touches = e.evt.touches
    if (touches.length !== 1) return

    const t = touches[0]
    const rect = stageRef.current!.container().getBoundingClientRect()

    if (paintMode) {
      isDrawing.current = true
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    } else {
      isSwiping.current = true
      swipeStartX.current = t.clientX
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, size, layout, activeIdx, sorted])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    const touches = e.evt.touches
    if (touches.length !== 1) return
    const t = touches[0]
    const rect = stageRef.current!.container().getBoundingClientRect()

    if (paintMode && isDrawing.current) {
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    } else if (!paintMode && isSwiping.current) {
      let dx = t.clientX - swipeStartX.current
      // Limitar: no swipe derecha en primera zona, no izquierda en última
      if (dx > 0 && activeIdx === 0) dx = dx * 0.2
      if (dx < 0 && activeIdx === sorted.length - 1) dx = dx * 0.2
      swipeXRef.current = dx
      setSwipeX(dx)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, layout])

  const handleTouchEnd = useCallback((_e: KonvaEventObject<TouchEvent>) => {
    if (paintMode && isDrawing.current) {
      isDrawing.current = false
      finishDrawing()
      return
    }
    if (!isSwiping.current) return
    isSwiping.current = false
    const dx = swipeXRef.current
    const threshold = size.w * SWIPE_THRESHOLD

    if (dx < -threshold && activeIdx < sorted.length - 1) {
      triggerTransition(1)
    } else if (dx > threshold && activeIdx > 0) {
      triggerTransition(-1)
    } else {
      animateTo(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size.w])

  const handleMouseDown = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode) return
    isDrawing.current = true
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, size, layout, activeIdx, sorted])

  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode || !isDrawing.current) return
    const p = stageRef.current!.getPointerPosition()!
    addDrawPoint(p.x, p.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, size, layout, activeIdx])

  const handleMouseUp = useCallback(() => {
    if (!paintMode || !isDrawing.current) return
    isDrawing.current = false
    finishDrawing()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted])

  // ── Helpers de render ─────────────────────────────────────
  function photoRectForIdx(idx: number): PhotoRect {
    const zone = sorted[idx]
    const img = zone && zoneImages[zone.id]
    return computePhotoRect(size.w, size.h, img?.naturalWidth ?? 4, img?.naturalHeight ?? 3)
  }

  function chainToScreen(p: { x: number; y: number }, idx: number, offsetX: number): { x: number; y: number } {
    const zone = sorted[idx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    const pr = photoRectForIdx(idx)
    if (!zl) return { x: 0, y: 0 }
    const virtualX = p.x * layout.totalW
    const relX = (virtualX - zl.virtualX) / zl.virtualW
    const relY = p.y
    return {
      x: pr.x + relX * pr.w + offsetX,
      y: pr.y + relY * pr.h,
    }
  }

  function routesForIdx(idx: number) {
    const zone = sorted[idx]
    if (!zone) return []
    const zl = layout.zones.find(z => z.id === zone.id)
    if (!zl) return []
    return routes.filter(r => {
      if (!r.chain_id || !r.blob_path?.length) return false
      // Mostrar ruta si algún punto pertenece a este zone
      return r.blob_path.some(p => {
        const vx = p.x * layout.totalW
        return vx >= zl.virtualX && vx < zl.virtualX + zl.virtualW
      })
    })
  }

  function renderPhoto(idx: number, offsetX: number) {
    const zone = sorted[idx]
    if (!zone) return null
    const img = zoneImages[zone.id]
    const pr = photoRectForIdx(idx)
    if (img) {
      return (
        <KonvaImage
          key={zone.id}
          x={pr.x + offsetX}
          y={pr.y}
          width={pr.w}
          height={pr.h}
          image={img}
        />
      )
    }
    return (
      <Group key={zone.id}>
        <Rect x={offsetX} y={0} width={size.w} height={size.h} fill={FALLBACK_COLOR} />
        <Text x={offsetX + 24} y={24} text={zone.name} fontSize={22} fill="rgba(255,255,255,0.2)" fontFamily="sans-serif" />
      </Group>
    )
  }

  function renderRoutes(idx: number, offsetX: number) {
    return routesForIdx(idx).map(route => {
      if (!route.blob_path || route.blob_path.length < 2) return null
      const flat = route.blob_path.flatMap(p => {
        const s = chainToScreen(p, idx, offsetX)
        return [s.x, s.y]
      })
      const centS = chainToScreen({
        x: route.blob_path.reduce((s, p) => s + p.x, 0) / route.blob_path.length,
        y: route.blob_path.reduce((s, p) => s + p.y, 0) / route.blob_path.length,
      }, idx, offsetX)

      const colorHex = getColorHex(route.color)
      const level = getFreshnessLevel(route.placed_at)
      const freshnessHex = getFreshnessColor(level)
      const days = getDaysOnWall(route.placed_at)

      return (
        <Group key={route.id} onClick={() => onRouteClick(route)} onTap={() => onRouteClick(route)}>
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
    })
  }

  const drawScreenPts = drawPoints.length >= 4
    ? (() => {
        const flat: number[] = []
        for (let i = 0; i < drawPoints.length; i += 2) {
          const s = chainToScreen({ x: drawPoints[i], y: drawPoints[i + 1] }, activeIdx, swipeX)
          flat.push(s.x, s.y)
        }
        return flat
      })()
    : []

  const previewScreenPts = previewBlob && previewBlob.path.length >= 2
    ? previewBlob.path.flatMap(p => {
        const s = chainToScreen(p, activeIdx, 0)
        return [s.x, s.y]
      })
    : []

  // Zona vecina que se muestra durante el swipe
  const showNext = swipeX < 0 && activeIdx < sorted.length - 1
  const showPrev = swipeX > 0 && activeIdx > 0

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
        {/* Layer 1: Fotos */}
        <Layer listening={false}>
          {/* Foto previa (peek cuando swipe derecha) */}
          {showPrev && renderPhoto(activeIdx - 1, -size.w + swipeX)}
          {/* Foto siguiente (peek cuando swipe izquierda) */}
          {showNext && renderPhoto(activeIdx + 1, size.w + swipeX)}
          {/* Foto activa */}
          {renderPhoto(activeIdx, swipeX)}
        </Layer>

        {/* Layer 2: Rutas */}
        <Layer>
          {showPrev && renderRoutes(activeIdx - 1, -size.w + swipeX)}
          {showNext && renderRoutes(activeIdx + 1, size.w + swipeX)}
          {renderRoutes(activeIdx, swipeX)}
        </Layer>

        {/* Layer 3: Dibujo activo + preview */}
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

      {/* Indicador de zona (dots) */}
      {sorted.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div className="flex items-center gap-1.5">
            {sorted.map((z, i) => (
              <div key={z.id} className="rounded-full transition-all duration-300" style={{
                width: i === activeIdx ? 20 : 6,
                height: 6,
                backgroundColor: i === activeIdx ? '#facc15' : 'rgba(255,255,255,0.25)',
              }} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
