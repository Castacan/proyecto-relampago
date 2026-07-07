import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAllChains, useChain } from '../../hooks/useChain'
import { CHAIN_H } from '../../lib/chain'
import type { ZoneAnchor, Zone } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type Pt = { x: number; y: number }

type Step = 1 | 2 | 3 | 4 | 5

interface TwoPointState {
  step: Step
  greenA: Pt | null
  redA: Pt | null
  greenB: Pt | null
  redB: Pt | null
}

const STEP_HINTS: Record<Step, string> = {
  1: 'Toca un punto reconocible en la foto IZQUIERDA — aparecerá verde',
  2: 'Toca otro punto diferente en la foto IZQUIERDA — aparecerá rojo',
  3: 'Toca el mismo punto verde en la foto DERECHA',
  4: 'Toca el mismo punto rojo en la foto DERECHA',
  5: '4 puntos colocados — ya puedes guardar',
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
  active: boolean
  onClickPhoto: (pt: Pt) => void
}

function PhotoClick({ zone, label, greenDot, redDot, active, onClickPhoto }: PhotoClickProps) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!active) return
    const rect = e.currentTarget.getBoundingClientRect()
    onClickPhoto({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">{label}</p>
      <div
        className={`relative w-full rounded-xl overflow-hidden border-2 transition-all ${
          active
            ? 'border-yellow-400 shadow-lg shadow-yellow-400/10 cursor-crosshair'
            : 'border-zinc-700/40 cursor-default'
        }`}
        onClick={handleClick}
      >
        {zone.image_url ? (
          <img src={zone.image_url} alt={zone.name} className="w-full block" draggable={false} />
        ) : (
          <div className="w-full aspect-video bg-zinc-800 flex items-center justify-center">
            <span className="text-zinc-600 text-xs">Sin foto</span>
          </div>
        )}

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
          <div className="absolute top-2 inset-x-2 flex justify-center pointer-events-none">
            <span className="bg-yellow-400 text-zinc-950 text-[10px] font-bold px-2.5 py-1 rounded-full shadow">
              Toca aquí
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface CalibModalProps {
  zoneA: Zone
  zoneB: Zone
  chainId: string
  existingAnchor: ZoneAnchor | null
  onClose: () => void
  onSaved: () => void
}

function CalibModal({ zoneA, zoneB, chainId, existingAnchor, onClose, onSaved }: CalibModalProps) {
  const [state, setState] = useState<TwoPointState>({
    step: 1, greenA: null, redA: null, greenB: null, redB: null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleClickA(pt: Pt) {
    if (state.step === 1) setState(s => ({ ...s, step: 2, greenA: pt }))
    else if (state.step === 2) setState(s => ({ ...s, step: 3, redA: pt }))
  }

  function handleClickB(pt: Pt) {
    if (state.step === 3) setState(s => ({ ...s, step: 4, greenB: pt }))
    else if (state.step === 4) setState(s => ({ ...s, step: 5, redB: pt }))
  }

  async function handleSave() {
    const { greenA, redA, greenB, redB } = state
    if (!greenA || !redA || !greenB || !redB) return
    setSaving(true)
    setError('')

    const { render_scale, render_y_offset, a_overlap_start, b_overlap_end } = compute2Point(
      greenA, redA, greenB, redB,
      zoneA.render_scale ?? 1, zoneA.render_y_offset ?? 0
    )

    const anchorData = {
      zone_a_id: zoneA.id,
      zone_b_id: zoneB.id,
      a_overlap_start,
      a_overlap_end: 1.0,
      b_overlap_start: 0.0,
      b_overlap_end,
    }

    const [anchorRes, zoneRes] = await Promise.all([
      existingAnchor
        ? db.from('zone_anchors').update(anchorData).eq('id', existingAnchor.id)
        : db.from('zone_anchors').insert({ chain_id: chainId, ...anchorData }),
      db.from('zones').update({ render_scale, render_y_offset }).eq('id', zoneB.id),
    ])

    setSaving(false)
    if (anchorRes.error || zoneRes.error) {
      setError('Error al guardar. Verifica que corriste el SQL de las columnas render_scale/render_y_offset.')
      return
    }

    onSaved()
    onClose()
  }

  const activeA = state.step === 1 || state.step === 2
  const activeB = state.step === 3 || state.step === 4
  const progress = state.step - 1  // 0-4

  return (
    <div className="fixed inset-0 bg-zinc-950 z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800/80">
        <div>
          <p className="text-white font-bold text-sm">{zoneA.name} → {zoneB.name}</p>
          <p className="text-zinc-500 text-xs">Calibración de 2 puntos</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white text-xl leading-none"
        >×</button>
      </div>

      {/* Progress + hint */}
      <div className="shrink-0 px-4 py-3 bg-zinc-900/80 border-b border-zinc-800/60">
        <div className="flex gap-1.5 mb-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              progress >= s ? 'bg-yellow-400' : progress === s - 1 ? 'bg-yellow-400/40' : 'bg-zinc-700'
            }`} />
          ))}
        </div>
        <p className="text-yellow-400 text-xs font-semibold leading-snug">{STEP_HINTS[state.step]}</p>
      </div>

      {/* Fotos */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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

      {/* Footer */}
      <div className="shrink-0 px-4 py-4 border-t border-zinc-800/80 space-y-2">
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => setState({ step: 1, greenA: null, redA: null, greenB: null, redB: null })}
            className="flex-1 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-semibold text-sm hover:bg-zinc-700 transition-all"
          >
            Reiniciar
          </button>
          <button
            onClick={handleSave}
            disabled={state.step !== 5 || saving}
            className="flex-1 py-3 rounded-2xl bg-yellow-400 text-zinc-950 font-bold text-sm disabled:opacity-40 hover:bg-yellow-300 active:scale-[0.98] transition-all"
          >
            {saving ? 'Guardando...' : 'Calcular y Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

export default function CalibrationPage() {
  const { chains, loading: chainsLoading } = useAllChains()
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const { zones, anchors, loading: chainLoading, refetch } = useChain(selectedChainId)
  const [activePair, setActivePair] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState<string | null>(null)

  const sortedZones = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  function handleSaved(key: string) {
    refetch()
    setJustSaved(key)
    setTimeout(() => setJustSaved(null), 3000)
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-8">
        <h1 className="text-white font-black text-2xl tracking-tight mb-1">Calibración</h1>
        <p className="text-zinc-500 text-sm mb-6">
          Marca 2 puntos en cada foto para que el sistema calcule escala, alineación vertical y overlap automáticamente.
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
            {/* Selector de cadena */}
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
                <div className="space-y-4">
                  {sortedZones.slice(0, -1).map((za, i) => {
                    const zb = sortedZones[i + 1]
                    const key = `${za.id}-${zb.id}`
                    const existingAnchor = anchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id) ?? null
                    const isSaved = justSaved === key
                    const isCalibrated = !!existingAnchor

                    return (
                      <div key={key} className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-white font-bold text-sm">{za.name} → {zb.name}</p>
                            <p className={`text-xs font-medium mt-0.5 ${isCalibrated ? 'text-green-400' : 'text-zinc-500'}`}>
                              {isSaved ? '✓ Guardado' : isCalibrated ? 'Calibrado' : 'Sin calibrar'}
                            </p>
                          </div>
                          <button
                            onClick={() => setActivePair(key)}
                            className="px-4 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-zinc-950 hover:bg-yellow-300 active:scale-95 transition-all"
                          >
                            Calibrar
                          </button>
                        </div>

                        {/* Mini preview de las dos fotos */}
                        <div className="flex gap-2">
                          {[za, zb].map(z => (
                            <div key={z.id} className="flex-1 aspect-video rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700/40">
                              {z.image_url
                                ? <img src={z.image_url} alt={z.name} className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center"><span className="text-zinc-600 text-[10px]">Sin foto</span></div>
                              }
                            </div>
                          ))}
                        </div>

                        {isCalibrated && (
                          <p className="text-zinc-600 text-[10px] mt-2">
                            overlap: {Math.round(existingAnchor.a_overlap_start * 100)}% · escala: {((zb.render_scale ?? 1) * 100).toFixed(0)}% · offset: {Math.round(zb.render_y_offset ?? 0)}px
                          </p>
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

      {/* Modal de calibración */}
      {activePair && selectedChainId && (() => {
        const za = sortedZones.find(z => activePair.startsWith(z.id))
        const zb = sortedZones.find(z => activePair.endsWith(z.id) && z.id !== za?.id)
        if (!za || !zb) return null
        const existingAnchor = anchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id) ?? null
        return (
          <CalibModal
            zoneA={za}
            zoneB={zb}
            chainId={selectedChainId}
            existingAnchor={existingAnchor}
            onClose={() => setActivePair(null)}
            onSaved={() => handleSaved(activePair)}
          />
        )
      })()}
    </div>
  )
}
