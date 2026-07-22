import { useState } from 'react'
import type { Zone, Route } from '../../types'
import { getFreshnessLevel, getFreshnessColor } from '../../lib/freshness'
import { STITCH_GROUPS, getGroupDisplaySlug } from '../../lib/zoneGroups'

interface Props {
  zones: Zone[]
  routes: Route[]
  onZoneSelect: (zone: Zone) => void
  assignQrHint?: boolean
  mini?: boolean
  selectedZoneIds?: string[]
  onCollapse?: () => void
}

function getZoneFreshnessColor(zone: Zone, routes: Route[]): string {
  const zoneRoutes = routes.filter(r => r.zone_id === zone.id)
  if (zoneRoutes.length === 0) return '#27272a'
  const oldest = zoneRoutes.reduce((a, b) => a.placed_at < b.placed_at ? a : b)
  return getFreshnessColor(getFreshnessLevel(oldest.placed_at))
}

type PolyDef = { points: string; label: string; labelX: number; labelY: number; badgeX: number; badgeY: number }

const ZONE_POLYS: Record<string, PolyDef> = {
  'pared-izquierda':        { points: '30,15 62,15 100,300 80,300',          label: 'Pared\nIzq',       labelX: 57,  labelY: 168, badgeX: 57,  badgeY: 155 },
  'fondo-izquierdo':        { points: '62,15 198,15 198,58 62,58',           label: 'Fondo Izq',        labelX: 130, labelY: 40,  badgeX: 170, badgeY: 27  },
  // Combined polygon for the two fondo-derecho photo sections
  'fondo-derecho':          { points: '198,15 368,15 320,58 198,58',         label: 'Fondo Der',        labelX: 280, labelY: 40,  badgeX: 340, badgeY: 27  },
  'pared-derecha':          { points: '320,58 368,15 320,300 300,300',       label: 'Pared\nDer',       labelX: 330, labelY: 168, badgeX: 340, badgeY: 155 },
  'flanco-tunel-izquierdo': { points: '108,82 200,82 200,248 108,248',       label: 'Flanco\nIzq',      labelX: 133, labelY: 168, badgeX: 133, badgeY: 155 },
  'flanco-tunel-derecho':   { points: '200,82 292,82 292,248 200,248',       label: 'Flanco\nDer',      labelX: 269, labelY: 168, badgeX: 269, badgeY: 155 },
  'desplome':               { points: '108,248 292,248 292,295 108,295',     label: 'Desplome',         labelX: 200, labelY: 274, badgeX: 260, badgeY: 261 },
}

// ── Build a deduplicated display list: groups appear as ONE entry ─────────
type DisplayEntry = {
  key: string
  poly: PolyDef
  representativeZone: Zone   // zone to pass to onZoneSelect
  color: string
  count: number
  isSelected: boolean
}

function buildDisplayEntries(zones: Zone[], routes: Route[], selectedZoneIds: string[]): DisplayEntry[] {
  const selectedSet = new Set(selectedZoneIds)
  const processedSlugs = new Set<string>()
  const entries: DisplayEntry[] = []

  for (const zone of zones) {
    if (processedSlugs.has(zone.slug)) continue

    const group = STITCH_GROUPS.find(g => g.slugs.includes(zone.slug))

    if (group) {
      // Mark all group slugs as processed so we skip them later
      group.slugs.forEach(s => processedSlugs.add(s))

      // Only render if we have the combined polygon
      const poly = ZONE_POLYS[group.displaySlug]
      if (!poly) continue

      const groupZones = group.slugs
        .map(s => zones.find(z => z.slug === s))
        .filter((z): z is Zone => z !== undefined)

      const groupRoutes = routes.filter(r => groupZones.some(z => z.id === r.zone_id))
      const oldest = groupRoutes.length
        ? groupRoutes.reduce((a, b) => a.placed_at < b.placed_at ? a : b)
        : null
      const color = oldest ? getFreshnessColor(getFreshnessLevel(oldest.placed_at)) : '#27272a'

      entries.push({
        key: group.displaySlug,
        poly,
        representativeZone: groupZones[0],
        color,
        count: groupRoutes.length,
        isSelected: groupZones.some(z => selectedSet.has(z.id)),
      })
    } else {
      processedSlugs.add(zone.slug)
      // Check if this zone has a group displaySlug (shouldn't happen for non-group zones, but be safe)
      const slugToUse = getGroupDisplaySlug(zone.slug) ?? zone.slug
      const poly = ZONE_POLYS[slugToUse]
      if (!poly) continue

      entries.push({
        key: zone.id,
        poly,
        representativeZone: zone,
        color: getZoneFreshnessColor(zone, routes),
        count: routes.filter(r => r.zone_id === zone.id).length,
        isSelected: selectedSet.has(zone.id),
      })
    }
  }

  return entries
}

