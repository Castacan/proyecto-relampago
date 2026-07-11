import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { VolumeCatalogItem } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useVolumeCatalog() {
  const [catalog, setCatalog] = useState<VolumeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const { data } = await db.from('volume_catalog').select('*').order('created_at', { ascending: false })
    if (data) setCatalog(data as VolumeCatalogItem[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { catalog, loading, refetch: fetch }
}
