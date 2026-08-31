import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { drawWinnerImage, loadImage, downloadCanvasAsPng } from '../../lib/winnerImage'
import { MONTHS_ES, fmtDayMonthOnly } from '../../lib/dates'
import gymLogoSrc from '../../assets/logo-vertical.png'
import type { Sponsorship, SponsorPeriod } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Candidate {
  display_name: string
  total_points: number
}

export interface ExistingSponsor {
  sponsor_name: string
  sponsor_logo: string
}

// Fuente de datos de la imagen — 'sponsor' es el flujo original (patrocinio
// real, ya terminado); 'generic' es nuevo (2026-08-24): periodo calendario
// SIN patrocinio, desde un card genérico de Ganadores. Los candidatos ya
// vienen resueltos (top 5 de get_weekly/monthly_winners_history) — no hace
// falta pedirlos de nuevo vía get_leaderboard_for_range.
export type WinnerImageSource =
  | { kind: 'sponsor'; sponsorship: Sponsorship }
  | { kind: 'generic'; rule: 'top_1_weekly' | 'top_1_monthly'; periodStart: string; periodEnd: string; candidates: Candidate[] }

interface Props {
  source: WinnerImageSource
  onClose: () => void
  // Solo se usa en modo 'generic' — logos de patrocinadores YA existentes en
  // el sistema (de sponsorships reales, pasados/vigentes) para elegir uno y
  // ponerlo como crédito abajo, sin tener que subir una foto nueva.
  existingSponsors?: ExistingSponsor[]
}

const PERIOD_HEADLINE: Record<SponsorPeriod, string> = {
  top_1_daily: 'GANADOR DEL DÍA',
  top_1_weekly: 'GANADOR DE LA SEMANA',
  top_1_monthly: 'GANADOR DEL MES',
}

