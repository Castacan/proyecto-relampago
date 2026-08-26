import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { SpraywallPhoto } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

// Historial de fotos del Spraywall (2026-08-26, reemplaza el singleton
// spraywall_settings) — ver comentario en schema.sql. Cada subida crea una
// fila nueva, nunca se sobrescribe. "Foto actual" = la más reciente, para
// crear rutas nuevas o proponer; una ruta YA existente usa su propio
// photo_id (joined aparte, ver useSpraywallRoutes), no `current`.
export function useSpraywallPhotos() {
  const [photos, setPhotos] = useState<SpraywallPhoto[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    const { data } = await db.from('spraywall_photos').select('*').order('created_at', { ascending: false })
    setPhotos(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const current = photos[0] ?? null
  return { photos, current, loading, refetch }
}
