import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
        .then(({ data }) => { if (data) setProfile(data as Profile) })
    })
  }, [])

  return { profile }
}
