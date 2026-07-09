import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Rect, Text, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Zone, Route, ZoneAnchor } from '../../types'
import { getColorHex } from '../../lib/colors'
import { getFreshnessLevel, getFreshnessColor, getDaysOnWall, getPublicLabel } from '../../lib/freshness'
import { CHAIN_H, computeChainLayout, computeAnchorTransform } from '../../lib/chain'

const TRANSITION_OVERSHOOT = 70  // px extra para disparar transición
const TRANSITION_MS = 240
const STROKE_W = 8
const MIN_POINT_GAP = 4
const FALLBACK_COLOR = '#1a2433'

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

  const sorted = useMemo(() => [...zones].sort((a, b) => a.chain_position - b.chain_position), [zones])
  const zonesKey = zones.map(z => z.id).join(',')

  // Imágenes cargadas
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

  // Layout virtual (necesario para coordenadas de rutas)
  const layout = useMemo(
    () => computeChainLayout(zones, anchors, zoneImages),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [zonesKey, anchors, zoneImages]
  )

  // Zona activa
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => {
    onActiveZoneChange?.(sorted[activeIdx]?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, sorted.length])

  // panX: cuánto hemos scrolleado dentro de la foto activa (0 = borde izq)
  const [panX, setPanX] = useState(0)
  const panXRef = useRef(0)

  // Estado de transición animada
  // transX: offset extra aplicado sobre panX durante la animación de salida/entrada
  const [transX, setTransX] = useState(0)
  const transXRef = useRef(0)
  const isTransitioning = useRef(false)
  const animFrameRef = useRef<number | null>(null)

  // Medición del contenedor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Dimensiones de cada foto en el modelo "fit by height"
  function displayWForIdx(idx: number): number {
    const zone = sorted[idx]
    const img = zone && zoneImages[zone.id]
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return size.h * (img.naturalWidth / img.naturalHeight)
    }
    return size.h * (4 / 3)
  }

  function maxPanXForIdx(idx: number): number {
    return Math.max(0, displayWForIdx(idx) - size.w)
  }

  // Transforms de calibración para el par activo
  function getTransform(fromIdx: number) {
    const za = sorted[fromIdx]
    const zb = sorted[fromIdx + 1]
    if (!za || !zb) return null
    const anchor = anchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
    return computeAnchorTransform(anchor?.point_pairs ?? [])
  }

  // Cuánto se puede panear antes de llegar al punto de transición
  function transitionPanXForIdx(idx: number): number {
    if (idx >= sorted.length - 1) return maxPanXForIdx(idx)
    const transform = getTransform(idx)
    if (!transform || transform.aTransitionX >= 1) return maxPanXForIdx(idx)
    const dw = displayWForIdx(idx)
    // El punto de transición en A: cuando aTransitionX llega al BORDE DERECHO de la pantalla
    return Math.max(0, transform.aTransitionX * dw - size.w)
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
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        onTick(to)
        onDone()
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  function startTransitionToNext() {
    if (isTransitioning.current || activeIdx >= sorted.length - 1) return
    isTransitioning.current = true

    const transform = getTransform(activeIdx)
    const nextDisplayW = displayWForIdx(activeIdx + 1)
    const entryPanX = transform
      ? Math.max(0, Math.min(transform.bEntryX * nextDisplayW, maxPanXForIdx(activeIdx + 1)))
      : 0

    // Animamos transX de 0 → size.w (desliza foto actual hacia la izquierda)
    animate(0, size.w, TRANSITION_MS, v => {
      transXRef.current = v
      setTransX(v)
    }, () => {
      isTransitioning.current = false
      transXRef.current = 0
      setTransX(0)
      panXRef.current = entryPanX
      setPanX(entryPanX)
      setActiveIdx(i => i + 1)
    })
  }

  function startTransitionToPrev() {
    if (isTransitioning.current || activeIdx <= 0) return
    isTransitioning.current = true

    const transform = getTransform(activeIdx - 1)
    const prevDisplayW = displayWForIdx(activeIdx - 1)
    // Entramos en la zona anterior cerca del punto de transición (para ver el overlap)
    const exitPanX = transform
      ? Math.max(0, Math.min(transform.aTransitionX * prevDisplayW - size.w * 0.3, maxPanXForIdx(activeIdx - 1)))
      : maxPanXForIdx(activeIdx - 1)

    // Animamos transX de 0 → -size.w (desliza foto actual hacia la derecha)
    animate(0, -size.w, TRANSITION_MS, v => {
      transXRef.current = v
      setTransX(v)
    }, () => {
      isTransitioning.current = false
      transXRef.current = 0
      setTransX(0)
      panXRef.current = exitPanX
      setPanX(exitPanX)
      setActiveIdx(i => i - 1)
    })
  }

  // ── Touch: panning y transición ───────────────────────────────
  const touchStartX = useRef(0)
  const touchStartPanX = useRef(0)
  const isTouching = useRef(false)
  const overshoot = useRef(0)

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
    const photoRelX = (sx + panXRef.current) / dw
    const photoRelY = sy / size.h
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

  // ── Konva event handlers ──────────────────────────────────────
  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches
    if (touches.length !== 1) return
    const t = touches[0]
    if (paintMode) {
      isDrawing.current = true
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
    } else {
      isTouching.current = true
      overshoot.current = 0
      touchStartX.current = t.clientX
      touchStartPanX.current = panXRef.current
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault()
    if (isTransitioning.current) return
    const touches = e.evt.touches
    if (touches.length !== 1) return
    const t = touches[0]

    if (paintMode && isDrawing.current) {
      const rect = stageRef.current!.container().getBoundingClientRect()
      addDrawPoint(t.clientX - rect.left, t.clientY - rect.top)
      return
    }

    if (!isTouching.current) return
    const dx = t.clientX - touchStartX.current  // positivo = dedo se movió a la derecha
    // Mover dedo a la IZQUIERDA (dx < 0) → aumentar panX (ver más a la derecha de la foto)
    const rawPanX = touchStartPanX.current - dx
    const limitedPanX = Math.max(0, Math.min(rawPanX, transitionPanXForIdx(activeIdx)))

    // Overshoot (más allá del límite) → resistencia
    const excess = rawPanX - limitedPanX
    const resistedPanX = limitedPanX + excess * 0.25
    overshoot.current = rawPanX - transitionPanXForIdx(activeIdx)  // positivo si pasa el límite derecho, negativo si pasa el izquierdo

    panXRef.current = Math.min(resistedPanX, transitionPanXForIdx(activeIdx) + size.w * 0.4)
    setPanX(panXRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, anchors])

  const handleTouchEnd = useCallback((_e: KonvaEventObject<TouchEvent>) => {
    if (paintMode && isDrawing.current) {
      isDrawing.current = false
      finishDrawing()
      return
    }
    if (!isTouching.current) return
    isTouching.current = false

    const over = overshoot.current
    if (over > TRANSITION_OVERSHOOT && activeIdx < sorted.length - 1) {
      startTransitionToNext()
    } else if (over < -TRANSITION_OVERSHOOT && activeIdx > 0) {
      startTransitionToPrev()
    } else {
      // Snap back al rango válido
      const target = Math.max(0, Math.min(panXRef.current, transitionPanXForIdx(activeIdx)))
      animate(panXRef.current, target, 180, v => {
        panXRef.current = v
        setPanX(v)
      }, () => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted.length, size, anchors])

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
  }, [paintMode, activeIdx])

  const handleMouseUp = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (!paintMode || !isDrawing.current) return
    isDrawing.current = false
    finishDrawing()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode, activeIdx, sorted])

  // ── Renderizado ───────────────────────────────────────────────
  function renderPhoto(idx: number, offsetX: number) {
    const zone = sorted[idx]
    if (!zone) return null
    const img = zoneImages[zone.id]
    const dw = displayWForIdx(idx)
    const x = offsetX
    if (img) {
      return (
        <KonvaImage key={zone.id} x={x} y={0} width={dw} height={size.h} image={img} />
      )
    }
    return (
      <Group key={zone.id}>
        <Rect x={x} y={0} width={dw} height={size.h} fill={FALLBACK_COLOR} />
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
      x: relX * dw - localPanX,
      y: p.y * size.h,
    }
  }

  function renderRoutes(idx: number, localPanX: number) {
    const zone = sorted[idx]
    const zl = layout.zones.find(z => z.id === zone?.id)
    if (!zone || !zl) return null

    const zoneRoutes = routes.filter(r => {
      if (!r.chain_id || !r.blob_path?.length) return false
      return r.blob_path.some(p => {
        const vx = p.x * layout.totalW
        return vx >= zl.virtualX && vx < zl.virtualX + zl.virtualW
      })
    })

    return zoneRoutes.map(route => {
      if (!route.blob_path || route.blob_path.length < 2) return null
      const flat = route.blob_path.flatMap(p => {
        const s = chainToScreen(p, idx, localPanX)
        return [s.x, s.y]
      })
      const centS = chainToScreen({
        x: route.blob_path.reduce((s, p) => s + p.x, 0) / route.blob_path.length,
        y: route.blob_path.reduce((s, p) => s + p.y, 0) / route.blob_path.length,
      }, idx, localPanX)

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

  // panX efectivo durante animación de transición
  // transX > 0 → deslizando hacia siguiente (foto activa va a la izquierda)
  // transX < 0 → deslizando hacia anterior (foto activa va a la derecha)
  const effectivePanX = panX + transX

  // Foto previa (visible durante transición a la izquierda)
  const showPrevPeek = transX < 0 && activeIdx > 0
  // Foto siguiente (visible durante transición a la derecha)
  const showNextPeek = transX > 0 && activeIdx < sorted.length - 1

  const prevPanX = transX < 0
    ? (() => {
        const transform = getTransform(activeIdx - 1)
        const prevDW = displayWForIdx(activeIdx - 1)
        return transform
          ? Math.max(0, transform.aTransitionX * prevDW - size.w * 0.3)
          : maxPanXForIdx(activeIdx - 1)
      })()
    : 0

  const nextEntryPanX = transX > 0
    ? (() => {
        const transform = getTransform(activeIdx)
        const nextDW = displayWForIdx(activeIdx + 1)
        return transform
          ? Math.max(0, Math.min(transform.bEntryX * nextDW, maxPanXForIdx(activeIdx + 1)))
          : 0
      })()
    : 0

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
    ? previewBlob.path.flatMap(p => {
        const s = chainToScreen(p, activeIdx, panX)
        return [s.x, s.y]
      })
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
        {/* Layer 1: Fotos */}
        <Layer listening={false}>
          {/* Foto previa durante transición hacia atrás */}
          {showPrevPeek && renderPhoto(activeIdx - 1, -displayWForIdx(activeIdx - 1) + prevPanX + size.w + Math.abs(transX))}
          {/* Foto siguiente durante transición hacia adelante */}
          {showNextPeek && renderPhoto(activeIdx + 1, displayWForIdx(activeIdx) - effectivePanX - nextEntryPanX)}
          {/* Foto activa */}
          {renderPhoto(activeIdx, -effectivePanX)}
        </Layer>

        {/* Layer 2: Rutas */}
        <Layer>
          {showPrevPeek && renderRoutes(activeIdx - 1, prevPanX - (size.w + Math.abs(transX)))}
          {showNextPeek && renderRoutes(activeIdx + 1, nextEntryPanX - (displayWForIdx(activeIdx) - effectivePanX))}
          {renderRoutes(activeIdx, effectivePanX)}
        </Layer>

        {/* Layer 3: Dibujo */}
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

      {/* Dots indicadores de zona */}
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
