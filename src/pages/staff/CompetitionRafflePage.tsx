import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'

// Rifa de premios al final de la competencia. RPCs en src/supabase/competencia_rifa.sql.
// 1 boleto por cada ruta en la que llegó a zona (top incluido); cada persona gana máximo 1 premio;
// no hay que estar presente; el staff se marca "fuera de la rifa".
// 2026-11-05: boletos extra por la dinámica previa y ruleta en la TV (/competencia/ruleta,
// src/supabase/competencia_ruleta.sql): al sortear aquí, la pantalla gira sola y anuncia.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Winner { registration_id: string; full_name: string; bib: number | null; folio: string; category: string }
interface Prize {
  id: string; name: string; sponsor: string | null; sort_order: number
  drawn_at: string | null; winner: Winner | null
  winner_tickets: number | null; pool_tickets: number | null; pool_people: number | null
}
interface Participant {
  registration_id: string; full_name: string; bib: number | null; category: string
  tickets: number; bonus?: number; excluded: boolean; won: string | null
}
interface RaffleData { name: string; prizes: Prize[]; participants: Participant[] }

const ERRORS: Record<string, string> = {
  forbidden: 'Solo un admin puede usar la rifa.',
  not_found: 'No se encontró.',
  already_drawn: 'Ese premio ya se sorteó.',
  no_tickets: 'Ya no queda nadie con boletos en la tómbola.',
  not_drawn: 'Ese premio todavía no se sortea.',
  invalid_value: 'Revisa el nombre del premio.',
}
const errorText = (code?: string) => (code && ERRORS[code]) || 'Algo salió mal. Intenta de nuevo.'

const smallBtn = 'text-zinc-200 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all disabled:opacity-50'
const primaryBtn = 'text-xs font-bold px-3 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento transition-all disabled:opacity-50'
const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
const card = 'bg-superficie rounded-2xl border border-zinc-800/80'

const boletos = (n: number) => `${n} ${n === 1 ? 'boleto' : 'boletos'}`

