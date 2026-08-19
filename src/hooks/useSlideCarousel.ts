import { useEffect, useState } from 'react'
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

  useEffect(() => {
    setPhase('leaderboard')
    setCurrentSlide(null)
    if (slides.length === 0) return

    let cancelled = false
    let idx = 0
    const timeouts: number[] = []
    const after = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => { if (!cancelled) fn() }, ms)
      timeouts.push(id)
    }

    function cycle() {
      after(intervalSeconds * 1000, () => {
        setPhase('toSlide')
        after(fadeMs, () => {
          setCurrentSlide(slides[idx])
          setPhase('slide')
          after(slides[idx].display_seconds * 1000, () => {
            setPhase('toLeaderboard')
            after(fadeMs, () => {
              setPhase('leaderboard')
              idx = (idx + 1) % slides.length
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
  }, [slides, intervalSeconds, fadeMs])

  return { phase, currentSlide }
}
