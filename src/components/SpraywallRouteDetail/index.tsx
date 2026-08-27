import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import SpraywallCanvas from '../SpraywallCanvas'
import SpraywallLegend from '../SpraywallLegend'
import { getSpraywallGradeHex } from '../../lib/spraywall'
import type { SpraywallRoute } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  route: SpraywallRoute
  photoUrl: string
  photoW?: number | null
  photoH?: number | null
  onClose: () => void
  onEdit: () => void
  onRetired: () => void
}

export default function SpraywallRouteDetail({ route, photoUrl, photoW, photoH, onClose, onEdit, onRetired }: Props) {
  const [retiring, setRetiring] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState(false)

  async function handleRetire() {
    if (!confirmRetire) { setConfirmRetire(true); return }
    setRetiring(true)
    await db.from('spraywall_routes').update({ status: 'retired', retired_at: new Date().toISOString() }).eq('id', route.id)
    setRetiring(false)
    onRetired()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onClose}>
      <div className="w-full bg-superficie rounded-t-3xl p-6 max-h-[92vh] overflow-y-auto border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 min-w-0">
            <h2 className="text-texto-principal font-black text-xl leading-tight tracking-tight">{route.name}</h2>
            <p className="text-zinc-400 text-sm font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getSpraywallGradeHex(route.grade) }} />
              <span className="font-bold">{route.grade}</span> · Por {route.setter_name}
            </p>
          </div>
          <div className="flex gap-2 items-center shrink-0">
            <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-superficie-alta text-zinc-400 hover:bg-superficie-alta-hover hover:text-zinc-200 transition-all">
              Editar
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-lg leading-none">
              ×
            </button>
          </div>
        </div>

        <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800/60 mb-4">
          <SpraywallCanvas photoUrl={photoUrl} photoW={photoW} photoH={photoH} holds={route.holds} mode="view" />
        </div>

        <div className="mb-5">
          <SpraywallLegend />
        </div>

        {route.notes && (
          <div className="mb-5 p-4 bg-superficie-alta/60 rounded-2xl border border-zinc-700/40">
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Notas</p>
            <p className="text-zinc-200 text-sm leading-relaxed">{route.notes}</p>
          </div>
        )}

        {route.status === 'active' && (
          <>
            <button
              onClick={handleRetire}
              disabled={retiring}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
                confirmRetire
                  ? 'bg-red-500 hover:bg-red-400 text-texto-principal shadow-lg shadow-red-500/20'
                  : 'bg-superficie-alta text-zinc-400 hover:bg-superficie-alta-hover hover:text-zinc-200'
              } disabled:opacity-50`}
            >
              {retiring ? 'Retirando...' : confirmRetire ? '¿Confirmar retiro?' : 'Retirar ruta'}
            </button>
            {confirmRetire && (
              <button onClick={() => setConfirmRetire(false)} className="w-full py-2.5 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors mt-1">
                Cancelar
              </button>
            )}
          </>
        )}

        {route.status === 'retired' && (
          <p className="text-zinc-600 text-xs text-center">Ruta retirada.</p>
        )}
      </div>
    </div>
  )
}
