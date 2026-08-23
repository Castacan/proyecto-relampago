import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Sponsorship } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Options {
  all?: boolean // true = admin (todos, sin filtro is_active), false = público (solo activos)
}

export function useSponsorships({ all = false }: Options = {}) {
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)

  const fetchAll = useCallback(async () => {
    let q = db.from('sponsorships').select('*, winner:climbers!winner_user_id(display_name)')
    q = all
      ? q.order('created_at', { ascending: false })
      // Límite subido de 5 a 12 (2026-08-23): antes solo podía haber 1
      // patrocinador activo A LA VEZ en todo el sistema; ahora hay 3
      // periodos independientes (diario/semanal/mensual) que pueden estar
      // activos simultáneamente, cada uno con su propia ventana de 48h de
      // "ganador reciente" — hasta 6 filas relevantes de golpe, 12 da margen.
      : q.eq('is_active', true).order('ends_at', { ascending: false }).limit(12)
    const { data, error } = await q
    if (error) {
      // eslint-disable-next-line no-console
      console.error('useSponsorships:', error)
    }
    setSponsorships(data ?? [])
    setLoading(false)
  }, [all])

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel(`sponsorships-${all ? 'admin' : 'public'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sponsorships' },
        () => { fetchAll() }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll, all])

  // Chequeo de ganador cada 60s, solo del lado público. No es polling de
  // datos: "ends_at ya pasó" depende del reloj, no de un cambio de fila que
  // Realtime pudiera avisar por sí solo. El RPC es idempotente (solo procesa
  // patrocinios con winner_user_id todavía NULL).
  useEffect(() => {
    if (all) return
    const t = setInterval(() => { db.rpc('determine_sponsorship_winner') }, 60_000)
    return () => clearInterval(t)
  }, [all])

  return { sponsorships, loading, connected, refetch: fetchAll }
}
