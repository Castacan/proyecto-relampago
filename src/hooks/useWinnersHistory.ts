import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export interface WinnerCandidate {
  display_name: string
  total_points: number
}

export interface WinnerHistoryPeriod {
  period_start: string
  period_end: string
  winners: WinnerCandidate[]
}

// Top 5 real de cada semana/mes calendario YA TERMINADO, calculado
// directo de sends — independiente de sponsorships. Ver comentario en
// schema.sql junto a get_weekly/monthly_winners_history.
export function useWinnersHistory() {
  const [weekly, setWeekly] = useState<WinnerHistoryPeriod[]>([])
  const [monthly, setMonthly] = useState<WinnerHistoryPeriod[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const [w, m] = await Promise.all([
      db.rpc('get_weekly_winners_history', { p_limit: 8, p_top_n: 5 }),
      db.rpc('get_monthly_winners_history', { p_limit: 6, p_top_n: 5 }),
    ])
    setWeekly(w.data ?? [])
    setMonthly(m.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { weekly, monthly, loading, refetch: fetch }
}
