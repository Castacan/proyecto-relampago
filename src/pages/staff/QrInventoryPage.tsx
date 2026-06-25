import { useEffect, useState } from 'react'
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

  return (
    <div className="h-full overflow-y-auto bg-zinc-950">
      {/* Stats header */}
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-white font-bold text-xl mb-3">Inventario QR</h1>
        <div className="flex gap-2">
          <div className="flex-1 bg-zinc-900 rounded-xl p-3 border border-zinc-800">
            <p className="text-green-400 font-bold text-2xl">{available}</p>
            <p className="text-zinc-500 text-xs mt-0.5">Disponibles</p>
          </div>
          <div className="flex-1 bg-zinc-900 rounded-xl p-3 border border-zinc-800">
            <p className="text-yellow-400 font-bold text-2xl">{inUse}</p>
            <p className="text-zinc-500 text-xs mt-0.5">En uso</p>
          </div>
          <div className="flex-1 bg-zinc-900 rounded-xl p-3 border border-zinc-800">
            <p className="text-zinc-300 font-bold text-2xl">{qrs.length}</p>
            <p className="text-zinc-500 text-xs mt-0.5">Total</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 mb-3">
        {(['all', 'available', 'in_use'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === f ? 'bg-yellow-400 text-zinc-950' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'available' ? 'Disponibles' : 'Asignados'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="w-6 h-6 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-4 pb-6">
          {filtered.map(qr => (
            <div
              key={qr.id}
              className={`p-3 rounded-xl border transition-all ${
                qr.status === 'available'
                  ? 'bg-zinc-900 border-zinc-800'
                  : 'bg-zinc-900 border-zinc-700/80'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  qr.status === 'available' ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <span className="text-zinc-400 text-xs font-mono font-semibold">{qr.id}</span>
              </div>

              {qr.status === 'available' ? (
                <p className="text-zinc-600 text-xs">Libre</p>
              ) : qr.routes ? (
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full shrink-0 border border-white/10"
                    style={{ backgroundColor: getColorHex(qr.routes.color) }}
                  />
                  <div className="min-w-0">
                    <p className="text-white text-xs font-bold font-mono">{qr.routes.grade}</p>
                    <p className="text-zinc-500 text-[10px] truncate">{qr.routes.zones?.name}</p>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-600 text-xs">Ruta retirada</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
