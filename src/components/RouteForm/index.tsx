import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { ROUTE_COLORS, GRADES, getColorHex } from '../../lib/colors'
import type { Zone } from '../../types'

interface Props {
  blobPath: { x: number; y: number }[]
  zones: Zone[]
  initialColor?: string
  assignQrId?: string
  onSave: () => void
  onCancel: () => void
}

export default function RouteForm({ blobPath, zones, initialColor = 'amarillo', assignQrId, onSave, onCancel }: Props) {
  const { profile } = useProfile()
  const [color, setColor] = useState(initialColor)
  const [grade, setGrade] = useState('V4')
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '')
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
    <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={onCancel}>
      <div
        className="w-full bg-zinc-900 rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Nueva ruta</h2>
          <button onClick={onCancel} className="text-zinc-400 text-2xl leading-none">×</button>
        </div>

        {/* Color */}
        <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Color de presas</label>
        <div className="grid grid-cols-5 gap-3 mb-5">
          {ROUTE_COLORS.map(c => (
            <button
              key={c.key}
              onClick={() => setColor(c.key)}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className={`w-12 h-12 rounded-full transition-all ${color === c.key ? 'ring-4 ring-white scale-110' : ''}`}
                style={{ backgroundColor: c.hex }}
              />
              <span className={`text-[10px] ${color === c.key ? 'text-white' : 'text-zinc-500'}`}>
                {c.label}
              </span>
            </button>
          ))}
        </div>

        {/* Grade */}
        <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Grado</label>
        <div className="flex flex-wrap gap-2 mb-5">
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`px-3 py-1.5 rounded-lg text-sm font-mono font-semibold transition-all ${grade === g ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Zone */}
        <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Zona principal</label>
        <select
          value={zoneId}
          onChange={e => setZoneId(e.target.value)}
          className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm mb-5 outline-none"
        >
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>

        {/* Notes */}
        <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Notas internas (opcional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Beta de setter, notas de ajuste..."
          className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm mb-5 outline-none resize-none placeholder-zinc-600"
        />

        {/* Preview */}
        <div className="flex items-center gap-3 mb-5 p-3 bg-zinc-800 rounded-lg">
          <div className="w-8 h-8 rounded-full border-2 border-white/30" style={{ backgroundColor: getColorHex(color) }} />
          <span className="text-white font-semibold">{color.charAt(0).toUpperCase() + color.slice(1)}</span>
          <span className="text-zinc-400">·</span>
          <span className="text-white font-mono font-bold">{grade}</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-300 text-sm">{zones.find(z => z.id === zoneId)?.name}</span>
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 font-semibold text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-yellow-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar ruta'}
          </button>
        </div>
      </div>
    </div>
  )
}
