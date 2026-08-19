import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { DisplaySlide } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface Options {
  all?: boolean // true = admin (todos, ordenados por sort_order), false = público (solo activos y dentro de ventana de fechas)
}

export function useDisplaySlides({ all = false }: Options = {}) {
  const [slides, setSlides] = useState<DisplaySlide[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    let q = db.from('display_slides').select('*')
    if (all) {
      q = q.order('sort_order', { ascending: true })
    } else {
      const nowIso = new Date().toISOString()
      q = q
        .eq('is_active', true)
        .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('sort_order', { ascending: true })
    }
    const { data } = await q
    setSlides(data ?? [])
    setLoading(false)
  }, [all])

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel(`display-slides-${all ? 'admin' : 'public'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'display_slides' },
        () => { fetchAll() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchAll, all])

  // Re-evalúa cada 60s del lado público: un slide puede entrar/salir de su
  // ventana starts_at/ends_at por el simple paso del tiempo, sin ningún
  // UPDATE en la tabla — Realtime no tiene forma de avisar eso.
  useEffect(() => {
    if (all) return
    const t = setInterval(fetchAll, 60_000)
    return () => clearInterval(t)
  }, [all, fetchAll])

  return { slides, loading, refetch: fetchAll }
}
