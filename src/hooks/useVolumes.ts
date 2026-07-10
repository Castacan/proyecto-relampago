import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Volume } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useVolumes() {
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const { data } = await db
      .from('volumes')
      .select('*')
      .eq('status', 'active')
      .order('placed_at', { ascending: false })
    if (data) setVolumes(data as Volume[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { volumes, loading, refetch: fetch }
}
