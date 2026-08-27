import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { useSpraywallPhotos } from '../../hooks/useSpraywallPhotos'
import { useSpraywallRoutes } from '../../hooks/useSpraywallRoutes'
import SpraywallForm from '../../components/SpraywallForm'
import SpraywallRouteDetail from '../../components/SpraywallRouteDetail'
import SpraywallCanvas from '../../components/SpraywallCanvas'
import { getSpraywallGradeHex } from '../../lib/spraywall'
import type { SpraywallRoute } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type Tab = 'rutas' | 'propuestas' | 'foto'

export default function SpraywallPage() {
  const { profile } = useProfile()
  const { photos, current, loading: photosLoading, refetch: refetchPhotos } = useSpraywallPhotos()
  const { routes: activeRoutes, loading: activeLoading, refetch: refetchActive } = useSpraywallRoutes(['active', 'retired'])
  const { routes: pendingRoutes, loading: pendingLoading, refetch: refetchPending } = useSpraywallRoutes(['pending'])

  const [tab, setTab] = useState<Tab>('rutas')
  const [detailRoute, setDetailRoute] = useState<SpraywallRoute | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formInitial, setFormInitial] = useState<SpraywallRoute | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function refetchAll() {
    refetchActive()
    refetchPending()
  }

  function openNewRoute() {
    setFormInitial(undefined)
    setFormOpen(true)
  }

  function openEditRoute(route: SpraywallRoute) {
    setDetailRoute(null)
    setFormInitial(route)
    setFormOpen(true)
  }

  async function handleApprove(route: SpraywallRoute) {
    if (!profile) return
    await db.from('spraywall_routes').update({
      status: 'active', reviewed_at: new Date().toISOString(), reviewed_by: profile.id,
    }).eq('id', route.id)
    refetchAll()
  }

  async function handleReject(route: SpraywallRoute) {
    if (!profile) return
    await db.from('spraywall_routes').update({
      status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: profile.id,
    }).eq('id', route.id)
    refetchAll()
  }

  // Sube una foto NUEVA (2026-08-26, ya no reemplaza la anterior) — cada
  // subida es una fila nueva en spraywall_photos y un archivo con nombre
  // único en storage, para que las rutas ya marcadas con la foto vieja
  // sigan viéndose bien sobre ella. Ver comentario en schema.sql.
  async function handlePhotoSelected(file: File) {
    setUploading(true)
    setUploadError(null)
    const objectUrl = URL.createObjectURL(file)
    const dims = await new Promise<{ w: number; h: number }>(resolve => {
      const img = new window.Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = objectUrl
    })

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('spraywall-photos')
      .upload(path, file, { contentType: file.type })
    if (uploadErr) { setUploading(false); setUploadError(`No se pudo subir el archivo: ${uploadErr.message}`); return }

    const { data: pub } = supabase.storage.from('spraywall-photos').getPublicUrl(path)

    const { error: insertErr } = await db.from('spraywall_photos').insert({
      photo_url: pub.publicUrl, photo_w: dims.w, photo_h: dims.h,
      created_by: profile?.id ?? null,
    })
    if (insertErr) { setUploading(false); setUploadError(`Se subió el archivo pero no se pudo guardar: ${insertErr.message}`); return }

    setUploading(false)
    refetchPhotos()
  }

  if (formOpen) {
    // Ruta nueva: usa la foto ACTUAL. Editar una ruta existente: conserva
    // su propia foto original (formInitial.photo), nunca la reasigna a la
    // más reciente — por eso photoId solo se pasa cuando no hay formInitial.
    const editPhoto = formInitial?.photo
    const photoUrl = formInitial ? editPhoto?.photo_url : current?.photo_url
    const photoW = formInitial ? editPhoto?.photo_w : current?.photo_w
    const photoH = formInitial ? editPhoto?.photo_h : current?.photo_h
    if (photosLoading || !photoUrl || !profile) return null
    return (
      // h-full overflow-y-auto (2026-08-27): SpraywallForm por sí solo usa
      // min-h-screen (pensado para su otro uso, la página pública /spraywall/
      // proponer, sin ancestro con altura fija). Pero aquí el <main> de
      // StaffLayout es overflow-hidden — sin este wrapper, lo que no cabía
      // se recortaba sin scrollbar en vez de poder bajar. No se tocó
      // SpraywallForm en sí para no afectar el flujo público, que ya
      // funciona bien con el scroll normal de la página.
      <div className="h-full overflow-y-auto">
        <SpraywallForm
          authorRole="staff"
          authorId={profile.id}
          authorName={profile.name}
          photoUrl={photoUrl}
          photoW={photoW}
          photoH={photoH}
          photoId={formInitial ? undefined : current?.id}
          initialRoute={formInitial}
          onSave={() => { setFormOpen(false); refetchAll() }}
          onCancel={() => setFormOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="px-4 pt-5 pb-4">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-4">Spraywall</h1>

        <div className="flex gap-2 mb-5 bg-superficie rounded-2xl p-1 border border-zinc-800/60">
          {([
            { key: 'rutas', label: 'Rutas' },
            { key: 'propuestas', label: `Propuestas${pendingRoutes.length ? ` (${pendingRoutes.length})` : ''}` },
            { key: 'foto', label: 'Foto' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                tab === t.key ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-texto-principal'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'rutas' && (
          <>
            <button
              onClick={openNewRoute}
              disabled={!current}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm mb-4 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Nueva ruta
            </button>
            {!current && (
              <p className="text-zinc-600 text-xs mb-4 text-center">Sube la foto base en la pestaña "Foto" antes de crear rutas.</p>
            )}
            {activeLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {activeRoutes.map(route => (
                <button
                  key={route.id}
                  onClick={() => setDetailRoute(route)}
                  className="flex items-center gap-3 p-4 bg-superficie border border-zinc-800/60 rounded-2xl hover:border-zinc-700 transition-all text-left"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0 border border-white/10"
                    style={{ backgroundColor: getSpraywallGradeHex(route.grade) }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-texto-principal font-semibold text-sm truncate">{route.name}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{route.grade} · Por {route.setter_name}</p>
                  </div>
                  {route.status === 'retired' && (
                    <span className="text-zinc-600 text-[10px] font-bold uppercase shrink-0">Retirada</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'propuestas' && (
          <>
            {pendingLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            )}
            {!pendingLoading && pendingRoutes.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-10">No hay propuestas pendientes.</p>
            )}
            <div className="flex flex-col gap-3">
              {pendingRoutes.map(route => (
                <div key={route.id} className="p-4 bg-superficie border border-zinc-800/60 rounded-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0 border border-white/10"
                      style={{ backgroundColor: getSpraywallGradeHex(route.grade) }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-texto-principal font-semibold text-sm truncate">{route.name}</p>
                      <p className="text-zinc-500 text-xs mt-0.5">{route.grade} · Propuesta por {route.setter_name}</p>
                    </div>
                  </div>
                  {route.photo && (
                    <div className="w-full aspect-[4/3] rounded-xl overflow-hidden border border-zinc-800/60 mb-3">
                      <SpraywallCanvas photoUrl={route.photo.photo_url} photoW={route.photo.photo_w} photoH={route.photo.photo_h} holds={route.holds} mode="view" />
                    </div>
                  )}
                  {route.notes && <p className="text-zinc-400 text-xs mb-3">{route.notes}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(route)}
                      className="flex-1 py-2.5 rounded-xl bg-red-500/10 text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => handleApprove(route)}
                      className="flex-1 py-2.5 rounded-xl bg-primario text-texto-en-acento font-bold text-xs hover:bg-primario-hover transition-all"
                    >
                      Aprobar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'foto' && (
          <div>
            <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800/60 mb-4 bg-superficie">
              {photosLoading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
                </div>
              ) : current ? (
                <SpraywallCanvas photoUrl={current.photo_url} photoW={current.photo_w} photoH={current.photo_h} holds={[]} mode="view" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">Sin foto configurada</div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoSelected(f) }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {uploading ? 'Subiendo...' : current ? 'Subir foto nueva' : 'Subir foto'}
            </button>
            {uploadError && (
              <p className="text-alerta text-xs mt-3 text-center">{uploadError}</p>
            )}
            <p className="text-zinc-600 text-xs mt-3 text-center">
              {current
                ? 'Sube una foto nueva cuando cambien los agarres de la pared. Las rutas que ya existen se quedan viéndose sobre la foto con la que se marcaron — solo las rutas nuevas usan esta.'
                : 'Sube la foto base de la pared para poder empezar a marcar rutas.'}
            </p>
            {photos.length > 1 && (
              <p className="text-zinc-600 text-xs mt-2 text-center">{photos.length} fotos en el historial.</p>
            )}
          </div>
        )}
      </div>

      {detailRoute && detailRoute.photo && (
        <SpraywallRouteDetail
          route={detailRoute}
          photoUrl={detailRoute.photo.photo_url}
          photoW={detailRoute.photo.photo_w}
          photoH={detailRoute.photo.photo_h}
          onClose={() => setDetailRoute(null)}
          onEdit={() => openEditRoute(detailRoute)}
          onRetired={() => { setDetailRoute(null); refetchAll() }}
        />
      )}
    </div>
  )
}
