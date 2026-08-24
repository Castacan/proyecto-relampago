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

    // Escucha sends (nuevos envíos) Y leaderboard_refresh_ping (2026-08-24:
    // excluir/reincluir a alguien desde /staff/sends no toca sends, así que
    // sin esto la TV se queda con datos viejos hasta recargar). NO escucha
    // climbers directo — probado en vivo que Realtime evalúa la policy RLS
    // de climbers sobre la fila NUEVA de cada UPDATE, así que excluir a
    // alguien (visible=true→false) nunca pasaba la policy y el evento no
    // llegaba, mientras que reincluir sí — asimetría confirmada con el
    // navegador. leaderboard_refresh_ping es una tabla puente sin datos
    // sensibles, 100% pública, que set_climber_visibility/
    // set_climber_prize_eligibility tocan después de cada cambio real.
    const channel = supabase
      .channel('leaderboard-sends')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sends' },
        () => { fetchAll() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leaderboard_refresh_ping' },
        () => { fetchAll() }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  return { daily, weekly, monthly, events, loading, connected }
}
