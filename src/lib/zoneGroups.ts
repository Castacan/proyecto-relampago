import type { Zone } from '../types'

// Zones stitched on one canvas. Each group has:
//   slugs       – ordered left-to-right DB zone slugs
//   displaySlug – polygon key in ZoneMap ZONE_POLYS for the combined view
//   displayName – label shown to the user
export const STITCH_GROUPS: { slugs: string[]; displaySlug: string; displayName: string }[] = [
  {
    slugs: ['fondo-derecho-izq', 'fondo-derecho-der'],
    displaySlug: 'fondo-derecho',
    displayName: 'Fondo Derecho',
  },
]

// Returns the ordered group of zones for a given zone (or [zone] if not in any group)
export function getZoneGroup(zone: Zone, allZones: Zone[]): Zone[] {
  for (const group of STITCH_GROUPS) {
    if (group.slugs.includes(zone.slug)) {
      return group.slugs
        .map(slug => allZones.find(z => z.slug === slug))
        .filter((z): z is Zone => z !== undefined)
    }
  }
  return [zone]
}

// Display name for a group (single zone → its name; group → group displayName)
export function getGroupDisplayName(groupZones: Zone[]): string {
  if (groupZones.length === 1) return groupZones[0].name
  for (const group of STITCH_GROUPS) {
    if (groupZones.some(z => group.slugs.includes(z.slug))) return group.displayName
  }
  return groupZones[0].name
}

// Returns the combined displaySlug for a zone that is part of a group, or null
export function getGroupDisplaySlug(slug: string): string | null {
  for (const group of STITCH_GROUPS) {
    if (group.slugs.includes(slug)) return group.displaySlug
  }
  return null
}

// True if this zone is a non-first member of a stitch group (should be hidden from UI lists)
export function isSecondaryInGroup(zone: Zone): boolean {
  return STITCH_GROUPS.some(g => g.slugs.indexOf(zone.slug) > 0)
}

// Display name for a single zone — returns group displayName if it belongs to one
export function getZoneDisplayName(zone: Zone): string {
  const group = STITCH_GROUPS.find(g => g.slugs.includes(zone.slug))
  return group ? group.displayName : zone.name
}
