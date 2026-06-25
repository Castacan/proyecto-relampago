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

// Approximate positions for each zone in the cenital view
function getZoneShape(slug: string, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const shapes: Record<string, { x: number; y: number; w: number; h: number }> = {
    'pared-izquierda':        { x: 4,       y: 6,      w: 10, h: h - 12 },
    'fondo-izquierdo':        { x: 14,      y: 6,      w: 16, h: h - 12 },
    'flanco-tunel-izquierdo': { x: 30,      y: 6,      w: 10, h: h - 12 },
    'tunel-norte':            { x: 40,      y: 6,      w: 12, h: (h - 14) / 2 },
    'tunel-sur':              { x: 40,      y: 8 + (h - 14) / 2, w: 12, h: (h - 14) / 2 },
    'desplome':               { x: 52,      y: 6,      w: 12, h: h - 12 },
    'flanco-tunel-derecho':   { x: 64,      y: 6,      w: 10, h: h - 12 },
    'fondo-derecho-izq':      { x: 74,      y: 6,      w: 18, h: h - 12 },
    'fondo-derecho-der':      { x: 92,      y: 6,      w: 18, h: h - 12 },
    'pared-derecha':          { x: w - 14,  y: 6,      w: 10, h: h - 12 },
  }
  return shapes[slug] ?? null
}
