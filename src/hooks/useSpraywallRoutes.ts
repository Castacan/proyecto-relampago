import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { SpraywallRoute } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useSpraywallRoutes(statuses: string[] = ['active']) {
  const [routes, setRoutes] = useState<SpraywallRoute[]>([])
  const [loading, setLoading] = useState(true)
  const statusesKey = statuses.join(',')

  const refetch = useCallback(async () => {
    setLoading(true)
    // photo:spraywall_photos(...) trae la foto CON LA QUE SE MARCÓ cada
    // ruta (2026-08-26) — no la más reciente, ver comentario en schema.sql.
    const { data } = await db
      .from('spraywall_routes')
      .select('*, photo:spraywall_photos(photo_url, photo_w, photo_h)')
      .in('status', statusesKey.split(','))
      .order('created_at', { ascending: false })
    setRoutes(data ?? [])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusesKey])

  useEffect(() => { refetch() }, [refetch])

  return { routes, loading, refetch }
}
