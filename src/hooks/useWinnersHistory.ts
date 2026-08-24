import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export interface WinnerHistoryEntry {
  period_start: string
  period_end: string
  display_name: string
  total_points: number
}

// Historial de ganadores por semana/mes calendario, independiente de
// sponsorships — ver comentario en schema.sql junto a
// get_weekly/monthly_winners_history. Solo periodos ya terminados.
export function useWinnersHistory() {
  const [weekly, setWeekly] = useState<WinnerHistoryEntry[]>([])
  const [monthly, setMonthly] = useState<WinnerHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const [w, m] = await Promise.all([
      db.rpc('get_weekly_winners_history', { p_limit: 8 }),
      db.rpc('get_monthly_winners_history', { p_limit: 6 }),
    ])
    setWeekly(w.data ?? [])
    setMonthly(m.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { weekly, monthly, loading, refetch: fetch }
}
