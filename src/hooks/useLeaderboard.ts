import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaderboardEntry, RecentEvent } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useLeaderboard() {
  const [daily, setDaily] = useState<LeaderboardEntry[]>([])
  const [monthly, setMonthly] = useState<LeaderboardEntry[]>([])
  const [events, setEvents] = useState<RecentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)

  const fetchAll = useCallback(async () => {
    const [d, m, e] = await Promise.all([
      db.rpc('get_daily_leaderboard'),
      db.rpc('get_monthly_leaderboard'),
      db.rpc('get_recent_events', { lim: 8 }),
    ])
    setDaily(d.data ?? [])
    setMonthly(m.data ?? [])
    setEvents(e.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel('leaderboard-sends')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sends' },
        () => { fetchAll() }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  return { daily, monthly, events, loading, connected }
}
