import { useState, useEffect } from 'react'
import { useAllChains, useChain } from '../../hooks/useChain'
import type { ZoneAnchor, Zone } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from '../../lib/supabase'
const db = supabase as unknown as any

interface SliderPhotoProps {
  zone: Zone
  overlapX: number
  side: 'left' | 'right'
  onChange: (v: number) => void
}

function SliderPhoto({ zone, overlapX, side, onChange }: SliderPhotoProps) {
  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest truncate text-center">
        {zone.name}
      </p>
      <div className="relative w-full aspect-video bg-zinc-800 rounded-xl overflow-hidden border border-zinc-700/50">
        {zone.image_url ? (
          <img src={zone.image_url} alt={zone.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Sin foto</div>
        )}

        {/* Línea de corte */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-400"
          style={{ left: `${overlapX * 100}%` }}
        />

        {/* Área de overlap sombreada */}
        {side === 'left' && (
          <div className="absolute top-0 bottom-0 bg-yellow-400/15" style={{ left: `${overlapX * 100}%`, right: 0 }} />
        )}
        {side === 'right' && (
          <div className="absolute top-0 bottom-0 bg-yellow-400/15" style={{ left: 0, width: `${overlapX * 100}%` }} />
        )}

        {/* Porcentaje */}
        <div
          className="absolute bottom-1.5 text-yellow-400 text-[10px] font-bold pointer-events-none"
          style={{ left: side === 'left' ? `${overlapX * 100 + 1}%` : undefined, right: side === 'right' ? `${(1 - overlapX) * 100 + 1}%` : undefined }}
        >
          {Math.round(overlapX * 100)}%
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(overlapX * 100)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="w-full accent-yellow-400"
      />
    </div>
  )
}

export default function CalibrationPage() {
  const { chains, loading: chainsLoading } = useAllChains()
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const { zones, anchors: existingAnchors, loading: chainLoading, refetch } = useChain(selectedChainId)

  const [localAnchors, setLocalAnchors] = useState<Record<string, Omit<ZoneAnchor, 'id' | 'chain_id'>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const sortedZones = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  useEffect(() => {
    const init: Record<string, Omit<ZoneAnchor, 'id' | 'chain_id'>> = {}
    for (let i = 0; i < sortedZones.length - 1; i++) {
      const za = sortedZones[i]
      const zb = sortedZones[i + 1]
      const key = `${za.id}-${zb.id}`
      const ex = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
      init[key] = ex
        ? { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: ex.a_overlap_start, a_overlap_end: ex.a_overlap_end, b_overlap_start: ex.b_overlap_start, b_overlap_end: ex.b_overlap_end }
        : { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: 0.75, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end: 0.25 }
    }
    setLocalAnchors(init)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, existingAnchors])

  async function handleSave(za: Zone, zb: Zone) {
    if (!selectedChainId) return
    const key = `${za.id}-${zb.id}`
    const data = localAnchors[key]
    if (!data) return
    setSaving(key)
    const existing = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
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
          Mueve las líneas amarillas para definir dónde empieza y termina la zona de transición entre fotos.
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
                <div className="space-y-6">
                  {sortedZones.slice(0, -1).map((za, i) => {
                    const zb = sortedZones[i + 1]
                    const key = `${za.id}-${zb.id}`
                    const anchor = localAnchors[key] ?? { zone_a_id: za.id, zone_b_id: zb.id, a_overlap_start: 0.75, a_overlap_end: 1.0, b_overlap_start: 0.0, b_overlap_end: 0.25 }
                    const isSaving = saving === key
                    const wasSaved = saved === key

                    return (
                      <div key={key} className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-white font-bold text-sm">{za.name} → {zb.name}</p>
                          <button
                            onClick={() => handleSave(za, zb)}
                            disabled={isSaving}
                            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                              wasSaved
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-yellow-400 text-zinc-950 hover:bg-yellow-300 disabled:opacity-50'
                            }`}
                          >
                            {isSaving ? 'Guardando...' : wasSaved ? '✓ Guardado' : 'Guardar'}
                          </button>
                        </div>

                        <div className="flex gap-4">
                          <SliderPhoto
                            zone={za}
                            overlapX={anchor.a_overlap_start}
                            side="left"
                            onChange={v => setLocalAnchors(prev => ({ ...prev, [key]: { ...anchor, a_overlap_start: v } }))}
                          />
                          <SliderPhoto
                            zone={zb}
                            overlapX={anchor.b_overlap_end}
                            side="right"
                            onChange={v => setLocalAnchors(prev => ({ ...prev, [key]: { ...anchor, b_overlap_end: v } }))}
                          />
                        </div>

                        <p className="text-zinc-600 text-xs mt-3 text-center">
                          Línea izquierda: dónde empieza la transición en esta foto. Línea derecha: dónde termina en la siguiente.
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
    </div>
  )
}
