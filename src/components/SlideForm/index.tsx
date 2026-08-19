import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadDisplayAsset } from '../../lib/uploadDisplayAsset'
import Toggle from '../Toggle'
import type { DisplaySlide } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  initial?: DisplaySlide
  nextSortOrder: number
  onSave: () => void
  onCancel: () => void
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}

export default function SlideForm({ initial, nextSortOrder, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [image, setImage] = useState(initial?.image_url ?? '')
  const [overlayText, setOverlayText] = useState(initial?.overlay_text ?? '')
  const [displaySeconds, setDisplaySeconds] = useState(initial?.display_seconds ?? 8)
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(initial?.starts_at))
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(initial?.ends_at))
  const [active, setActive] = useState(initial?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aspectWarning, setAspectWarning] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MAX_BYTES = 2 * 1024 * 1024

  async function handleImageSelected(file: File) {
    setError(null)
    setAspectWarning(null)

    // Bloqueo duro: restricción real de ancho de banda del WiFi del gym.
    if (file.size > MAX_BYTES) {
      setError(`La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)}MB, el máximo es 2MB.`)
      return
    }

    setUploading(true)
    try {
      const objectUrl = URL.createObjectURL(file)
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new window.Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = reject
        img.src = objectUrl
      })
      // Warning no bloqueante si se aleja de 16:9 (±0.05).
      const ratio = dims.w / dims.h
      if (Math.abs(ratio - 16 / 9) > 0.05) {
        setAspectWarning(`Esta imagen es ${dims.w}×${dims.h} (${ratio.toFixed(2)}:1) — se recomienda 16:9 (1.78:1) para llenar la TV sin bordes.`)
      }

      const url = await uploadDisplayAsset(file, 'slides')
      setImage(url)
    } catch {
      setError('No se pudo subir la imagen.')
    }
    setUploading(false)
  }

  async function handleSave() {
    if (!title.trim() || !image || displaySeconds <= 0) {
      setError('Faltan campos obligatorios.')
      return
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('La fecha de fin debe ser después del inicio.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      title: title.trim(),
      image_url: image,
      overlay_text: overlayText.trim() || null,
      display_seconds: displaySeconds,
      is_active: active,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      ...(initial ? {} : { sort_order: nextSortOrder }),
    }

    const { error: saveErr } = initial
      ? await db.from('display_slides').update(payload).eq('id', initial.id)
      : await db.from('display_slides').insert(payload)

    setSaving(false)
    if (saveErr) { setError('No se pudo guardar.'); return }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onCancel}>
      <div className="w-full bg-superficie rounded-t-3xl p-6 max-h-[92vh] overflow-y-auto border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-texto-principal font-black text-xl tracking-tight">{initial ? 'Editar slide' : 'Nuevo slide'}</h2>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Título interno</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Promo Mean Patty agosto (no se muestra en pantalla)"
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
            />
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Imagen (1920×1080, 16:9, máx. 2MB)</label>
            {image && (
              <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-800/60 mb-2 bg-zinc-950">
                <img src={image} alt="Slide" className="w-full h-full object-cover" />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageSelected(f) }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2.5 rounded-xl bg-superficie-alta hover:bg-superficie-alta-hover text-texto-principal font-semibold text-xs transition-all disabled:opacity-50"
            >
              {uploading ? 'Subiendo...' : image ? 'Reemplazar imagen' : 'Subir imagen'}
            </button>
            {aspectWarning && <p className="text-amber-400 text-xs mt-2">⚠ {aspectWarning}</p>}
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Texto sobre la imagen (opcional)</label>
            <textarea
              value={overlayText}
              onChange={e => setOverlayText(e.target.value)}
              rows={2}
              placeholder="Quedan 5 días"
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all resize-none"
            />
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Duración (segundos)</label>
            <input
              type="number"
              min={1}
              value={displaySeconds}
              onChange={e => setDisplaySeconds(Number(e.target.value))}
              className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Inicio (opcional)</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
                className="w-full bg-superficie-alta text-texto-principal rounded-xl px-3 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Fin (opcional)</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                className="w-full bg-superficie-alta text-texto-principal rounded-xl px-3 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all [color-scheme:dark]"
              />
            </div>
          </div>

          <Toggle checked={active} onChange={setActive} label="Activo" description="Si está apagado, no entra al carrusel aunque esté dentro de sus fechas." />

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
