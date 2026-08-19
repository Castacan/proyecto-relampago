import type { DisplaySlide as DisplaySlideType } from '../../types'

interface Props {
  slide: DisplaySlideType | null
}

// Imagen fullscreen + overlay_text opcional (texto blanco grande centrado
// con sombra, tercio inferior) — spec sección 10.4 del doc.
export default function DisplaySlide({ slide }: Props) {
  if (!slide) return null
  return (
    <div
      className="absolute inset-0 bg-cover bg-center flex items-end justify-center pb-16"
      style={{ backgroundImage: `url(${slide.image_url})` }}
    >
      {slide.overlay_text && (
        <p
          className="text-white font-black text-5xl text-center px-12 max-w-4xl"
          style={{ textShadow: '0 2px 16px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6)' }}
        >
          {slide.overlay_text}
        </p>
      )}
    </div>
  )
}
