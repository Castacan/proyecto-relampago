import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'

interface GeneratedQr {
  id: string
  url: string
}

export default function AdminPage() {
  const [qrCount, setQrCount] = useState(10)
  const [generatedQrs, setGeneratedQrs] = useState<GeneratedQr[]>([])
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [exportingCsv, setExportingCsv] = useState(false)

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

  async function handleExportCsv() {
    setExportingCsv(true)
    const { data: routes } = await supabase
      .from('routes')
      .select('*, zones (name)')
      .order('placed_at', { ascending: false })

    if (routes) {
      const header = 'ID,Color,Grado,Zona,Estado,Colocada,Retirada,Notas\n'
      const rows = routes.map(r => [
        r.id,
        r.color,
        r.grade,
        ((r as any).zones as { name: string } | null)?.name ?? '',
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
                    <QRCodeSVG value={qr.url} size={76} level="M" />
                    <span className="text-zinc-700 text-[9px] font-mono font-bold text-center break-all leading-tight">
                      {qr.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            </>
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
