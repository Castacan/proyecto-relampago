import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'
import { useAutoUpdate } from '../../hooks/useAutoUpdate'

// Ruleta de la rifa para la TV / proyector (pedido del dueño, 2026-11-05).
// - Durante la competencia: los nombres entran a la ruleta en tiempo real conforme sacan
//   zonas (cada zona = 1 boleto; el tamaño de cada rebanada = sus boletos).
// - Arranca con quienes tienen boletos extra (dinámica previa).
// - En la rifa: el admin pica "Sortear" en /staff/competencia/rifa. El SERVIDOR elige al
//   ganador; esta pantalla solo lo muestra: quita al ganador anterior, gira y cae en el nuevo.
// Datos: get_competition_raffle_wheel (pública, src/supabase/competencia_ruleta.sql).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const POLL_MS = 2500
const SHRINK_MS = 1400  // quitar / agregar nombres
const SPIN_MS = 9000    // giro
const HOLD_MS = 7000    // mínimo que se queda un anuncio si ya hay otro sorteo en cola

interface Entry { id: string; full_name: string; bib: number | null; tickets: number }
interface Draw {
  prize_id: string; prize: string; sponsor: string | null; drawn_at: string
  winner_id: string; full_name: string; bib: number | null; tickets: number
}
interface WheelData {
  name: string; now: string; cleared_at: string | null; entries: Entry[]; draws: Draw[]
  prizes_total: number; next_prize: { name: string; sponsor: string | null } | null
}
interface Item { id: string; full_name: string; bib: number | null; w: number }
interface FeedItem { key: string; name: string; delta: number }

const PALETTE: [string, string][] = [
  ['#FF4D15', '#ffffff'], ['#0E9AA7', '#ffffff'], ['#F6C85F', '#013a4b'], ['#7B4FA0', '#ffffff'],
  ['#9DD866', '#013a4b'], ['#E23D5B', '#ffffff'], ['#3DA5D9', '#ffffff'], ['#FFA056', '#013a4b'],
]

const time = (iso: string) => Date.parse(iso)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const boletos = (n: number) => `${n} ${n === 1 ? 'boleto' : 'boletos'}`

