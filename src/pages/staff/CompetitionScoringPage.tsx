import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'
import {
  RESULT_LABELS, fmtPoints, fmtTime, formatRouteList, parseRouteList, scoringError,
  type AttemptResult, type RankingRow,
} from '../../lib/competitionScoring'

// Panel de puntos del día de la competencia: ranking, intentos, rutas por
// categoría, jueces y ajustes. RPCs en src/supabase/competencia_jueces.sql.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface ScoringCategory { id: string; name: string; route_numbers: number[]; merge_into: string | null }
interface Judge { id: string; name: string; code: string; active: boolean; attempts: number }
interface Attempt {
  id: string; bib: number; full_name: string; route_number: number; result: AttemptResult
  judge_name: string | null; created_at: string; voided_at: string | null; void_reason: string | null; counts: boolean
}
interface ScoringData {
  competition: { name: string; score_top: number; score_zone: number; score_attempt_penalty: number; ranking_public: boolean }
  categories: ScoringCategory[]
  judges: Judge[]
  ranking: RankingRow[]
  attempts: Attempt[]
}

type Tab = 'ranking' | 'intentos' | 'rutas' | 'jueces' | 'ajustes'
const TABS: { id: Tab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'intentos', label: 'Intentos' },
  { id: 'rutas', label: 'Rutas' },
  { id: 'jueces', label: 'Jueces' },
  { id: 'ajustes', label: 'Ajustes' },
]

const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
const smallBtn = 'text-zinc-200 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 transition-all disabled:opacity-50'
const primaryBtn = 'text-xs font-bold px-3 py-2 rounded-xl bg-primario hover:bg-primario-hover text-texto-en-acento transition-all disabled:opacity-50'
const card = 'bg-superficie rounded-2xl border border-zinc-800/80'

export default function CompetitionScoringPage() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'
  const [data, setData] = useState<ScoringData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('ranking')
  const [auto, setAuto] = useState(true)

  const fetchAll = useCallback(async () => {
    const { data, error } = await db.rpc('get_competition_scoring_admin', { p_slug: COMPETITION_SLUG })
    if (error || !data) { setError('No se pudo cargar. ¿Ya se corrió competencia_jueces.sql?'); return }
    if (data.error) { setError(scoringError(data.error)); return }
    setError(null)
    setData(data)
  }, [])

  useEffect(() => { if (isAdmin) fetchAll() }, [isAdmin, fetchAll])
  useEffect(() => {
    if (!isAdmin || !auto || tab !== 'ranking') return
    const t = setInterval(fetchAll, 15000)
    return () => clearInterval(t)
  }, [isAdmin, auto, tab, fetchAll])

  if (profile && !isAdmin) return <Navigate to="/staff" replace />

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-texto-principal font-black text-2xl tracking-tight">Puntos de la competencia</h1>
          <p className="text-zinc-400 text-xs truncate">
            {data?.competition.name ?? ''} · <Link to="/staff/competencia" className="text-primario font-bold">Inscripciones</Link>
          </p>
        </div>
        <button onClick={fetchAll} className={smallBtn}>Actualizar</button>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap ${tab === t.id ? 'bg-primario text-texto-en-acento' : 'bg-superficie-alta/60 text-zinc-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-alerta text-xs mb-3">{error}</p>}
      {!data ? (
        !error && <div className="flex justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" /></div>
      ) : (
        <>
          {tab === 'ranking' && <RankingTab data={data} auto={auto} setAuto={setAuto} onChanged={fetchAll} />}
          {tab === 'intentos' && <AttemptsTab data={data} onChanged={fetchAll} />}
          {tab === 'rutas' && <RoutesTab data={data} onChanged={fetchAll} />}
          {tab === 'jueces' && <JudgesTab data={data} onChanged={fetchAll} />}
          {tab === 'ajustes' && <SettingsTab data={data} onChanged={fetchAll} />}
        </>
      )}
    </div>
  )
}

