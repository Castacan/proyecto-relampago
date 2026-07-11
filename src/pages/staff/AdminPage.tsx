import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'
import type { Zone, Chain } from '../../types'

interface RetiredRoute {
  id: string
  color: string
  grade: string
  retired_at: string | null
  zones: { name: string } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface GeneratedQr {
  id: string
  url: string
}

interface ChainState {
  chain: Chain | null
  chainZones: Zone[]
  freeZones: Zone[]
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [qrCount, setQrCount] = useState(10)
  const [generatedQrs, setGeneratedQrs] = useState<GeneratedQr[]>([])
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [exportingCsv, setExportingCsv] = useState(false)

  const [showRetired, setShowRetired] = useState(false)
  const [retiredRoutes, setRetiredRoutes] = useState<RetiredRoute[]>([])
  const [loadingRetired, setLoadingRetired] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const [chainState, setChainState] = useState<ChainState>({ chain: null, chainZones: [], freeZones: [] })
  const [chainLoading, setChainLoading] = useState(true)
  const [chainError, setChainError] = useState<string | null>(null)

  const loadChainData = useCallback(async () => {
    setChainLoading(true)
    setChainError(null)
    const [{ data: chains }, { data: zones }] = await Promise.all([
      db.from('chains').select('*').order('name').limit(1),
      db.from('zones').select('*').order('order_index'),
    ])
    const chain: Chain | null = chains?.[0] ?? null
    const allZones: Zone[] = (zones ?? []) as Zone[]
    const chainZones = chain
      ? allZones.filter(z => z.chain_id === chain.id).sort((a, b) => a.chain_position - b.chain_position)
      : []
    const freeZones = allZones.filter(z => !z.chain_id || z.chain_id !== chain?.id)
    setChainState({ chain, chainZones, freeZones })
    setChainLoading(false)
  }, [])

  useEffect(() => { loadChainData() }, [loadChainData])

  async function addToChain(zone: Zone) {
    const { chain, chainZones } = chainState
    if (!chain) return
    const nextPos = chainZones.length
    const { error: zErr } = await db.from('zones')
      .update({ chain_id: chain.id, chain_position: nextPos })
      .eq('id', zone.id)
    if (zErr) { setChainError(zErr.message); return }
    if (chainZones.length > 0) {
      const prevZone = chainZones[chainZones.length - 1]
      const { error: aErr } = await db.from('zone_anchors').insert({
        chain_id: chain.id,
        zone_a_id: prevZone.id,
        zone_b_id: zone.id,
        a_overlap_start: 0.8,
        a_overlap_end: 1.0,
        b_overlap_start: 0.0,
        b_overlap_end: 0.2,
        point_pairs: [],
      })
      if (aErr) { setChainError(aErr.message); return }
    }
    await loadChainData()
  }

  async function removeFromChain(zone: Zone) {
    if (!window.confirm(`¿Quitar "${zone.name}" de la cadena? Se perderán sus calibraciones.`)) return
    await db.from('zones').update({ chain_id: null, chain_position: 0 }).eq('id', zone.id)
    await db.from('zone_anchors').delete()
      .or(`zone_a_id.eq.${zone.id},zone_b_id.eq.${zone.id}`)
    await loadChainData()
  }

  async function handleGenerateQrs() {
    setGenerating(true)
    setGenError(null)
    const ids = Array.from({ length: qrCount }, () => crypto.randomUUID())
    const rows = ids.map(id => ({ id, status: 'available' as const }))
    const { error } = await supabase.from('qr_codes').insert(rows)
    if (error) {
      setGenError(error.message)
    } else {
      const base = window.location.origin
      setGeneratedQrs(ids.map(id => ({ id, url: `${base}/q/${id}` })))
    }
    setGenerating(false)
  }

  async function loadRetiredRoutes() {
    setLoadingRetired(true)
    const { data } = await db.from('routes').select('id, color, grade, retired_at, zones(name)')
      .eq('status', 'retired').order('retired_at', { ascending: false }).limit(30)
    setRetiredRoutes((data ?? []) as RetiredRoute[])
    setLoadingRetired(false)
  }

