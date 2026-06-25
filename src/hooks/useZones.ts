import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Zone } from '../types'

export function useZones() {
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('zones')
      .select('*')
      .order('order_index')
      .then(({ data }) => {
        if (data) setZones(data as Zone[])
        setLoading(false)
      })
  }, [])

  return { zones, loading }
}
