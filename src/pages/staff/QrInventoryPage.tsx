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
            <div
              key={qr.id}
              className={`p-4 rounded-2xl border transition-all ${
                qr.status === 'available'
                  ? 'bg-zinc-900 border-zinc-800/80'
                  : 'bg-zinc-900 border-zinc-700/60'
              }`}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  qr.status === 'available' ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <span className="text-zinc-300 text-xs font-bold font-mono">{qr.id}</span>
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
