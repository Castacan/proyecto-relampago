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

export default function SpraywallCanvas({
  photoUrl, photoW, photoH, holds, mode,
  activeRole, selectedIndex = null, onSelectIndex, onHoldsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!photoUrl) return
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => setImg(image)
    image.src = photoUrl
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
  const scale = Math.min(size.w / naturalW, size.h / naturalH) || 1
  const dw = naturalW * scale
  const dh = naturalH * scale
  const offsetX = (size.w - dw) / 2
  const offsetY = (size.h - dh) / 2
  const radius = Math.max(9, dw * 0.022)

  function toNormalized(px: number, py: number): { x: number; y: number } | null {
    const x = (px - offsetX) / dw
    const y = (py - offsetY) / dh
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (mode !== 'edit' || !activeRole || !onHoldsChange) return
    if (e.target !== e.target.getStage()) return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
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
    <div ref={containerRef} className="w-full h-full relative bg-zinc-900">
      <Stage width={size.w} height={size.h} onClick={handleStageClick} onTap={handleStageClick}>
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
    </div>
  )
}
