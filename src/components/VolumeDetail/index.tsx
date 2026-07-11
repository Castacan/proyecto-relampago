import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getDaysOnWall } from '../../lib/freshness'
import type { Volume, VolumeCatalogItem, Zone } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  volume: Volume
  zones: Zone[]
  onClose: () => void
  onRetire: () => void
}

export default function VolumeDetail({ volume, zones, onClose, onRetire }: Props) {
  const [retiring, setRetiring] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState(false)
  const [catalogItem, setCatalogItem] = useState<VolumeCatalogItem | null>(null)

  const days = getDaysOnWall(volume.placed_at)
  const zone = zones.find(z => z.id === volume.zone_id)

  useEffect(() => {
    if (!volume.catalog_id) return
    db.from('volume_catalog').select('*').eq('id', volume.catalog_id).single()
      .then(({ data }: { data: VolumeCatalogItem | null }) => { if (data) setCatalogItem(data) })
  }, [volume.catalog_id])

  async function handleRetire() {
    if (!confirmRetire) { setConfirmRetire(true); return }
    setRetiring(true)
    await db.from('volumes').update({ status: 'retired', retired_at: new Date().toISOString() }).eq('id', volume.id)
    setRetiring(false)
    onRetire()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onClose}>
      <div className="w-full bg-zinc-900 rounded-t-3xl p-6 border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-zinc-700/50 border border-zinc-600/30 shrink-0 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(160,160,160,0.5)" stroke="rgba(180,180,180,0.6)" strokeWidth={1.5}>
              <polygon points="5,4 19,4 21,20 3,20" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-black text-xl leading-tight tracking-tight">Volumen</h2>
            <p className="text-zinc-400 text-sm font-medium">{zone?.name ?? '—'}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all text-lg leading-none"
          >
            ×
          </button>
        </div>

        {catalogItem && (
          <div className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-zinc-800/60 border border-zinc-700/40">
            <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0 rounded-lg bg-zinc-900">
              <polygon
                points={catalogItem.shape.map(p => `${p.x * 36},${p.y * 36}`).join(' ')}
                fill="rgba(110,110,110,0.55)" stroke="rgba(180,180,180,0.6)" strokeWidth={1.5}
              />
            </svg>
            <div>
              <p className="text-white text-sm font-bold">{catalogItem.name}</p>
              <p className="text-zinc-500 text-xs">
                {Math.round(volume.rotation ?? 0)}° · ×{((volume.vol_scale ?? 1)).toFixed(2)}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-5 p-4 rounded-2xl bg-zinc-800/60 border border-zinc-700/40">
          <div className="w-2 h-2 rounded-full shrink-0 bg-zinc-400" />
          <span className="font-black text-3xl font-mono leading-none text-zinc-200">{days}</span>
          <span className="text-zinc-400 text-sm font-medium">días en la pared</span>
        </div>

        <p className="text-zinc-600 text-xs mb-5">
          Colocado el {new Date(volume.placed_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        <button
          onClick={handleRetire}
          disabled={retiring}
          className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
            confirmRetire
              ? 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
          } disabled:opacity-50`}
        >
          {retiring ? 'Retirando...' : confirmRetire ? '¿Confirmar retiro?' : 'Retirar volumen'}
        </button>
        {confirmRetire && (
          <button onClick={() => setConfirmRetire(false)} className="w-full py-2.5 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors mt-1">
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
