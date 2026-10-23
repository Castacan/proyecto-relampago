import type { ReactNode } from 'react'

// Piezas visuales compartidas del ERP: misma tipografía, tarjetas y botones
// en todas las pantallas para que se sienta como una sola herramienta.

export const input = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2.5 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario/60'
export const label = 'block text-zinc-300 text-xs font-bold mb-1'
export const btn = 'inline-flex items-center justify-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-all disabled:opacity-50 active:scale-[0.98]'
export const btnPrimary = `${btn} bg-primario hover:bg-primario-hover text-texto-en-acento`
export const btnGhost = `${btn} bg-superficie-alta/80 hover:bg-superficie-alta-hover text-zinc-200 border border-zinc-700/50`
export const btnDanger = `${btn} bg-alerta text-white hover:opacity-90`
export const btnSmall = 'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-superficie-alta/80 hover:bg-superficie-alta-hover border border-zinc-700/50 text-zinc-200 transition-all disabled:opacity-50'

export function Page({ title, subtitle, actions, children, width = 'max-w-5xl' }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; width?: string
}) {
  return (
    <div className="h-full overflow-y-auto bg-fondo px-4 sm:px-6 pt-5 pb-16">
      <div className={`${width} mx-auto space-y-5`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-texto-principal font-black text-2xl tracking-tight">{title}</h1>
            {subtitle && <p className="text-zinc-400 text-sm mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Card({ title, actions, children, className = '', tone }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; tone?: 'accent' | 'alert' | 'success'
}) {
  const border = tone === 'accent' ? 'border-primario/40' : tone === 'alert' ? 'border-alerta/60' : tone === 'success' ? 'border-exito/50' : 'border-zinc-800/80'
  return (
    <section className={`bg-superficie rounded-2xl border ${border} p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <h2 className="text-texto-principal font-bold text-base">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label: l, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'alert' | 'success' }) {
  const color = tone === 'accent' ? 'text-primario' : tone === 'alert' ? 'text-alerta' : tone === 'success' ? 'text-exito' : 'text-texto-principal'
  return (
    <div className="bg-superficie rounded-2xl border border-zinc-800/80 p-4">
      <p className="text-zinc-400 text-xs font-semibold">{l}</p>
      <p className={`font-black text-2xl leading-tight mt-0.5 tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-zinc-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

export function Badge({ children, cls = 'text-zinc-300 bg-superficie-alta' }: { children: ReactNode; cls?: string }) {
  return <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-zinc-500 text-sm text-center py-6">{children}</p>
}

export function Msg({ text, tone = 'error' }: { text: string | null; tone?: 'error' | 'ok' }) {
  if (!text) return null
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`text-sm font-semibold ${tone === 'error' ? 'text-alerta' : 'text-exito'}`}>{text}</p>
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )
}

// Campo de dinero en pesos (el valor guardado es texto en pesos).
export function MoneyField({ id, label: l, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{l}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
        <input id={id} type="number" inputMode="decimal" min={0} step="0.01" value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} className={`${input} pl-7`} />
      </div>
    </div>
  )
}
