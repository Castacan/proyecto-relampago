import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { ROUTE_COLORS, GRADES, getColorHex } from '../../lib/colors'
import type { Zone } from '../../types'
import { getZoneDisplayName } from '../../lib/zoneGroups'

interface Props {
  blobPath: { x: number; y: number }[]
  zones: Zone[]
  initialColor?: string
  initialZoneId?: string
  initialChainId?: string
  assignQrId?: string
  onSave: () => void
  onCancel: () => void
}

export default function RouteForm({ blobPath, zones, initialColor = 'amarillo', initialZoneId, initialChainId, assignQrId, onSave, onCancel }: Props) {
  const { profile } = useProfile()
  const [color, setColor] = useState(initialColor)
  const [grade, setGrade] = useState('V4')
  const [zoneId, setZoneId] = useState(initialZoneId ?? zones[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    setError('')
    const { data: newRoute, error: err } = await supabase.from('routes').insert({
      color,
      grade,
      setter_id: profile.id,
      zone_id: zoneId,
      chain_id: (initialChainId ?? null) as unknown as never,
      blob_path: blobPath,
      notes: notes.trim() || null,
    }).select('id').single()
    if (err || !newRoute) { setSaving(false); setError('Error al guardar. Intenta de nuevo.'); return }

    if (assignQrId) {
      await supabase.from('qr_codes').update({ status: 'in_use', route_id: newRoute.id }).eq('id', assignQrId)
    }

    setSaving(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onCancel}>
      <div
        className="w-full bg-zinc-900 rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto border-t border-zinc-800/80"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-bold text-xl tracking-tight">Nueva ruta</h2>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Color */}
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Color de presas</p>
        <div className="grid grid-cols-5 gap-4 mb-6">
          {ROUTE_COLORS.map(c => (
            <button
              key={c.key}
              onClick={() => setColor(c.key)}
              className="flex flex-col items-center gap-2 group cursor-pointer"
            >
              <div
                className={`w-13 h-13 rounded-full transition-all duration-150 ${
                  color === c.key
                    ? 'ring-4 ring-white scale-110 shadow-lg'
                    : 'ring-0 group-hover:ring-2 group-hover:ring-white/40 group-hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
              />
              <span className={`text-[10px] font-medium transition-colors ${color === c.key ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                {c.label}
              </span>
            </button>
          ))}
        </div>

        {/* Grade */}
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Grado</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold font-mono transition-all ${
                grade === g
                  ? 'bg-yellow-400 text-zinc-950 shadow-md shadow-yellow-400/20 scale-105'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Zone */}
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Zona principal</p>
        <select
          value={zoneId}
          onChange={e => setZoneId(e.target.value)}
          className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm mb-6 outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 focus:ring-2 focus:ring-yellow-400/20 transition-all cursor-pointer"
        >
          {zones.map(z => <option key={z.id} value={z.id}>{getZoneDisplayName(z)}</option>)}
        </select>

        {/* Notes */}
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Notas internas <span className="normal-case text-zinc-600">(opcional)</span></p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Beta de setter, notas de ajuste..."
          className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm mb-6 outline-none resize-none placeholder-zinc-600 border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 focus:ring-2 focus:ring-yellow-400/20 transition-all"
        />

        {/* Preview */}
        <div className="flex items-center gap-3 mb-6 p-4 bg-zinc-800/60 rounded-2xl border border-zinc-700/40">
          <div className="w-9 h-9 rounded-full border-2 border-white/20 shrink-0 shadow-md" style={{ backgroundColor: getColorHex(color) }} />
          <span className="text-white font-semibold text-sm">{color.charAt(0).toUpperCase() + color.slice(1)}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-white font-black font-mono text-base">{grade}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-300 text-sm">{getZoneDisplayName(zones.find(z => z.id === zoneId) ?? zones[0])}</span>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-2xl bg-zinc-800 text-zinc-300 font-semibold text-sm hover:bg-zinc-700 hover:text-white transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3.5 rounded-2xl bg-yellow-400 text-zinc-950 font-bold text-sm hover:bg-yellow-300 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-400/20"
          >
            {saving ? 'Guardando...' : 'Guardar ruta'}
          </button>
        </div>
      </div>
    </div>
  )
}
