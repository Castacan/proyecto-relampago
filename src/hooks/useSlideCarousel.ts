import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplaySlide } from '../types'

export type CarouselPhase = 'leaderboard' | 'toSlide' | 'slide' | 'toLeaderboard'

// Máquina de estados de 4 fases con setTimeout auto-encadenado (nunca un
// setInterval fijo + setTimeouts anidados como el pseudocódigo del doc
// original, que puede desfasarse si display_seconds + 2×fade > interval).
// Cada paso agenda el siguiente solo cuando el anterior terminó, así que
// nunca se solapan dos ciclos.
//
// leaderboardVisible = phase === 'leaderboard'
// slideVisible        = phase === 'slide'
// Ambos contenedores quedan siempre montados con transition-opacity de
// duración fadeMs — el cambio de fase dispara el fade automáticamente vía CSS.
export function useSlideCarousel(slides: DisplaySlide[], intervalSeconds: number, fadeMs: number) {
  const [phase, setPhase] = useState<CarouselPhase>('leaderboard')
  const [currentSlide, setCurrentSlide] = useState<DisplaySlide | null>(null)

  // useDisplaySlides refresca cada 60s (para detectar slides que entran/
  // salen de su ventana de fechas) aunque el contenido no haya cambiado —
  // eso entrega un array con una referencia nueva cada vez. Si el efecto de
  // abajo dependiera de `slides` directamente, ese refresh reiniciaría el
  // ciclo completo del carrusel cada 60s, justo el mismo intervalo default
  // entre slides — el carrusel nunca llegaba a mostrar nada porque se
  // reseteaba antes de completar la espera. `slidesKey` solo cambia cuando
  // el contenido real cambió (slides agregados/quitados/editados).
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  const slidesKey = useMemo(
    () => slides.map(s => `${s.id}:${s.display_seconds}:${s.image_url}:${s.overlay_text ?? ''}`).join('|'),
    [slides]
  )

  useEffect(() => {
    setPhase('leaderboard')
    setCurrentSlide(null)
    if (slidesRef.current.length === 0) return

    let cancelled = false
    let idx = 0
    const timeouts: number[] = []
    const after = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => { if (!cancelled) fn() }, ms)
      timeouts.push(id)
    }

    function cycle() {
      const currentSlides = slidesRef.current
      if (currentSlides.length === 0) return
      after(intervalSeconds * 1000, () => {
        setPhase('toSlide')
        after(fadeMs, () => {
          const list = slidesRef.current
          if (list.length === 0) { setPhase('leaderboard'); return }
          const slide = list[idx % list.length]
          setCurrentSlide(slide)
          setPhase('slide')
          after(slide.display_seconds * 1000, () => {
            setPhase('toLeaderboard')
            after(fadeMs, () => {
              setPhase('leaderboard')
              idx = (idx + 1) % list.length
              cycle()
            })
          })
        })
      })
    }
    cycle()

    return () => {
      cancelled = true
      timeouts.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidesKey, intervalSeconds, fadeMs])

  return { phase, currentSlide }
}