export default function CompetitionRafflePage() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'
  const [data, setData] = useState<RaffleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const fetchAll = useCallback(async () => {
    const { data, error } = await db.rpc('get_competition_raffle_admin', { p_slug: COMPETITION_SLUG })
    if (error || !data) { setError('No se pudo cargar. ¿Ya se corrió competencia_rifa.sql?'); return }
    if (data.error) { setError(errorText(data.error)); return }
    setError(null)
    setData(data)
  }, [])

  useEffect(() => { if (isAdmin) fetchAll() }, [isAdmin, fetchAll])

  // Quiénes pueden ganar ahora mismo.
  const pool = useMemo(() => (data?.participants ?? []).filter(p => !p.excluded && !p.won && p.tickets > 0), [data])
  const poolTickets = pool.reduce((s, p) => s + p.tickets, 0)

  if (profile && !isAdmin) return <Navigate to="/staff" replace />

  const draw = async (prize: Prize) => {
    setBusy(prize.id); setMsg(null)
    const { data: res, error } = await db.rpc('admin_raffle_draw', { p_prize_id: prize.id })
    setBusy(null)
    if (error || !res || res.error) { setMsg(errorText(res?.error)); fetchAll(); return }
    setMsg(`${prize.name}: la ruleta de la pantalla está girando. Ganó ${res.winner.full_name} (se ve aquí abajo).`)
    fetchAll()
  }

  const undo = async (prize: Prize) => {
    const reason = window.prompt(`¿Por qué se deshace el sorteo de "${prize.name}"? ${prize.winner?.full_name} regresa a la tómbola.`)
    if (reason === null) return
    setBusy(prize.id)
    const { data: res, error } = await db.rpc('admin_raffle_undo', { p_prize_id: prize.id, p_reason: reason })
    setBusy(null)
    if (error || !res || res.error) setMsg(errorText(res?.error))
    fetchAll()
  }

  // Modo neutral: la pantalla quita el anuncio y los nombres del último ganador.
  const clearWheel = async () => {
    setBusy('clear'); setMsg(null)
    const { data: res, error } = await db.rpc('admin_raffle_clear_wheel', { p_slug: COMPETITION_SLUG })
    setBusy(null)
    if (error || !res || res.error) { setMsg(error ? 'No se pudo. ¿Ya se corrió competencia_ruleta.sql?' : errorText(res?.error)); return }
    setMsg('Listo: la pantalla quitó al ganador y muestra la ruleta sola.')
  }

  const setBonus = async (p: Participant, bonus: number) => {
    setBusy(p.registration_id)
    const { data: res, error } = await db.rpc('admin_raffle_set_bonus', { p_registration_id: p.registration_id, p_bonus: bonus })
    setBusy(null)
    if (error || !res || res.error) setMsg(error ? 'No se pudo. ¿Ya se corrió competencia_ruleta.sql?' : errorText(res?.error))
    fetchAll()
  }

  const setExcluded = async (p: Participant, excluded: boolean) => {
    setBusy(p.registration_id)
    const { data: res, error } = await db.rpc('admin_raffle_set_excluded', { p_registration_id: p.registration_id, p_excluded: excluded })
    setBusy(null)
    if (error || !res || res.error) setMsg(errorText(res?.error))
    fetchAll()
  }

  const drawn = data?.prizes.filter(p => p.winner).length ?? 0

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="max-w-4xl mx-auto w-full px-4 py-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="text-texto-principal font-black text-2xl tracking-tight">Rifa</h1>
            <p className="text-zinc-400 text-xs truncate">
              {data?.name ?? ''} · <Link to="/staff/competencia" className="text-primario font-bold">Inscripciones</Link>
              {' · '}<Link to="/staff/competencia/puntos" className="text-primario font-bold">Puntos</Link>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setEditing(v => !v)} className={smallBtn}>{editing ? 'Listo' : 'Editar premios'}</button>
            <a href="/competencia/ruleta" target="_blank" rel="noreferrer" className={primaryBtn}>Abrir ruleta</a>
            <button onClick={clearWheel} disabled={busy !== null} className={smallBtn} title="Quita el anuncio y los nombres del último ganador de la pantalla">
              {busy === 'clear' ? 'Quitando...' : 'Ruleta neutral'}
            </button>
            <button onClick={fetchAll} className={smallBtn}>Actualizar</button>
          </div>
        </div>

        {error && <p className="text-alerta text-xs mb-3">{error}</p>}
        {msg && <p role="status" className="text-amarillo-suave text-xs mb-3">{msg}</p>}

        {!data ? (
          !error && <div className="flex justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Stat label="En la tómbola" value={pool.length} sub={boletos(poolTickets)} accent />
              <Stat label="Premios sorteados" value={drawn} sub={`de ${data.prizes.length}`} />
              <Stat label="Fuera de la rifa" value={data.participants.filter(p => p.excluded).length} sub="staff" />
            </div>
            <p className="text-zinc-400 text-[11px] mb-3">
              1 boleto por cada bloque en el que llegó a zona (el top cuenta) + boletos extra de la dinámica. Quien gana sale de las rifas siguientes. No hay que estar presente.
              {' '}Pon la ruleta en la pantalla (botón "Abrir ruleta" o la TV el día de la compe): al picar "Sortear" aquí, allá gira sola y anuncia al ganador.
            </p>

            {editing ? <PrizeEditor prizes={data.prizes} onChanged={fetchAll} /> : (
              <div className="space-y-2 mb-6">
                {data.prizes.map((p, i) => (
                  <div key={p.id} className={`${card} px-4 py-3 flex items-center gap-3 ${p.winner ? '' : 'border-zinc-700'}`}>
                    <span className="text-zinc-500 font-black tabular-nums w-6 shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-texto-principal font-bold text-sm truncate">{p.name}</p>
                      <p className="text-zinc-400 text-xs truncate">{p.sponsor ?? ''}</p>
                    </div>
                    {p.winner ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-right min-w-0">
                          <p className="text-exito font-bold text-sm truncate">
                            {p.winner.bib != null && <span className="tabular-nums">#{p.winner.bib} </span>}{p.winner.full_name}
                          </p>
                          <p className="text-zinc-400 text-[11px] truncate">
                            {p.winner.category} · {boletos(p.winner_tickets ?? 0)} de {p.pool_tickets}
                          </p>
                        </div>
                        <button onClick={() => undo(p)} disabled={busy === p.id} className={smallBtn}>Deshacer</button>
                      </div>
                    ) : (
                      <button onClick={() => draw(p)} disabled={busy !== null || poolTickets === 0} className={primaryBtn}>
                        {busy === p.id ? 'Sorteando...' : 'Sortear'}
                      </button>
                    )}
                  </div>
                ))}
                {data.prizes.length === 0 && <p className="text-zinc-400 text-sm">No hay premios. Agrégalos en "Editar premios".</p>}
              </div>
            )}

            <Participants data={data} busy={busy} onToggle={setExcluded} onBonus={setBonus} />
          </>
        )}

      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub: string; accent?: boolean }) {
  return (
    <div className={`${card} p-3`}>
      <p className="text-zinc-400 text-[11px] font-semibold">{label}</p>
      <p className={`font-black text-2xl leading-tight tabular-nums ${accent ? 'text-primario' : 'text-texto-principal'}`}>{value}</p>
      <p className="text-zinc-400 text-[10px] truncate">{sub}</p>
    </div>
  )
}