// ── Mini overlay ──────────────────────────────────────────────────────────
function ZoneMapMini({ zones, routes, onZoneSelect, selectedZoneIds, onCollapse }: Props) {
  const entries = buildDisplayEntries(zones, routes, selectedZoneIds ?? [])

  return (
    <div className="absolute top-3 right-3 z-30 bg-zinc-950/95 backdrop-blur-sm rounded-2xl border border-zinc-800/60 shadow-2xl p-2.5">
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <p className="text-zinc-600 text-[8px] font-bold uppercase tracking-widest select-none">Mapa</p>
        {onCollapse && (
          <button onClick={onCollapse} className="text-zinc-600 hover:text-zinc-300 leading-none text-[10px] font-bold ml-2">✕</button>
        )}
      </div>
      <svg viewBox="0 0 400 320" width="148" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <polygon points="30,15 368,15 320,300 80,300" fill="#18181b" stroke="#3f3f46" strokeWidth="1.5" />
        <rect x="108" y="82" width="184" height="213" fill="#09090b" rx="2" />
        <rect x="108" y="82" width="184" height="213" fill="none" stroke="#3f3f46" strokeWidth="1" rx="2" />

        {entries.map(({ key, poly, representativeZone, color, count, isSelected }) => (
          <g key={key} onClick={() => onZoneSelect(representativeZone)} style={{ cursor: 'pointer' }}>
            <polygon
              points={poly.points}
              fill={color}
              fillOpacity={isSelected ? 0.9 : 0.45}
              stroke={isSelected ? '#ffffff' : color}
              strokeWidth={isSelected ? 2.5 : 0.5}
            />
            {count > 0 && (
              <circle cx={poly.badgeX} cy={poly.badgeY} r="5" fill={isSelected ? '#fff' : color} opacity={isSelected ? 1 : 0.7} />
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Full-screen selector ──────────────────────────────────────────────────
export default function ZoneMap({ zones, routes, onZoneSelect, assignQrHint, mini, selectedZoneIds, onCollapse }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  if (mini) {
    return <ZoneMapMini zones={zones} routes={routes} onZoneSelect={onZoneSelect} selectedZoneIds={selectedZoneIds} onCollapse={onCollapse} />
  }

  const entries = buildDisplayEntries(zones, routes, selectedZoneIds ?? [])

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950">
      {assignQrHint && (
        <div className="shrink-0 mx-4 mt-3 bg-yellow-400/10 border border-yellow-400/40 rounded-xl px-4 py-2.5 text-center">
          <p className="text-yellow-400 text-sm font-semibold">Selecciona la zona donde colocaste la ruta</p>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center p-4">
        <svg viewBox="0 0 400 320" width="100%" height="100%" style={{ maxHeight: '100%' }} preserveAspectRatio="xMidYMid meet">
          <polygon points="30,15 368,15 320,300 80,300" fill="#18181b" stroke="#3f3f46" strokeWidth="1.5" />
          <rect x="108" y="82" width="184" height="213" fill="#09090b" rx="2" />
          <rect x="108" y="82" width="184" height="213" fill="none" stroke="#3f3f46" strokeWidth="1" rx="2" />

          {entries.map(({ key, poly, representativeZone, color, count, isSelected }) => {
            const isHov = hovered === key
            const labelLines = poly.label.split('\n')
            return (
              <g
                key={key}
                onClick={() => onZoneSelect(representativeZone)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                <polygon
                  points={poly.points}
                  fill={color}
                  fillOpacity={isHov ? 0.80 : 0.55}
                  stroke={color}
                  strokeWidth={isHov ? 1.5 : 0.5}
                />
                {poly.label && labelLines.map((line, i) => (
                  <text key={i} x={poly.labelX} y={poly.labelY + i * 10} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.7)" fontFamily="system-ui, sans-serif" fontWeight={isHov ? 'bold' : 'normal'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {line}
                  </text>
                ))}
                {count > 0 && (
                  <g>
                    <circle cx={poly.badgeX} cy={poly.badgeY} r="8" fill={color} opacity="0.9" />
                    <text x={poly.badgeX} y={poly.badgeY + 3} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#09090b" fontFamily="system-ui, sans-serif" style={{ pointerEvents: 'none', userSelect: 'none' }}>{count}</text>
                  </g>
                )}
                {isSelected && (
                  <polygon points={poly.points} fill="none" stroke="#fff" strokeWidth="2" opacity="0.6" style={{ pointerEvents: 'none' }} />
                )}
              </g>
            )
          })}

          <text x="200" y="312" textAnchor="middle" fontSize="7" fill="#52525b" fontFamily="system-ui, sans-serif">
            Toca una zona para ver sus rutas
          </text>
        </svg>
      </div>
    </div>
  )
}
