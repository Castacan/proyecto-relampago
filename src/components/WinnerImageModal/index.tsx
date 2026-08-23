import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { drawWinnerImage, loadImage, downloadCanvasAsPng } from '../../lib/winnerImage'
import { MONTHS_ES } from '../../lib/dates'
import gymLogoSrc from '../../assets/logo-vertical.png'
import type { Sponsorship, SponsorPeriod } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Props {
  sponsorship: Sponsorship
  onClose: () => void
}

interface Candidate {
  display_name: string
  total_points: number
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

// Genera la imagen vertical para anunciar al ganador (2026-08-23). Trae el
// top N real de ese periodo vía get_leaderboard_for_range (no el
// winner_user_id ya guardado — el staff puede QUITAR gente de la lista
// antes de descargar, sin tocar el ganador oficial del sistema, ver
// AskUserQuestion respondida en esta sesión: el alcance es solo la imagen).
export default function WinnerImageModal({ sponsorship, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await db.rpc('get_leaderboard_for_range', {
        p_start: sponsorship.starts_at,
        p_end: sponsorship.ends_at,
        p_monthly: sponsorship.winner_rule === 'top_1_monthly',
        p_limit: 8,
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
  }, [sponsorship.id, sponsorship.starts_at, sponsorship.ends_at, sponsorship.winner_rule])

  const top3 = (candidates ?? []).filter(c => !excluded.has(c.display_name)).slice(0, 3)

  useEffect(() => {
    if (!candidates || !canvasRef.current) return
    let cancelled = false
    setRendering(true)
    ;(async () => {
      try {
        const [gymLogo, sponsorLogo] = await Promise.all([
          loadImage(gymLogoSrc),
          sponsorship.sponsor_logo ? loadImage(sponsorship.sponsor_logo).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled || !canvasRef.current) return
        await drawWinnerImage(canvasRef.current, gymLogo, sponsorLogo, {
          periodLabel: PERIOD_HEADLINE[sponsorship.winner_rule],
          dateRangeLabel: `${fmtDayMonth(sponsorship.starts_at)} a ${fmtDayMonth(sponsorship.ends_at)}`,
          sponsorName: sponsorship.sponsor_name,
          prizeText: sponsorship.prize_text,
          top3,
        })
      } catch {
        if (!cancelled) setError('No se pudo generar la imagen — revisa que el logo del patrocinador cargue bien.')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => { cancelled = true }
    // top3 se deriva de candidates+excluded, sponsorship trae los textos —
    // meter top3/sponsorship enteros en deps sería redundante con lo de
    // arriba y dispara renders de más por la referencia nueva del array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, excluded, sponsorship.id])

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
    const safeName = sponsorship.sponsor_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    downloadCanvasAsPng(canvasRef.current, `ganador-${safeName}-${sponsorship.ends_at.slice(0, 10)}.png`)
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
