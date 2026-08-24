import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmingUnassign, setConfirmingUnassign] = useState(false)
  const [unassigning, setUnassigning] = useState(false)

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

  // El botón "Imprimir" del detalle de un solo QR manda a imprimir SOLO
  // ese, sin depender ni tocar la selección múltiple de abajo.
  const printList = selectedQr ? [selectedQr] : qrs.filter(q => selectedIds.has(q.id))
  const allFilteredSelected = filtered.length > 0 && filtered.every(q => selectedIds.has(q.id))

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Desasignar un QR de su ruta (2026-08-24) — lo libera para reusarse en
  // otra ruta, sin tocar la ruta en sí (a diferencia de retirar una ruta,
  // que además libera su QR desde RouteDetail). Mismo update que ahí:
  // status vuelve a 'available' y route_id a null.
  async function handleUnassign(qr: QrRow) {
    setUnassigning(true)
    const { error } = await supabase.from('qr_codes').update({ status: 'available', route_id: null }).eq('id', qr.id)
    setUnassigning(false)
    setConfirmingUnassign(false)
    if (error) return
    const updated: QrRow = { ...qr, status: 'available', routes: null }
    setQrs(prev => prev.map(q => q.id === qr.id ? updated : q))
    setSelectedQr(updated)
  }

  const toggleSelectAllFiltered = () => {
    setSelectedIds(prev => {
      if (allFilteredSelected) {
        const next = new Set(prev)
        filtered.forEach(q => next.delete(q.id))
        return next
      }
      const next = new Set(prev)
      filtered.forEach(q => next.add(q.id))
      return next
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      {/* Stats header */}
      <div className="px-4 pt-5 pb-4">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-4">Inventario QR</h1>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-superficie rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-green-400 font-black text-3xl leading-none">{available}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">Disponibles</p>
          </div>
          <div className="bg-superficie rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-primario font-black text-3xl leading-none">{inUse}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">En uso</p>
          </div>
          <div className="bg-superficie rounded-2xl p-4 border border-zinc-800/80">
            <p className="text-zinc-300 font-black text-3xl leading-none">{qrs.length}</p>
            <p className="text-zinc-500 text-xs font-medium mt-1.5">Total</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 px-4 mb-4">
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
                ? 'bg-primario text-texto-en-acento shadow-md shadow-primario/20'
                : 'bg-superficie-alta text-zinc-400 hover:bg-superficie-alta-hover hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        {!loading && filtered.length > 0 && (
          <button
            onClick={toggleSelectAllFiltered}
            className="ml-auto text-zinc-500 hover:text-zinc-300 text-[11px] font-bold underline underline-offset-2 shrink-0"
          >
            {allFilteredSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-2.5 px-4 ${selectedIds.size > 0 ? 'pb-24' : 'pb-6'}`}>
          {filtered.map(qr => (
            <button
              key={qr.id}
              onClick={() => { setSelectedQr(qr); setConfirmingUnassign(false) }}
              className={`relative p-4 rounded-2xl border text-left transition-all active:scale-95 ${
                qr.status === 'available'
                  ? 'bg-superficie border-zinc-800/80 hover:border-zinc-700'
                  : 'bg-superficie border-zinc-700/60 hover:border-zinc-600'
              } ${selectedIds.has(qr.id) ? '!border-primario' : ''}`}
            >
              <div
                onClick={e => toggleSelect(qr.id, e)}
                className={`absolute top-2.5 right-2.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                  selectedIds.has(qr.id)
                    ? 'bg-primario border-primario'
                    : 'border-zinc-600 hover:border-zinc-400'
                }`}
              >
                {selectedIds.has(qr.id) && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>

              <div className="flex items-center gap-2 mb-2.5 pr-6">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  qr.status === 'available' ? 'bg-green-400' : 'bg-primario'
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
                    <p className="text-texto-principal text-sm font-black font-mono leading-none">{qr.routes.grade}</p>
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
            className="relative w-full bg-superficie rounded-t-3xl p-6 flex flex-col items-center gap-5"
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
                  <span className="text-texto-principal text-sm font-black font-mono">{selectedQr.routes.grade}</span>
                  <span className="text-zinc-500 text-xs">{selectedQr.routes.zones?.name}</span>
                </div>
              )}
              {selectedQr.status === 'available' && (
                <p className="text-green-400 text-xs font-medium mt-2">Disponible</p>
              )}
              {selectedQr.status === 'in_use' && !selectedQr.routes && (
                <p className="text-zinc-600 text-xs font-medium mt-2">Ruta retirada — este QR sigue marcado como en uso</p>
              )}
            </div>

            {selectedQr.status === 'in_use' && (
              confirmingUnassign ? (
                <div className="w-full flex gap-2.5">
                  <button
                    onClick={() => setConfirmingUnassign(false)}
                    className="flex-1 bg-superficie-alta text-zinc-300 font-bold text-sm py-3 rounded-2xl hover:bg-superficie-alta-hover transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleUnassign(selectedQr)}
                    disabled={unassigning}
                    className="flex-1 bg-red-500 hover:bg-red-400 text-texto-principal font-bold text-sm py-3 rounded-2xl transition-all disabled:opacity-50"
                  >
                    {unassigning ? 'Desasignando...' : '¿Confirmar?'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingUnassign(true)}
                  className="w-full bg-superficie-alta border border-dashed border-zinc-600 text-zinc-300 font-bold text-sm py-3 rounded-2xl hover:bg-superficie-alta-hover hover:border-zinc-500 hover:text-texto-principal transition-all"
                >
                  Desasignar QR
                </button>
              )
            )}

            <button
              onClick={() => window.print()}
              className="w-full bg-primario text-texto-en-acento font-black text-sm py-3 rounded-2xl hover:bg-primario-hover transition-all"
            >
              Imprimir
            </button>

            <button
              onClick={() => setSelectedQr(null)}
              className="w-full bg-superficie-alta text-zinc-300 font-bold text-sm py-3 rounded-2xl hover:bg-superficie-alta-hover transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Barra flotante de selección múltiple */}
      {selectedIds.size > 0 && !selectedQr && (
        <div className="fixed bottom-20 left-4 right-4 z-40 bg-superficie border border-zinc-700 rounded-2xl shadow-xl shadow-black/40 p-3 flex items-center gap-3">
          <span className="text-texto-principal text-sm font-bold flex-1">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-zinc-400 hover:text-zinc-200 text-xs font-bold px-3 py-2"
          >
            Cancelar
          </button>
          <button
            onClick={() => window.print()}
            className="bg-primario text-texto-en-acento font-black text-sm px-5 py-2.5 rounded-xl hover:bg-primario-hover transition-all"
          >
            Imprimir
          </button>
        </div>
      )}

      {/* Hoja de impresión — portal a document.body, oculta en pantalla,
          visible solo dentro de @media print (ver src/index.css). Cada QR
          sale a 4x4cm exactos con guía de corte punteada, listo para
          cortar y laminar. */}
      {printList.length > 0 && createPortal(
        <div id="qr-print-sheet">
          {printList.map(qr => (
            <div className="qr-print-cell" key={qr.id}>
              <div className="qr-print-box">
                <QRCode
                  value={`${window.location.origin}/q/${qr.id}`}
                  level="M"
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              <span className="qr-print-label">{qr.id.slice(0, 8)}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
