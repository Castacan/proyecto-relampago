import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { call, money, fmtDate, scheduleLabel, subscriptionLink } from '../lib/erp'

// Portal del cliente dentro de "Mi cuenta": membresía, domiciliación,
// clases y compras. Lee get_my_portal (solo sus propios datos).

interface Portal {
  person: { full_name: string; phone: string | null; email: string | null } | null
  membership_until: string | null
  free_left_this_month: number
  subscriptions: { id: string; status: string; product_name: string; price_cents: number; promo_cycles: number; promo_price_cents: number | null
    cycles_paid: number; next_charge_on: string; next_amount_cents: number; card_brand: string | null; card_last4: string | null
    cancel_at_period_end: boolean; last_error: string | null }[]
  sales: { folio: number; created_at: string; total_cents: number; items: string | null }[]
}

export default function MyMembership() {
  const [p, setP] = useState<Portal | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [access, setAccess] = useState<{ access_code: string; pending_documents: { title: string }[] } | null>(null)
  const [showQr, setShowQr] = useState(false)
  useEffect(() => { call<Portal>('get_my_portal').then(({ data }) => setP(data ?? null)) }, [])
  useEffect(() => { call<{ access_code: string; pending_documents: { title: string }[] }>('get_my_access').then(({ data }) => setAccess(data?.access_code ? data : null)) }, [])

  const updateCard = async (id: string) => {
    setBusy(id)
    const { data } = await call<{ token: string }>('my_subscription_link', { p_subscription_id: id })
    setBusy(null)
    if (data?.token) window.location.href = subscriptionLink(data.token)
  }

  if (!p) return null
  return (
    <div className="space-y-3">
      {access && access.pending_documents.length > 0 && (
        <Link to="/firmar" className="block bg-amarillo-suave/10 border border-amarillo-suave/60 rounded-2xl p-4">
          <p className="text-amarillo-suave font-bold">Firma tu responsiva y el reglamento</p>
          <p className="text-zinc-300 text-sm">Es necesario para poder escalar. Toma 2 minutos → </p>
        </Link>
      )}
      <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-widest">Mi membresía</p>
      <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4 space-y-1">
        {p.membership_until ? (
          <>
            <p className="text-exito font-black text-lg">Activa hasta el {fmtDate(p.membership_until)}</p>
            <p className="text-zinc-400 text-sm">{p.free_left_this_month > 0 ? 'Tienes tu clase gratis de este mes disponible.' : 'Ya usaste tu clase gratis de este mes.'}</p>
          </>
        ) : (
          <>
            <p className="text-texto-principal font-bold">Sin membresía activa</p>
            <p className="text-zinc-400 text-sm">Pregunta en el gym por la membresía mensual o la domiciliación.</p>
          </>
        )}
        {!p.person && <p className="text-zinc-500 text-xs pt-1">Si ya eres cliente y no ves tu membresía, pide en el gym que liguen tu correo a tu ficha.</p>}
      </div>

      {p.subscriptions.map(s => (
        <div key={s.id} className={`bg-superficie rounded-2xl border p-4 space-y-2 ${s.status === 'past_due' ? 'border-alerta/60' : 'border-zinc-800/60'}`}>
          <p className="text-texto-principal font-bold">{s.product_name} · cobro automático</p>
          <p className="text-zinc-400 text-sm">{scheduleLabel(s.price_cents, s.promo_cycles || null, s.promo_price_cents)}</p>
          {s.status === 'pending_card' && <p className="text-amarillo-suave text-sm font-semibold">Falta registrar tu tarjeta.</p>}
          {s.status === 'past_due' && <p className="text-alerta text-sm font-semibold">No pudimos cobrar: {s.last_error ?? 'el banco rechazó el cargo'}. Actualiza tu tarjeta.</p>}
          {s.card_last4 && <p className="text-zinc-300 text-sm">Tarjeta {s.card_brand} •••• {s.card_last4}</p>}
          <p className="text-zinc-300 text-sm">{s.cancel_at_period_end ? `Termina el ${fmtDate(s.next_charge_on)}` : `Próximo cobro: ${fmtDate(s.next_charge_on)} · ${money(s.next_amount_cents)}`}</p>
          <button onClick={() => updateCard(s.id)} disabled={busy === s.id}
            className="w-full py-2.5 rounded-xl bg-superficie-alta border border-zinc-700/50 text-texto-principal text-sm font-bold disabled:opacity-50">
            {busy === s.id ? 'Abriendo…' : s.status === 'pending_card' ? 'Registrar mi tarjeta' : 'Cambiar mi tarjeta'}
          </button>
        </div>
      ))}

      {access && (
        <div className="bg-superficie rounded-2xl border border-zinc-800/60 p-4">
          <button onClick={() => setShowQr(v => !v)} className="w-full flex items-center justify-between">
            <span className="text-texto-principal font-semibold text-sm">Mi código de entrada (QR)</span>
            <span className="text-zinc-500 text-sm">{showQr ? 'Ocultar' : 'Mostrar'}</span>
          </button>
          {showQr && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <div className="bg-white p-3 rounded-xl"><QRCode value={access.access_code} size={180} /></div>
              <p className="text-zinc-400 text-xs font-mono">{access.access_code}</p>
              <p className="text-zinc-500 text-xs text-center">Muéstralo en recepción al llegar.</p>
            </div>
          )}
        </div>
      )}

      <Link to="/clases" className="flex items-center justify-between px-4 py-3.5 bg-superficie border border-zinc-800/60 rounded-2xl hover:border-zinc-700">
        <span className="text-texto-principal font-semibold text-sm">Mis clases y reservas</span>
        <span className="text-zinc-500 text-sm">→</span>
      </Link>

      {p.sales.length > 0 && (
        <details className="bg-superficie rounded-2xl border border-zinc-800/60 p-4">
          <summary className="text-texto-principal font-semibold text-sm cursor-pointer">Mis compras ({p.sales.length})</summary>
          <div className="mt-2 divide-y divide-zinc-800/80">
            {p.sales.map(s => (
              <div key={s.folio} className="py-2 flex justify-between gap-3 text-sm">
                <span className="text-zinc-300">{s.items} <span className="text-zinc-500 text-xs">· {fmtDate(s.created_at.slice(0, 10))}</span></span>
                <span className="text-texto-principal font-bold">{money(s.total_cents)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
