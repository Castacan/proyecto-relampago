import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getColorHex, ROUTE_COLORS, GRADES } from '../../lib/colors'
import { getDaysOnWall, getFreshnessColor, getFreshnessLevel } from '../../lib/freshness'
import type { Route, Zone } from '../../types'

interface Props {
  route: Route
  zones: Zone[]
  onClose: () => void
  onUpdate: () => void
  onRetire: () => void
}

export default function RouteDetail({ route, zones, onClose, onUpdate, onRetire }: Props) {
  const [editing, setEditing] = useState(false)
  const [editColor, setEditColor] = useState(route.color)
  const [editGrade, setEditGrade] = useState(route.grade)
  const [editZoneId, setEditZoneId] = useState(route.zone_id)
  const [editNotes, setEditNotes] = useState(route.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState(false)

  const days = getDaysOnWall(route.placed_at)
  const level = getFreshnessLevel(route.placed_at)
  const freshnessHex = getFreshnessColor(level)
  const colorHex = getColorHex(route.color)
  const zone = zones.find(z => z.id === route.zone_id)

  async function handleSaveEdit() {
    setSaving(true)
    await supabase.from('routes').update({
      color: editColor,
      grade: editGrade,
      zone_id: editZoneId,
      notes: editNotes.trim() || null,
    }).eq('id', route.id)
    setSaving(false)
    onUpdate()
  }

  async function handleRetire() {
    if (!confirmRetire) { setConfirmRetire(true); return }
    setRetiring(true)
    await supabase.from('routes').update({ status: 'retired', retired_at: new Date().toISOString() }).eq('id', route.id)
    await supabase.from('qr_codes').update({ status: 'available', route_id: null }).eq('route_id', route.id)
    setRetiring(false)
    onRetire()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={onClose}>
      <div
        className="w-full bg-zinc-900 rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto"
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
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => { setEditing(e => !e); setConfirmRetire(false) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${editing ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-zinc-300'}`}
            >
              {editing ? 'Cancelar' : 'Editar'}
            </button>
            <button onClick={onClose} className="text-zinc-400 text-2xl leading-none ml-1">×</button>
          </div>
        </div>

        {!editing ? (
          <>
            {/* Freshness */}
            <div className="flex items-center gap-2 mb-4 p-3 rounded-xl" style={{ backgroundColor: freshnessHex + '22', border: `1px solid ${freshnessHex}44` }}>
              <span className="font-bold text-2xl" style={{ color: freshnessHex }}>{days}</span>
              <span className="text-zinc-300 text-sm">días en la pared</span>
            </div>

            {route.notes && (
              <div className="mb-4 p-3 bg-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Notas</p>
                <p className="text-zinc-200 text-sm">{route.notes}</p>
              </div>
            )}

            <p className="text-zinc-500 text-xs mb-5">
              Colocada el {new Date(route.placed_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>

            <button
              onClick={handleRetire}
              disabled={retiring}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${confirmRetire ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-300'} disabled:opacity-50`}
            >
              {retiring ? 'Retirando...' : confirmRetire ? '¿Confirmar retiro?' : 'Retirar ruta'}
            </button>
            {confirmRetire && (
              <button onClick={() => setConfirmRetire(false)} className="w-full py-2 text-zinc-500 text-sm mt-1">
                Cancelar
              </button>
            )}
          </>
        ) : (
          <>
            {/* Edit: Color */}
            <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Color</label>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {ROUTE_COLORS.map(c => (
                <button
                  key={c.key}
                  onClick={() => setEditColor(c.key)}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div
                    className={`w-12 h-12 rounded-full transition-all ${editColor === c.key ? 'ring-4 ring-white scale-110' : ''}`}
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className={`text-[10px] ${editColor === c.key ? 'text-white' : 'text-zinc-500'}`}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Edit: Grade */}
            <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Grado</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {GRADES.map(g => (
                <button
                  key={g}
                  onClick={() => setEditGrade(g)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-mono font-semibold transition-all ${editGrade === g ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Edit: Zone */}
            <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Zona</label>
            <select
              value={editZoneId}
              onChange={e => setEditZoneId(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm mb-4 outline-none"
            >
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>

            {/* Edit: Notes */}
            <label className="block text-zinc-400 text-xs uppercase tracking-widest mb-2">Notas</label>
            <textarea
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm mb-4 outline-none resize-none placeholder-zinc-600"
            />

            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-yellow-400 text-zinc-950 font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
