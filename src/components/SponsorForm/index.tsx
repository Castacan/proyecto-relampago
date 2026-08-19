import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadDisplayAsset } from '../../lib/uploadDisplayAsset'
import Toggle from '../Toggle'
import type { Sponsorship } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  initial?: Sponsorship
  existingSponsorships: Sponsorship[]
  onSave: () => void
  onCancel: () => void
}

// TIMESTAMPTZ, no DATE (a diferencia del <input type="date"> que usa
// VolumeDetail para placed_at) — la hora exacta importa para decidir si un
// patrocinio está "activo" ahora mismo, truncar a medianoche perdería eso.
function toDatetimeLocal(iso: string | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}

export default function SponsorForm({ initial, existingSponsorships, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.sponsor_name ?? '')
  const [logo, setLogo] = useState(initial?.sponsor_logo ?? '')
  const [prize, setPrize] = useState(initial?.prize_text ?? '')
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(initial?.starts_at))
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(initial?.ends_at))
  const [active, setActive] = useState(initial?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleLogoSelected(file: File) {
    setUploading(true)
    try {
      const url = await uploadDisplayAsset(file, 'sponsors')
      setLogo(url)
    } catch {
      setError('No se pudo subir el logo.')
    }
    setUploading(false)
  }

  async function handleSave() {
    if (!name.trim() || !logo || !prize.trim() || !startsAt || !endsAt) {
      setError('Faltan campos obligatorios.')
      return
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('La fecha de fin debe ser después del inicio.')
      return
    }

    const newStartsIso = new Date(startsAt).toISOString()
    const newEndsIso = new Date(endsAt).toISOString()

    // Solo 1 patrocinador activo a la vez (decisión explícita del doc,
    // sección 9) — si esto queda activo, no debe traslaparse en fechas con
    // otro patrocinador que también vaya a quedar activo.
    if (active) {
      const conflict = existingSponsorships.find(s =>
        s.id !== initial?.id &&
        s.is_active &&
        s.starts_at < newEndsIso &&
        s.ends_at > newStartsIso
      )
      if (conflict) {
        setError(`Se traslapa con "${conflict.sponsor_name}" (${new Date(conflict.starts_at).toLocaleDateString('es-MX')}–${new Date(conflict.ends_at).toLocaleDateString('es-MX')}). Solo puede haber un patrocinador activo a la vez — desactívalo o ajusta las fechas.`)
        return
      }
    }

    setSaving(true)
    setError(null)

    const payload = {
      sponsor_name: name.trim(),
      sponsor_logo: logo,
      prize_text: prize.trim(),
      starts_at: newStartsIso,
      ends_at: newEndsIso,
      is_active: active,
    }

    const { error: saveErr } = initial
      ? await db.from('sponsorships').update(payload).eq('id', initial.id)
      : await db.from('sponsorships').insert(payload)

    setSaving(false)
    if (saveErr) { setError('No se pudo guardar.'); return }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onCancel}>
      <div className="w-full bg-superficie rounded-t-3xl p-6 max-h-[92vh] overflow-y-auto border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-texto-principal font-black text-xl tracking-tight">{initial ? 'Editar patrocinador' : 'Nuevo patrocinador'}</h2>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Nombre del patrocinador</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Mean Patty"
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
            />
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Logo</label>
            {logo && (
              <div className="w-24 h-24 rounded-xl overflow-hidden border border-zinc-800/60 mb-2 bg-zinc-950 flex items-center justify-center">
                <img src={logo} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoSelected(f) }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2.5 rounded-xl bg-superficie-alta hover:bg-superficie-alta-hover text-texto-principal font-semibold text-xs transition-all disabled:opacity-50"
            >
              {uploading ? 'Subiendo...' : logo ? 'Reemplazar logo' : 'Subir logo'}
            </button>
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Premio</label>
            <input
              type="text"
              value={prize}
              onChange={e => setPrize(e.target.value)}
              placeholder="Vale de $500 en hamburguesas"
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Inicio</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
                className="w-full bg-superficie-alta text-texto-principal rounded-xl px-3 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Fin</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                className="w-full bg-superficie-alta text-texto-principal rounded-xl px-3 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all [color-scheme:dark]"
              />
            </div>
          </div>

          <Toggle checked={active} onChange={setActive} label="Activo" description="Si está apagado, no aparece en pantalla aunque esté dentro de sus fechas." />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
