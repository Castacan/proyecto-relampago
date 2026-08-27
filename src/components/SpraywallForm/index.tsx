import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { GRADES } from '../../lib/colors'
import { type HoldRole } from '../../lib/spraywall'
import SpraywallCanvas from '../SpraywallCanvas'
import SpraywallLegend from '../SpraywallLegend'
import type { SpraywallHold, SpraywallRoute } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  authorRole: 'staff' | 'climber'
  authorId: string
  authorName: string
  photoUrl: string
  photoW?: number | null
  photoH?: number | null
  // Requerido solo para rutas NUEVAS (fija con qué foto se marcó, para
  // siempre — ver comentario en schema.sql, 2026-08-26). No se usa al
  // editar: initialRoute conserva su photo_id original, nunca se reasigna.
  photoId?: string
  initialRoute?: SpraywallRoute
  onSave: () => void
  onCancel: () => void
}

export default function SpraywallForm({
  authorRole, authorId, authorName, photoUrl, photoW, photoH, photoId, initialRoute, onSave, onCancel,
}: Props) {
  const [name, setName] = useState(initialRoute?.name ?? '')
  // Nombre de quien puso la ruta (2026-08-27): antes se guardaba siempre
  // el nombre del perfil de staff logueado sin poder cambiarlo — para esta
  // cuenta en particular ese "nombre" resultó ser su correo, así que salía
  // "Por correo@..." en vez del nombre real de quien armó la ruta (puede
  // ser otro staff, o alguien externo). Ahora es un campo editable,
  // precargado con authorName como sugerencia pero corregible.
  const [setterName, setSetterName] = useState(initialRoute?.setter_name ?? authorName)
  const [grade, setGrade] = useState(initialRoute?.grade ?? 'V4')
  const [notes, setNotes] = useState(initialRoute?.notes ?? '')
  const [holds, setHolds] = useState<SpraywallHold[]>(initialRoute?.holds ?? [])
  const [activeRole, setActiveRole] = useState<HoldRole>('inicio_mano')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = selectedIndex !== null ? holds[selectedIndex] : null

  function handleSelectIndex(i: number | null) {
    setSelectedIndex(i)
    setLabelInput(i !== null ? (holds[i]?.label ?? '') : '')
  }

  function applyLabel() {
    if (selectedIndex === null) return
    const next = [...holds]
    next[selectedIndex] = { ...next[selectedIndex], label: labelInput.trim() || undefined }
    setHolds(next)
  }

  function deleteSelected() {
    if (selectedIndex === null) return
    setHolds(holds.filter((_, i) => i !== selectedIndex))
    setSelectedIndex(null)
    setLabelInput('')
  }

  async function handleSave() {
    if (!name.trim()) { setError('Ponle un nombre a la ruta.'); return }
    if (holds.length === 0) { setError('Coloca al menos un agarre.'); return }
    setSaving(true)
    setError('')

    const finalSetterName = setterName.trim() || authorName

    if (initialRoute) {
      const { error: err } = await db.from('spraywall_routes').update({
        name: name.trim(), grade, setter_name: finalSetterName, notes: notes.trim() || null, holds,
        updated_at: new Date().toISOString(),
      }).eq('id', initialRoute.id)
      setSaving(false)
      if (err) { setError('Error al guardar. Intenta de nuevo.'); return }
      onSave()
      return
    }

    if (!photoId) { setSaving(false); setError('Falta la foto base — recarga la página.'); return }

    const payload = authorRole === 'staff'
      ? { created_by_profile_id: authorId, created_by_climber_id: null, status: 'active' }
      : { created_by_climber_id: authorId, created_by_profile_id: null, status: 'pending' }

    const { error: err } = await db.from('spraywall_routes').insert({
      name: name.trim(), grade, setter_name: finalSetterName, notes: notes.trim() || null, holds,
      photo_id: photoId,
      ...payload,
    })
    setSaving(false)
    if (err) { setError('Error al guardar. Intenta de nuevo.'); return }
    onSave()
  }

  return (
    <div className="min-h-screen bg-fondo flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-3">
        <h1 className="text-texto-principal font-black text-lg tracking-tight">
          {initialRoute ? 'Editar ruta' : authorRole === 'climber' ? 'Proponer ruta' : 'Nueva ruta'}
        </h1>
        <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-lg leading-none">
          ×
        </button>
      </div>

      <div className="max-w-md mx-auto w-full px-5 flex-1 flex flex-col">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Nombre de la ruta (ej. Amarillo)"
          className="w-full bg-superficie text-texto-principal rounded-xl px-4 py-3 text-sm mb-3 outline-none placeholder-zinc-600 border border-zinc-700/50 focus:border-primario/60 focus:ring-2 focus:ring-primario/20 transition-all"
        />

        <input
          value={setterName}
          onChange={e => setSetterName(e.target.value)}
          placeholder="Puesta por (nombre de quien la armó)"
          className="w-full bg-superficie text-texto-principal rounded-xl px-4 py-3 text-sm mb-4 outline-none placeholder-zinc-600 border border-zinc-700/50 focus:border-primario/60 focus:ring-2 focus:ring-primario/20 transition-all"
        />

        <div className="flex flex-wrap gap-2 mb-4">
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold font-mono transition-all ${
                grade === g ? 'bg-primario text-texto-en-acento scale-105' : 'bg-superficie-alta text-zinc-400 hover:text-texto-principal'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2.5">
          Toca la foto para colocar un agarre del rol activo
        </p>
        <div className="mb-3">
          <SpraywallLegend interactive activeRole={activeRole} onSelectRole={setActiveRole} />
        </div>

        <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800/60 mb-3">
          <SpraywallCanvas
            photoUrl={photoUrl}
            photoW={photoW}
            photoH={photoH}
            holds={holds}
            mode="edit"
            activeRole={activeRole}
            selectedIndex={selectedIndex}
            onSelectIndex={handleSelectIndex}
            onHoldsChange={setHolds}
          />
        </div>

        {selected && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-superficie border border-zinc-700/50 rounded-xl">
            <input
              value={labelInput}
              onChange={e => setLabelInput(e.target.value)}
              onBlur={applyLabel}
              placeholder="Etiqueta opcional (ej. x2)"
              className="flex-1 bg-superficie-alta text-texto-principal rounded-lg px-3 py-2 text-xs outline-none placeholder-zinc-600"
            />
            <button onClick={deleteSelected} className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">
              Eliminar
            </button>
          </div>
        )}

        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2.5">Notas <span className="normal-case text-zinc-600">(opcional)</span></p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Beta, condición de agarres, etc."
          className="w-full bg-superficie text-texto-principal rounded-xl px-4 py-3 text-sm mb-4 outline-none resize-none placeholder-zinc-600 border border-zinc-700/50 focus:border-primario/60 focus:ring-2 focus:ring-primario/20 transition-all"
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-2xl bg-superficie-alta text-zinc-300 font-semibold text-sm hover:bg-superficie-alta-hover hover:text-texto-principal transition-all">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3.5 rounded-2xl bg-primario text-texto-en-acento font-bold text-sm hover:bg-primario-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primario/20"
          >
            {saving ? 'Guardando...' : initialRoute ? 'Guardar cambios' : authorRole === 'climber' ? 'Enviar propuesta' : 'Guardar ruta'}
          </button>
        </div>
      </div>
    </div>
  )
}
