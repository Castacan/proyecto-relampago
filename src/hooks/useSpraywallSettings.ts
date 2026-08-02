import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { SpraywallSettings } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useSpraywallSettings() {
  const [settings, setSettings] = useState<SpraywallSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    const { data } = await db.from('spraywall_settings').select('*').eq('id', true).single()
    setSettings(data ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { refetch() }, [refetch])

  return { settings, loading, refetch }
}
