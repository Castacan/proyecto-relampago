import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Route } from '../types'

export function useRoutes() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('routes')
      .select('*')
      .eq('status', 'active')
      .order('placed_at', { ascending: false })
    if (data) setRoutes(data as Route[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { routes, loading, refetch: fetch }
}
