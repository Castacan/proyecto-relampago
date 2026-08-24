import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useRouteSendCounts() {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const { data } = await db.rpc('get_route_send_counts')
    const map = new Map<string, number>()
    ;(data ?? []).forEach((row: { route_id: string; send_count: number }) => {
      map.set(row.route_id, Number(row.send_count))
    })
    setCounts(map)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { counts, loading, refetch: fetch }
}
