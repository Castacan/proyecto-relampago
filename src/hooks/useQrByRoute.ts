import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useQrByRoute() {
  const [qrByRoute, setQrByRoute] = useState<Record<string, string>>({})

  useEffect(() => {
    supabase
      .from('qr_codes')
      .select('id, route_id')
      .eq('status', 'in_use')
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string> = {}
        data.forEach(qr => { if (qr.route_id) map[qr.route_id] = qr.id })
        setQrByRoute(map)
      })
  }, [])

  return { qrByRoute }
}
