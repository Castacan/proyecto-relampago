import { useState, useEffect, useRef, useCallback } from 'react'
import { useAllChains, useChain } from '../../hooks/useChain'
import type { Zone, ZoneAnchor, PointPair } from '../../types'
import { computeAnchorTransform } from '../../lib/chain'

import { supabase } from '../../lib/supabase'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const PAIR_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899']
const MAX_PAIRS = 6

// Calcula el rect de display de la imagen dentro del container (object-contain con letterboxing)
function getDisplayRect(cw: number, ch: number, nw: number, nh: number) {
  if (!nw || !nh || !cw || !ch) return { ox: 0, oy: 0, dw: cw, dh: ch }
  if (cw / ch > nw / nh) {
    const dh = ch; const dw = dh * nw / nh
    return { ox: (cw - dw) / 2, oy: 0, dw, dh }
  } else {
    const dw = cw; const dh = dw * nh / nw
    return { ox: 0, oy: (ch - dh) / 2, dw, dh }
  }
}

interface PhotoPanelProps {
  zone: Zone
  pairs: PointPair[]
  side: 'a' | 'b'
  waitingForClick: boolean
  onPhotoClick: (p: { x: number; y: number }) => void
}

function PhotoPanel({ zone, pairs, side, waitingForClick, onPhotoClick }: PhotoPanelProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  // Observa el tamaño del container para calcular el letterboxing en tiempo real
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    setContainerSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => ro.disconnect()
  }, [])

  const dr = useCallback(() => {
    const img = imgRef.current
    if (!img) return { ox: 0, oy: 0, dw: containerSize.w, dh: containerSize.h }
    return getDisplayRect(containerSize.w, containerSize.h, img.naturalWidth, img.naturalHeight)
  }, [containerSize])()

  function dotStyle(p: { x: number; y: number }) {
    if (!containerSize.w || !containerSize.h || !dr.dw || !dr.dh) return {}
    return {
      left: `${((dr.ox + p.x * dr.dw) / containerSize.w) * 100}%`,
      top: `${((dr.oy + p.y * dr.dh) / containerSize.h) * 100}%`,
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!waitingForClick) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const img = imgRef.current
    const { ox, oy, dw, dh } = img
      ? getDisplayRect(rect.width, rect.height, img.naturalWidth, img.naturalHeight)
      : { ox: 0, oy: 0, dw: rect.width, dh: rect.height }
    const px = (cx - ox) / dw
    const py = (cy - oy) / dh
    if (px < 0 || px > 1 || py < 0 || py > 1) return
    onPhotoClick({ x: px, y: py })
  }

  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest text-center truncate">
        {zone.name}
      </p>
      <div
        ref={containerRef}
        className={`relative w-full aspect-video bg-zinc-800 rounded-xl overflow-hidden border transition-all ${
          waitingForClick
            ? 'border-yellow-400 cursor-crosshair shadow-[0_0_0_2px_rgba(250,204,21,0.3)]'
            : 'border-zinc-700/50 cursor-default'
        }`}
        onClick={handleClick}
      >
        {zone.image_url ? (
          <img
            ref={imgRef}
            src={zone.image_url}
            alt={zone.name}
            className="w-full h-full object-contain"
            draggable={false}
            onLoad={() => setContainerSize(s => ({ ...s }))}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Sin foto</div>
        )}

        {/* Puntos de calibración — posicionados con offset de letterboxing */}
        {pairs.map((pair, i) => {
          const p = side === 'a' ? pair.a : pair.b
          return (
            <div
              key={i}
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 pointer-events-none"
              style={{
                ...dotStyle(p),
                backgroundColor: PAIR_COLORS[i % PAIR_COLORS.length],
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-white leading-none">
                {i + 1}
              </span>
            </div>
          )
        })}

        {/* Indicador cuando está esperando click */}
        {waitingForClick && (
          <div className="absolute top-2 left-0 right-0 flex justify-center pointer-events-none">
            <div className="bg-yellow-400 text-zinc-950 text-[10px] font-black px-2 py-0.5 rounded-full">
              Toca un punto
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CalibrationPage() {
  const { chains, loading: chainsLoading } = useAllChains()
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const { zones, anchors: existingAnchors, loading: chainLoading, refetch } = useChain(selectedChainId)

  const sortedZones = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  // Por cada par de zonas: estado de pares de puntos
  const [pairsMap, setPairsMap] = useState<Record<string, PointPair[]>>({})
  const [pendingA, setPendingA] = useState<Record<string, { x: number; y: number } | null>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    const init: Record<string, PointPair[]> = {}
    for (let i = 0; i < sortedZones.length - 1; i++) {
      const za = sortedZones[i]
      const zb = sortedZones[i + 1]
      const key = `${za.id}-${zb.id}`
      const ex = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
      init[key] = ex?.point_pairs ?? []
    }
    setPairsMap(init)
    setPendingA({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, existingAnchors])

  function handleClickA(key: string, p: { x: number; y: number }) {
    setPendingA(prev => ({ ...prev, [key]: p }))
  }

  function handleClickB(key: string, p: { x: number; y: number }) {
    const a = pendingA[key]
    if (!a) return
    const currentPairs = pairsMap[key] ?? []
    if (currentPairs.length >= MAX_PAIRS) return
    setPairsMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), { a, b: p }] }))
    setPendingA(prev => ({ ...prev, [key]: null }))
  }

  function removePair(key: string, idx: number) {
    setPairsMap(prev => ({ ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== idx) }))
  }

  function cancelPending(key: string) {
    setPendingA(prev => ({ ...prev, [key]: null }))
  }

  async function handleSave(za: Zone, zb: Zone) {
    if (!selectedChainId) return
    const key = `${za.id}-${zb.id}`
    const pairs = pairsMap[key] ?? []
    const transform = computeAnchorTransform(pairs)
    setSaving(key)

    const existing = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
    const data: Partial<ZoneAnchor> & { point_pairs: PointPair[] } = {
      zone_a_id: za.id,
      zone_b_id: zb.id,
      // Mantener backward compat con columnas antiguas
      a_overlap_start: transform.aTransitionX,
      a_overlap_end: 1.0,
      b_overlap_start: 0.0,
      b_overlap_end: transform.bEntryX,
      point_pairs: pairs,
    }

    if (existing) {
      await db.from('zone_anchors').update(data).eq('id', existing.id)
    } else {
      await db.from('zone_anchors').insert({ chain_id: selectedChainId, ...data })
    }

    refetch()
    setSaving(null)
    setSaved(key)
    setTimeout(() => setSaved(null), 2500)
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-8">
        <h1 className="text-white font-black text-2xl tracking-tight mb-1">Calibración</h1>
        <p className="text-zinc-500 text-sm mb-6">
          Toca el mismo punto físico en ambas fotos para crear un par. Añade 3-6 pares para mayor precisión.
        </p>

        {chainsLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : chains.length === 0 ? (
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 text-center">
            <p className="text-zinc-500 text-sm">No hay cadenas creadas.</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-6 flex-wrap">
              {chains.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChainId(c.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    selectedChainId === c.id
                      ? 'bg-yellow-400 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {selectedChainId && (
              chainLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                </div>
              ) : sortedZones.length < 2 ? (
                <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 text-center">
                  <p className="text-zinc-500 text-sm">Necesitas al menos 2 zonas en esta cadena.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {sortedZones.slice(0, -1).map((za, i) => {
                    const zb = sortedZones[i + 1]
                    const key = `${za.id}-${zb.id}`
                    const pairs = pairsMap[key] ?? []
                    const pending = pendingA[key] ?? null
                    const transform = computeAnchorTransform(pairs)
                    const isSaving = saving === key
                    const wasSaved = saved === key
                    const waitingA = !pending && pairs.length < MAX_PAIRS
                    const waitingB = !!pending

                    return (
                      <div key={key} className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="text-white font-bold text-sm">{za.name} → {zb.name}</p>
                            {pairs.length > 0 && (
                              <p className="text-zinc-500 text-xs mt-0.5">
                                {pairs.length} par{pairs.length !== 1 ? 'es' : ''} ·
                                transición A en {Math.round(transform.aTransitionX * 100)}% ·
                                entrada B en {Math.round(transform.bEntryX * 100)}%
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleSave(za, zb)}
                            disabled={isSaving || pairs.length === 0}
                            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                              wasSaved
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-yellow-400 text-zinc-950 hover:bg-yellow-300 disabled:opacity-40'
                            }`}
                          >
                            {isSaving ? 'Guardando…' : wasSaved ? '✓ Guardado' : 'Guardar'}
                          </button>
                        </div>

                        {/* Instrucción de paso actual */}
                        <div className="mb-3 text-center">
                          {pending ? (
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-yellow-400 text-xs font-bold">
                                Paso 2: toca el mismo punto en {zb.name}
                              </span>
                              <button
                                onClick={() => cancelPending(key)}
                                className="text-zinc-500 text-xs underline"
                              >
                                cancelar
                              </button>
                            </div>
                          ) : pairs.length < MAX_PAIRS ? (
                            <span className="text-zinc-500 text-xs">
                              Paso 1: toca un punto reconocible en {za.name}
                            </span>
                          ) : (
                            <span className="text-zinc-500 text-xs">Máximo de pares alcanzado</span>
                          )}
                        </div>

                        {/* Fotos */}
                        <div className="flex gap-3">
                          <PhotoPanel
                            zone={za}
                            pairs={pairs}
                            side="a"
                            waitingForClick={waitingA}
                            onPhotoClick={p => handleClickA(key, p)}
                          />
                          <PhotoPanel
                            zone={zb}
                            pairs={pairs}
                            side="b"
                            waitingForClick={waitingB}
                            onPhotoClick={p => handleClickB(key, p)}
                          />
                        </div>

                        {/* Lista de pares */}
                        {pairs.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {pairs.map((_, pi) => (
                              <div
                                key={pi}
                                className="flex items-center gap-1.5 bg-zinc-800 rounded-full px-2.5 py-1"
                              >
                                <div
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: PAIR_COLORS[pi % PAIR_COLORS.length] }}
                                />
                                <span className="text-zinc-300 text-xs font-bold">Par {pi + 1}</span>
                                <button
                                  onClick={() => removePair(key, pi)}
                                  className="text-zinc-500 hover:text-red-400 text-xs ml-0.5 leading-none"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}