// Categorías con ranking propio (las juntadas salen con la destino) y su nombre.
function useGroups(categories: ScoringCategory[]) {
  return useMemo(() => categories.filter(c => !c.merge_into).map(c => ({
    ...c,
    label: [c, ...categories.filter(x => x.merge_into === c.id)].map(x => x.name).join(' + '),
  })), [categories])
}

function RankingTab({ data, auto, setAuto, onChanged }: { data: ScoringData; auto: boolean; setAuto: (v: boolean) => void; onChanged: () => void }) {
  const groups = useGroups(data.categories)
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = data.ranking.filter(r => r.effective_category_id === groupId)
  const hints = data.ranking.filter(r => r.promotion_hint)
  const catName = (id: string) => data.categories.find(c => c.id === id)?.name ?? ''

  const exportCsv = () => {
    const lines = [['Categoría', 'Lugar', 'Número', 'Nombre', 'Puntos', 'Tops', 'Zonas', 'Flashes', 'Intentos']]
    for (const g of groups) {
      for (const r of data.ranking.filter(x => x.effective_category_id === g.id)) {
        lines.push([g.label, String(r.place), String(r.bib ?? ''), r.full_name, String(r.points), String(r.tops), String(r.zones), String(r.flashes), String(r.attempts)])
      }
    }
    const csv = '﻿' + lines.map(l => l.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'ranking-competencia.csv'
    a.click()
  }

  return (
    <div className="space-y-3">
      {hints.length > 0 && (
        <div className={`${card} border-atencion/60 px-4 py-3`}>
          <p className="text-atencion text-xs font-bold mb-1">Revisar para subir de categoría</p>
          {hints.map(h => (
            <p key={h.registration_id} className="text-zinc-200 text-xs">#{h.bib} {h.full_name} ({catName(h.category_id)}): {h.promotion_hint}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={groupId} onChange={e => { setGroupId(e.target.value); setOpenId(null) }} className={`${inputClass} w-auto flex-1 min-w-[12rem]`}>
          {groups.map(g => <option key={g.id} value={g.id}>{g.label} ({data.ranking.filter(r => r.effective_category_id === g.id).length})</option>)}
        </select>
        <label className="flex items-center gap-2 text-zinc-200 text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 border border-zinc-700/50 cursor-pointer">
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-primario" />
          Actualizar solo (15 s)
        </label>
        <button onClick={exportCsv} className={smallBtn}>CSV</button>
      </div>

      {rows.length === 0 ? <p className="text-zinc-400 text-xs">Nadie pagado en esta categoría.</p> : (
        <div className={`${card} divide-y divide-zinc-800/60`}>
          {rows.map(r => (
            <div key={r.registration_id}>
              <button onClick={() => setOpenId(openId === r.registration_id ? null : r.registration_id)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3">
                <span className={`w-7 text-center font-black text-lg tabular-nums ${r.place <= 3 && r.attempts > 0 ? 'text-primario' : 'text-zinc-400'}`}>{r.place}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-texto-principal font-bold text-sm truncate">
                    <span className="text-zinc-400 font-mono">#{r.bib ?? '—'}</span> {r.full_name}
                    {r.promotion_hint && <span className="ml-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-atencion/20 text-atencion">Revisar</span>}
                  </span>
                  <span className="block text-zinc-400 text-[11px]">
                    {r.tops} tops · {r.zones} zonas · {r.flashes} flashes · {r.attempts} intentos
                    {r.category_id !== r.effective_category_id && ` · ${catName(r.category_id)}`}
                  </span>
                </span>
                <span className="text-texto-principal font-black tabular-nums">{fmtPoints(r.points)}</span>
              </button>
              {openId === r.registration_id && <CompetitorDetail row={r} data={data} onChanged={onChanged} />}
            </div>
          ))}
        </div>
      )}
      <p className="text-zinc-500 text-[11px]">
        Desempate: puntos → más tops → más flashes → la ruta más difícil encadenada → quien hizo antes su último intento.
        Mismo lugar = empate total.
      </p>
    </div>
  )
}

function CompetitorDetail({ row, data, onChanged }: { row: RankingRow; data: ScoringData; onChanged: () => void }) {
  const [catId, setCatId] = useState(row.category_id)
  const [reason, setReason] = useState('')
  const [bib, setBib] = useState(String(row.bib ?? ''))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const move = async () => {
    if (!reason.trim()) { setMsg('Escribe el motivo.'); return }
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_update_registration', {
      p_id: row.registration_id, p_action: 'edit', p_reason: reason.trim(), p_payload: { category_id: catId },
    })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    onChanged()
  }

  const saveBib = async () => {
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_set_bib', { p_registration_id: row.registration_id, p_bib: bib ? Number(bib) : null })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    setMsg('Número guardado.'); onChanged()
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {row.promotion_hint && <p className="text-atencion text-xs font-bold">{row.promotion_hint}</p>}
      {row.routes.length === 0 ? <p className="text-zinc-400 text-xs">Aún sin intentos en su categoría.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {row.routes.map(rt => (
            <span key={rt.route_number} className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${rt.topped ? 'border-exito/50 text-exito' : rt.zoned ? 'border-atencion/50 text-atencion' : 'border-zinc-700 text-zinc-300'}`}>
              R{rt.route_number}: {rt.topped ? (rt.flash ? 'flash' : 'top') : rt.zoned ? 'zona' : 'nada'} · {rt.attempts} int. · {fmtPoints(rt.points)}
            </span>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <p className="text-zinc-300 text-xs font-bold">Cambiar de categoría (empieza de cero)</p>
          <select value={catId} onChange={e => setCatId(e.target.value)} className={inputClass}>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (ej. flash en todas)" className={inputClass} />
          <button onClick={move} disabled={busy || catId === row.category_id} className={primaryBtn}>Mover</button>
        </div>
        <div className="space-y-2">
          <p className="text-zinc-300 text-xs font-bold">Número de competidor</p>
          <input value={bib} onChange={e => setBib(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={inputClass} />
          <button onClick={saveBib} disabled={busy || bib === String(row.bib ?? '')} className={smallBtn}>Guardar número</button>
        </div>
      </div>
      {msg && <p className="text-zinc-200 text-xs">{msg}</p>}
    </div>
  )
}

function AttemptsTab({ data, onChanged }: { data: ScoringData; onChanged: () => void }) {
  const [filter, setFilter] = useState('')
  const [voidId, setVoidId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [form, setForm] = useState({ bib: '', route: '', result: 'top' as AttemptResult, reason: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shown = data.attempts.filter(a => !filter || String(a.bib) === filter.trim() || String(a.route_number) === filter.trim().replace(/^r/i, ''))

  const doVoid = async (id: string) => {
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_void_attempt', { p_attempt_id: id, p_reason: reason })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    setVoidId(null); setReason(''); setMsg(null); onChanged()
  }

  const add = async () => {
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_add_attempt', {
      p_slug: COMPETITION_SLUG, p_bib: Number(form.bib), p_route: Number(form.route), p_result: form.result, p_reason: form.reason,
    })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    setForm({ ...form, route: '', reason: '' }); setMsg('Intento agregado.'); onChanged()
  }

  return (
    <div className="space-y-3">
      <div className={`${card} p-4 space-y-2`}>
        <p className="text-texto-principal text-sm font-bold">Capturar un intento a mano</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input value={form.bib} onChange={e => setForm({ ...form, bib: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="Número" className={inputClass} />
          <input value={form.route} onChange={e => setForm({ ...form, route: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="Ruta" className={inputClass} />
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value as AttemptResult })} className={inputClass}>
            {(Object.keys(RESULT_LABELS) as AttemptResult[]).map(r => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
          </select>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Motivo" className={inputClass} />
        </div>
        <button onClick={add} disabled={busy || !form.bib || !form.route || !form.reason.trim()} className={primaryBtn}>Agregar</button>
      </div>
      {msg && <p className="text-zinc-200 text-xs">{msg}</p>}

      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por número de competidor o ruta (ej. R5)" className={inputClass} />
      <p className="text-zinc-500 text-[11px]">Se muestran los últimos 300.</p>
      <div className={`${card} divide-y divide-zinc-800/60`}>
        {shown.length === 0 && <p className="text-zinc-400 text-xs px-4 py-3">Sin intentos.</p>}
        {shown.map(a => (
          <div key={a.id} className="px-4 py-2">
            <div className={`flex items-center gap-3 text-sm ${a.voided_at ? 'opacity-40' : ''}`}>
              <span className="text-zinc-400 text-xs tabular-nums w-20 shrink-0">{fmtTime(a.created_at)}</span>
              <span className={`flex-1 min-w-0 truncate text-texto-principal ${a.voided_at ? 'line-through' : ''}`}>
                <span className="font-mono text-zinc-400">#{a.bib}</span> {a.full_name} · R{a.route_number} · <b>{RESULT_LABELS[a.result]}</b>
                <span className="text-zinc-400 text-xs"> · {a.judge_name ?? 'admin'}{!a.counts && ' · otra categoría'}</span>
              </span>
              {!a.voided_at && <button onClick={() => { setVoidId(voidId === a.id ? null : a.id); setReason('') }} className="text-zinc-300 text-xs font-bold underline">Anular</button>}
            </div>
            {a.voided_at && <p className="text-zinc-500 text-[11px] ml-23">Anulado: {a.void_reason}</p>}
            {voidId === a.id && (
              <div className="flex gap-2 mt-2">
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo" className={inputClass} />
                <button onClick={() => doVoid(a.id)} disabled={busy || !reason.trim()} className={primaryBtn}>Anular</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RoutesTab({ data, onChanged }: { data: ScoringData; onChanged: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-zinc-300 text-xs">
        Escribe las rutas de cada categoría, por ejemplo <b>1-8</b> o <b>2-9, 12</b>. Solo cuentan los intentos en esas rutas.
        Para juntar dos categorías (ej. Básico mixto), elige con cuál compite: usa las rutas y el ranking de esa.
      </p>
      {data.categories.map(c => <RouteRow key={c.id} cat={c} data={data} onChanged={onChanged} />)}
    </div>
  )
}

function RouteRow({ cat, data, onChanged }: { cat: ScoringCategory; data: ScoringData; onChanged: () => void }) {
  const [text, setText] = useState(formatRouteList(cat.route_numbers))
  const [merge, setMerge] = useState(cat.merge_into ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const parsed = parseRouteList(text)
  const targets = data.categories.filter(c => c.id !== cat.id && !c.merge_into)
  const hasMerged = data.categories.some(c => c.merge_into === cat.id)
  const dirty = text !== formatRouteList(cat.route_numbers) || merge !== (cat.merge_into ?? '')

  const save = async () => {
    if (!parsed) { setMsg('No entiendo la lista. Usa números, guiones y comas.'); return }
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_set_category_routes', {
      p_category_id: cat.id, p_routes: merge ? [] : parsed, p_merge_into: merge || null,
    })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    setMsg('Guardado.'); onChanged()
  }

  return (
    <div className={`${card} p-4 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-texto-principal text-sm font-bold">{cat.name}</p>
        {!merge && parsed && <span className="text-zinc-400 text-xs">{parsed.length > 0 ? `${parsed.length} rutas` : 'Sin lista: cuentan todas'}</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={merge ? '' : text} onChange={e => setText(e.target.value)} disabled={!!merge}
          placeholder={merge ? 'Usa las rutas de la otra categoría' : 'Ej. 1-8'} className={inputClass} />
        <select value={merge} onChange={e => setMerge(e.target.value)} disabled={hasMerged} className={inputClass}>
          <option value="">Separada (ranking propio)</option>
          {targets.map(t => <option key={t.id} value={t.id}>Juntar con {t.name}</option>)}
        </select>
      </div>
      {hasMerged && <p className="text-zinc-500 text-[11px]">Otra categoría está juntada con esta.</p>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy || !dirty} className={primaryBtn}>Guardar</button>
        {msg && <span className="text-zinc-200 text-xs">{msg}</span>}
      </div>
    </div>
  )
}

function JudgesTab({ data, onChanged }: { data: ScoringData; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const judgeUrl = `${window.location.origin}/juez`

  const act = async (action: string, judgeId: string | null, payload: object = {}) => {
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_manage_judge', {
      p_slug: COMPETITION_SLUG, p_action: action, p_judge_id: judgeId, p_payload: payload,
    })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return false }
    setMsg(null); onChanged(); return true
  }

  return (
    <div className="space-y-3">
      <div className={`${card} p-4 space-y-1`}>
        <p className="text-zinc-300 text-xs">Los jueces abren esta página en su celular y escriben su código:</p>
        <p className="text-primario font-mono font-bold text-sm break-all">{judgeUrl}</p>
      </div>
      <div className={`${card} p-4 space-y-2`}>
        <p className="text-texto-principal text-sm font-bold">Nuevo juez</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre" className={inputClass} />
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Código (opcional, se crea solo)" className={`${inputClass} font-mono`} />
        </div>
        <button onClick={async () => { if (await act('create', null, { name, code })) { setName(''); setCode('') } }}
          disabled={busy || name.trim().length < 2} className={primaryBtn}>Crear juez</button>
        {msg && <p className="text-alerta text-xs">{msg}</p>}
      </div>
      <div className={`${card} divide-y divide-zinc-800/60`}>
        {data.judges.length === 0 && <p className="text-zinc-400 text-xs px-4 py-3">Aún no hay jueces.</p>}
        {data.judges.map(j => (
          <div key={j.id} className={`px-4 py-3 flex items-center gap-3 ${j.active ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-texto-principal text-sm font-bold">{j.name}</p>
              <p className="text-zinc-400 text-xs">{j.attempts} intentos capturados{j.active ? '' : ' · desactivado'}</p>
            </div>
            <span className="text-primario font-mono font-black text-lg">{j.code}</span>
            <button onClick={() => act(j.active ? 'deactivate' : 'activate', j.id)} disabled={busy} className={smallBtn}>
              {j.active ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab({ data, onChanged }: { data: ScoringData; onChanged: () => void }) {
  const c = data.competition
  const [top, setTop] = useState(String(c.score_top))
  const [zone, setZone] = useState(String(c.score_zone))
  const [penalty, setPenalty] = useState(String(c.score_attempt_penalty))
  const [isPublic, setIsPublic] = useState(c.ranking_public)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const { data: res, error } = await db.rpc('admin_update_scoring', {
      p_slug: COMPETITION_SLUG,
      p_patch: { score_top: Number(top), score_zone: Number(zone), score_attempt_penalty: Number(penalty), ranking_public: isPublic },
    })
    setBusy(false)
    if (error || !res || res.error) { setMsg(scoringError(res?.error)); return }
    setMsg('Guardado. El ranking se recalcula con estos valores.'); onChanged()
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="block space-y-1">
      <span className="text-zinc-300 text-xs font-semibold">{label}</span>
      <input value={value} onChange={e => set(e.target.value)} inputMode="decimal" className={inputClass} />
    </label>
  )

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div className="grid sm:grid-cols-3 gap-3">
        {field('Puntos por top', top, setTop)}
        {field('Puntos por zona', zone, setZone)}
        {field('Resta por intento que no es top', penalty, setPenalty)}
      </div>
      <label className="flex items-center gap-2 text-zinc-200 text-sm cursor-pointer">
        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="accent-primario" />
        Ranking visible sin sesión (para la TV). Apagado = solo tú lo ves.
      </label>
      <button onClick={save} disabled={busy} className={primaryBtn}>Guardar</button>
      {msg && <p className="text-zinc-200 text-xs">{msg}</p>}
    </div>
  )
}
