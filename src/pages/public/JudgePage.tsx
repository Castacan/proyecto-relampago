import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  JUDGE_CODE_KEY, RESULT_LABELS, fmtPoints, fmtTime, scoringError,
  type AttemptResult, type CompetitorCard,
} from '../../lib/competitionScoring'
import logoHorizontal from '../../assets/logo-horizontal.png'

// Pantalla del juez (/juez). Entra con su código (sin contraseña) y
// captura cada intento: número de competidor → ruta → Top / Zona / No completó.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface RecentAttempt {
  id: string
  bib: number
  full_name: string
  route_number: number
  result: AttemptResult
  created_at: string
  voided: boolean
}

// Intento que no llegó al servidor (sin señal): se reintenta con el mismo
// client_id para que no se guarde dos veces.
interface PendingAttempt {
  bib: number
  route: number
  result: AttemptResult
  clientId: string
  force: boolean
}

const readCode = () => { try { return localStorage.getItem(JUDGE_CODE_KEY) ?? '' } catch { return '' } }
const writeCode = (c: string | null) => {
  try { if (c) localStorage.setItem(JUDGE_CODE_KEY, c); else localStorage.removeItem(JUDGE_CODE_KEY) } catch { /* sin storage */ }
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))

const inputClass = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-4 py-3 text-texto-principal text-2xl font-black tabular-nums text-center placeholder:text-zinc-500 placeholder:text-base placeholder:font-semibold focus:outline-none focus:border-primario/60'

export default function JudgePage() {
  const [code, setCode] = useState(readCode)
  const [judge, setJudge] = useState<{ judge_name: string; competition_name: string } | null>(null)
  const [checking, setChecking] = useState(!!readCode())
  const [loginError, setLoginError] = useState<string | null>(null)

  const login = useCallback(async (c: string) => {
    setChecking(true)
    setLoginError(null)
    const { data, error } = await db.rpc('judge_login', { p_code: c })
    setChecking(false)
    if (error || !data) { setLoginError('Sin conexión. Revisa la señal e intenta de nuevo.'); return }
    if (data.error) { setLoginError(scoringError(data.error)); writeCode(null); return }
    writeCode(c)
    setJudge(data)
  }, [])

  useEffect(() => {
    const saved = readCode()
    if (saved) login(saved)
  }, [login])

  const logout = () => { writeCode(null); setJudge(null); setCode('') }

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        {judge && (
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-zinc-300 text-xs font-semibold truncate">Juez: {judge.judge_name}</span>
            <button onClick={logout} className="text-primario text-xs font-bold">Salir</button>
          </div>
        )}
      </header>

      <div className="max-w-md mx-auto w-full px-4 py-5">
        {!judge ? (
          <form onSubmit={e => { e.preventDefault(); if (code.trim()) login(code.trim()) }} className="space-y-4 pt-6">
            <h1 className="text-texto-principal font-black text-2xl tracking-tight">Juez de la competencia</h1>
            <p className="text-zinc-300 text-sm">Escribe el código de juez que te dieron. Se queda guardado en este celular.</p>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} autoCapitalize="characters"
              autoComplete="off" placeholder="Código de juez" className={`${inputClass} font-mono`} />
            {loginError && <p className="text-alerta text-sm font-semibold">{loginError}</p>}
            <button type="submit" disabled={checking || !code.trim()}
              className="w-full py-4 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-black text-lg disabled:opacity-50">
              {checking ? 'Revisando...' : 'Entrar'}
            </button>
          </form>
        ) : (
          <JudgeConsole code={readCode()} onInvalid={logout} />
        )}
      </div>
    </div>
  )
}

