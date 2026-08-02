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
    const { data } = await db
      .from('spraywall_routes')
      .select('*')
      .in('status', statusesKey.split(','))
      .order('created_at', { ascending: false })
    setRoutes(data ?? [])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusesKey])

  useEffect(() => { refetch() }, [refetch])

  return { routes, loading, refetch }
}
