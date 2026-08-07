import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Climber } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

export function useClimber() {
  const { session, loading: authLoading } = useAuth()
  const [climber, setClimber] = useState<Climber | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    const userId = session?.user?.id
    if (!userId) {
      setClimber(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await db.from('climbers').select('*').eq('id', userId).single()
    setClimber(data ?? null)
    setLoading(false)
  }, [session?.user?.id])

  // Esperar a que useAuth resuelva si hay sesión antes de decidir "sin
  // climber" — si no, hay una carrera: justo al volver de un magic link,
  // session todavía es null por una fracción de segundo (auth no ha
  // resuelto), climber se asume null "por default" y climberLoading ya
  // volvió a false, así que cualquier código que espere a climberLoading
  // (ej. el auto-onboarding tras magic link) actúa demasiado pronto y
  // cree que el usuario nunca tuvo perfil, aunque sí lo tenga.
  useEffect(() => {
    if (authLoading) return
    refetch()
  }, [authLoading, refetch])

  return { climber, loading, refetch }
}
