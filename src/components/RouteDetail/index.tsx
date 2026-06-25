import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'
import { getDaysOnWall, getFreshnessColor, getFreshnessLevel } from '../../lib/freshness'
import type { Route, Zone } from '../../types'

interface Props {
  route: Route
  zones: Zone[]
  onClose: () => void
  onRetire: () => void
}

export default function RouteDetail({ route, zones, onClose, onRetire }: Props) {
  const [retiring, setRetiring] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const days = getDaysOnWall(route.placed_at)
  const level = getFreshnessLevel(route.placed_at)
  const freshnessHex = getFreshnessColor(level)
  const colorHex = getColorHex(route.color)
  const zone = zones.find(z => z.id === route.zone_id)

  async function handleRetire() {
    if (!confirm) { setConfirm(true); return }
    setRetiring(true)
    await supabase
      .from('routes')
      .update({ status: 'retired', retired_at: new Date().toISOString() })
      .eq('id', route.id)
    // Free up the QR if assigned
    await supabase
      .from('qr_codes')
      .update({ status: 'available', route_id: null })
      .eq('route_id', route.id)
    setRetiring(false)
    onRetire()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-zinc-900 rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 shrink-0" style={{ backgroundColor: colorHex }} />
          <div>
            <h2 className="text-white font-bold text-xl font-mono">
              {route.color.charAt(0).toUpperCase() + route.color.slice(1)} · {route.grade}
            </h2>
            <p className="text-zinc-400 text-sm">{zone?.name}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-zinc-400 text-2xl leading-none">×</button>
        </div>

        {/* Freshness */}
        <div className="flex items-center gap-2 mb-4 p-3 rounded-xl" style={{ backgroundColor: freshnessHex + '22', borderColor: freshnessHex + '44', border: '1px solid' }}>
          <span className="font-bold text-2xl" style={{ color: freshnessHex }}>{days}</span>
          <span className="text-zinc-300 text-sm">días en la pared</span>
        </div>

        {/* Notes */}
        {route.notes && (
          <div className="mb-4 p-3 bg-zinc-800 rounded-xl">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Notas</p>
            <p className="text-zinc-200 text-sm">{route.notes}</p>
          </div>
        )}

        {/* Fecha */}
        <p className="text-zinc-500 text-xs mb-5">
          Colocada el {new Date(route.placed_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        {/* Retire button */}
        <button
          onClick={handleRetire}
          disabled={retiring}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            confirm
              ? 'bg-red-500 text-white'
              : 'bg-zinc-800 text-zinc-300'
          } disabled:opacity-50`}
        >
          {retiring ? 'Retirando...' : confirm ? '¿Confirmar retiro?' : 'Retirar ruta'}
        </button>
        {confirm && (
          <button onClick={() => setConfirm(false)} className="w-full py-2 text-zinc-500 text-sm mt-1">
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
