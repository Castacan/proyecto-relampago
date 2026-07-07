import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAllChains, useChain } from '../../hooks/useChain'
import { CHAIN_H } from '../../lib/chain'
import type { ZoneAnchor, Zone } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type Pt = { x: number; y: number }

interface TwoPointState {
  step: 1 | 2 | 3 | 4 | 5   // 1=greenA, 2=redA, 3=greenB, 4=redB, 5=done
  greenA: Pt | null
  redA: Pt | null
  greenB: Pt | null
  redB: Pt | null
}

const STEP_LABELS: Record<number, string> = {
  1: 'Toca un punto de referencia en la foto IZQUIERDA (punto verde)',
  2: 'Toca otro punto de referencia en la foto IZQUIERDA (punto rojo)',
  3: 'Toca el mismo punto verde en la foto DERECHA',
  4: 'Toca el mismo punto rojo en la foto DERECHA',
  5: 'Puntos colocados — revisa y guarda',
}

function compute2Point(
  greenA: Pt, redA: Pt,
  greenB: Pt, redB: Pt,
  scaleA = 1, yOffsetA = 0
) {
  const dyA = greenA.y - redA.y
  const dyB = greenB.y - redB.y

  let render_scale = scaleA
  let render_y_offset = yOffsetA

  if (Math.abs(dyB) > 0.005) {
    render_scale = (dyA / dyB) * scaleA
    render_y_offset = greenA.y * CHAIN_H * scaleA + yOffsetA - greenB.y * CHAIN_H * render_scale
  }

  render_scale = Math.max(0.3, Math.min(3, render_scale))
  render_y_offset = Math.max(-CHAIN_H, Math.min(CHAIN_H, render_y_offset))

  const a_overlap_start = Math.max(0, Math.min(0.95, Math.min(greenA.x, redA.x)))
  const b_overlap_end = Math.min(1, Math.max(0.05, Math.max(greenB.x, redB.x)))

  return { render_scale, render_y_offset, a_overlap_start, b_overlap_end }
}

interface PhotoClickProps {
  zone: Zone
  label: string
  greenDot: Pt | null
  redDot: Pt | null
  active: boolean      // está esperando un click en esta foto
  onClickPhoto: (pt: Pt) => void
}

