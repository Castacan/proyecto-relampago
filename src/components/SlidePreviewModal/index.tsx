import DisplaySlide from '../DisplaySlide'
import type { DisplaySlide as DisplaySlideType } from '../../types'

interface Props {
  slide: DisplaySlideType
  onClose: () => void
}

// Reusa DisplaySlide dentro de un contenedor aspect-video — el preview es
// pixel-idéntico al render real de la TV, no una aproximación aparte.
export default function SlidePreviewModal({ slide, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[60] p-6" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-700/60 bg-zinc-950">
          <DisplaySlide slide={slide} />
        </div>
        <button
          onClick={onClose}
          className="w-full mt-4 py-3 rounded-2xl bg-superficie-alta hover:bg-superficie-alta-hover text-texto-principal font-bold text-sm transition-all"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
