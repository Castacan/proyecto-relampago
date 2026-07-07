import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Chain, Zone, ZoneAnchor } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface UseChainResult {
  chain: Chain | null
  zones: Zone[]       // ordenadas por chain_position
  anchors: ZoneAnchor[]
  loading: boolean
}

export function useChain(chainId: string | null): UseChainResult {
  const [chain, setChain] = useState<Chain | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [anchors, setAnchors] = useState<ZoneAnchor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chainId) {
      setLoading(false)
      return
    }
    setLoading(true)

    Promise.all([
      db.from('chains').select('*').eq('id', chainId).single(),
      db.from('zones').select('*').eq('chain_id', chainId).order('chain_position'),
      db.from('zone_anchors').select('*').eq('chain_id', chainId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([chainRes, zonesRes, anchorsRes]: any[]) => {
      if (chainRes.data) setChain(chainRes.data as Chain)
      if (zonesRes.data) setZones(zonesRes.data as Zone[])
      if (anchorsRes.data) setAnchors(anchorsRes.data as ZoneAnchor[])
      setLoading(false)
    })
  }, [chainId])

  return { chain, zones, anchors, loading }
}

// Carga todas las cadenas disponibles (para la UI de calibración)
export function useAllChains() {
  const [chains, setChains] = useState<Chain[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('chains')
      .select('*')
      .order('name')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => {
        if (data) setChains(data as Chain[])
        setLoading(false)
      })
  }, [])

  return { chains, loading }
}