function PhotoClick({ zone, label, greenDot, redDot, active, onClickPhoto }: PhotoClickProps) {
  const imgRef = useRef<HTMLImageElement>(null)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!active) return
    const rect = e.currentTarget.getBoundingClientRect()
    onClickPhoto({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }

  return (
    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
      <p className="text-zinc-400 text-[10px] font-semibold uppercase tracking-widest truncate">{label}</p>
      <div
        className={`relative w-full rounded-xl overflow-hidden border-2 transition-colors ${
          active ? 'border-yellow-400 cursor-crosshair' : 'border-zinc-700/50 cursor-default'
        }`}
        onClick={handleClick}
      >
        {zone.image_url ? (
          <img
            ref={imgRef}
            src={zone.image_url}
            alt={zone.name}
            className="w-full block"
            draggable={false}
          />
        ) : (
          <div className="w-full aspect-video bg-zinc-800 flex items-center justify-center">
            <span className="text-zinc-600 text-xs">Sin foto</span>
          </div>
        )}

        {/* Puntos de referencia */}
        {greenDot && (
          <div
            className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg pointer-events-none"
            style={{ left: `${greenDot.x * 100}%`, top: `${greenDot.y * 100}%`, backgroundColor: '#22c55e' }}
          />
        )}
        {redDot && (
          <div
            className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg pointer-events-none"
            style={{ left: `${redDot.x * 100}%`, top: `${redDot.y * 100}%`, backgroundColor: '#ef4444' }}
          />
        )}

        {active && (
          <div className="absolute top-2 left-2 right-2 flex justify-center pointer-events-none">
            <div className="bg-yellow-400 text-zinc-950 text-[10px] font-bold px-2 py-1 rounded-full">
              Toca aquí
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface TwoPointModalProps {
  zoneA: Zone
  zoneB: Zone
  anchor: Omit<ZoneAnchor, 'id' | 'chain_id'>
  onClose: () => void
  onSave: (
    result: { a_overlap_start: number; a_overlap_end: number; b_overlap_start: number; b_overlap_end: number },
    scaleB: number,
    yOffsetB: number
  ) => Promise<void>
}

function TwoPointModal({ zoneA, zoneB, onClose, onSave }: TwoPointModalProps) {
  const [state, setState] = useState<TwoPointState>({
    step: 1, greenA: null, redA: null, greenB: null, redB: null,
  })
  const [saving, setSaving] = useState(false)

  function handleClickA(pt: Pt) {
    if (state.step === 1) setState(s => ({ ...s, step: 2, greenA: pt }))
    else if (state.step === 2) setState(s => ({ ...s, step: 3, redA: pt }))
  }

  function handleClickB(pt: Pt) {
    if (state.step === 3) setState(s => ({ ...s, step: 4, greenB: pt }))
    else if (state.step === 4) setState(s => ({ ...s, step: 5, redB: pt }))
  }

  async function handleSave() {
    if (!state.greenA || !state.redA || !state.greenB || !state.redB) return
    setSaving(true)
    const { render_scale, render_y_offset, a_overlap_start, b_overlap_end } = compute2Point(
      state.greenA, state.redA, state.greenB, state.redB,
      zoneA.render_scale ?? 1, zoneA.render_y_offset ?? 0
    )
    await onSave(
      { a_overlap_start, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end },
      render_scale,
      render_y_offset
    )
    setSaving(false)
    onClose()
  }

  const activeA = state.step === 1 || state.step === 2
  const activeB = state.step === 3 || state.step === 4

  return (
    <div className="fixed inset-0 bg-zinc-950/95 z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-white font-bold text-sm">{zoneA.name} → {zoneB.name}</span>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white text-xl">×</button>
      </div>

      {/* Step indicator */}
      <div className="shrink-0 px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-1.5">
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                state.step > s ? 'bg-yellow-400' :
                state.step === s ? 'bg-yellow-400/60' : 'bg-zinc-700'
              }`}
            />
          ))}
        </div>
        <p className="text-yellow-400 text-xs font-semibold">{STEP_LABELS[state.step]}</p>
      </div>

      {/* Fotos */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <PhotoClick
          zone={zoneA}
          label={zoneA.name}
          greenDot={state.greenA}
          redDot={state.redA}
          active={activeA}
          onClickPhoto={handleClickA}
        />
        <PhotoClick
          zone={zoneB}
          label={zoneB.name}
          greenDot={state.greenB}
          redDot={state.redB}
          active={activeB}
          onClickPhoto={handleClickB}
        />
      </div>

      {/* Actions */}
      <div className="shrink-0 px-4 py-4 border-t border-zinc-800 flex gap-3">
        <button
          onClick={() => setState({ step: 1, greenA: null, redA: null, greenB: null, redB: null })}
          className="flex-1 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-semibold text-sm hover:bg-zinc-700 transition-all"
        >
          Reiniciar
        </button>
        <button
          onClick={handleSave}
          disabled={state.step !== 5 || saving}
          className="flex-1 py-3 rounded-2xl bg-yellow-400 text-zinc-950 font-bold text-sm disabled:opacity-40 hover:bg-yellow-300 transition-all"
        >
          {saving ? 'Guardando...' : 'Calcular y Guardar'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Slider calibration view (existing)
// ────────────────────────────────────────────────────────────

interface SliderPhotoProps {
  zone: Zone
  overlapX: number
  side: 'left' | 'right'
  label: string
  onChange: (v: number) => void
}

function SliderPhoto({ zone, overlapX, side, label, onChange }: SliderPhotoProps) {
  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <p className="text-zinc-400 text-[10px] font-semibold uppercase tracking-widest truncate text-center">{label}</p>
      <div className="relative w-full aspect-video bg-zinc-800 rounded-xl overflow-hidden border border-zinc-700/50">
        {zone.image_url ? (
          <img src={zone.image_url} alt={zone.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Sin foto</div>
        )}
        <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-400/80" style={{ left: `${overlapX * 100}%` }} />
        {side === 'left' && <div className="absolute top-0 bottom-0 bg-yellow-400/10" style={{ left: `${overlapX * 100}%`, right: 0 }} />}
        {side === 'right' && <div className="absolute top-0 bottom-0 bg-yellow-400/10" style={{ left: 0, width: `${overlapX * 100}%` }} />}
        <div className="absolute left-0 right-0 border-t border-dashed border-white/20" style={{ top: '50%' }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs w-8 text-right">{Math.round(overlapX * 100)}%</span>
        <input type="range" min={0} max={100} value={Math.round(overlapX * 100)}
          onChange={e => onChange(Number(e.target.value) / 100)}
          className="flex-1 accent-yellow-400" />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────

export default function CalibrationPage() {
  const { chains, loading: chainsLoading } = useAllChains()
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const { zones, anchors: existingAnchors, loading: chainLoading } = useChain(selectedChainId)

  const [localAnchors, setLocalAnchors] = useState<Record<string, Omit<ZoneAnchor, 'id' | 'chain_id'>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [twoPointPair, setTwoPointPair] = useState<string | null>(null)

  useEffect(() => {
    const init: Record<string, Omit<ZoneAnchor, 'id' | 'chain_id'>> = {}
    for (let i = 0; i < zones.length - 1; i++) {
      const za = zones[i]; const zb = zones[i + 1]
      const key = `${za.id}-${zb.id}`
      const existing = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
      init[key] = existing
        ? { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: existing.a_overlap_start, a_overlap_end: existing.a_overlap_end, b_overlap_start: existing.b_overlap_start, b_overlap_end: existing.b_overlap_end }
        : { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: 0.8, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end: 0.2 }
    }
    setLocalAnchors(init)
  }, [zones, existingAnchors])

  async function saveAnchor(za: Zone, zb: Zone, anchorData?: Omit<ZoneAnchor, 'id' | 'chain_id'>) {
    if (!selectedChainId) return
    const key = `${za.id}-${zb.id}`
    const data = anchorData ?? localAnchors[key]
    if (!data) return
    setSaving(key)
    const existing = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
    if (existing) {
      await db.from('zone_anchors').update(data).eq('id', existing.id)
    } else {
      await db.from('zone_anchors').insert({ chain_id: selectedChainId, ...data })
    }
    setSaving(null)
    setSaved(key)
    setTimeout(() => setSaved(null), 2000)
  }

  async function handle2PointSave(
    za: Zone, zb: Zone,
    anchorResult: { a_overlap_start: number; a_overlap_end: number; b_overlap_start: number; b_overlap_end: number },
    scaleB: number,
    yOffsetB: number
  ) {
    const key = `${za.id}-${zb.id}`
    const fullAnchor: Omit<ZoneAnchor, 'id' | 'chain_id'> = {
      zone_a_id: za.id,
      zone_b_id: zb.id,
      a_overlap_start: anchorResult.a_overlap_start,
      a_overlap_end: anchorResult.a_overlap_end,
      b_overlap_start: anchorResult.b_overlap_start,
      b_overlap_end: anchorResult.b_overlap_end,
    }
    setLocalAnchors(prev => ({ ...prev, [key]: fullAnchor }))

    await Promise.all([
      saveAnchor(za, zb, fullAnchor),
      db.from('zones').update({ render_scale: scaleB, render_y_offset: yOffsetB }).eq('id', zb.id),
    ])
  }

  const sortedZones = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-8">
        <h1 className="text-white font-black text-2xl tracking-tight mb-1">Calibración</h1>
        <p className="text-zinc-500 text-sm mb-6">Ajusta los overlaps y la escala entre fotos consecutivas.</p>

        {chainsLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : chains.length === 0 ? (
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800/80 text-center">
            <p className="text-zinc-500 text-sm">No hay cadenas creadas.</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-6 flex-wrap">
              {chains.map(c => (
                <button key={c.id} onClick={() => setSelectedChainId(c.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    selectedChainId === c.id ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                  }`}>{c.name}</button>
              ))}
            </div>

            {selectedChainId && (
              chainLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                </div>
              ) : sortedZones.length < 2 ? (
                <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800/80 text-center">
                  <p className="text-zinc-500 text-sm">Necesitas al menos 2 zonas para calibrar.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {sortedZones.slice(0, -1).map((za, i) => {
                    const zb = sortedZones[i + 1]
                    const key = `${za.id}-${zb.id}`
                    const anchor = localAnchors[key] ?? { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: 0.8, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end: 0.2 }
                    const isSaving = saving === key
                    const wasSaved = saved === key

                    return (
                      <div key={key} className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-white font-bold text-sm">{za.name} → {zb.name}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setTwoPointPair(key)}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-all border border-zinc-600"
                            >
                              2 puntos
                            </button>
                            <button
                              onClick={() => saveAnchor(za, zb)}
                              disabled={isSaving}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                wasSaved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-yellow-400 text-zinc-950 hover:bg-yellow-300 disabled:opacity-50'
                              }`}
                            >
                              {isSaving ? '...' : wasSaved ? '✓' : 'Guardar'}
                            </button>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <SliderPhoto
                            zone={za}
                            overlapX={anchor.a_overlap_start}
                            side="left"
                            label={za.name}
                            onChange={v => setLocalAnchors(prev => ({ ...prev, [key]: { ...anchor, a_overlap_start: v } }))}
                          />
                          <SliderPhoto
                            zone={zb}
                            overlapX={anchor.b_overlap_end}
                            side="right"
                            label={zb.name}
                            onChange={v => setLocalAnchors(prev => ({ ...prev, [key]: { ...anchor, b_overlap_end: v } }))}
                          />
                        </div>
                        <p className="text-zinc-600 text-xs mt-2.5 text-center">
                          Mueve las líneas hasta que el contenido del overlap coincida — o usa "2 puntos" para ajuste automático de escala.
                        </p>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Modal de 2 puntos */}
      {twoPointPair && (() => {
        const za = sortedZones.find(z => twoPointPair.startsWith(z.id))
        const zb = sortedZones.find(z => twoPointPair.endsWith(z.id) && z.id !== za?.id)
        if (!za || !zb) return null
        const anchor = localAnchors[twoPointPair] ?? { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: 0.8, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end: 0.2 }
        return (
          <TwoPointModal
            zoneA={za}
            zoneB={zb}
            anchor={anchor}
            onClose={() => setTwoPointPair(null)}
            onSave={(anchorResult, scaleB, yOffsetB) => handle2PointSave(za, zb, anchorResult, scaleB, yOffsetB)}
          />
        )
      })()}
    </div>
  )
}
