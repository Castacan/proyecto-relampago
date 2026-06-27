import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getColorHex, ROUTE_COLORS, GRADES } from '../../lib/colors'
import { getDaysOnWall, getFreshnessColor, getFreshnessLevel } from '../../lib/freshness'
import { useProfile } from '../../hooks/useProfile'
import type { Route, Zone } from '../../types'
import QrScanner from '../QrScanner'

interface Props {
  route: Route
  zones: Zone[]
  onClose: () => void
  onUpdate: () => void
  onRetire: () => void
}

interface VoteCounts { up: number; down: number }
interface Beta { id: string; file_url: string }

export default function RouteDetail({ route, zones, onClose, onUpdate, onRetire }: Props) {
  const { profile } = useProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editing, setEditing] = useState(false)
  const [editColor, setEditColor] = useState(route.color)
  const [editGrade, setEditGrade] = useState(route.grade)
  const [editZoneId, setEditZoneId] = useState(route.zone_id)
  const [editNotes, setEditNotes] = useState(route.notes ?? '')
  const [saving, setSaving] = useState(false)

  const [retiring, setRetiring] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState(false)

  const [votes, setVotes] = useState<VoteCounts>({ up: 0, down: 0 })
  const [betas, setBetas] = useState<Beta[]>([])
  const [uploading, setUploading] = useState(false)
  const [showBeta, setShowBeta] = useState(false)
  const [qrId, setQrId] = useState<string | null | undefined>(undefined)
  const [showScanner, setShowScanner] = useState(false)

  const days = getDaysOnWall(route.placed_at)
  const level = getFreshnessLevel(route.placed_at)
  const freshnessHex = getFreshnessColor(level)
  const colorHex = getColorHex(route.color)
  const zone = zones.find(z => z.id === route.zone_id)

  useEffect(() => {
    supabase.from('qr_codes').select('id').eq('route_id', route.id).eq('status', 'in_use').maybeSingle()
      .then(({ data }) => setQrId(data?.id ?? null))
  }, [route.id])

  useEffect(() => {
    supabase.from('votes').select('value').eq('route_id', route.id).then(({ data }) => {
      if (!data) return
      setVotes({
        up: data.filter(v => v.value === 'up').length,
        down: data.filter(v => v.value === 'down').length,
      })
    })
    supabase.from('betas').select('id, file_url').eq('route_id', route.id).order('created_at').then(({ data }) => {
      if (data) setBetas(data as Beta[])
    })
  }, [route.id])

  async function handleSaveEdit() {
    setSaving(true)
    await supabase.from('routes').update({
      color: editColor, grade: editGrade, zone_id: editZoneId,
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

  async function handleBetaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${route.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('betas').upload(path, file, { upsert: false })
    if (!error) {
      const { data: urlData } = supabase.storage.from('betas').getPublicUrl(path)
      const { data: beta } = await supabase.from('betas').insert({
        route_id: route.id,
        file_url: urlData.publicUrl,
        uploaded_by: profile.id,
      }).select('id, file_url').single()
      if (beta) setBetas(prev => [...prev, beta as Beta])
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleQrAssigned(id: string) {
    setQrId(id)
    setShowScanner(false)
  }

  return (
    <>
    {showScanner && (
      <QrScanner
        routeId={route.id}
        onAssigned={handleQrAssigned}
        onClose={() => setShowScanner(false)}
      />
    )}
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end z-50" onClick={onClose}>
      <div className="w-full bg-zinc-900 rounded-t-3xl p-6 max-h-[92vh] overflow-y-auto border-t border-zinc-800/80" onClick={e => e.stopPropagation()}>

        {/* Handle bar */}
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl border-2 border-white/10 shrink-0 shadow-lg" style={{ backgroundColor: colorHex }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-black text-2xl leading-tight tracking-tight font-mono">
              {route.grade}
              <span className="text-zinc-500 font-semibold text-lg ml-2 font-sans">· {route.color.charAt(0).toUpperCase() + route.color.slice(1)}</span>
            </h2>
            <p className="text-zinc-400 text-sm font-medium">{zone?.name}</p>
          </div>
          <div className="flex gap-2 items-center shrink-0">
            <button
              onClick={() => { setEditing(e => !e); setConfirmRetire(false) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                editing
                  ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {editing ? 'Cancelar' : 'Editar'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {!editing ? (
          <>
            {/* Frescura */}
            <div
              className="flex items-center gap-3 mb-5 p-4 rounded-2xl"
              style={{ backgroundColor: freshnessHex + '18', border: `1px solid ${freshnessHex}35` }}
            >
              <div className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: freshnessHex }} />
              <span className="font-black text-3xl font-mono leading-none" style={{ color: freshnessHex }}>{days}</span>
              <span className="text-zinc-300 text-sm font-medium">días en la pared</span>
            </div>

            {/* Votos */}
            <div className="flex gap-3 mb-5">
              <div className="flex-1 flex items-center gap-3 p-4 bg-zinc-800/60 rounded-2xl border border-zinc-700/40">
                <span className="text-2xl">👍</span>
                <div>
                  <p className="text-white font-black text-2xl leading-none">{votes.up}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">me gusta</p>
                </div>
              </div>
              <div className="flex-1 flex items-center gap-3 p-4 bg-zinc-800/60 rounded-2xl border border-zinc-700/40">
                <span className="text-2xl">👎</span>
                <div>
                  <p className="text-white font-black text-2xl leading-none">{votes.down}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">no me gusta</p>
                </div>
              </div>
            </div>

            {/* Beta */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest">Beta</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs font-semibold text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition-colors"
                >
                  {uploading ? 'Subiendo...' : '+ Subir'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.gif"
                  className="hidden"
                  onChange={handleBetaUpload}
                />
              </div>

              {betas.length === 0 ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-5 bg-zinc-800/60 border border-dashed border-zinc-600 rounded-2xl text-zinc-500 text-sm hover:bg-zinc-800 hover:border-zinc-500 hover:text-zinc-300 transition-all disabled:opacity-50"
                >
                  {uploading ? 'Subiendo...' : '🎬 Toca para subir beta'}
                </button>
              ) : !showBeta ? (
                <button
                  onClick={() => setShowBeta(true)}
                  className="w-full py-3.5 bg-zinc-800/60 rounded-2xl text-zinc-300 text-sm font-medium border border-zinc-700/50 hover:bg-zinc-800 hover:border-zinc-600 hover:text-white transition-all"
                >
                  Ver beta ({betas.length})
                </button>
              ) : (
                <div className="space-y-2">
                  {betas.map(b => (
                    <img key={b.id} src={b.file_url} alt="Beta" className="w-full rounded-2xl" />
                  ))}
                </div>
              )}
            </div>

            {route.notes && (
              <div className="mb-5 p-4 bg-zinc-800/60 rounded-2xl border border-zinc-700/40">
                <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Notas</p>
                <p className="text-zinc-200 text-sm leading-relaxed">{route.notes}</p>
              </div>
            )}

            <p className="text-zinc-600 text-xs mb-5">
              Colocada el {new Date(route.placed_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>

            {/* QR status */}
            {qrId === null && (
              <button
                onClick={() => setShowScanner(true)}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl bg-zinc-800 border border-dashed border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500 hover:text-white font-bold text-sm transition-all mb-3"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                  <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                  <rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/>
                  <rect x="7" y="14" width="3" height="3"/><path d="M14 14h3v3"/>
                </svg>
                Asignar QR
              </button>
            )}
            {qrId && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2.5 bg-zinc-800/60 rounded-xl border border-zinc-700/40">
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-zinc-400 text-xs font-mono truncate">{qrId}</span>
              </div>
            )}

            <button
              onClick={handleRetire}
              disabled={retiring}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
                confirmRetire
                  ? 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
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
        ) : (
          <>
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Color</p>
            <div className="grid grid-cols-5 gap-4 mb-6">
              {ROUTE_COLORS.map(c => (
                <button key={c.key} onClick={() => setEditColor(c.key)} className="flex flex-col items-center gap-2 group cursor-pointer">
                  <div
                    className={`w-13 h-13 rounded-full transition-all duration-150 ${
                      editColor === c.key
                        ? 'ring-4 ring-white scale-110 shadow-lg'
                        : 'ring-0 group-hover:ring-2 group-hover:ring-white/40 group-hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className={`text-[10px] font-medium transition-colors ${editColor === c.key ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>{c.label}</span>
                </button>
              ))}
            </div>

            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Grado</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {GRADES.map(g => (
                <button
                  key={g}
                  onClick={() => setEditGrade(g)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-bold font-mono transition-all ${
                    editGrade === g
                      ? 'bg-yellow-400 text-zinc-950 shadow-md shadow-yellow-400/20 scale-105'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Zona</p>
            <select
              value={editZoneId}
              onChange={e => setEditZoneId(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm mb-6 outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 transition-all cursor-pointer"
            >
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>

            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-3">Notas</p>
            <textarea
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 text-sm mb-6 outline-none resize-none border border-zinc-700/50 hover:border-zinc-600 focus:border-yellow-400/60 transition-all"
            />

            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="w-full py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold text-sm transition-all disabled:opacity-50 shadow-lg shadow-yellow-400/20"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </>
        )}
      </div>
    </div>
    </>
  )
}
