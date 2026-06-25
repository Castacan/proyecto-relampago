export const ROUTE_COLORS: { key: string; hex: string; label: string }[] = [
  { key: 'amarillo', hex: '#FACC15', label: 'Amarillo' },
  { key: 'azul',     hex: '#3B82F6', label: 'Azul' },
  { key: 'rojo',     hex: '#EF4444', label: 'Rojo' },
  { key: 'verde',    hex: '#22C55E', label: 'Verde' },
  { key: 'naranja',  hex: '#F97316', label: 'Naranja' },
  { key: 'rosa',     hex: '#EC4899', label: 'Rosa' },
  { key: 'morado',   hex: '#A855F7', label: 'Morado' },
  { key: 'negro',    hex: '#6B7280', label: 'Negro' },
  { key: 'blanco',   hex: '#F1F5F9', label: 'Blanco' },
  { key: 'cafe',     hex: '#B45309', label: 'Café' },
]

export function getColorHex(colorKey: string): string {
  return ROUTE_COLORS.find(c => c.key === colorKey.toLowerCase())?.hex ?? '#94A3B8'
}

export const GRADES = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12']
