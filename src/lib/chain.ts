import type { Zone, ZoneAnchor } from '../types'

export const CHAIN_H = 900

export interface ZoneLayout {
  id: string
  virtualX: number    // X de inicio en el canvas virtual
  virtualW: number    // ancho en el canvas virtual (proporcional al aspect ratio de la foto)
  activeStart: number // X donde esta zona "toma el control" (midpoint overlap con anterior)
  activeEnd: number   // X donde cede el control a la siguiente (midpoint overlap con siguiente)
}

export interface ChainLayout {
  totalW: number
  zones: ZoneLayout[]
}

// Aspect ratio por defecto si la imagen no ha cargado todavía (4:3)
const DEFAULT_ASPECT = 4 / 3

export function computeChainLayout(
  zones: Zone[],
  anchors: ZoneAnchor[],
  images: Record<string, HTMLImageElement>
): ChainLayout {
  if (zones.length === 0) return { totalW: CHAIN_H * DEFAULT_ASPECT, zones: [] }

  const sorted = [...zones].sort((a, b) => a.chain_position - b.chain_position)

  // Calcula virtualW de cada zona basado en el aspect ratio real de la imagen
  const widths = sorted.map(z => {
    const img = images[z.id]
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return CHAIN_H * (img.naturalWidth / img.naturalHeight)
    }
    return CHAIN_H * DEFAULT_ASPECT
  })

  // Calcula posición X de inicio de cada zona
  const positions: number[] = [0]
  for (let i = 1; i < sorted.length; i++) {
    const anchor = anchors.find(
      a => a.zone_a_id === sorted[i - 1].id && a.zone_b_id === sorted[i].id
    )
    const overlapFraction = anchor
      ? (anchor.a_overlap_end - anchor.a_overlap_start)
      : 0.2 // default 20% overlap si no hay anchor calibrado
    positions.push(positions[i - 1] + widths[i - 1] - overlapFraction * widths[i - 1])
  }

  const totalW = positions[sorted.length - 1] + widths[sorted.length - 1]

  const layoutZones: ZoneLayout[] = sorted.map((z, i) => {
    // Midpoint del overlap con la zona anterior → donde esta zona "empieza a mandar"
    let activeStart = positions[i]
    if (i > 0) {
      const anchor = anchors.find(
        a => a.zone_a_id === sorted[i - 1].id && a.zone_b_id === z.id
      )
      // Midpoint del overlap = inicio de la zona actual + mitad del ancho de overlap de B
      const bOverlapEnd = anchor ? anchor.b_overlap_end : 0.2
      activeStart = positions[i] + (bOverlapEnd * widths[i]) / 2
    }

    // Midpoint del overlap con la zona siguiente → donde esta zona "cede el control"
    let activeEnd = positions[i] + widths[i]
    if (i < sorted.length - 1) {
      const anchor = anchors.find(
        a => a.zone_a_id === z.id && a.zone_b_id === sorted[i + 1].id
      )
      const aOverlapStart = anchor ? anchor.a_overlap_start : 0.8
      activeEnd = positions[i] + aOverlapStart * widths[i] + (widths[i] * (1 - aOverlapStart)) / 2
    }

    return {
      id: z.id,
      virtualX: positions[i],
      virtualW: widths[i],
      activeStart,
      activeEnd,
    }
  })

  return { totalW, zones: layoutZones }
}

// Devuelve el id de la zona activa dado un X en el canvas virtual
export function resolveActiveZone(viewportCenterX: number, layout: ChainLayout): string | null {
  for (const z of layout.zones) {
    if (viewportCenterX >= z.activeStart && viewportCenterX < z.activeEnd) return z.id
  }
  // Fallback: primera o última zona
  if (layout.zones.length === 0) return null
  if (viewportCenterX < layout.zones[0].activeStart) return layout.zones[0].id
  return layout.zones[layout.zones.length - 1].id
}

// Coordenadas de cadena {x: 0-1, y: 0-1} → coordenadas virtuales del canvas
export function chainToVirtual(
  point: { x: number; y: number },
  layout: ChainLayout
): { x: number; y: number } {
  return {
    x: point.x * layout.totalW,
    y: point.y * CHAIN_H,
  }
}

// Coordenadas virtuales del canvas → coordenadas de cadena {x: 0-1, y: 0-1}
export function virtualToChain(
  vx: number,
  vy: number,
  layout: ChainLayout
): { x: number; y: number } {
  return {
    x: layout.totalW > 0 ? vx / layout.totalW : 0,
    y: CHAIN_H > 0 ? vy / CHAIN_H : 0,
  }
}

// Devuelve la zona de anclaje para un punto de cadena (la zona que contiene ese X)
export function resolveZoneForChainX(x: number, layout: ChainLayout): string | null {
  const vx = x * layout.totalW
  for (const z of layout.zones) {
    if (vx >= z.virtualX && vx < z.virtualX + z.virtualW) return z.id
  }
  if (layout.zones.length === 0) return null
  if (vx < layout.zones[0].virtualX) return layout.zones[0].id
  return layout.zones[layout.zones.length - 1].id
}