function shortName(full: string) {
  const w = full.trim().split(/\s+/)
  const s = w.length >= 2 ? `${w[0]} ${w[1]}` : w[0] ?? ''
  return s.length > 18 ? s.slice(0, 17) + '…' : s
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const byKey = (a: { bib: number | null; id: string }, b: { bib: number | null; id: string }) =>
  (a.bib ?? 1e9) - (b.bib ?? 1e9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Quién está en la ruleta: la tómbola + el ganador que se está mostrando (para poder caer en él).
function wheelTarget(data: WheelData | null, shown: Draw | null): Item[] {
  if (!data) return []
  const items: Item[] = data.entries.map(e => ({ id: e.id, full_name: e.full_name, bib: e.bib, w: e.tickets }))
  if (shown && !items.some(i => i.id === shown.winner_id)) {
    items.push({ id: shown.winner_id, full_name: shown.full_name, bib: shown.bib, w: Math.max(1, shown.tickets) })
  }
  return items.sort(byKey)
}

// Ángulos (grados, desde arriba en sentido del reloj) de cada rebanada.
function layout(items: Item[]) {
  const total = items.reduce((s, i) => s + i.w, 0)
  let a = 0
  return items.map(i => {
    const span = total > 0 ? (i.w / total) * 360 : 0
    const r = { ...i, a0: a, a1: a + span }
    a += span
    return r
  })
}

// Cambia el tamaño de las rebanadas suavemente (entran nombres nuevos, sale el ganador).
function useTweened(target: Item[], ms: number) {
  const [shown, setShown] = useState<Item[]>(target)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const key = target.map(t => `${t.id}:${t.w}`).join('|')

  useEffect(() => {
    const from = new Map(shownRef.current.map(s => [s.id, s]))
    const to = new Map(target.map(t => [t.id, t]))
    const ids = new Set([...from.keys(), ...to.keys()])
    const items = [...ids].map(id => {
      const base = to.get(id) ?? from.get(id)!
      return { ...base, a: from.get(id)?.w ?? 0, b: to.get(id)?.w ?? 0 }
    }).sort(byKey)
    if (items.every(i => i.a === i.b)) { setShown(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      setShown(items.filter(i => p < 1 || i.b > 0).map(i => ({ id: i.id, full_name: i.full_name, bib: i.bib, w: i.a + (i.b - i.a) * e })))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])

  return shown
}

const setNoReload = (v: boolean) => { (window as unknown as { __noAutoReload?: boolean }).__noAutoReload = v }

export default function RaffleWheelDisplay() {
  useAutoUpdate()
  const [data, setData] = useState<WheelData | null>(null)
  const [failed, setFailed] = useState(false)
  const [shownDraw, setShownDraw] = useState<Draw | null>(null)
  const [announce, setAnnounce] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [spinMs, setSpinMs] = useState(0)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [tick, setTick] = useState(0)
  // Hasta qué sorteo ya se anunció (para no adelantar al ganador en la lista de la derecha).
  const [revealedAt, setRevealedAt] = useState(0)

  const dataRef = useRef<WheelData | null>(null)
  const rotRef = useRef(0)
  const busyRef = useRef(false)
  const processedRef = useRef<number | null>(null)
  const prevTickets = useRef<Map<string, number> | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; setNoReload(false) }
  }, [])

  // Pide los datos cada 2.5 s.
  useEffect(() => {
    let stop = false
    const load = async () => {
      const { data: res, error } = await db.rpc('get_competition_raffle_wheel', { p_slug: COMPETITION_SLUG })
      if (stop) return
      if (error || !res || res.error) { setFailed(true); return }
      setFailed(false)
      dataRef.current = res
      setData(res)
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(t) }
  }, [])

  // Quién ganó boletos (para la lista de "acaban de entrar").
  useEffect(() => {
    if (!data) return
    const now = new Map(data.entries.map(e => [e.id, e.tickets]))
    const prev = prevTickets.current
    prevTickets.current = now
    if (!prev) return
    const gained: FeedItem[] = []
    for (const e of data.entries) {
      const d = e.tickets - (prev.get(e.id) ?? 0)
      if (d > 0) gained.push({ key: `${e.id}-${e.tickets}-${Date.now()}`, name: shortName(e.full_name), delta: d })
    }
    if (gained.length) setFeed(f => [...gained, ...f].slice(0, 7))
  }, [data])

  // Sorteos: el primero que llega a la pantalla, deshacer, y la cola de nuevos.
  useEffect(() => {
    if (!data) return
    const draws = [...data.draws].sort((a, b) => time(a.drawn_at) - time(b.drawn_at))

    // Modo neutral: los sorteos hasta esta hora ya no se anuncian (botón en el panel de la Rifa).
    const cleared = data.cleared_at ? time(data.cleared_at) : 0
    if (processedRef.current === null) {
      const last = draws[draws.length - 1]
      const age = last ? time(data.now) - time(last.drawn_at) : Infinity
      if (last && cleared >= time(last.drawn_at)) {
        processedRef.current = time(last.drawn_at)
        setRevealedAt(time(last.drawn_at))
      } else if (last && age > 30000) {
        // Ya estaba sorteado cuando se abrió la pantalla: se muestra quieto, sin girar.
        processedRef.current = time(last.drawn_at)
        setRevealedAt(time(last.drawn_at))
        setShownDraw(last)
        setAnnounce(true)
        const seg = layout(wheelTarget(data, last)).find(s => s.id === last.winner_id)
        if (seg) { const r = -((seg.a0 + seg.a1) / 2); rotRef.current = r; setSpinMs(0); setRotation(r) }
      } else {
        processedRef.current = draws.length > 1 ? time(draws[draws.length - 2].drawn_at) : 0
        setRevealedAt(processedRef.current)
      }
    }

    if (busyRef.current) return

    // Deshacer: el sorteo que se muestra ya no existe.
    if (shownDraw && !draws.some(d => d.prize_id === shownDraw.prize_id && d.drawn_at === shownDraw.drawn_at)) {
      setShownDraw(null)
      setAnnounce(false)
    }

    if (shownDraw && cleared >= time(shownDraw.drawn_at)) {
      setShownDraw(null)
      setAnnounce(false)
    }

    const next = draws.find(d => time(d.drawn_at) > (processedRef.current ?? 0))
    if (!next) return
    if (cleared >= time(next.drawn_at)) {
      // Se sorteó y se puso neutral antes de que la pantalla lo viera: no se gira.
      processedRef.current = time(next.drawn_at)
      setRevealedAt(time(next.drawn_at))
      setTick(t => t + 1)
      return
    }
    busyRef.current = true
    setNoReload(true)
    ;(async () => {
      // 1) Se cierra el anuncio y se quitan los nombres del ganador anterior.
      setAnnounce(false)
      setShownDraw(next)
      await sleep(SHRINK_MS + 300)
      if (!alive.current) return
      // 2) Gira y cae en el ganador (una parte al azar de su rebanada).
      const seg = layout(wheelTarget(dataRef.current, next)).find(s => s.id === next.winner_id)
      if (seg) {
        const theta = seg.a0 + (seg.a1 - seg.a0) * (0.2 + Math.random() * 0.6)
        const base = rotRef.current
        const delta = ((-theta - base) % 360 + 360) % 360
        const target = base + 360 * 8 + delta
        rotRef.current = target
        setSpinMs(SPIN_MS)
        setRotation(target)
        await sleep(SPIN_MS + 400)
        if (!alive.current) return
      }
      // 3) Se anuncia.
      setAnnounce(true)
      processedRef.current = time(next.drawn_at)
      setRevealedAt(time(next.drawn_at))
      await sleep(HOLD_MS)
      busyRef.current = false
      setNoReload(false)
      if (alive.current) setTick(t => t + 1)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tick])

  const target = useMemo(() => wheelTarget(data, shownDraw), [data, shownDraw])
  const slices = useTweened(target, SHRINK_MS)
  const totalTickets = target.reduce((s, i) => s + i.w, 0)
  // Personas y boletos = lo que está en la rueda (incluye al ganador que se está anunciando),
  // igual que el número del centro.
  const people = target.length
  const winners = useMemo(() => [...(data?.draws ?? [])].filter(d => time(d.drawn_at) <= revealedAt)
    .sort((a, b) => time(b.drawn_at) - time(a.drawn_at)), [data, revealedAt])
  const spinning = shownDraw && !announce && time(shownDraw.drawn_at) > revealedAt ? shownDraw : null
  const upcoming = spinning ? { name: spinning.prize, sponsor: spinning.sponsor } : data?.next_prize ?? null
  const highlight = announce ? shownDraw?.winner_id ?? null : null

  return (
    <div className="w-screen h-screen bg-fondo overflow-hidden font-sans select-none flex">
      <div className="flex-1 min-w-0 flex items-center justify-center relative">
        <Wheel slices={slices} rotation={rotation} spinMs={spinMs} highlight={highlight} totalTickets={totalTickets} />
      </div>

      <div className="w-[34vw] shrink-0 flex flex-col border-l border-zinc-800 bg-white/5 px-[2.2vw] py-[4vh] gap-[3vh] min-h-0">
        <div>
          <p className="font-black text-primario tracking-tight" style={{ fontSize: '7vh', lineHeight: 1 }}>RIFA</p>
          <p className="font-bold text-zinc-300 mt-[0.8vh]" style={{ fontSize: '2.4vh' }}>{data?.name ?? 'JAM · Jaibas Al Muro'}</p>
        </div>

        <div className="grid grid-cols-2 gap-[1vw]">
          <div className="rounded-2xl bg-superficie border border-zinc-800 px-[1vw] py-[1.5vh] text-center">
            <p className="font-black text-texto-principal tabular-nums" style={{ fontSize: '6vh', lineHeight: 1 }}>{people}</p>
            <p className="font-bold text-zinc-300" style={{ fontSize: '2vh' }}>{people === 1 ? 'persona' : 'personas'}</p>
          </div>
          <div className="rounded-2xl bg-superficie border border-zinc-800 px-[1vw] py-[1.5vh] text-center">
            <p className="font-black text-primario tabular-nums" style={{ fontSize: '6vh', lineHeight: 1 }}>{totalTickets}</p>
            <p className="font-bold text-zinc-300" style={{ fontSize: '2vh' }}>boletos</p>
          </div>
        </div>

        {winners.length === 0 ? (
          <>
            <p className="font-black text-texto-principal" style={{ fontSize: '3.4vh', lineHeight: 1.15 }}>
              Cada zona = <span className="text-primario">1 boleto</span> más en la ruleta
            </p>
            <div className="min-h-0 flex-1 overflow-hidden">
              <p className="font-black text-zinc-400 tracking-widest mb-[1.2vh]" style={{ fontSize: '2vh' }}>ACABAN DE GANAR BOLETO</p>
              <div className="space-y-[1vh]">
                {feed.map((f, i) => (
                  <div key={f.key} className="flex items-center justify-between gap-2 rounded-xl bg-superficie/70 px-[1vw] py-[0.9vh] transition-opacity"
                    style={{ opacity: 1 - i * 0.11, animation: i === 0 ? 'ruleta-in 600ms ease-out' : undefined }}>
                    <span className="font-bold text-texto-principal truncate" style={{ fontSize: '2.6vh' }}>{f.name}</span>
                    <span className="font-black text-primario shrink-0 tabular-nums" style={{ fontSize: '2.6vh' }}>+{f.delta}</span>
                  </div>
                ))}
                {feed.length === 0 && <p className="text-zinc-400 font-semibold" style={{ fontSize: '2.2vh' }}>Los nombres aparecen aquí y en la ruleta en cuanto alguien saca una zona.</p>}
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <p className="font-black text-zinc-400 tracking-widest mb-[1.2vh]" style={{ fontSize: '2vh' }}>
              GANADORES · {winners.length} de {data?.prizes_total ?? 0}
            </p>
            <div className="space-y-[0.8vh]">
              {winners.map(w => (
                <div key={w.prize_id} className="rounded-xl bg-superficie/70 px-[1vw] py-[0.8vh]">
                  <p className="font-black text-texto-principal truncate" style={{ fontSize: '2.5vh', lineHeight: 1.15 }}>{w.full_name}</p>
                  <p className="font-bold text-primario truncate" style={{ fontSize: '1.9vh' }}>{w.prize}{w.sponsor ? ` · ${w.sponsor}` : ''}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {upcoming && (
          <div className={`rounded-2xl border px-[1vw] py-[1.4vh] ${spinning ? 'border-primario bg-primario/15' : 'border-primario/60'}`}>
            <p className="font-black text-zinc-400 tracking-widest" style={{ fontSize: '1.8vh' }}>{spinning ? 'SE ESTÁ RIFANDO' : 'SIGUIENTE PREMIO'}</p>
            <p className="font-black text-texto-principal truncate" style={{ fontSize: '3vh' }}>{upcoming.name}</p>
            {upcoming.sponsor && <p className="font-bold text-zinc-300 truncate" style={{ fontSize: '2vh' }}>{upcoming.sponsor}</p>}
          </div>
        )}
        {failed && <p className="text-zinc-500" style={{ fontSize: '1.6vh' }}>Sin conexión… reintentando</p>}
      </div>

      {announce && shownDraw && <Announcement draw={shownDraw} />}

      <style>{`
        @keyframes ruleta-in { from { transform: translateX(-12px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes ruleta-pop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.05); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes ruleta-glow { 0%, 100% { text-shadow: 0 0 0 rgba(255,77,21,0) } 50% { text-shadow: 0 0 40px rgba(255,77,21,.65) } }
      `}</style>
    </div>
  )
}

function Wheel({ slices, rotation, spinMs, highlight, totalTickets }: {
  slices: Item[]; rotation: number; spinMs: number; highlight: string | null; totalTickets: number
}) {
  const R = 480
  const segs = layout(slices)
  // Color estable por persona; si choca con el vecino, el siguiente de la paleta.
  const colors: [string, string][] = []
  segs.forEach((s, i) => {
    let c = hash(s.id) % PALETTE.length
    const prev = i > 0 ? colors[i - 1] : null
    if (prev && PALETTE[c] === prev) c = (c + 1) % PALETTE.length
    if (i === segs.length - 1 && segs.length > 1 && PALETTE[c] === colors[0]) {
      c = (c + 1) % PALETTE.length
      if (prev && PALETTE[c] === prev) c = (c + 1) % PALETTE.length
    }
    colors.push(PALETTE[c])
  })
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180
    return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`
  }

  return (
    <div className="relative" style={{ width: 'min(92vh, 62vw)', height: 'min(92vh, 62vw)' }}>
      <div className="absolute inset-0" style={{
        transform: `rotate(${rotation}deg)`,
        transition: spinMs ? `transform ${spinMs}ms cubic-bezier(0.12, 0.8, 0.12, 1)` : 'none',
        willChange: 'transform',
      }}>
        <svg viewBox="-500 -500 1000 1000" className="w-full h-full">
          <circle r={R + 12} fill="#012a37" stroke="#ff4d15" strokeWidth={8} />
          {segs.length === 0 && (
            <circle r={R} fill="none" stroke="#3b6b7a" strokeWidth={4} strokeDasharray="14 14" />
          )}
          {segs.map((s, i) => {
            const span = s.a1 - s.a0
            if (span <= 0.01) return null
            const [bg, fg] = colors[i]
            const dim = highlight && s.id !== highlight
            const shape = span >= 359.99
              ? <circle r={R} fill={bg} />
              : <path d={`M 0 0 L ${pt(s.a0, R)} A ${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${pt(s.a1, R)} Z`} fill={bg} stroke="#013a4b" strokeWidth={2} />
            const mid = (s.a0 + s.a1) / 2
            const arc = (2 * Math.PI * R * 0.72 * Math.min(span, 90)) / 360
            const fs = Math.min(36, arc * 0.78)
            return (
              <g key={s.id} opacity={dim ? 0.28 : 1} style={{ transition: 'opacity 600ms' }}>
                {shape}
                {fs >= 9 && (
                  <text transform={`rotate(${mid - 90})`} x={R - 24} y={0} textAnchor="end" dominantBaseline="central"
                    fill={fg} fontSize={fs} fontWeight={800} style={{ fontFamily: 'inherit' }}>
                    {shortName(s.full_name)}
                  </text>
                )}
              </g>
            )
          })}
          {highlight && segs.filter(s => s.id === highlight && s.a1 - s.a0 < 359.99).map(s => (
            <path key="hl" d={`M 0 0 L ${pt(s.a0, R)} A ${R} ${R} 0 ${s.a1 - s.a0 > 180 ? 1 : 0} 1 ${pt(s.a1, R)} Z`}
              fill="none" stroke="#ffffff" strokeWidth={10} />
          ))}
        </svg>
      </div>

      {/* Centro y flecha: no giran. */}
      <svg viewBox="-500 -500 1000 1000" className="absolute inset-0 w-full h-full pointer-events-none">
        <circle r={92} fill="#013a4b" stroke="#ff4d15" strokeWidth={8} />
        <text y={-8} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={64} fontWeight={900}>{Math.round(totalTickets)}</text>
        <text y={46} textAnchor="middle" dominantBaseline="central" fill="#cbd5e1" fontSize={26} fontWeight={700}>boletos</text>
        <path d="M -38 -508 L 38 -508 L 0 -428 Z" fill="#ffffff" stroke="#ff4d15" strokeWidth={6} strokeLinejoin="round" />
        {slices.length === 0 && (
          <text y={180} textAnchor="middle" fill="#9fb7c0" fontSize={34} fontWeight={700}>Aquí aparecerán los nombres</text>
        )}
      </svg>
    </div>
  )
}

function Announcement({ draw }: { draw: Draw }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center text-center px-[6vw]"
      style={{ background: 'rgba(1, 42, 55, 0.88)' }}>
      <p className="font-black text-zinc-300 tracking-widest" style={{ fontSize: '3.4vh' }}>
        {draw.sponsor ? `${draw.sponsor.toUpperCase()} REGALA` : 'PREMIO'}
      </p>
      <p className="font-black text-primario tracking-tight mt-[1vh]" style={{ fontSize: '8vh', lineHeight: 1.05 }}>{draw.prize}</p>
      <p className="font-black text-texto-principal tracking-tight mt-[6vh]"
        style={{ fontSize: '13vh', lineHeight: 1.02, animation: 'ruleta-pop 700ms ease-out, ruleta-glow 2.4s ease-in-out 700ms infinite' }}>
        {draw.full_name}
      </p>
      <p className="font-bold text-zinc-300 mt-[3vh]" style={{ fontSize: '3.4vh' }}>
        {draw.bib != null && `#${draw.bib} · `}{boletos(draw.tickets)}
      </p>
    </div>
  )
}
