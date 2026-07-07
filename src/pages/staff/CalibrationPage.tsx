import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAllChains, useChain } from '../../hooks/useChain'
import type { ZoneAnchor, Zone } from '../../types'

interface PhotoViewProps {
  zone: Zone
  overlapX: number      // 0.0 a 1.0 — posición de la línea de corte
  side: 'left' | 'right'
  label: string
  onChange: (v: number) => void
}

function CalibrationPhotoView({ zone, overlapX, side, label, onChange }: PhotoViewProps) {
  return (
    <div className="flex-1 flex flex-col gap-2">
      <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest text-center">{label}</p>
      <div className="relative w-full aspect-video bg-zinc-800 rounded-xl overflow-hidden border border-zinc-700/50">
        {zone.image_url ? (
          <img src={zone.image_url} alt={zone.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs font-medium">Sin foto</div>
        )}
        {/* Línea de corte */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-400/80"
          style={{ left: `${overlapX * 100}%` }}
        />
        {/* Área de overlap sombreada */}
        {side === 'left' && (
          <div
            className="absolute top-0 bottom-0 bg-yellow-400/10"
            style={{ left: `${overlapX * 100}%`, right: 0 }}
          />
        )}
        {side === 'right' && (
          <div
            className="absolute top-0 bottom-0 bg-yellow-400/10"
            style={{ left: 0, width: `${overlapX * 100}%` }}
          />
        )}
        {/* Línea de verificación (horizontal a media altura) */}
        <div className="absolute left-0 right-0 border-t border-dashed border-white/20" style={{ top: '50%' }} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-zinc-500 text-xs w-8 text-right">{Math.round(overlapX * 100)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlapX * 100)}
          onChange={e => onChange(Number(e.target.value) / 100)}
          className="flex-1 accent-yellow-400"
        />
      </div>
    </div>
  )
}

export default function CalibrationPage() {
  const { chains, loading: chainsLoading } = useAllChains()
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const { zones, anchors: existingAnchors, loading: chainLoading } = useChain(selectedChainId)

  // Local anchor edits: keyed by "zoneAId-zoneBId"
  const [localAnchors, setLocalAnchors] = useState<Record<string, Omit<ZoneAnchor, 'id' | 'chain_id'>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Sync from DB anchors when chain loads
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

  async function handleSave(za: Zone, zb: Zone) {
    if (!selectedChainId) return
    const key = `${za.id}-${zb.id}`
    const data = localAnchors[key]
    if (!data) return
    setSaving(key)
    const existing = existingAnchors.find(a => a.zone_a_id === za.id && a.zone_b_id === zb.id)
    if (existing) {
      await supabase.from('zone_anchors').update(data as unknown as never).eq('id', existing.id)
    } else {
      await supabase.from('zone_anchors').insert({ chain_id: selectedChainId, ...data } as unknown as never)
    }
    setSaving(null)
    setSaved(key)
    setTimeout(() => setSaved(null), 2000)
  }

  const sortedZones = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-8">
        <h1 className="text-white font-black text-2xl tracking-tight mb-1">Calibración</h1>
        <p className="text-zinc-500 text-sm mb-6">Ajusta los overlaps entre fotos consecutivas de cada cadena.</p>

        {/* Selector de cadena */}
        {chainsLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : chains.length === 0 ? (
          <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800/80 text-center">
            <p className="text-zinc-500 text-sm">No hay cadenas creadas todavía.</p>
            <p className="text-zinc-600 text-xs mt-1">Crea una cadena en la tabla "chains" de Supabase y asigna zonas a ella.</p>
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
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                </div>
              ) : sortedZones.length < 2 ? (
                <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800/80 text-center">
                  <p className="text-zinc-500 text-sm">Esta cadena tiene {sortedZones.length} zona(s). Necesitas al menos 2 para calibrar un overlap.</p>
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
                          <CalibrationPhotoView
                            zone={za}
                            overlapX={anchor.a_overlap_start}
                            side="left"
                            label={`Inicio overlap en ${za.name}`}
                            onChange={v => setLocalAnchors(prev => ({
                              ...prev,
                              [key]: { ...anchor, a_overlap_start: v },
                            }))}
                          />
                          <CalibrationPhotoView
                            zone={zb}
                            overlapX={anchor.b_overlap_end}
                            side="right"
                            label={`Fin overlap en ${zb.name}`}
                            onChange={v => setLocalAnchors(prev => ({
                              ...prev,
                              [key]: { ...anchor, b_overlap_end: v },
                            }))}
                          />
                        </div>

                        <p className="text-zinc-600 text-xs mt-3 text-center">
                          Ajusta las líneas amarillas hasta que el contenido de overlap coincida en ambas fotos.
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
