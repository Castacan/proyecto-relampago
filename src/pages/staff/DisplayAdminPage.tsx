import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { useSponsorships } from '../../hooks/useSponsorships'
import { useDisplaySlides } from '../../hooks/useDisplaySlides'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import SponsorForm from '../../components/SponsorForm'
import SlideForm from '../../components/SlideForm'
import SlidePreviewModal from '../../components/SlidePreviewModal'
import WinnerImageModal from '../../components/WinnerImageModal'
import Toggle from '../../components/Toggle'
import type { Sponsorship, DisplaySlide, SponsorPeriod } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

type Tab = 'patrocinadores' | 'ganadores' | 'slides' | 'configuracion'

const PERIOD_LABEL: Record<SponsorPeriod, string> = {
  top_1_daily: 'Diario',
  top_1_weekly: 'Semanal',
  top_1_monthly: 'Mensual',
}

const WINNER_FILTERS: { value: 'todos' | SponsorPeriod; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'top_1_daily', label: 'Diario' },
  { value: 'top_1_weekly', label: 'Semanal' },
  { value: 'top_1_monthly', label: 'Mensual' },
]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function sponsorshipEstado(s: Sponsorship): { label: string; color: string } {
  const now = new Date().toISOString()
  if (!s.is_active) return { label: 'Inactivo', color: 'text-zinc-500' }
  if (s.starts_at > now) return { label: 'Programado', color: 'text-blue-400' }
  if (s.ends_at < now) return { label: 'Expirado', color: 'text-zinc-500' }
  return { label: 'Activo', color: 'text-primario' }
}

function slideEstado(s: DisplaySlide): { label: string; color: string } {
  const now = new Date().toISOString()
  if (!s.is_active) return { label: 'Inactivo', color: 'text-zinc-500' }
  if (s.starts_at && s.starts_at > now) return { label: 'Programado', color: 'text-blue-400' }
  if (s.ends_at && s.ends_at < now) return { label: 'Expirado', color: 'text-zinc-500' }
  return { label: 'Activo', color: 'text-primario' }
}

