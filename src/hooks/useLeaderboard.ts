import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaderboardEntry, RecentEvent } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useLeaderboard() {
  const [daily, setDaily] = useState<LeaderboardEntry[]>([])
  const [weekly, setWeekly] = useState<LeaderboardEntry[]>([])
  const [monthly, setMonthly] = useState<LeaderboardEntry[]>([])
  const [events, setEvents] = useState<RecentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)

  const fetchAll = useCallback(async () => {
    const [d, w, m, e] = await Promise.all([
      db.rpc('get_daily_leaderboard'),
      db.rpc('get_weekly_leaderboard'),
      db.rpc('get_monthly_leaderboard'),
      db.rpc('get_recent_events', { lim: 8 }),
    ])
    setDaily(d.data ?? [])
    setWeekly(w.data ?? [])
    setMonthly(m.data ?? [])
    setEvents(e.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()

    // Escucha sends (nuevos envíos) Y climbers (2026-08-24: excluir/reincluir
    // a alguien desde /staff/sends — visible_in_leaderboard/eligible_for_prizes
    // — no toca sends, así que sin esto la TV se queda con datos viejos hasta
    // recargar). Solo UPDATE en climbers porque INSERT/DELETE de climbers no
    // cambia el ranking (nuevo climber sin sends no aparece de todos modos).
    const channel = supabase
      .channel('leaderboard-sends')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sends' },
        () => { fetchAll() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'climbers' },
        () => { fetchAll() }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  return { daily, weekly, monthly, events, loading, connected }
}
