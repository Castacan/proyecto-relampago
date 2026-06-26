import type { Zone } from '../types'

// Zones that share the same physical wall plane and should be stitched on one canvas.
// Each inner array is an ordered list of slugs from left to right.
const STITCH_GROUPS: string[][] = [
  ['fondo-derecho-izq', 'fondo-derecho-der'],
]

export function getZoneGroup(zone: Zone, allZones: Zone[]): Zone[] {
  for (const group of STITCH_GROUPS) {
    if (group.includes(zone.slug)) {
      return group
        .map(slug => allZones.find(z => z.slug === slug))
        .filter((z): z is Zone => z !== undefined)
    }
  }
  return [zone]
}
