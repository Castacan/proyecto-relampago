// Gráficas del estado de resultados (SVG propio, sin librería).
// Colores validados con el validador de dataviz contra la superficie #015169:
//   ingresos #c98500 (amarillo) / egresos #9085e9 (violeta): CVD ΔE 27.3, normal ΔE 27.5.
//   Contraste con la superficie < 3:1 (2.87 / 2.82) → cada barra lleva su cifra y la tabla
//   completa está abajo (alivio requerido).
import { useState } from 'react'
import { money } from '../../../lib/erp'

const C_IN = '#c98500'
const C_OUT = '#9085e9'
const C_NET = '#e4e4e7'
const INK = '#f4f4f3'
const MUTED = '#a1a1aa'
const GRID = 'rgba(255,255,255,0.10)'

const short = (cents: number) => {
  const v = cents / 100
  const a = Math.abs(v)
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : a.toFixed(0)
  return `${v < 0 ? '−' : ''}$${s}`
}

function Tip({ x, y, lines }: { x: string; y: number; lines: string[] }) {
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg bg-black/85 px-2.5 py-1.5 text-xs text-white shadow-lg whitespace-nowrap"
      style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}>
      {lines.map((l, i) => <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>)}
    </div>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
      {items.map(it => <span key={it.label} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />{it.label}</span>)}
    </div>
  )
}

/** Barras agrupadas: ingresos vs egresos por mes. */
function IncomeVsExpense({ months, inc, exp }: { months: string[]; inc: number[]; exp: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 220, L = 8, R = 8, T = 18, B = 22
  const max = Math.max(1, ...inc, ...exp)
  const bw = (W - L - R) / months.length
  const barW = Math.min(28, (bw - 10) / 2)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Ingresos y egresos por mes">
        {[0.5, 1].map(f => <line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke={GRID} />)}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.25)" />
        {months.map((m, i) => {
          const cx = L + bw * i + bw / 2
          const bars = [{ v: inc[i], c: C_IN, x: cx - barW - 1 }, { v: exp[i], c: C_OUT, x: cx + 1 }]
          return (
            <g key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + bw * i} y={T} width={bw} height={H - T - B} fill={hover === i ? 'rgba(255,255,255,0.05)' : 'transparent'} />
              {bars.map((b, k) => b.v > 0 && (
                <g key={k}>
                  <rect x={b.x} y={y(b.v)} width={barW} height={y(0) - y(b.v)} rx={3} fill={b.c} />
                  {months.length <= 8 && <text x={b.x + barW / 2} y={y(b.v) - 4} textAnchor="middle" fontSize={10} fill={MUTED}>{short(b.v)}</text>}
                </g>
              ))}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{m}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <Tip x={`${((L + bw * hover + bw / 2) / W) * 100}%`} y={0}
          lines={[months[hover], `Ingresos ${money(inc[hover])}`, `Egresos ${money(exp[hover])}`, `Utilidad ${money(inc[hover] - exp[hover])}`]} />
      )}
    </div>
  )
}

/** Utilidad por mes: barra hacia arriba si gana, hacia abajo si pierde. */
function NetByMonth({ months, net }: { months: string[]; net: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 180, L = 8, R = 8, T = 18, B = 22
  const max = Math.max(1, ...net.map(Math.abs))
  const hasNeg = net.some(v => v < 0), hasPos = net.some(v => v > 0)
  // Holgura para que la cifra quepa arriba de la barra positiva y abajo de la negativa sin pisar el mes.
  const top = hasPos ? max * 1.12 : 0, bottom = hasNeg ? -max * 1.3 : 0
  const y = (v: number) => T + (H - T - B) * ((top - v) / ((top - bottom) || 1))
  const bw = (W - L - R) / months.length
  const barW = Math.min(36, bw - 12)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Utilidad por mes">
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.35)" />
        {months.map((m, i) => {
          const v = net[i], cx = L + bw * i + bw / 2
          const y0 = y(0), y1 = y(v)
          return (
            <g key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + bw * i} y={T} width={bw} height={H - T - B} fill={hover === i ? 'rgba(255,255,255,0.05)' : 'transparent'} />
              {v !== 0 && <rect x={cx - barW / 2} y={Math.min(y0, y1)} width={barW} height={Math.abs(y1 - y0)} rx={3} fill={C_NET} opacity={v < 0 ? 0.55 : 1} />}
              {months.length <= 8 && v !== 0 && <text x={cx} y={v >= 0 ? y1 - 4 : y1 + 12} textAnchor="middle" fontSize={10} fill={v < 0 ? '#fca5a5' : INK}>{short(v)}</text>}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{m}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && <Tip x={`${((L + bw * hover + bw / 2) / W) * 100}%`} y={0} lines={[months[hover], `Utilidad ${money(net[hover])}`]} />}
    </div>
  )
}

/** Barras horizontales: en qué se va el gasto (meses elegidos). */
function ExpenseBreakdown({ items }: { items: { label: string; cents: number }[] }) {
  const total = items.reduce((a, b) => a + b.cents, 0) || 1
  const max = Math.max(1, ...items.map(i => i.cents))
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.label} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="text-zinc-300 truncate">{it.label}</span>
          <div className="h-3 rounded bg-white/5 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(it.cents / max) * 100}%`, background: C_OUT }} />
          </div>
          <span className="text-texto-principal tabular-nums">{money(it.cents)} <span className="text-zinc-400">· {Math.round((it.cents / total) * 100)}%</span></span>
        </div>
      ))}
    </div>
  )
}

export default function StatementCharts({ months, inc, exp, net, netLabel, breakdown }: {
  months: string[]; inc: number[]; exp: number[]; net: number[]; netLabel: string; breakdown: { label: string; cents: number }[]
}) {
  if (!months.length) return null
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-texto-principal text-sm font-bold">Ingresos y egresos por mes</p>
          <Legend items={[{ color: C_IN, label: 'Ingresos' }, { color: C_OUT, label: 'Egresos' }]} />
        </div>
        <IncomeVsExpense months={months} inc={inc} exp={exp} />
      </div>
      <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-2">
        <p className="text-texto-principal text-sm font-bold">{netLabel} por mes</p>
        <NetByMonth months={months} net={net} />
      </div>
      <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4 space-y-3 lg:col-span-2">
        <p className="text-texto-principal text-sm font-bold">¿En qué se va el gasto? <span className="text-zinc-400 font-normal">(meses elegidos)</span></p>
        <ExpenseBreakdown items={breakdown} />
      </div>
    </div>
  )
}