function PrizeEditor({ prizes, onChanged }: { prizes: Prize[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [sponsor, setSponsor] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const call = async (fn: string, args: Record<string, unknown>) => {
    setSaving(true); setErr(null)
    const { data: res, error } = await db.rpc(fn, args)
    setSaving(false)
    if (error || !res || res.error) { setErr(errorText(res?.error)); return false }
    onChanged()
    return true
  }

  const add = async () => {
    if (!name.trim()) return
    if (await call('admin_raffle_save_prize', { p_slug: COMPETITION_SLUG, p_id: null, p_name: name, p_sponsor: sponsor, p_sort_order: null })) {
      setName(''); setSponsor('')
    }
  }

  // Subir o bajar: intercambia el orden con el vecino.
  const move = async (i: number, dir: -1 | 1) => {
    const a = prizes[i], b = prizes[i + dir]
    if (!b) return
    await call('admin_raffle_save_prize', { p_slug: COMPETITION_SLUG, p_id: a.id, p_name: a.name, p_sponsor: a.sponsor, p_sort_order: b.sort_order })
    await call('admin_raffle_save_prize', { p_slug: COMPETITION_SLUG, p_id: b.id, p_name: b.name, p_sponsor: b.sponsor, p_sort_order: a.sort_order })
  }

  return (
    <div className={`${card} p-4 mb-6 space-y-3`}>
      <p className="text-texto-principal text-sm font-bold">Premios (se rifan en este orden)</p>
      {prizes.map((p, i) => (
        <PrizeRow key={p.id} prize={p} index={i} last={i === prizes.length - 1} disabled={saving}
          onMove={dir => move(i, dir)}
          onSave={(n, s) => call('admin_raffle_save_prize', { p_slug: COMPETITION_SLUG, p_id: p.id, p_name: n, p_sponsor: s, p_sort_order: null })}
          onDelete={() => call('admin_raffle_delete_prize', { p_id: p.id })} />
      ))}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-800/60">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Premio nuevo" className={`${inputClass} flex-1 min-w-[10rem]`} maxLength={120} />
        <input value={sponsor} onChange={e => setSponsor(e.target.value)} placeholder="Patrocinador" className={`${inputClass} flex-1 min-w-[8rem]`} maxLength={80} />
        <button onClick={add} disabled={saving || !name.trim()} className={primaryBtn}>Agregar</button>
      </div>
      {err && <p className="text-alerta text-xs">{err}</p>}
    </div>
  )
}

function PrizeRow({ prize, index, last, disabled, onMove, onSave, onDelete }: {
  prize: Prize; index: number; last: boolean; disabled: boolean
  onMove: (dir: -1 | 1) => void; onSave: (name: string, sponsor: string) => Promise<boolean>; onDelete: () => void
}) {
  const [name, setName] = useState(prize.name)
  const [sponsor, setSponsor] = useState(prize.sponsor ?? '')
  const changed = name !== prize.name || sponsor !== (prize.sponsor ?? '')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-zinc-500 font-black tabular-nums w-6">{index + 1}</span>
      <input value={name} onChange={e => setName(e.target.value)} className={`${inputClass} flex-1 min-w-[9rem]`} maxLength={120} aria-label="Premio" />
      <input value={sponsor} onChange={e => setSponsor(e.target.value)} className={`${inputClass} w-36`} maxLength={80} aria-label="Patrocinador" placeholder="Patrocinador" />
      <button onClick={() => onMove(-1)} disabled={disabled || index === 0} className={smallBtn} aria-label="Subir">↑</button>
      <button onClick={() => onMove(1)} disabled={disabled || last} className={smallBtn} aria-label="Bajar">↓</button>
      {changed && <button onClick={() => onSave(name, sponsor)} disabled={disabled || !name.trim()} className={smallBtn}>Guardar</button>}
      {prize.winner
        ? <span className="text-zinc-500 text-[11px]">ya sorteado</span>
        : <button onClick={onDelete} disabled={disabled} className={`${smallBtn} text-alerta`}>Quitar</button>}
    </div>
  )
}

function Participants({ data, busy, onToggle, onBonus }: {
  data: RaffleData; busy: string | null
  onToggle: (p: Participant, excluded: boolean) => void; onBonus: (p: Participant, bonus: number) => void
}) {
  const [search, setSearch] = useState('')
  const rows = data.participants.filter(p => !search.trim() || p.full_name.toLowerCase().includes(search.trim().toLowerCase()) || String(p.bib ?? '') === search.trim())
  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-texto-principal text-sm font-bold">Boletos por competidor</p>
        <p className="text-zinc-400 text-[11px]">
          Extra = boletos de la dinámica ({data.participants.filter(p => (p.bonus ?? 0) > 0).length} personas). Si alguien es staff, sácalo con "Sacar de la rifa".
        </p>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o número..." className={`${inputClass} mb-3`} />
      <div className="divide-y divide-zinc-800/60">
        {rows.map(p => (
          <div key={p.registration_id} className={`flex items-center gap-3 py-2 ${p.excluded ? 'opacity-50' : ''}`}>
            <span className="text-zinc-500 font-bold tabular-nums w-10 shrink-0 text-xs">{p.bib != null ? `#${p.bib}` : ''}</span>
            <div className="min-w-0 flex-1">
              <p className="text-texto-principal text-sm font-semibold truncate">{p.full_name}</p>
              <p className="text-zinc-400 text-[11px] truncate">
                {p.category}{p.won && <span className="text-exito font-bold"> · ganó {p.won}</span>}{p.excluded && ' · fuera de la rifa'}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0" title="Boletos extra (dinámica)">
              <span className="text-zinc-400 text-[11px] mr-1">Extra</span>
              <button onClick={() => onBonus(p, Math.max(0, (p.bonus ?? 0) - 1))} disabled={busy === p.registration_id || !(p.bonus ?? 0)} className={smallBtn} aria-label="Quitar boleto extra">−</button>
              <span className={`w-5 text-center font-black tabular-nums text-sm ${(p.bonus ?? 0) > 0 ? 'text-amarillo-suave' : 'text-zinc-500'}`}>{p.bonus ?? 0}</span>
              <button onClick={() => onBonus(p, (p.bonus ?? 0) + 1)} disabled={busy === p.registration_id || (p.bonus ?? 0) >= 20} className={smallBtn} aria-label="Dar boleto extra">+</button>
            </div>
            <span className={`font-black tabular-nums text-sm shrink-0 w-20 text-right ${p.tickets > 0 ? 'text-primario' : 'text-zinc-500'}`}>{boletos(p.tickets)}</span>
            <button onClick={() => onToggle(p, !p.excluded)} disabled={busy === p.registration_id} className={`${smallBtn} shrink-0`}>
              {p.excluded ? 'Regresar' : 'Sacar de la rifa'}
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-zinc-400 text-sm py-2">Nadie con ese nombre.</p>}
      </div>
    </div>
  )
}
