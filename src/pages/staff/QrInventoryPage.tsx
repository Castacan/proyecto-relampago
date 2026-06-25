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
    <div className="h-full overflow-y-auto bg-zinc-950 p-4">
      <h1 className="text-white font-bold text-lg mb-1">Inventario QR</h1>
      <p className="text-zinc-500 text-sm mb-4">{available} disponibles · {inUse} asignados</p>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
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
        <div className="grid grid-cols-2 gap-2">
          {filtered.map(qr => (
            <div
              key={qr.id}
              className={`p-3 rounded-xl border ${
                qr.status === 'available'
                  ? 'bg-zinc-900 border-zinc-800'
                  : 'bg-zinc-900 border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${qr.status === 'available' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                <span className="text-zinc-400 text-xs font-mono">QR {qr.id}</span>
              </div>

              {qr.status === 'available' ? (
                <p className="text-zinc-600 text-xs">Disponible</p>
              ) : qr.routes ? (
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: getColorHex(qr.routes.color) }}
                  />
                  <span className="text-white text-xs font-semibold font-mono">
                    {qr.routes.grade}
                  </span>
                  <span className="text-zinc-500 text-xs truncate">
                    {qr.routes.zones?.name}
                  </span>
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