export default function DisplayAdminPage() {
  const { profile } = useProfile()
  const [tab, setTab] = useState<Tab>('patrocinadores')

  const { sponsorships, loading: sponsorsLoading, refetch: refetchSponsors } = useSponsorships({ all: true })
  const { slides, loading: slidesLoading, refetch: refetchSlides } = useDisplaySlides({ all: true })
  const { settings, loading: settingsLoading, refetch: refetchSettings } = useDisplaySettings()

  const [sponsorForm, setSponsorForm] = useState<{ open: boolean; initial?: Sponsorship }>({ open: false })
  const [slideForm, setSlideForm] = useState<{ open: boolean; initial?: DisplaySlide }>({ open: false })
  const [previewSlide, setPreviewSlide] = useState<DisplaySlide | null>(null)
  const [winnerFilter, setWinnerFilter] = useState<'todos' | SponsorPeriod>('todos')
  const [winnerImageSponsorship, setWinnerImageSponsorship] = useState<Sponsorship | null>(null)

  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null)
  const [fadeMs, setFadeMs] = useState<number | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  async function togglePrizeDelivered(s: Sponsorship) {
    await db.from('sponsorships').update({ prize_delivered: !s.prize_delivered }).eq('id', s.id)
    refetchSponsors()
  }

  // Swap de sort_order entre filas adyacentes — sin drag-and-drop, mismo
  // espíritu que el orden de zonas en Cadena Panorámica (AdminPage.tsx).
  async function moveSlide(index: number, direction: -1 | 1) {
    const other = slides[index + direction]
    const current = slides[index]
    if (!other) return
    await Promise.all([
      db.from('display_slides').update({ sort_order: other.sort_order }).eq('id', current.id),
      db.from('display_slides').update({ sort_order: current.sort_order }).eq('id', other.id),
    ])
    refetchSlides()
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    const interval = intervalSeconds ?? settings.slide_interval_seconds
    const fade = fadeMs ?? settings.fade_duration_ms
    await Promise.all([
      db.from('display_settings').update({ value: String(interval) }).eq('key', 'slide_interval_seconds'),
      db.from('display_settings').update({ value: String(fade) }).eq('key', 'fade_duration_ms'),
    ])
    setSavingSettings(false)
    refetchSettings()
  }

  if (profile === null) return (
    <div className="flex justify-center items-center h-full bg-fondo">
      <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )
  if (profile.role !== 'admin') return <Navigate to="/staff" replace />

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="px-4 pt-5 pb-6">
        <h1 className="text-texto-principal font-black text-2xl tracking-tight mb-4">Display</h1>

        {/* overflow-x-auto + shrink-0 (no flex-1): con 4 tabs "Patrocinadores"
            ya no cabe repartido en pantallas chicas — mismo fix que
            StaffLayout aplicó para su tab bar de 5 (commit f41cc11). */}
        <div className="flex gap-2 mb-5 bg-superficie rounded-2xl p-1 border border-zinc-800/60 overflow-x-auto">
          {([
            { key: 'patrocinadores', label: 'Patrocinadores' },
            { key: 'ganadores', label: 'Ganadores' },
            { key: 'slides', label: 'Slides' },
            { key: 'configuracion', label: 'Configuración' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                tab === t.key ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-texto-principal'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'patrocinadores' && (
          <>
            <button
              onClick={() => setSponsorForm({ open: true })}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm mb-4 active:scale-[0.98] transition-all"
            >
              + Nuevo patrocinador
            </button>
            {sponsorsLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            )}
            {!sponsorsLoading && sponsorships.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-10">No hay patrocinadores todavía.</p>
            )}
            <div className="flex flex-col gap-2.5">
              {sponsorships.map(s => {
                const estado = sponsorshipEstado(s)
                const ended = s.ends_at < new Date().toISOString()
                return (
                  <div key={s.id} className="p-4 bg-superficie border border-zinc-800/60 rounded-2xl">
                    <button onClick={() => setSponsorForm({ open: true, initial: s })} className="w-full flex items-center gap-3 text-left">
                      <div className="w-11 h-11 rounded-xl bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden">
                        <img src={s.sponsor_logo} alt={s.sponsor_name} className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-texto-principal font-semibold text-sm truncate">{s.sponsor_name}</p>
                          <span className="text-[9px] font-bold uppercase text-zinc-500 bg-superficie-alta px-1.5 py-0.5 rounded shrink-0">{PERIOD_LABEL[s.winner_rule]}</span>
                        </div>
                        <p className="text-zinc-500 text-xs mt-0.5 truncate">{s.prize_text}</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase shrink-0 ${estado.color}`}>{estado.label}</span>
                    </button>
                    {ended && s.winner_user_id && (
                      <div className="mt-3 pt-3 border-t border-zinc-800/60">
                        <p className="text-zinc-400 text-xs mb-2">
                          🏆 Ganó: <span className="text-texto-principal font-semibold">{s.winner?.display_name ?? '—'}</span>
                        </p>
                        <Toggle checked={s.prize_delivered} onChange={() => togglePrizeDelivered(s)} label="Premio entregado" />
                      </div>
                    )}
                    {ended && !s.winner_user_id && (
                      <p className="text-zinc-600 text-xs mt-3 pt-3 border-t border-zinc-800/60">Sin ganador todavía (se calcula automáticamente dentro de 60s de terminar el periodo).</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'ganadores' && (
          <>
            <div className="flex gap-2 mb-4 overflow-x-auto">
              {WINNER_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setWinnerFilter(f.value)}
                  className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                    winnerFilter === f.value
                      ? 'bg-primario text-texto-en-acento border-primario'
                      : 'bg-superficie text-zinc-400 border-zinc-800/60 hover:text-texto-principal'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {sponsorsLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            )}

            {!sponsorsLoading && (() => {
              const nowIso = new Date().toISOString()
              const past = sponsorships
                .filter(s => s.ends_at < nowIso && (winnerFilter === 'todos' || s.winner_rule === winnerFilter))
                .sort((a, b) => b.ends_at.localeCompare(a.ends_at))

              if (past.length === 0) {
                return <p className="text-zinc-600 text-sm text-center py-10">Todavía no hay patrocinios terminados{winnerFilter !== 'todos' ? ` de tipo ${PERIOD_LABEL[winnerFilter]}` : ''}.</p>
              }

              return (
                <div className="flex flex-col gap-2.5">
                  {past.map(s => (
                    <div key={s.id} className="p-4 bg-superficie border border-zinc-800/60 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden">
                          <img src={s.sponsor_logo} alt={s.sponsor_name} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-texto-principal font-semibold text-sm truncate">{s.sponsor_name}</p>
                            <span className="text-[9px] font-bold uppercase text-zinc-500 bg-superficie-alta px-1.5 py-0.5 rounded shrink-0">{PERIOD_LABEL[s.winner_rule]}</span>
                          </div>
                          <p className="text-zinc-500 text-xs mt-0.5 truncate">{s.prize_text}</p>
                          <p className="text-zinc-600 text-[11px] mt-0.5">{fmtDate(s.starts_at)} – {fmtDate(s.ends_at)}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-zinc-800/60">
                        {s.winner_user_id ? (
                          <>
                            <p className="text-zinc-400 text-xs mb-2">
                              🏆 Ganó: <span className="text-texto-principal font-semibold">{s.winner?.display_name ?? '—'}</span>
                            </p>
                            <Toggle checked={s.prize_delivered} onChange={() => togglePrizeDelivered(s)} label="Premio entregado" />
                          </>
                        ) : (
                          <p className="text-zinc-600 text-xs mb-2">Sin ganador (nadie calificó dentro del periodo, o se calcula dentro de 60s de haber terminado).</p>
                        )}
                        {/* Solo semanal/mensual (2026-08-23) — el usuario pidió
                            esto específicamente para anunciar esos dos, diario
                            queda fuera para no llenar la pantalla de botones */}
                        {s.winner_rule !== 'top_1_daily' && (
                          <button
                            onClick={() => setWinnerImageSponsorship(s)}
                            className="w-full mt-1 py-2.5 rounded-xl bg-superficie-alta hover:bg-superficie-alta-hover text-texto-principal font-semibold text-xs transition-all"
                          >
                            📸 Crear imagen
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </>
        )}

        {tab === 'slides' && (
          <>
            <button
              onClick={() => setSlideForm({ open: true })}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm mb-4 active:scale-[0.98] transition-all"
            >
              + Nuevo slide
            </button>
            {slidesLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            )}
            {!slidesLoading && slides.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-10">No hay slides todavía. La pantalla muestra solo el leaderboard.</p>
            )}
            <div className="flex flex-col gap-2.5">
              {slides.map((s, i) => {
                const estado = slideEstado(s)
                return (
                  <div key={s.id} className="flex items-center gap-2 p-4 bg-superficie border border-zinc-800/60 rounded-2xl">
                    <button
                      onClick={() => setSlideForm({ open: true, initial: s })}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <div className="w-14 h-9 rounded-lg overflow-hidden shrink-0 bg-zinc-950">
                        <img src={s.image_url} alt={s.title} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-texto-principal font-semibold text-sm truncate">{s.title}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">{s.display_seconds}s</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase shrink-0 ${estado.color}`}>{estado.label}</span>
                    </button>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => moveSlide(i, -1)}
                        disabled={i === 0}
                        className="w-6 h-5 flex items-center justify-center rounded bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 disabled:opacity-30 transition-all text-xs"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveSlide(i, 1)}
                        disabled={i === slides.length - 1}
                        className="w-6 h-5 flex items-center justify-center rounded bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 disabled:opacity-30 transition-all text-xs"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      onClick={() => setPreviewSlide(s)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-superficie-alta hover:bg-superficie-alta-hover text-zinc-400 hover:text-texto-principal transition-all shrink-0"
                      title="Vista previa"
                    >
                      ▶
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'configuracion' && (
          <>
            {settingsLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-primario border-t-transparent animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Intervalo entre slides (segundos)</label>
                  <p className="text-zinc-600 text-xs mb-2">Cada cuántos segundos de leaderboard aparece un slide.</p>
                  <input
                    type="number"
                    min={1}
                    value={intervalSeconds ?? settings.slide_interval_seconds}
                    onChange={e => setIntervalSeconds(Number(e.target.value))}
                    className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 text-xs font-semibold mb-1.5 block">Duración del fade (milisegundos)</label>
                  <input
                    type="number"
                    min={0}
                    value={fadeMs ?? settings.fade_duration_ms}
                    onChange={e => setFadeMs(Number(e.target.value))}
                    className="w-full bg-superficie-alta text-texto-principal rounded-xl px-4 py-3 text-sm outline-none border border-zinc-700/50 hover:border-zinc-600 focus:border-primario/60 transition-all"
                  />
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="w-full py-3.5 rounded-2xl bg-primario hover:bg-primario-hover text-texto-en-acento font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {savingSettings ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {sponsorForm.open && (
        <SponsorForm
          initial={sponsorForm.initial}
          existingSponsorships={sponsorships}
          onSave={() => { setSponsorForm({ open: false }); refetchSponsors() }}
          onCancel={() => setSponsorForm({ open: false })}
        />
      )}

      {slideForm.open && (
        <SlideForm
          initial={slideForm.initial}
          nextSortOrder={slides.length}
          onSave={() => { setSlideForm({ open: false }); refetchSlides() }}
          onCancel={() => setSlideForm({ open: false })}
        />
      )}

      {previewSlide && (
        <SlidePreviewModal slide={previewSlide} onClose={() => setPreviewSlide(null)} />
      )}

      {winnerImageSponsorship && (
        <WinnerImageModal sponsorship={winnerImageSponsorship} onClose={() => setWinnerImageSponsorship(null)} />
      )}
    </div>
  )
}
