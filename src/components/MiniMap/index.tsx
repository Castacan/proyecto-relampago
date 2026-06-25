import type { Zone, Route } from '../../types'
import { getFreshnessLevel, getFreshnessColor } from '../../lib/freshness'

const MAP_W = 130
const MAP_H = 100

interface Props {
  zones: Zone[]
  routes: Route[]
  onZoneClick: (zone: Zone) => void
}

function getZoneFreshnessColor(zone: Zone, routes: Route[]): string {
  const zoneRoutes = routes.filter(r => r.zone_id === zone.id)
  if (zoneRoutes.length === 0) return '#374151'
  // Color based on oldest route in this zone
  const oldest = zoneRoutes.reduce((a, b) => a.placed_at < b.placed_at ? a : b)
  return getFreshnessColor(getFreshnessLevel(oldest.placed_at))
}

export default function MiniMap({ zones, routes, onZoneClick }: Props) {
  return (
    <div className="absolute top-3 right-3 rounded-lg overflow-hidden border border-zinc-700 shadow-xl" style={{ width: MAP_W + 16, background: '#111' }}>
      <p className="text-zinc-500 text-[10px] px-2 pt-1.5 pb-0.5 uppercase tracking-widest">Muro</p>
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        width={MAP_W}
        height={MAP_H}
        className="block mx-auto mb-1"
      >
        {/* Outer room boundary */}
        <rect x={4} y={4} width={MAP_W - 8} height={MAP_H - 8} fill="none" stroke="#374151" strokeWidth={1} />

        {/* Zone shapes - approximate cenital layout */}
        {zones.map(zone => {
          const color = getZoneFreshnessColor(zone, routes)
          // Map each zone to a rough position in the cenital view
          const shape = getZoneShape(zone.slug, MAP_W, MAP_H)
          if (!shape) return null
          return (
            <g key={zone.id} onClick={() => onZoneClick(zone)} style={{ cursor: 'pointer' }}>
              <rect
                x={shape.x} y={shape.y} width={shape.w} height={shape.h}
                fill={color} fillOpacity={0.6} rx={2}
                stroke={color} strokeWidth={1}
              />
              <text
                x={shape.x + shape.w / 2}
                y={shape.y + shape.h / 2 + 3}
                textAnchor="middle"
                fontSize={7}
                fill="rgba(255,255,255,0.7)"
                fontFamily="sans-serif"
              >
                {zone.name.split(' ')[0]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Posiciones cenitales basadas en el modelo 3D del gym
// Espacio trapezoidal: paredes laterales + fondo + estructura de túnel central
function getZoneShape(slug: string, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const shapes: Record<string, { x: number; y: number; w: number; h: number }> = {
    // Pared lateral izquierda (franja vertical izq)
    'pared-izquierda':        { x: 4,       y: 6,       w: 8,  h: h - 12 },
    // Fondo izquierdo (pared trasera izq, arriba)
    'fondo-izquierdo':        { x: 12,      y: 6,       w: 28, h: 18 },
    // Flanco túnel izquierdo (lado izq de la estructura)
    'flanco-tunel-izquierdo': { x: 12,      y: 24,      w: 14, h: h - 36 },
    // Desplome (nariz del túnel, abajo centro)
    'desplome':               { x: 26,      y: h - 22,  w: 30, h: 16 },
    // Flanco túnel derecho (lado der de la estructura)
    'flanco-tunel-derecho':   { x: 56,      y: 24,      w: 14, h: h - 36 },
    // Fondo derecho izq (pared trasera der, arriba — foto izq)
    'fondo-derecho-izq':      { x: 56,      y: 6,       w: 20, h: 18 },
    // Fondo derecho der (pared trasera der, arriba — foto der)
    'fondo-derecho-der':      { x: 76,      y: 6,       w: 20, h: 18 },
    // Pared lateral derecha (franja vertical der)
    'pared-derecha':          { x: w - 12,  y: 6,       w: 8,  h: h - 12 },
    // Túnel norte (cara interior norte del túnel)
    'tunel-norte':            { x: 28,      y: 24,      w: 26, h: (h - 50) / 2 },
    // Túnel sur (cara interior sur del túnel)
    'tunel-sur':              { x: 28,      y: 24 + (h - 50) / 2 + 2, w: 26, h: (h - 50) / 2 },
  }
  return shapes[slug] ?? null
}
