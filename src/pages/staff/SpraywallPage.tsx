import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { useSpraywallSettings } from '../../hooks/useSpraywallSettings'
import { useSpraywallRoutes } from '../../hooks/useSpraywallRoutes'
import SpraywallForm from '../../components/SpraywallForm'
import SpraywallRouteDetail from '../../components/SpraywallRouteDetail'
import SpraywallCanvas from '../../components/SpraywallCanvas'
import type { SpraywallRoute } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type Tab = 'rutas' | 'propuestas' | 'foto'

export default function SpraywallPage() {
  const { profile } = useProfile()
  const { settings, loading: settingsLoading, refetch: refetchSettings } = useSpraywallSettings()
  const { routes: activeRoutes, loading: activeLoading, refetch: refetchActive } = useSpraywallRoutes(['active', 'retired'])
  const { routes: pendingRoutes, loading: pendingLoading, refetch: refetchPending } = useSpraywallRoutes(['pending'])

  const [tab, setTab] = useState<Tab>('rutas')
  const [detailRoute, setDetailRoute] = useState<SpraywallRoute | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formInitial, setFormInitial] = useState<SpraywallRoute | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
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

  async function handlePhotoSelected(file: File) {
    setUploading(true)
    const objectUrl = URL.createObjectURL(file)
    const dims = await new Promise<{ w: number; h: number }>(resolve => {
      const img = new window.Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = objectUrl
    })

    const path = `base.jpg`
    const { error: uploadErr } = await supabase.storage
      .from('spraywall-photos')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadErr) { setUploading(false); return }

    const { data: pub } = supabase.storage.from('spraywall-photos').getPublicUrl(path)
    const cacheBusted = `${pub.publicUrl}?v=${Date.now()}`

    await db.from('spraywall_settings').update({
      photo_url: cacheBusted, photo_w: dims.w, photo_h: dims.h,
      updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }).eq('id', true)

    setUploading(false)
    refetchSettings()
  }

  if (formOpen) {
    if (settingsLoading || !settings?.photo_url || !profile) return null
    return (
      <SpraywallForm
        authorRole="staff"
        authorId={profile.id}
        authorName={profile.name}
        photoUrl={settings.photo_url}
        photoW={settings.photo_w}
        photoH={settings.photo_h}
        initialRoute={formInitial}
        onSave={() => { setFormOpen(false); refetchAll() }}
        onCancel={() => setFormOpen(false)}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-4">
        <h1 className="text-white font-black text-2xl tracking-tight mb-4">Spraywall</h1>

        <div className="flex gap-2 mb-5 bg-zinc-900 rounded-2xl p-1 border border-zinc-800/60">
          {([
            { key: 'rutas', label: 'Rutas' },
            { key: 'propuestas', label: `Propuestas${pendingRoutes.length ? ` (${pendingRoutes.length})` : ''}` },
            { key: 'foto', label: 'Foto' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                tab === t.key ? 'bg-yellow-400 text-zinc-950' : 'text-zinc-400 hover:text-white'
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
              disabled={!settings?.photo_url}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm mb-4 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Nueva ruta
            </button>
            {!settings?.photo_url && (
              <p className="text-zinc-600 text-xs mb-4 text-center">Sube la foto base en la pestaña "Foto" antes de crear rutas.</p>
            )}
            {activeLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {activeRoutes.map(route => (
                <button
                  key={route.id}
                  onClick={() => setDetailRoute(route)}
                  className="flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 transition-all text-left"
                >
                  <div className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                    <span className="text-white font-black font-mono text-sm">{route.grade}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{route.name}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Por {route.setter_name}</p>
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
                <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
              </div>
            )}
            {!pendingLoading && pendingRoutes.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-10">No hay propuestas pendientes.</p>
            )}
            <div className="flex flex-col gap-3">
              {pendingRoutes.map(route => (
                <div key={route.id} className="p-4 bg-zinc-900 border border-zinc-800/60 rounded-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                      <span className="text-white font-black font-mono text-sm">{route.grade}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{route.name}</p>
                      <p className="text-zinc-500 text-xs mt-0.5">Propuesta por {route.setter_name}</p>
                    </div>
                  </div>
                  {settings?.photo_url && (
                    <div className="w-full aspect-[4/3] rounded-xl overflow-hidden border border-zinc-800/60 mb-3">
                      <SpraywallCanvas photoUrl={settings.photo_url} photoW={settings.photo_w} photoH={settings.photo_h} holds={route.holds} mode="view" />
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
                      className="flex-1 py-2.5 rounded-xl bg-yellow-400 text-zinc-950 font-bold text-xs hover:bg-yellow-300 transition-all"
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
            <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800/60 mb-4 bg-zinc-900">
              {settingsLoading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                </div>
              ) : settings?.photo_url ? (
                <SpraywallCanvas photoUrl={settings.photo_url} photoW={settings.photo_w} photoH={settings.photo_h} holds={[]} mode="view" />
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
              className="w-full py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {uploading ? 'Subiendo...' : settings?.photo_url ? 'Reemplazar foto' : 'Subir foto'}
            </button>
            <p className="text-zinc-600 text-xs mt-3 text-center">
              Es una sola foto compartida por todas las rutas — reemplazarla no borra las rutas existentes, solo cambia el fondo.
            </p>
          </div>
        )}
      </div>

      {detailRoute && settings?.photo_url && (
        <SpraywallRouteDetail
          route={detailRoute}
          photoUrl={settings.photo_url}
          photoW={settings.photo_w}
          photoH={settings.photo_h}
          onClose={() => setDetailRoute(null)}
          onEdit={() => openEditRoute(detailRoute)}
          onRetired={() => { setDetailRoute(null); refetchAll() }}
        />
      )}
    </div>
  )
}
