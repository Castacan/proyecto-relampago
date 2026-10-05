import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import {
  COMPETITION_SLUG, SHIRT_SIZES, STATUS_LABELS, UNLIMITED_CAPACITY, formatPrice, formatDeadline,
  type RegistrationStatus, type ShirtSize,
} from '../../lib/competition'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface AdminCompetition {
  name: string
  event_date: string
  price_cents: number
  capacity_total: number
  is_open: boolean
  hold_hours: number
  payment_link_url: string | null
  payment_instructions: string | null
}

interface AdminCategory {
  id: string
  name: string
  capacity: number | null
}

interface AdminRegistration {
  id: string
  folio: string
  full_name: string
  birth_date: string
  email: string | null   // null en inscripciones manuales sin correo
  phone: string | null
  category_id: string
  shirt_size: ShirtSize
  status: RegistrationStatus
  hold_expires_at: string | null
  hold_expired: boolean
  paid_at: string | null
  payment_method: string | null
  checked_in_at: string | null
  created_at: string
  is_minor: boolean
}

type Action = 'mark_paid' | 'resolve_attention' | 'cancel' | 'mark_refunded' | 'edit' | 'extend_hold' | 'check_in' | 'undo_check_in'

const ACTION_LABELS: Record<Action, string> = {
  mark_paid: 'Marcar pagado',
  resolve_attention: 'Admitir (confirmar lugar)',
  cancel: 'Cancelar inscripción',
  mark_refunded: 'Registrar reembolso',
  edit: 'Editar datos',
  extend_hold: 'Re-apartar lugar',
  check_in: 'Check-in',
  undo_check_in: 'Quitar check-in',
}

// 'clip' lo pone el sistema cuando el pago en línea se confirma; no es
// elegible al marcar pagado a mano (MANUAL_METHODS).
const PAYMENT_METHODS: Record<string, string> = {
  clip: 'Clip en línea',
  cash: 'Efectivo',
  card: 'Tarjeta en sucursal',
  link: 'Link de pago',
  transfer: 'Transferencia',
  other: 'Otro',
}

const MANUAL_METHODS = ['cash', 'card', 'transfer', 'link', 'other']

interface PaymentReview {
  id: string
  folio: string
  full_name: string
  registration_status: RegistrationStatus
  amount_cents: number
  receipt_no: string | null
  review_reason: string
  completed_at: string | null
}

interface PaymentsSummary {
  completed: number
  open: number
  last_check_at: string | null
  unknown_events: number
  review: PaymentReview[]
}

const REVIEW_REASONS: Record<string, string> = {
  duplicate: 'Pago duplicado: esta inscripción ya tenía un pago. Hay que reembolsar uno en Clip.',
  amount_mismatch: 'El monto cobrado no coincide con el precio.',
  no_room: 'Pagó después de que venció su reserva y ya no había cupo. Admítelo o reembólsalo.',
  registration_inactive: 'Pagó una inscripción cancelada, reembolsada o vencida. Hay que reembolsar o reactivar.',
}

const ACTION_ERRORS: Record<string, string> = {
  invalid_birth_date: 'Revisa la fecha de nacimiento.',
  invalid_shirt_size: 'Elige una talla.',
  invalid_category: 'Elige una categoría.',
  duplicate: 'Esa persona ya tiene una inscripción activa. Búscala en la lista: si está pendiente, márcala como pagada.',
  category_full: 'Esa categoría ya está llena.',
  forbidden: 'No tienes permiso.',
  reason_required: 'Escribe el motivo.',
  invalid_state: 'La inscripción ya cambió de estado. Actualiza la lista.',
  invalid_method: 'Elige el método de pago.',
  has_other_active: 'Esta persona ya tiene otra inscripción activa.',
  full: 'Ya no hay cupo para re-apartar.',
  invalid_name: 'Nombre inválido.',
  invalid_email: 'Correo inválido.',
  invalid_phone: 'El celular debe tener 10 dígitos.',
  invalid_value: 'Valor inválido.',
  invalid_link: 'El link debe empezar con https://',
}

