import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'
import logoHorizontal from '../../assets/logo-horizontal.png'

// /competencia/resultados — ranking final oficial (pedido del dueño, 2026-11-08).
// Solo LEE get_competition_ranking_public (el mismo cálculo que /staff/competencia/puntos);
// no cambia nada. Se ve sin sesión únicamente cuando el admin prende
// "Ranking visible sin sesión" en Puntos → Ajustes; mientras tanto solo el admin lo ve.

type Row = { place: number; bib: number | null; full_name: string; points: number; tops: number; zones: number; flashes: number }
type Category = { id: string; name: string; ranking: Row[] }
type Data = { name: string; categories: Category[] }

const db = supabase as unknown as { rpc: (fn: string, args: object) => Promise<{ data: unknown; error: unknown }> }

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const fmt = (n: number) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CompetitionResultsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'hidden' | 'error'>('loading')
  const [isAdminPreview, setIsAdminPreview] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: session } = await supabase.auth.getSession()
      const { data: res, error } = await db.rpc('get_competition_ranking_public', { p_slug: COMPETITION_SLUG })
      if (!alive) return
      const r = res as (Data & { error?: string }) | null
      if (error || !r) { setState('error'); return }
      if (r.error === 'hidden') { setState('hidden'); return }
      if (r.error) { setState('error'); return }
      if (session.session) {
        // Solo el admin puede leer esto; así sabemos si el público ya lo ve o no.
        const { data: adm } = await db.rpc('get_competition_scoring_admin', { p_slug: COMPETITION_SLUG })
        const comp = (adm as { competition?: { ranking_public?: boolean } } | null)?.competition
        if (alive && comp && !comp.ranking_public) setIsAdminPreview(true)
      }
      if (!alive) return
      setData(r); setState('ok')
    })()
    return () => { alive = false }
  }, [])

  const term = q.trim().toLowerCase()
  const cats = (data?.categories ?? [])
    .map(c => ({ ...c, ranking: c.ranking.filter(r => !term || r.full_name.toLowerCase().includes(term) || String(r.bib ?? '') === term) }))
    .filter(c => c.ranking.length > 0)

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        <Link to="/competencia/reglamento" className="text-primario text-xs font-bold hover:text-primario-hover transition-colors">
          Cómo se califica
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div>
          <p className="text-primario font-black text-xs tracking-widest">JAM · JAIBAS AL MURO 2026</p>
          <h1 className="text-texto-principal font-black text-3xl leading-tight mt-1">Resultados</h1>
          <p className="text-zinc-400 text-sm mt-1">Ranking final por categoría. Gracias a todos por escalar con nosotros.</p>
        </div>

        {state === 'loading' && <p className="text-zinc-400 text-sm">Cargando…</p>}
        {state === 'error' && <p className="text-zinc-300 text-sm">No se pudieron cargar los resultados. Intenta de nuevo en un momento.</p>}
        {state === 'hidden' && (
          <div className="rounded-2xl bg-superficie border border-zinc-800 p-5">
            <p className="text-texto-principal font-bold">Los resultados se publican muy pronto.</p>
            <p className="text-zinc-400 text-sm mt-1">Vuelve a esta página en un rato.</p>
          </div>
        )}

        {state === 'ok' && (
          <>
            {isAdminPreview && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs p-3">
                Vista previa: solo tú ves esto. El público ve "se publican muy pronto" hasta que prendas
                "Ranking visible sin sesión" en Puntos → Ajustes y le des Guardar.
              </p>
            )}
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Busca tu nombre o número"
              className="w-full rounded-xl bg-superficie border border-zinc-800 px-4 py-3 text-texto-principal text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primario"
            />
            {cats.length === 0 && <p className="text-zinc-400 text-sm">No encontramos a nadie con esa búsqueda.</p>}
            {cats.map(c => (
              <section key={c.id} className="rounded-2xl bg-superficie border border-zinc-800 overflow-hidden">
                <h2 className="px-4 py-3 text-texto-principal font-black text-lg border-b border-zinc-800">{c.name}</h2>
                <div className="grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_3rem_3rem_5rem] gap-x-3 px-4 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
                  <span>Lugar</span><span>Nombre</span>
                  <span className="hidden sm:block text-right">Tops</span>
                  <span className="hidden sm:block text-right">Zonas</span>
                  <span className="text-right">Puntos</span>
                </div>
                <ol>
                  {c.ranking.map(r => (
                    <li key={`${r.bib}-${r.full_name}`}
                      className={`grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_3rem_3rem_5rem] gap-x-3 items-center px-4 py-2.5 border-t border-zinc-800/60 ${r.place <= 3 ? 'bg-primario/5' : ''}`}>
                      <span className="font-black text-texto-principal tabular-nums">{MEDAL[r.place] ?? r.place}</span>
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${r.place <= 3 ? 'text-texto-principal font-bold' : 'text-zinc-200'}`}>{r.full_name}</span>
                        <span className="block text-[11px] text-zinc-500 sm:hidden">#{r.bib} · {r.tops} tops · {r.zones} zonas</span>
                        <span className="hidden sm:block text-[11px] text-zinc-500">#{r.bib}</span>
                      </span>
                      <span className="hidden sm:block text-right text-zinc-300 text-sm tabular-nums">{r.tops}</span>
                      <span className="hidden sm:block text-right text-zinc-300 text-sm tabular-nums">{r.zones}</span>
                      <span className="text-right text-primario font-black text-sm tabular-nums">{fmt(r.points)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            <p className="text-zinc-500 text-xs">
              Puntos = suma de tus 5 mejores bloques. Empates: top más difícil, luego flashes y luego tus demás bloques.
              Ve el detalle en <Link to="/competencia/reglamento" className="text-primario font-semibold">Cómo se califica</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
