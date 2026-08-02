import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useSpraywallSends() {
  const { session } = useAuth()
  const [sentMap, setSentMap] = useState<Record<string, string>>({}) // route_id -> sent_at
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    const userId = session?.user?.id
    if (!userId) { setSentMap({}); return }
    setLoading(true)
    const { data } = await db.from('spraywall_sends').select('route_id, sent_at').eq('climber_id', userId)
    const map: Record<string, string> = {}
    ;(data ?? []).forEach((row: { route_id: string; sent_at: string }) => { map[row.route_id] = row.sent_at })
    setSentMap(map)
    setLoading(false)
  }, [session?.user?.id])

  useEffect(() => { refetch() }, [refetch])

  async function toggle(routeId: string) {
    const userId = session?.user?.id
    if (!userId) return
    if (sentMap[routeId]) {
      await db.from('spraywall_sends').delete().eq('route_id', routeId).eq('climber_id', userId)
      setSentMap(prev => {
        const next = { ...prev }
        delete next[routeId]
        return next
      })
    } else {
      const sentAt = new Date().toISOString()
      await db.from('spraywall_sends').insert({ route_id: routeId, climber_id: userId, sent_at: sentAt })
      setSentMap(prev => ({ ...prev, [routeId]: sentAt }))
    }
  }

  return { sentMap, loading, toggle, refetch }
}