// Estado que se muestra: un pendiente con la reserva vencida se ve como
// "Vencido" aunque en la tabla siga como pending_payment (ver competencia.sql).
function displayStatus(r: AdminRegistration): RegistrationStatus {
  return r.status === 'pending_payment' && r.hold_expired ? 'expired' : r.status
}

const STATUS_STYLE: Record<RegistrationStatus, string> = {
  paid: 'text-exito bg-exito/10',
  pending_payment: 'text-amarillo-suave bg-amarillo-suave/10',
  needs_attention: 'text-white bg-alerta',
  expired: 'text-zinc-300 bg-superficie-alta',
  cancelled: 'text-zinc-300 bg-superficie-alta',
  refunded: 'text-zinc-300 bg-superficie-alta',
}

function actionsFor(r: AdminRegistration): Action[] {
  switch (r.status) {
    case 'pending_payment': return ['mark_paid', 'extend_hold', 'edit', 'cancel']
    case 'expired': return ['mark_paid', 'extend_hold', 'cancel']
    case 'paid': return [r.checked_in_at ? 'undo_check_in' : 'check_in', 'edit', 'mark_refunded']
    case 'needs_attention': return ['resolve_attention', 'mark_refunded', 'edit']
    default: return []
  }
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' })

const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
const smallBtn = 'text-zinc-200 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all disabled:opacity-50'

export default function CompetitionAdminPage() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'

  const [comp, setComp] = useState<AdminCompetition | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [regs, setRegs] = useState<AdminRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RegistrationStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [minorsOnly, setMinorsOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [payments, setPayments] = useState<PaymentsSummary | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)

  const fetchAll = () => {
    if (!isAdmin) return
    setLoading(true)
    db.rpc('get_competition_admin', { p_slug: COMPETITION_SLUG })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: { data: any; error: unknown }) => {
        if (error || !data || data.error) {
          setError('No se pudo cargar la competencia.')
        } else {
          setError(null)
          setComp(data.competition)
          setCategories(data.categories)
          setRegs(data.registrations)
        }
        setLoading(false)
      })
    db.rpc('get_competition_payments_admin', { p_slug: COMPETITION_SLUG })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: { data: any; error: unknown }) => {
        // Si el SQL de pagos aún no se corre, el panel sigue funcionando sin esta sección.
        setPayments(!error && data && !data.error ? data : null)
      })
  }

  // Le pide al servidor que consulte en Clip TODOS los links abiertos. Es
  // la red de seguridad por si un aviso automático de Clip no llegó.
  const reconcile = async () => {
    setReconciling(true)
    setReconcileMsg(null)
    const { data, error } = await supabase.functions.invoke('competition-payments', { body: { action: 'reconcile' } })
    setReconciling(false)
    if (error || !data || data.error) {
      setReconcileMsg('No se pudo revisar con Clip. Intenta de nuevo.')
      return
    }
    setReconcileMsg(
      `Revisados ${data.checked} links abiertos: ${data.completed} pagos nuevos confirmados` +
      (data.errors > 0 ? `, ${data.errors} no se pudieron consultar` : '') +
      (data.pending_more > 0 ? `. Faltan ${data.pending_more}: presiona de nuevo` : '') + '.'
    )
    fetchAll()
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  const categoryName = useMemo(() => {
    const map = new Map(categories.map(c => [c.id, c.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [categories])

  const counts = useMemo(() => {
    const by = (s: RegistrationStatus) => regs.filter(r => displayStatus(r) === s).length
    const paid = by('paid')
    const pending = by('pending_payment')
    const attention = by('needs_attention')
    const sizes = Object.fromEntries(SHIRT_SIZES.map(s => [s, regs.filter(r => r.status === 'paid' && r.shirt_size === s).length]))
    return {
      paid, pending, attention, expired: by('expired'),
      checkedIn: regs.filter(r => r.status === 'paid' && r.checked_in_at).length,
      taken: paid + pending + attention,
      sizes,
    }
  }, [regs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return regs.filter(r => {
      if (statusFilter !== 'all' && displayStatus(r) !== statusFilter) return false
      if (categoryFilter !== 'all' && r.category_id !== categoryFilter) return false
      if (minorsOnly && !r.is_minor) return false
      if (!q) return true
      return r.full_name.toLowerCase().includes(q) || r.folio.toLowerCase().includes(q)
        || (r.email ?? '').includes(q) || (r.phone ?? '').includes(q)
    })
  }, [regs, search, statusFilter, categoryFilter, minorsOnly])

  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-fondo">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )
  if (!isAdmin) return <Navigate to="/staff" replace />

  const exportCsv = () => {
    const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`
    const header = 'Folio,Nombre,Fecha de nacimiento,Menor,Correo,Celular,Categoría,Talla,Estado,Método de pago,Fecha de pago,Check-in,Inscrito el\n'
    const rows = regs.map(r => [
      r.folio, r.full_name, r.birth_date, r.is_minor ? 'Sí' : 'No', r.email, r.phone,
      categoryName(r.category_id), r.shirt_size, STATUS_LABELS[displayStatus(r)],
      r.payment_method ? PAYMENT_METHODS[r.payment_method] ?? r.payment_method : '',
      r.paid_at ? fmtDateTime(r.paid_at) : '', r.checked_in_at ? fmtDateTime(r.checked_in_at) : '',
      fmtDateTime(r.created_at),
    ].map(esc).join(','))
    // BOM UTF-8 al inicio: sin él Excel abre el archivo como ANSI y rompe
    // acentos y ñ.
    const blob = new Blob(['﻿' + header + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `competencia_inscritos_${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto bg-fondo px-4 pt-5 pb-10">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-texto-principal font-black text-2xl tracking-tight">Competencia</h1>
          <p className="text-zinc-400 text-xs truncate">{comp?.name ?? 'Inscripciones'}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowManual(v => !v)}
            className="text-xs font-bold px-3 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento transition-all">
            {showManual ? 'Cerrar' : '+ Inscribir aquí'}
          </button>
          <button onClick={fetchAll} className={smallBtn}>Actualizar</button>
          <button onClick={exportCsv} disabled={regs.length === 0} className={smallBtn}>CSV</button>
        </div>
      </div>

      {error && <p className="text-alerta text-xs mb-3">{error}</p>}

      {loading && !comp ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
        </div>
      ) : comp && (
        <>
          {showManual && <ManualRegistrationForm categories={categories} onDone={fetchAll} />}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Counter label="Pagados" value={counts.paid} sub={formatPrice(counts.paid * comp.price_cents)} accent />
            <Counter label="Pendientes" value={counts.pending} sub="con lugar apartado" />
            <Counter label="Por atender" value={counts.attention} sub={counts.attention > 0 ? 'requieren decisión' : 'todo en orden'} alert={counts.attention > 0} />
            {comp.capacity_total >= UNLIMITED_CAPACITY
              ? <Counter label="Lugares ocupados" value={counts.taken} sub="sin límite de cupo" />
              : <Counter label="Cupo libre" value={Math.max(comp.capacity_total - counts.taken, 0)} sub={`de ${comp.capacity_total}`} />}
          </div>

          <div className="bg-superficie rounded-2xl border border-zinc-800/80 px-4 py-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="text-zinc-400 font-semibold">Playeras (pagados):</span>
            {SHIRT_SIZES.map(s => (
              <span key={s} className="text-texto-principal font-bold tabular-nums">{s} <span className="text-primario">{counts.sizes[s]}</span></span>
            ))}
            <span className="text-zinc-400 ml-auto">Vencidos: {counts.expired} · Check-in: {counts.checkedIn}/{counts.paid}</span>
          </div>

          <div className="bg-superficie rounded-2xl border border-zinc-800/80 px-4 py-3 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-bold ${comp.is_open ? 'text-exito' : 'text-zinc-300'}`}>
                  Inscripciones {comp.is_open ? 'abiertas' : 'cerradas'}
                </p>
                <p className="text-zinc-400 text-xs">
                  {formatPrice(comp.price_cents)} · {comp.payment_link_url ? 'pago por link manual' : 'pago en línea con Clip'}
                </p>
              </div>
              <button onClick={() => setShowSettings(v => !v)} className={smallBtn}>
                {showSettings ? 'Ocultar ajustes' : 'Ajustes'}
              </button>
            </div>
            {showSettings && <SettingsForm comp={comp} onSaved={fetchAll} />}
          </div>

          {payments && (
            <div className={`bg-superficie rounded-2xl border px-4 py-3 mb-4 ${payments.review.length > 0 || payments.unknown_events > 0 ? 'border-alerta' : 'border-zinc-800/80'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-texto-principal text-sm font-bold">Pagos en línea (Clip)</p>
                  <p className="text-zinc-400 text-xs">
                    {payments.completed} confirmados · {payments.open} links abiertos
                    {payments.last_check_at && ` · última revisión ${fmtDateTime(payments.last_check_at)}`}
                  </p>
                </div>
                <button onClick={reconcile} disabled={reconciling} className={smallBtn}>
                  {reconciling ? 'Revisando...' : 'Revisar pagos con Clip'}
                </button>
              </div>
              {reconcileMsg && <p role="status" className="text-zinc-200 text-xs mt-2">{reconcileMsg}</p>}
              {payments.unknown_events > 0 && (
                <p className="text-alerta text-xs font-semibold mt-2">
                  Clip reportó {payments.unknown_events} {payments.unknown_events === 1 ? 'pago que no corresponde' : 'pagos que no corresponden'} a ninguna inscripción. Revísalo en tu panel de Clip.
                </p>
              )}
              {payments.review.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-800/60 space-y-3">
                  <p className="text-alerta text-xs font-bold">Pagos que requieren tu decisión</p>
                  {payments.review.map(pr => <PaymentReviewRow key={pr.id} review={pr} onDone={fetchAll} />)}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 mb-4">
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setOpenId(null) }}
              placeholder="Buscar por nombre, folio, correo o celular..." className={inputClass} />
            <div className="flex flex-wrap gap-2">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as RegistrationStatus | 'all')}
                aria-label="Filtrar por estado" className={`${inputClass} w-auto flex-1 min-w-[9rem]`}>
                <option value="all">Todos los estados</option>
                {(Object.keys(STATUS_LABELS) as RegistrationStatus[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                aria-label="Filtrar por categoría" className={`${inputClass} w-auto flex-1 min-w-[9rem]`}>
                <option value="all">Todas las categorías</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <label className="flex items-center gap-2 text-zinc-200 text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 border border-zinc-700/50 cursor-pointer">
                <input type="checkbox" checked={minorsOnly} onChange={e => setMinorsOnly(e.target.checked)} className="accent-primario" />
                Solo menores
              </label>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-zinc-400 text-xs">{regs.length === 0 ? 'Aún no hay inscripciones.' : 'Sin resultados con esos filtros.'}</p>
          ) : (
            <>
              <p className="text-zinc-400 text-[11px] mb-2">{filtered.length} de {regs.length} inscripciones</p>
              <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60">
                {filtered.map(r => {
                  const shown = displayStatus(r)
                  return (
                    <div key={r.id} className="px-4 py-3">
                      <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-texto-principal font-bold text-sm">{r.full_name}</span>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLE[shown]}`}>{STATUS_LABELS[shown]}</span>
                          {r.is_minor && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-texto-en-acento bg-amarillo-suave">Menor</span>}
                          {r.checked_in_at && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-exito bg-exito/10">Check-in</span>}
                        </div>
                        <div className="text-zinc-300 text-xs mt-0.5">
                          <span className="font-mono font-bold">{r.folio}</span> · {categoryName(r.category_id)} · talla {r.shirt_size}
                        </div>
                        <div className="text-zinc-400 text-xs truncate">{[r.email, r.phone].filter(Boolean).join(' · ') || 'Sin correo ni celular'}</div>
                        <div className="text-zinc-400 text-[10px] mt-0.5">
                          Inscrito {fmtDateTime(r.created_at)}
                          {r.paid_at && ` · pagado ${fmtDateTime(r.paid_at)}${r.payment_method ? ` (${PAYMENT_METHODS[r.payment_method] ?? r.payment_method})` : ''}`}
                          {r.status === 'pending_payment' && r.hold_expires_at && ` · reserva ${r.hold_expired ? 'venció' : 'vence'} ${formatDeadline(r.hold_expires_at)}`}
                        </div>
                      </button>
                      {openId === r.id && (
                        <ActionPanel reg={r} categories={categories} onDone={() => { setOpenId(null); fetchAll() }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Counter({ label, value, sub, accent, alert }: { label: string; value: number; sub: string; accent?: boolean; alert?: boolean }) {
  return (
    <div className={`bg-superficie rounded-2xl border p-3 ${alert ? 'border-alerta' : 'border-zinc-800/80'}`}>
      <p className="text-zinc-400 text-[11px] font-semibold">{label}</p>
      <p className={`font-black text-2xl leading-tight tabular-nums ${alert ? 'text-alerta' : accent ? 'text-primario' : 'text-texto-principal'}`}>{value}</p>
      <p className="text-zinc-400 text-[10px] truncate">{sub}</p>
    </div>
  )
}

function SettingsForm({ comp, onSaved }: { comp: AdminCompetition; onSaved: () => void }) {
  const [isOpen, setIsOpen] = useState(comp.is_open)
  const [capacity, setCapacity] = useState(String(comp.capacity_total))
  const [holdHours, setHoldHours] = useState(String(comp.hold_hours))
  const [price, setPrice] = useState(String(comp.price_cents / 100))
  const [link, setLink] = useState(comp.payment_link_url ?? '')
  const [instructions, setInstructions] = useState(comp.payment_instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    const { data, error } = await db.rpc('admin_update_competition', {
      p_slug: COMPETITION_SLUG,
      p_patch: {
        is_open: isOpen,
        capacity_total: Number(capacity),
        hold_hours: Number(holdHours),
        price_cents: Math.round(Number(price) * 100),
        payment_link_url: link,
        payment_instructions: instructions,
      },
    })
    setSaving(false)
    if (error || !data || data.error) {
      setError(ACTION_ERRORS[data?.error] ?? 'No se pudo guardar.')
      return
    }
    onSaved()
  }

  return (
    <div className="mt-4 pt-4 border-t border-zinc-800/60 space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} className="w-5 h-5 accent-primario" />
        <span className="text-texto-principal text-sm font-semibold">Inscripciones abiertas</span>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="set-price" className="block text-zinc-300 text-xs font-bold mb-1">Precio (MXN)</label>
          <input id="set-price" type="number" min={1} step="0.01" value={price} onChange={e => setPrice(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="set-capacity" className="block text-zinc-300 text-xs font-bold mb-1">Cupo total ({UNLIMITED_CAPACITY} = sin límite)</label>
          <input id="set-capacity" type="number" min={0} value={capacity} onChange={e => setCapacity(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="set-hold" className="block text-zinc-300 text-xs font-bold mb-1">Horas para pagar</label>
          <input id="set-hold" type="number" min={1} max={720} value={holdHours} onChange={e => setHoldHours(e.target.value)} className={inputClass} />
        </div>
      </div>
      {Number(capacity) >= UNLIMITED_CAPACITY && (
        <p className="text-zinc-400 text-xs">
          Con cupo sin límite, "Horas para pagar" no se le muestra a nadie ni le quita su lugar: solo decide cuándo una inscripción sin pagar aparece aquí como "Vencido". Puede pagar igual después.
        </p>
      )}
      <div>
        <label htmlFor="set-link" className="block text-zinc-300 text-xs font-bold mb-1">Link de pago manual (déjalo vacío para cobrar con Clip en línea)</label>
        <input id="set-link" type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." className={inputClass} />
      </div>
      <div>
        <label htmlFor="set-instructions" className="block text-zinc-300 text-xs font-bold mb-1">Instrucciones de pago (se muestran junto al botón)</label>
        <textarea id="set-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} className={inputClass} />
      </div>
      {error && <p className="text-alerta text-xs">{error}</p>}
      <button onClick={save} disabled={saving}
        className="text-xs font-bold px-4 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento disabled:opacity-50">
        {saving ? 'Guardando...' : 'Guardar ajustes'}
      </button>
    </div>
  )
}

function ActionPanel({ reg, categories, onDone }: { reg: AdminRegistration; categories: AdminCategory[]; onDone: () => void }) {
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('cash')
  const [edit, setEdit] = useState({
    full_name: reg.full_name, email: reg.email ?? '', phone: reg.phone ?? '',
    category_id: reg.category_id, shirt_size: reg.shirt_size,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const available = actionsFor(reg)
  const needsReason = action !== null && action !== 'check_in' && action !== 'undo_check_in'

  const run = async (act: Action) => {
    if (act !== 'check_in' && act !== 'undo_check_in' && reason.trim().length < 3) { setError('Escribe el motivo.'); return }
    setBusy(true)
    setError(null)
    // Correo y celular vacíos no se mandan (una inscripción manual puede no tenerlos).
    const { email: editEmail, phone: editPhone, ...editRest } = edit
    const editPayload = {
      ...editRest,
      ...(editEmail.trim() ? { email: editEmail } : {}),
      ...(editPhone.trim() ? { phone: editPhone } : {}),
    }
    const payload = act === 'mark_paid' ? { method } : act === 'edit' ? editPayload : {}
    const { data, error } = await db.rpc('admin_update_registration', {
      p_id: reg.id, p_action: act, p_reason: reason, p_payload: payload,
    })
    setBusy(false)
    if (error || !data || data.error) {
      setError(ACTION_ERRORS[data?.error] ?? 'No se pudo completar la acción.')
      return
    }
    // El pago quedó registrado pero ya no había cupo: avisar antes de cerrar.
    if (act === 'mark_paid' && data.status === 'needs_attention') {
      setNotice('Pago registrado, pero ya no había cupo: quedó en "Por atender". Decide si lo admites o lo reembolsas.')
      return
    }
    onDone()
  }

  if (notice) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-superficie-alta border border-alerta space-y-2">
        <p className="text-texto-principal text-xs font-semibold">{notice}</p>
        <button onClick={onDone} className={smallBtn}>Entendido</button>
      </div>
    )
  }

  if (available.length === 0) {
    return <p className="mt-3 text-zinc-400 text-xs">Sin acciones disponibles para una inscripción {STATUS_LABELS[reg.status].toLowerCase()}.</p>
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-fondo/60 border border-zinc-800/80 space-y-3">
      <div className="flex flex-wrap gap-2">
        {available.map(a => (
          <button key={a} disabled={busy}
            onClick={() => { setError(null); if (a === 'check_in' || a === 'undo_check_in') run(a); else setAction(a) }}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-all disabled:opacity-50 ${
              action === a ? 'bg-primario text-texto-en-acento border-primario'
                : 'text-zinc-200 bg-superficie-alta/80 hover:bg-superficie-alta-hover border-zinc-700/50'}`}>
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      {action === 'mark_paid' && (
        <div>
          <label htmlFor={`method-${reg.id}`} className="block text-zinc-300 text-xs font-bold mb-1">¿Cómo pagó?</label>
          <select id={`method-${reg.id}`} value={method} onChange={e => setMethod(e.target.value)} className={inputClass}>
            {MANUAL_METHODS.map(k => <option key={k} value={k}>{PAYMENT_METHODS[k]}</option>)}
          </select>
        </div>
      )}

      {action === 'edit' && (
        <div className="space-y-2">
          <input aria-label="Nombre completo" value={edit.full_name} onChange={e => setEdit({ ...edit, full_name: e.target.value })} className={inputClass} />
          <input aria-label="Correo" type="email" value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} className={inputClass} />
          <input aria-label="Celular" type="tel" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Categoría" value={edit.category_id} onChange={e => setEdit({ ...edit, category_id: e.target.value })} className={inputClass}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Talla" value={edit.shirt_size} onChange={e => setEdit({ ...edit, shirt_size: e.target.value as ShirtSize })} className={inputClass}>
              {SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      {action && needsReason && (
        <>
          <div>
            <label htmlFor={`reason-${reg.id}`} className="block text-zinc-300 text-xs font-bold mb-1">Motivo (queda en el registro)</label>
            <input id={`reason-${reg.id}`} value={reason} onChange={e => setReason(e.target.value)}
              placeholder={action === 'mark_paid' ? 'Ej. pago visto en el panel, 4 oct 6:20 pm' : 'Ej. lo pidió el participante'} className={inputClass} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => run(action)} disabled={busy}
              className={`text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50 ${
                action === 'cancel' || action === 'mark_refunded' ? 'bg-alerta text-white' : 'bg-primario hover:bg-primario-hover text-texto-en-acento'}`}>
              {busy ? '...' : `Confirmar: ${ACTION_LABELS[action].toLowerCase()}`}
            </button>
            <button onClick={() => { setAction(null); setError(null) }} className="text-zinc-400 hover:text-zinc-200 text-xs">Volver</button>
          </div>
        </>
      )}

      {error && <p className="text-alerta text-xs">{error}</p>}
    </div>
  )
}

function PaymentReviewRow({ review, onDone }: { review: PaymentReview; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async () => {
    if (reason.trim().length < 3) { setError('Escribe qué se hizo con este pago.'); return }
    setBusy(true)
    setError(null)
    const { data, error } = await db.rpc('admin_resolve_payment_review', { p_payment_id: review.id, p_reason: reason })
    setBusy(false)
    if (error || !data || data.error) { setError('No se pudo guardar.'); return }
    onDone()
  }

  return (
    <div className="space-y-2">
      <p className="text-texto-principal text-xs">
        <span className="font-bold">{review.full_name}</span> · <span className="font-mono font-bold">{review.folio}</span>
        {' · '}{formatPrice(review.amount_cents)}
        {review.receipt_no && ` · recibo Clip ${review.receipt_no}`}
        {review.completed_at && ` · ${fmtDateTime(review.completed_at)}`}
      </p>
      <p className="text-zinc-300 text-xs">{REVIEW_REASONS[review.review_reason] ?? review.review_reason}</p>
      <div className="flex gap-2">
        <input aria-label={`Qué se hizo con el pago de ${review.full_name}`} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Qué se hizo (ej. reembolsado en Clip el 5 oct)" className={inputClass} />
        <button onClick={resolve} disabled={busy} className={smallBtn + ' shrink-0'}>{busy ? '...' : 'Marcar resuelto'}</button>
      </div>
      {error && <p className="text-alerta text-xs">{error}</p>}
    </div>
  )
}

// Inscripción de mostrador: alguien llega al gym y paga en efectivo (u otro
// medio fuera de la app). Queda PAGADA de inmediato. Correo y celular son
// opcionales; a estas inscripciones no se les manda correo de confirmación.
function ManualRegistrationForm({ categories, onDone }: { categories: AdminCategory[]; onDone: () => void }) {
  const empty = { full_name: '', birth_date: '', category_id: '', shirt_size: '' as ShirtSize | '', method: 'cash', phone: '', email: '', note: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ folio: string; full_name: string; category_name: string; is_minor: boolean } | null>(null)

  const set = (patch: Partial<typeof empty>) => { setForm(f => ({ ...f, ...patch })); setError(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.full_name.trim().length < 3) { setError('Escribe el nombre completo.'); return }
    if (!form.birth_date) { setError('Falta la fecha de nacimiento.'); return }
    if (!form.category_id) { setError('Elige una categoría.'); return }
    if (!form.shirt_size) { setError('Elige una talla.'); return }
    setBusy(true)
    setError(null)
    const { data, error } = await db.rpc('admin_register_participant', {
      p_slug: COMPETITION_SLUG,
      p_full_name: form.full_name,
      p_birth_date: form.birth_date,
      p_category_id: form.category_id,
      p_shirt_size: form.shirt_size,
      p_method: form.method,
      p_email: form.email.trim() || null,
      p_phone: form.phone.trim() || null,
      p_note: form.note.trim() || null,
    })
    setBusy(false)
    if (error || !data || data.error) {
      setError(ACTION_ERRORS[data?.error] ?? 'No se pudo inscribir. Intenta de nuevo.')
      return
    }
    setDone(data)
    setForm(empty)
    onDone()
  }

  const fieldLabel = 'block text-zinc-300 text-xs font-bold mb-1'

  return (
    <form onSubmit={submit} noValidate className="bg-superficie rounded-2xl border border-primario/40 px-4 py-4 mb-4 space-y-3">
      <div>
        <p className="text-texto-principal text-sm font-bold">Inscribir a alguien aquí en el gym</p>
        <p className="text-zinc-400 text-xs">Queda como pagado de inmediato. Úsalo cuando ya recibiste el dinero.</p>
      </div>

      {done && (
        <p role="status" className="rounded-xl bg-superficie-alta border border-exito/50 px-3 py-2 text-texto-principal text-sm">
          Inscrito: <span className="font-bold">{done.full_name}</span> · {done.category_name} · folio{' '}
          <span className="font-mono font-black text-primario">{done.folio}</span>
          {done.is_minor && <span className="block text-amarillo-suave text-xs font-semibold mt-1">Es menor: debe firmar un mayor de edad.</span>}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="man-name" className={fieldLabel}>Nombre completo</label>
          <input id="man-name" value={form.full_name} onChange={e => set({ full_name: e.target.value })} maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="man-birth" className={fieldLabel}>Fecha de nacimiento</label>
          <input id="man-birth" type="date" value={form.birth_date} onChange={e => set({ birth_date: e.target.value })} min="1920-01-01" className={inputClass} />
        </div>
        <div>
          <label htmlFor="man-cat" className={fieldLabel}>Categoría</label>
          <select id="man-cat" value={form.category_id} onChange={e => set({ category_id: e.target.value })} className={inputClass}>
            <option value="">Elige...</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="man-size" className={fieldLabel}>Talla</label>
            <select id="man-size" value={form.shirt_size} onChange={e => set({ shirt_size: e.target.value as ShirtSize | '' })} className={inputClass}>
              <option value="">Elige...</option>
              {SHIRT_SIZES.map(sz => <option key={sz} value={sz}>{sz}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="man-method" className={fieldLabel}>¿Cómo pagó?</label>
            <select id="man-method" value={form.method} onChange={e => set({ method: e.target.value })} className={inputClass}>
              {MANUAL_METHODS.map(k => <option key={k} value={k}>{PAYMENT_METHODS[k]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="man-phone" className={fieldLabel}>Celular (opcional)</label>
          <input id="man-phone" type="tel" inputMode="numeric" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="10 dígitos" className={inputClass} />
        </div>
        <div>
          <label htmlFor="man-email" className={fieldLabel}>Correo (opcional)</label>
          <input id="man-email" type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor="man-note" className={fieldLabel}>Nota (opcional, queda en el registro)</label>
        <input id="man-note" value={form.note} onChange={e => set({ note: e.target.value })} placeholder="Ej. pagó $500 en efectivo a Erick" className={inputClass} />
      </div>

      {error && <p role="alert" className="text-alerta text-xs font-semibold">{error}</p>}
      <button type="submit" disabled={busy}
        className="text-sm font-bold px-4 py-2.5 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento disabled:opacity-50">
        {busy ? 'Inscribiendo...' : 'Inscribir como pagado'}
      </button>
    </form>
  )
}
