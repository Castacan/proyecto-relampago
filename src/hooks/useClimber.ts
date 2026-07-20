import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Climber } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useClimber() {
  const { session } = useAuth()
  const [climber, setClimber] = useState<Climber | null>(null)
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    const userId = session?.user?.id
    if (!userId) {
      setClimber(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await db.from('climbers').select('*').eq('id', userId).single()
    setClimber(data ?? null)
    setLoading(false)
  }, [session?.user?.id])

  useEffect(() => { refetch() }, [refetch])

  return { climber, loading, refetch }
}
