import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getDeviceId } from '../../lib/device'

interface Props {
  routeId: string
}

export default function VoteButtons({ routeId }: Props) {
  const [myVote, setMyVote] = useState<'up' | 'down' | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const deviceId = getDeviceId()
    supabase
      .from('votes')
      .select('value')
      .eq('route_id', routeId)
      .eq('device_id', deviceId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMyVote(data.value as 'up' | 'down')
        setChecking(false)
      })
  }, [routeId])

  async function vote(value: 'up' | 'down') {
    if (loading) return
    // Si ya votó lo mismo, quita el voto
    const newValue = myVote === value ? null : value
    setLoading(true)
    const deviceId = getDeviceId()
    if (newValue === null) {
      await supabase.from('votes').delete().eq('route_id', routeId).eq('device_id', deviceId)
    } else {
      await supabase.from('votes').upsert(
        { route_id: routeId, value: newValue, device_id: deviceId },
        { onConflict: 'route_id,device_id' }
      )
    }
    setMyVote(newValue)
    setLoading(false)
  }

  if (checking) return (
    <div className="flex gap-3">
      <div className="flex-1 py-5 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />
      <div className="flex-1 py-5 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />
    </div>
  )

  return (
    <div className="flex gap-3">
      <button
        onClick={() => vote('up')}
        disabled={loading}
        className={`flex-1 py-5 rounded-2xl text-3xl border transition-all active:scale-95 disabled:opacity-60 ${
          myVote === 'up'
            ? 'bg-green-500/20 border-green-500'
            : 'bg-zinc-900 border-zinc-800 active:bg-zinc-800'
        }`}
      >
        👍
      </button>
      <button
        onClick={() => vote('down')}
        disabled={loading}
        className={`flex-1 py-5 rounded-2xl text-3xl border transition-all active:scale-95 disabled:opacity-60 ${
          myVote === 'down'
            ? 'bg-red-500/20 border-red-500'
            : 'bg-zinc-900 border-zinc-800 active:bg-zinc-800'
        }`}
      >
        👎
      </button>
    </div>
  )
}