  async function restoreRoute(id: string) {
    setRestoringId(id)
    await db.from('routes').update({ status: 'active', retired_at: null }).eq('id', id)
    setRestoringId(null)
    setRetiredRoutes(prev => prev.filter(r => r.id !== id))
  }

  async function handleExportCsv() {
    setExportingCsv(true)
    const { data: routes } = await supabase
      .from('routes')
      .select('*, zones (name)')
      .order('placed_at', { ascending: false })

    if (routes) {
      type RouteRow = { id: string; color: string; grade: string; status: string; placed_at: string; retired_at: string | null; notes: string | null; zones: { name: string } | null }
      const header = 'ID,Color,Grado,Zona,Estado,Colocada,Retirada,Notas\n'
      const rows = (routes as unknown as RouteRow[]).map(r => [
        r.id,
        r.color,
        r.grade,
        r.zones?.name ?? '',
        r.status,
        r.placed_at?.slice(0, 10) ?? '',
        r.retired_at?.slice(0, 10) ?? '',
        (r.notes ?? '').replace(/,/g, ';'),
      ].join(','))
      const csv = header + rows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rutas_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    setExportingCsv(false)
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      <div className="px-4 pt-5 pb-6">
        <h1 className="text-white font-black text-2xl tracking-tight mb-6">Admin</h1>

        {/* Cadena Panorámica */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <h2 className="text-white font-bold text-base mb-1">Cadena Panorámica</h2>
          <p className="text-zinc-500 text-xs font-medium mb-4">Zonas activas en la cadena y su orden</p>

          {chainLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
            </div>
          ) : !chainState.chain ? (
            <p className="text-zinc-500 text-xs">No hay cadenas configuradas en la base de datos.</p>
          ) : (
            <>
              <p className="text-yellow-400/70 text-[11px] font-bold uppercase tracking-wider mb-2">
                {chainState.chain.name}
              </p>

              {/* Zonas en cadena */}
              <div className="space-y-1.5 mb-4">
                {chainState.chainZones.length === 0 ? (
                  <p className="text-zinc-600 text-xs italic py-2">Sin zonas</p>
                ) : chainState.chainZones.map((z, i) => (
                  <div key={z.id} className="flex items-center gap-2.5 bg-zinc-800 rounded-xl px-3 py-2.5">
                    <span className="text-zinc-600 text-xs font-mono w-4 shrink-0">{i}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                    <span className="text-white text-sm font-medium flex-1 truncate">{z.name}</span>
                    <button
                      onClick={() => removeFromChain(z)}
                      className="text-zinc-600 hover:text-red-400 text-xs font-bold transition-colors px-1.5 py-1 rounded"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>

              {/* Zonas sin cadena */}
              {chainState.freeZones.length > 0 && (
                <>
                  <p className="text-zinc-600 text-[11px] font-bold uppercase tracking-wider mb-2">
                    Sin cadena
                  </p>
                  <div className="space-y-1.5">
                    {chainState.freeZones.map(z => (
                      <div key={z.id} className="flex items-center gap-2.5 bg-zinc-800/40 border border-zinc-700/50 border-dashed rounded-xl px-3 py-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                        <span className="text-zinc-400 text-sm font-medium flex-1 truncate">{z.name}</span>
                        <button
                          onClick={() => addToChain(z)}
                          className="text-yellow-400 hover:text-yellow-300 text-xs font-black transition-colors px-1.5 py-1 rounded"
                        >
                          + Agregar
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {chainError && (
                <p className="text-red-400 text-xs font-medium mt-3">{chainError}</p>
              )}
            </>
          )}
        </div>

        {/* Calibración de cadenas */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <h2 className="text-white font-bold text-base mb-1">Calibración de Cadenas</h2>
          <p className="text-zinc-500 text-xs font-medium mb-4">Configura los overlaps entre fotos de cada cadena panorámica</p>
          <button
            onClick={() => navigate('/staff/calibration')}
            className="w-full bg-zinc-800 text-zinc-200 font-bold text-sm py-2.5 rounded-xl hover:bg-zinc-700 border border-zinc-700 transition-all"
          >
            Abrir Calibración
          </button>
        </div>

        {/* Catálogo de volúmenes */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <h2 className="text-white font-bold text-base mb-1">Catálogo de Volúmenes</h2>
          <p className="text-zinc-500 text-xs font-medium mb-4">Dibuja formas de volúmenes para colocarlos desde inventario</p>
          <button
            onClick={() => navigate('/staff/volume-catalog')}
            className="w-full bg-zinc-800 text-zinc-200 font-bold text-sm py-2.5 rounded-xl hover:bg-zinc-700 border border-zinc-700 transition-all"
          >
            Abrir Catálogo
          </button>
        </div>

        {/* QR Generation */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <h2 className="text-white font-bold text-base mb-3">Generar QR Codes</h2>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-zinc-400 text-sm font-medium shrink-0">Cantidad</label>
            <input
              type="number"
              min={1}
              max={50}
              value={qrCount}
              onChange={e => setQrCount(Math.max(1, Math.min(50, Number(e.target.value))))}
              className="w-20 bg-zinc-800 text-white text-sm font-mono px-3 py-2 rounded-xl border border-zinc-700 focus:outline-none focus:border-yellow-400"
            />
            <button
              onClick={handleGenerateQrs}
              disabled={generating}
              className="flex-1 bg-yellow-400 text-zinc-950 font-black text-sm py-2.5 rounded-xl hover:bg-yellow-300 transition-all disabled:opacity-50"
            >
              {generating ? 'Creando...' : 'Crear QRs'}
            </button>
          </div>

          {genError && (
            <p className="text-red-400 text-xs font-medium mb-3">{genError}</p>
          )}

          {generatedQrs.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-zinc-400 text-xs font-medium">{generatedQrs.length} QRs creados</p>
                <button
                  onClick={() => window.print()}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 transition-all"
                >
                  Imprimir
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {generatedQrs.map(qr => (
                  <div key={qr.id} className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl">
                    <QRCode value={qr.url} size={76} level="M" />
                    <span className="text-zinc-700 text-[9px] font-mono font-bold text-center break-all leading-tight">
                      {qr.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Rutas retiradas — restaurar */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-bold text-base">Rutas retiradas</h2>
            <button
              onClick={() => {
                const next = !showRetired
                setShowRetired(next)
                if (next && retiredRoutes.length === 0) loadRetiredRoutes()
              }}
              className="text-zinc-400 hover:text-white text-xs font-bold transition-colors"
            >
              {showRetired ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          <p className="text-zinc-500 text-xs font-medium mb-3">Restaura una ruta retirada por error</p>

          {showRetired && (
            loadingRetired ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
              </div>
            ) : retiredRoutes.length === 0 ? (
              <p className="text-zinc-600 text-xs text-center py-3">Sin rutas retiradas</p>
            ) : (
              <div className="space-y-2">
                {retiredRoutes.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-zinc-800 rounded-xl px-3 py-2.5">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getColorHex(r.color) }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-bold">{r.grade} — {r.color}</p>
                      <p className="text-zinc-500 text-xs">
                        {r.zones?.name ?? '—'} · retirada {r.retired_at ? new Date(r.retired_at).toLocaleDateString('es-MX') : '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreRoute(r.id)}
                      disabled={restoringId === r.id}
                      className="text-yellow-400 hover:text-yellow-300 text-xs font-black transition-colors px-2 py-1 rounded disabled:opacity-40"
                    >
                      {restoringId === r.id ? '…' : 'Restaurar'}
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* CSV Export */}
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
          <h2 className="text-white font-bold text-base mb-1">Exportar Rutas</h2>
          <p className="text-zinc-500 text-xs font-medium mb-4">Descarga todas las rutas en formato CSV</p>
          <button
            onClick={handleExportCsv}
            disabled={exportingCsv}
            className="w-full bg-zinc-800 text-zinc-200 font-bold text-sm py-2.5 rounded-xl hover:bg-zinc-700 border border-zinc-700 transition-all disabled:opacity-50"
          >
            {exportingCsv ? 'Exportando...' : 'Descargar CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
