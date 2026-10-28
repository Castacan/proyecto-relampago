import { useEffect, useState } from 'react'
import { call } from './erp'
import { useProfile } from '../hooks/useProfile'

// Secciones del panel que el admin activa para el staff (erp_staff_secciones.sql).
// El admin ve todo; al staff se le filtra el menú y las pantallas.

export interface StaffSection { key: string; label: string; paths: string[]; exact?: boolean }

export const STAFF_SECTIONS: StaffSection[] = [
  { key: 'inicio', label: 'Inicio', paths: ['/staff/inicio'] },
  { key: 'turno', label: 'Turno de hoy', paths: ['/staff/turno'] },
  { key: 'asistencia', label: 'Mi asistencia', paths: ['/staff/asistencia'], exact: true },
  { key: 'acceso', label: 'Acceso (recepción)', paths: ['/staff/acceso'] },
  { key: 'personas', label: 'Personas (fichas de clientes)', paths: ['/staff/personas'] },
  { key: 'domiciliaciones', label: 'Domiciliaciones', paths: ['/staff/domiciliaciones'] },
  { key: 'vender', label: 'Vender', paths: ['/staff/vender'] },
  { key: 'caja', label: 'Caja', paths: ['/staff/caja'] },
  { key: 'ventas', label: 'Historial de ventas', paths: ['/staff/ventas'] },
  { key: 'inventario', label: 'Inventario', paths: ['/staff/inventario'] },
  { key: 'reportes', label: 'Reporte del mes', paths: ['/staff/reportes'] },
  { key: 'clases', label: 'Clases y reservas', paths: ['/staff/clases'] },
  { key: 'muro', label: 'Muro', paths: ['/staff'], exact: true },
  { key: 'qr', label: 'QRs', paths: ['/staff/qr'] },
  { key: 'spraywall', label: 'Spraywall', paths: ['/staff/spraywall'] },
]

/** Lo que ve el staff mientras no se cambie en la base (o si aún no se corre el SQL). */
export const DEFAULT_STAFF_SECTIONS = ['inicio', 'turno', 'asistencia', 'muro', 'qr', 'spraywall']

/** Sección a la que pertenece una ruta del panel (null = no está en la lista: solo admin). */
export function sectionOf(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  for (const s of STAFF_SECTIONS) {
    for (const base of s.paths) {
      if (p === base || (!s.exact && p.startsWith(base + '/'))) return s.key
    }
  }
  return null
}

let cache: string[] | null = null
const listeners = new Set<(v: string[]) => void>()

export function setStaffSectionsCache(v: string[]) {
  cache = v
  listeners.forEach(l => l(v))
}

/** Secciones activas para el staff (se lee una vez y se comparte). */
export function useStaffSections(): string[] | null {
  const [v, setV] = useState<string[] | null>(cache)
  useEffect(() => {
    listeners.add(setV)
    if (!cache) {
      call<{ erp: { staff_sections?: string[] } }>('get_erp_settings').then(({ data }) => {
        setStaffSectionsCache(data?.erp?.staff_sections ?? DEFAULT_STAFF_SECTIONS)
      })
    }
    return () => { listeners.delete(setV) }
  }, [])
  return v
}

/** ¿Puede el usuario actual ver esta ruta del panel? El admin, siempre. */
export function useCanSee(): (path: string) => boolean {
  const { profile } = useProfile()
  const sections = useStaffSections()
  return (path: string) => profile?.role === 'admin' || (!!sections && !!profile && sections.includes(sectionOf(path) ?? '__solo_admin__'))
}