function JudgeConsole({ code, onInvalid }: { code: string; onInvalid: () => void }) {
  const [bibText, setBibText] = useState('')
  const [card, setCard] = useState<CompetitorCard | null>(null)
  const [route, setRoute] = useState<number | null>(null)
  const [otherRoute, setOtherRoute] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ pending: PendingAttempt; message: string } | null>(null)
  const [offline, setOffline] = useState<PendingAttempt | null>(null)
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null)
  const [recent, setRecent] = useState<RecentAttempt[]>([])
  const bibRef = useRef<HTMLInputElement>(null)

  const loadRecent = useCallback(async () => {
    const { data } = await db.rpc('judge_recent', { p_code: code })
    if (data?.error === 'invalid_code') { onInvalid(); return }
    if (data?.attempts) setRecent(data.attempts)
  }, [code, onInvalid])

  useEffect(() => { loadRecent() }, [loadRecent])

  const reset = () => {
    setBibText(''); setCard(null); setRoute(null); setOtherRoute(''); setError(null); setConfirm(null)
    setTimeout(() => bibRef.current?.focus(), 50)
  }

  const lookup = async () => {
    const bib = Number(bibText)
    if (!Number.isInteger(bib) || bib < 1) { setError('Escribe el número del competidor.'); return }
    setBusy(true); setError(null); setSaved(null)
    const { data, error } = await db.rpc('judge_lookup', { p_code: code, p_bib: bib })
    setBusy(false)
    if (error || !data) { setError('Sin conexión. Intenta de nuevo.'); return }
    if (data.error === 'invalid_code') { onInvalid(); return }
    if (data.error) { setError(scoringError(data.error)); setCard(null); return }
    setCard(data); setRoute(null); setOtherRoute('')
  }

  const send = async (p: PendingAttempt) => {
    setBusy(true); setError(null)
    const { data, error } = await db.rpc('judge_record_attempt', {
      p_code: code, p_bib: p.bib, p_route: p.route, p_result: p.result, p_client_id: p.clientId, p_force: p.force,
    })
    setBusy(false)
    if (error || !data) { setOffline(p); return }
    setOffline(null)
    if (data.error === 'invalid_code') { onInvalid(); return }
    if (data.error === 'route_not_in_category') {
      setConfirm({ pending: { ...p, force: true }, message: `La ruta ${p.route} no es de ${card?.category_name ?? 'su categoría'}. Si la guardas, NO le cuenta puntos.` })
      return
    }
    if (data.error === 'already_topped') {
      setConfirm({ pending: { ...p, force: true }, message: `El #${p.bib} ya tiene top en la ruta ${p.route}. ¿Guardar otro intento de todos modos?` })
      return
    }
    if (data.error) { setError(scoringError(data.error)); return }
    setConfirm(null)
    setSaved({ id: data.attempt_id, text: `#${p.bib} · ruta ${p.route} · ${RESULT_LABELS[p.result]}` })
    reset()
    loadRecent()
  }

  const record = (result: AttemptResult) => {
    if (!card || route == null) return
    send({ bib: card.bib, route, result, clientId: newId(), force: false })
  }

  const undo = async (id: string) => {
    setBusy(true)
    const { data, error } = await db.rpc('judge_undo_attempt', { p_code: code, p_attempt_id: id })
    setBusy(false)
    if (error || !data) { setError('Sin conexión. No se deshizo.'); return }
    if (data.error) { setError(scoringError(data.error)); return }
    if (saved?.id === id) setSaved(null)
    loadRecent()
  }

  const byRoute = new Map(card?.routes.map(r => [r.route_number, r]) ?? [])
  const routeChoices = card ? (card.route_numbers.length > 0 ? card.route_numbers : [...byRoute.keys()]) : []

  return (
    <div className="space-y-4">
      {saved && (
        <div className="bg-exito/15 border border-exito/40 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-exito text-sm font-bold">Guardado: {saved.text}</p>
          <button onClick={() => undo(saved.id)} disabled={busy} className="text-texto-principal text-xs font-bold underline shrink-0">Deshacer</button>
        </div>
      )}

      {offline && (
        <div className="bg-alerta/15 border border-alerta rounded-2xl px-4 py-3 space-y-2">
          <p className="text-alerta text-sm font-bold">
            No se guardó (sin señal): #{offline.bib} · ruta {offline.route} · {RESULT_LABELS[offline.result]}
          </p>
          <button onClick={() => send(offline)} disabled={busy}
            className="w-full py-3 rounded-xl bg-alerta text-white font-black">{busy ? 'Enviando...' : 'Reintentar'}</button>
        </div>
      )}

      {/* 1. Competidor */}
      <form onSubmit={e => { e.preventDefault(); lookup() }} className="flex gap-2">
        <input ref={bibRef} value={bibText} onChange={e => { setBibText(e.target.value.replace(/\D/g, '')); setCard(null) }}
          inputMode="numeric" autoFocus placeholder="Número de competidor" className={inputClass} />
        <button type="submit" disabled={busy || !bibText}
          className="px-5 rounded-xl bg-primario text-texto-en-acento font-black disabled:opacity-50">Buscar</button>
      </form>

      {error && <p className="text-alerta text-sm font-semibold">{error}</p>}

      {card && (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-texto-principal font-black text-xl leading-tight">#{card.bib} {card.full_name}</p>
              <p className="text-zinc-300 text-sm">{card.category_name}</p>
            </div>
            <p className="text-primario font-black text-lg tabular-nums shrink-0">{fmtPoints(card.points)} pts</p>
          </div>

          {/* 2. Ruta */}
          <div>
            <p className="text-zinc-400 text-xs font-semibold mb-2">¿Qué ruta va a intentar?</p>
            <div className="grid grid-cols-5 gap-2">
              {routeChoices.map(n => {
                const r = byRoute.get(n)
                const selected = route === n
                return (
                  <button key={n} onClick={() => { setRoute(n); setOtherRoute('') }}
                    className={`rounded-xl py-2 border text-center transition-all ${selected
                      ? 'bg-primario border-primario text-texto-en-acento'
                      : r?.topped ? 'bg-exito/15 border-exito/40 text-exito'
                      : r?.zoned ? 'bg-atencion/15 border-atencion/40 text-atencion'
                      : 'bg-superficie-alta/60 border-zinc-700/50 text-texto-principal'}`}>
                    <span className="block font-black text-lg leading-none">{n}</span>
                    <span className="block text-[10px] font-bold mt-1">
                      {r ? (r.topped ? (r.flash ? 'FLASH' : 'TOP') : r.zoned ? 'ZONA' : `${r.attempts} int.`) : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-zinc-400 text-xs">Otra ruta:</span>
              <input value={otherRoute} inputMode="numeric"
                onChange={e => { const v = e.target.value.replace(/\D/g, ''); setOtherRoute(v); setRoute(v ? Number(v) : null) }}
                className="w-20 bg-superficie-alta border border-zinc-700/50 rounded-lg px-2 py-1 text-texto-principal text-sm font-bold text-center" />
            </div>
          </div>

          {/* 3. Resultado */}
          {route != null && (
            <div className="space-y-2">
              <p className="text-zinc-300 text-sm">Ruta <span className="font-black text-texto-principal">{route}</span>
                {byRoute.get(route) && ` · lleva ${byRoute.get(route)!.attempts} ${byRoute.get(route)!.attempts === 1 ? 'intento' : 'intentos'}`}</p>
              {confirm ? (
                <div className="bg-atencion/15 border border-atencion/50 rounded-xl p-3 space-y-2">
                  <p className="text-atencion text-sm font-bold">{confirm.message}</p>
                  <div className="flex gap-2">
                    <button onClick={() => send(confirm.pending)} disabled={busy}
                      className="flex-1 py-3 rounded-xl bg-atencion text-texto-en-acento font-black">Guardar así</button>
                    <button onClick={() => setConfirm(null)} className="flex-1 py-3 rounded-xl bg-superficie-alta text-texto-principal font-bold">Cancelar</button>
                  </div>
                </div>
              ) : (
                <>
                  <button onClick={() => record('top')} disabled={busy}
                    className="w-full py-5 rounded-2xl bg-exito text-texto-en-acento font-black text-2xl disabled:opacity-50">TOP</button>
                  <button onClick={() => record('zone')} disabled={busy}
                    className="w-full py-5 rounded-2xl bg-atencion text-texto-en-acento font-black text-2xl disabled:opacity-50">ZONA</button>
                  <button onClick={() => record('fail')} disabled={busy}
                    className="w-full py-4 rounded-2xl bg-superficie-alta text-texto-principal font-black text-xl border border-zinc-600 disabled:opacity-50">NO COMPLETÓ</button>
                </>
              )}
            </div>
          )}

          <button onClick={reset} className="w-full text-zinc-400 text-xs font-semibold py-1">Cancelar · otro competidor</button>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-zinc-400 text-xs font-semibold">Lo último que capturaste</p>
            <button onClick={loadRecent} className="text-primario text-xs font-bold">Actualizar</button>
          </div>
          <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60">
            {recent.map(a => {
              const canUndo = !a.voided && Date.now() - new Date(a.created_at).getTime() < 30 * 60 * 1000
              return (
                <div key={a.id} className={`px-4 py-2 flex items-center gap-3 text-sm ${a.voided ? 'opacity-40 line-through' : ''}`}>
                  <span className="text-zinc-400 text-xs tabular-nums w-16 shrink-0">{fmtTime(a.created_at)}</span>
                  <span className="text-texto-principal font-semibold truncate flex-1">#{a.bib} · R{a.route_number} · {RESULT_LABELS[a.result]}</span>
                  {canUndo && <button onClick={() => undo(a.id)} disabled={busy} className="text-zinc-300 text-xs font-bold underline">Deshacer</button>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
