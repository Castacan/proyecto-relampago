import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { supabase } from '../../lib/supabase'
import { getColorHex } from '../../lib/colors'

interface QrRow {
  id: string
  status: 'available' | 'in_use'
  routes: {
    color: string
    grade: string
    zones: { name: string } | null
  } | null
}

export default function QrInventoryPage() {
  const [qrs, setQrs] = useState<QrRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'available' | 'in_use'>('all')
  const [selectedQr, setSelectedQr] = useState<QrRow | null>(null)

  useEffect(() => {
    supabase
      .from('qr_codes')
      .select('id, status, routes (color, grade, zones (name))')
      .order('id')
      .then(({ data }) => {
        if (data) setQrs(data as unknown as QrRow[])
        setLoading(false)
      })
  }, [])

  const filtered = qrs.filter(q => filter === 'all' || q.status === filter)
  const available = qrs.filter(q => q.status === 'available').length
  const inUse = qrs.filter(q => q.status === 'in_use').length
  const qrUrl = selectedQr ? `${window.location.origin}/q/${selectedQr.id}` : ''

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      {/* Stats header */}
      <div className="px-4 pt-5 pb-4">
        <h1 className="text-white font-black text-2xl tracking-tight mb-4">Inventario QR</h1>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-green-400 font-black text-3xl leading-none">{available}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">Disponibles</p>
          </div>
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-yellow-400 font-black text-3xl leading-none">{inUse}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">En uso</p>
          </div>
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-zinc-300 font-black text-3xl leading-none">{qrs.length}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">Total</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {([
          { key: 'all', label: 'Todos' },
          { key: 'available', label: 'Disponibles' },
          { key: 'in_use', label: 'Asignados' },
        ] as const).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              filter === f.key
                ? 'bg-yellow-400 text-zinc-950 shadow-md shadow-yellow-400/20'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-6">
          {filtered.map(qr => (
            <button
              key={qr.id}
              onClick={() => setSelectedQr(qr)}
              className={`p-4 rounded-2xl border text-left transition-all active:scale-95 ${
                qr.status === 'available'
                  ? 'bg-zinc-900 border-zinc-800/80 hover:border-zinc-700'
                  : 'bg-zinc-900 border-zinc-700/60 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  qr.status === 'available' ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <span className="text-zinc-300 text-[10px] font-bold font-mono truncate">{qr.id.slice(0, 8)}</span>
              </div>

              {qr.status === 'available' ? (
                <p className="text-zinc-600 text-xs font-medium">Sin asignar</p>
              ) : qr.routes ? (
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-6 h-6 rounded-full shrink-0 border border-white/10 shadow-sm"
                    style={{ backgroundColor: getColorHex(qr.routes.color) }}
                  />
                  <div className="min-w-0">
                    <p className="text-white text-sm font-black font-mono leading-none">{qr.routes.grade}</p>
                    <p className="text-zinc-500 text-[11px] font-medium truncate mt-0.5">{qr.routes.zones?.name}</p>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-600 text-xs font-medium">Ruta retirada</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* QR Detail sheet */}
      {selectedQr && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          onClick={() => setSelectedQr(null)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full bg-zinc-900 rounded-t-3xl p-6 flex flex-col items-center gap-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-zinc-700 rounded-full mb-1" />

            <div className="bg-white p-4 rounded-2xl">
              <QRCode value={qrUrl} size={180} level="M" />
            </div>

            <div className="text-center">
              <p className="text-zinc-400 text-[11px] font-mono break-all">{selectedQr.id}</p>
              {selectedQr.routes && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <div
                    className="w-4 h-4 rounded-full border border-white/10"
                    style={{ backgroundColor: getColorHex(selectedQr.routes.color) }}
                  />
                  <span className="text-white text-sm font-black font-mono">{selectedQr.routes.grade}</span>
                  <span className="text-zinc-500 text-xs">{selectedQr.routes.zones?.name}</span>
                </div>
              )}
              {selectedQr.status === 'available' && (
                <p className="text-green-400 text-xs font-medium mt-2">Disponible</p>
              )}
            </div>

            <button
              onClick={() => window.print()}
              className="w-full bg-yellow-400 text-zinc-950 font-black text-sm py-3 rounded-2xl hover:bg-yellow-300 transition-all"
            >
              Imprimir
            </button>

            <button
              onClick={() => setSelectedQr(null)}
              className="w-full bg-zinc-800 text-zinc-300 font-bold text-sm py-3 rounded-2xl hover:bg-zinc-700 transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
