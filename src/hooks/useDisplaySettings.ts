import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { DisplaySettingsMap } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const DEFAULTS: DisplaySettingsMap = {
  slide_interval_seconds: 60,
  fade_duration_ms: 500,
}

export function useDisplaySettings() {
  const [settings, setSettings] = useState<DisplaySettingsMap>(DEFAULTS)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const { data, error } = await db.from('display_settings').select('key, value')
    if (error) {
      // eslint-disable-next-line no-console
      console.error('useDisplaySettings:', error)
    }
    const map = { ...DEFAULTS }
    for (const row of data ?? []) {
      if (row.key === 'slide_interval_seconds' || row.key === 'fade_duration_ms') {
        map[row.key as keyof DisplaySettingsMap] = Number(row.value)
      }
    }
    setSettings(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel('display-settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'display_settings' },
        () => { fetchAll() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  return { settings, loading, refetch: fetchAll }
}