function fmtDayMonth(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`
}

// Genera la imagen vertical para anunciar al ganador (2026-08-23, generalizada
// 2026-08-24 para periodos sin patrocinio). Trae el top N real del periodo
// (no el winner_user_id ya guardado) — el staff puede QUITAR gente de la
// lista antes de descargar, sin tocar el ganador oficial del sistema, ver
// AskUserQuestion respondida en la sesión original: el alcance es solo la
// imagen.
export default function WinnerImageModal({ source, onClose, existingSponsors = [] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(source.kind === 'generic' ? source.candidates : null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Solo el modo 'generic' expone estos campos — en modo 'sponsor' ya
  // vienen del patrocinio real y no son editables en esta pasada.
  const [prizeText, setPrizeText] = useState('')
  const [selectedSponsor, setSelectedSponsor] = useState<ExistingSponsor | null>(null)

  useEffect(() => {
    if (source.kind !== 'sponsor') return
    const sponsorship = source.sponsorship
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await db.rpc('get_leaderboard_for_range', {
        p_start: sponsorship.starts_at,
        p_end: sponsorship.ends_at,
        p_monthly: sponsorship.winner_rule === 'top_1_monthly',
        p_limit: 8,
        // 2026-08-30: dedup mensual también para semanal, ver comentario en
        // schema.sql junto a get_leaderboard_for_range (fix "semana > mes").
        p_weekly_dedup: sponsorship.winner_rule === 'top_1_weekly',
      })
      if (cancelled) return
      if (err) {
        // eslint-disable-next-line no-console
        console.error('get_leaderboard_for_range:', err)
        setError('No se pudieron cargar los datos del periodo.')
        return
      }
      setCandidates(data ?? [])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind === 'sponsor' ? source.sponsorship.id : null])

  const top3 = (candidates ?? []).filter(c => !excluded.has(c.display_name)).slice(0, 3)

  const periodLabel = source.kind === 'sponsor' ? PERIOD_HEADLINE[source.sponsorship.winner_rule] : PERIOD_HEADLINE[source.rule]
  const dateRangeLabel = source.kind === 'sponsor'
    ? `${fmtDayMonth(source.sponsorship.starts_at)} a ${fmtDayMonth(source.sponsorship.ends_at)}`
    : `${fmtDayMonthOnly(source.periodStart)} a ${fmtDayMonthOnly(source.periodEnd)}`

  useEffect(() => {
    if (!candidates || !canvasRef.current) return
    let cancelled = false
    setRendering(true)
    ;(async () => {
      try {
        const sponsorLogoSrc = source.kind === 'sponsor' ? source.sponsorship.sponsor_logo : (selectedSponsor?.sponsor_logo ?? null)
        const [gymLogo, sponsorLogo] = await Promise.all([
          loadImage(gymLogoSrc),
          sponsorLogoSrc ? loadImage(sponsorLogoSrc).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled || !canvasRef.current) return
        await drawWinnerImage(canvasRef.current, gymLogo, sponsorLogo, {
          periodLabel,
          dateRangeLabel,
          sponsorName: source.kind === 'sponsor' ? source.sponsorship.sponsor_name : selectedSponsor?.sponsor_name,
          prizeText: source.kind === 'sponsor' ? source.sponsorship.prize_text : (prizeText.trim() || undefined),
          // Modo sponsor: card grande arriba, como siempre. Modo generic:
          // crédito chico pegado al pie — el usuario pidió explícito que el
          // logo elegido "vaya hasta abajo".
          sponsorPosition: source.kind === 'sponsor' ? 'top' : 'bottom',
          top3,
        })
      } catch {
        if (!cancelled) setError('No se pudo generar la imagen — revisa que el logo del patrocinador cargue bien.')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => { cancelled = true }
    // periodLabel/dateRangeLabel se derivan de source (estable por id/kind),
    // top3 de candidates+excluded — meter source entero en deps dispararía
    // renders de más por la referencia nueva del objeto en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, excluded, prizeText, selectedSponsor, source.kind === 'sponsor' ? source.sponsorship.id : `${source.rule}-${source.periodStart}`])

  function toggleExclude(name: string) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function handleDownload() {
    if (!canvasRef.current) return
    if (source.kind === 'sponsor') {
      const safeName = source.sponsorship.sponsor_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      downloadCanvasAsPng(canvasRef.current, `ganador-${safeName}-${source.sponsorship.ends_at.slice(0, 10)}.png`)
    } else {
      const periodSlug = source.rule === 'top_1_weekly' ? 'semana' : 'mes'
      downloadCanvasAsPng(canvasRef.current, `ganador-${periodSlug}-${source.periodEnd}.png`)
    }
  }

  const canDownload = candidates !== null && candidates.length > 0 && top3.length > 0 && !rendering

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-superficie rounded-3xl border border-zinc-800/80 max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-texto-principal font-black text-lg tracking-tight">Imagen de ganador</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all text-lg leading-none">
              ×
            </button>
          </div>

          <div className="flex justify-center mb-5">
            <div className="relative w-full max-w-[280px] aspect-[9/16] rounded-2xl overflow-hidden bg-fondo border border-zinc-800/60">
              <canvas ref={canvasRef} className="w-full h-full" />
              {(candidates === null || rendering) && (
                <div className="absolute inset-0 flex items-center justify-center bg-fondo/80">
                  <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-red-400 text-xs text-center mb-4">{error}</p>}

          {source.kind === 'generic' && (
            <div className="mb-5 flex flex-col gap-3">
              <p className="text-zinc-500 text-xs font-semibold">
                Este periodo no tuvo patrocinio — todo opcional, déjalo vacío para un post limpio de solo top 3.
              </p>
              <div>
                <label className="text-zinc-500 text-[11px] font-semibold mb-1.5 block">Logo de patrocinador (opcional) — va hasta abajo</label>
                {existingSponsors.length === 0 ? (
                  <p className="text-zinc-600 text-xs">Todavía no hay patrocinadores registrados en el sistema.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button
                      onClick={() => setSelectedSponsor(null)}
                      className={`shrink-0 w-16 h-16 rounded-xl flex items-center justify-center text-[10px] font-bold uppercase transition-all border-2 ${
                        selectedSponsor === null ? 'border-primario text-primario bg-primario/10' : 'border-zinc-700/60 text-zinc-500 bg-fondo hover:border-zinc-600'
                      }`}
                    >
                      Ninguno
                    </button>
                    {existingSponsors.map(s => (
                      <button
                        key={s.sponsor_name}
                        onClick={() => setSelectedSponsor(s)}
                        title={s.sponsor_name}
                        className={`shrink-0 w-16 h-16 rounded-xl bg-white flex items-center justify-center p-1.5 overflow-hidden transition-all border-2 ${
                          selectedSponsor?.sponsor_name === s.sponsor_name ? 'border-primario' : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <img src={s.sponsor_logo} alt={s.sponsor_name} className="max-w-full max-h-full object-contain" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-zinc-500 text-[11px] font-semibold mb-1 block">Premio (opcional)</label>
                <input
                  type="text"
                  value={prizeText}
                  onChange={e => setPrizeText(e.target.value)}
                  placeholder="ej. Playera Jaibamuro"
                  className="w-full bg-fondo border border-zinc-800/80 rounded-xl px-3 py-2 text-texto-principal text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primario/60"
                />
              </div>
            </div>
          )}

          {candidates !== null && candidates.length === 0 && (
            <p className="text-zinc-600 text-sm text-center mb-4">Nadie mandó rutas durante este periodo — no hay datos para la imagen.</p>
          )}

          {candidates !== null && candidates.length > 0 && top3.length === 0 && (
            <p className="text-primario text-xs text-center mb-4">Quitaste a todos — vuelve a incluir a alguien para poder descargar.</p>
          )}

          {candidates !== null && candidates.length > 0 && (
            <div className="mb-5">
              <p className="text-zinc-500 text-xs font-semibold mb-2">
                Quita a alguien si hizo trampa o es staff — el top 3 de la imagen se recalcula solo. Esto NO cambia el ganador guardado en el sistema.
              </p>
              <div className="flex flex-col gap-1.5">
                {candidates.map((c, i) => {
                  const isExcluded = excluded.has(c.display_name)
                  return (
                    <div
                      key={c.display_name}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${isExcluded ? 'bg-fondo/60 border-zinc-800/40 opacity-50' : 'bg-fondo border-zinc-800/60'}`}
                    >
                      <span className="text-zinc-600 font-bold text-xs w-5 shrink-0">{i + 1}</span>
                      <span className={`flex-1 text-sm font-semibold truncate ${isExcluded ? 'text-zinc-500 line-through' : 'text-texto-principal'}`}>
                        {c.display_name}
                      </span>
                      <span className="text-zinc-500 text-xs shrink-0">{c.total_points} pts</span>
                      <button
                        onClick={() => toggleExclude(c.display_name)}
                        className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg transition-all ${
                          isExcluded ? 'bg-primario/15 text-primario' : 'bg-superficie-alta text-zinc-400 hover:text-red-400'
                        }`}
                      >
                        {isExcluded ? 'Incluir' : 'Quitar'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleDownload}
            disabled={!canDownload}
            className="w-full py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
          >
            Descargar imagen
          </button>
        </div>
      </div>
    </div>
  )
}
