import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { getColorHex } from '../../lib/colors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

interface MySend {
  id: string
  sent_at: string
  points_daily: number
  points_monthly: number
  grade: string
  color: string
  zone_name: string | null
}

interface Group {
  key: string
  label: string
  sends: MySend[]
  points: number
}

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function cdmxParts(dateStr: string) {
  const d = new Date(dateStr)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day'), weekday: get('weekday') }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function SendsHistoryPage() {
  const { session, loading: authLoading } = useAuth()
  const { climber, loading: climberLoading } = useClimber()

  const [sends, setSends] = useState<MySend[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [autoExpanded, setAutoExpanded] = useState(false)

  useEffect(() => {
    if (!session?.user || !climber) return
    db.rpc('get_my_sends', { lim: 1000 }).then(({ data }: { data: MySend[] | null }) => {
      setSends(data ?? [])
      setLoading(false)
    })
  }, [session?.user?.id, climber])

  const dayGroups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const s of sends) {
      const { year, month, day, weekday } = cdmxParts(s.sent_at)
      const key = `${year}-${month}-${day}`
      if (!map.has(key)) {
        map.set(key, { key, label: `${capitalize(weekday)} ${parseInt(day, 10)} de ${MONTHS_ES[parseInt(month, 10) - 1].toLowerCase()}`, sends: [], points: 0 })
      }
      const g = map.get(key)!
      g.sends.push(s)
      g.points += s.points_daily
    }
    return Array.from(map.values())
  }, [sends])

  const monthGroups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const s of sends) {
      const { year, month } = cdmxParts(s.sent_at)
      const key = `${year}-${month}`
      if (!map.has(key)) {
        map.set(key, { key, label: `${MONTHS_ES[parseInt(month, 10) - 1]} ${year}`, sends: [], points: 0 })
      }
      const g = map.get(key)!
      g.sends.push(s)
      g.points += s.points_monthly
    }
    return Array.from(map.values())
  }, [sends])

  // Abre el grupo más reciente de cada vista una sola vez, al cargar los datos.
  useEffect(() => {
    if (autoExpanded || sends.length === 0) return
    setExpanded(new Set([dayGroups[0]?.key, monthGroups[0]?.key].filter(Boolean) as string[]))
    setAutoExpanded(true)
  }, [sends.length, dayGroups, monthGroups, autoExpanded])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (authLoading || climberLoading) {
    return (
      <div className="min-h-screen bg-fondo flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session?.user) return <Navigate to="/mi-cuenta" replace />

  const groups = tab === 'daily' ? dayGroups : monthGroups
  const pointsField = tab === 'daily' ? 'points_daily' : 'points_monthly'

  return (
    <div className="min-h-screen bg-fondo flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <Link to="/mi-cuenta" className="text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors">
          ← Mi cuenta
        </Link>
        <h1 className="text-texto-principal font-black text-base tracking-tight">Historial</h1>
        <div className="w-16" />
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-5 py-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 bg-superficie rounded-2xl border border-zinc-800/60 p-1">
          <button
            onClick={() => setTab('daily')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === 'daily' ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-texto-principal'
            }`}
          >
            Diario
          </button>
          <button
            onClick={() => setTab('monthly')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === 'monthly' ? 'bg-primario text-texto-en-acento' : 'text-zinc-400 hover:text-texto-principal'
            }`}
          >
            Mensual
          </button>
        </div>

        {loading ? (
          <div className="h-24 bg-superficie rounded-2xl border border-zinc-800/60 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-primario border-t-transparent animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 bg-superficie rounded-2xl border border-zinc-800/60 text-center">
            <p className="text-zinc-600 text-sm">Aún no has marcado ninguna ruta.</p>
            <p className="text-zinc-700 text-xs mt-1">¡Escanea un QR y completa tu primer send!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map(group => (
              <div key={group.key} className="bg-superficie rounded-2xl border border-zinc-800/60 overflow-hidden">
                <button
                  onClick={() => toggle(group.key)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-texto-principal font-bold text-sm truncate">{group.label}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{group.sends.length} {group.sends.length === 1 ? 'ruta' : 'rutas'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pl-3">
                    <span className="text-primario font-black text-base tabular-nums">+{group.points}</span>
                    <span className={`text-zinc-600 text-xs transition-transform inline-block ${expanded.has(group.key) ? 'rotate-180' : ''}`}>▾</span>
                  </div>
                </button>
                {expanded.has(group.key) && (
                  <div className="border-t border-zinc-800/50 divide-y divide-zinc-800/40">
                    {group.sends.map(s => (
                      <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getColorHex(s.color) }} />
                        <span className="text-texto-principal font-black text-sm font-mono shrink-0">{s.grade}</span>
                        <span className="text-zinc-500 text-xs truncate flex-1">{s.zone_name ?? s.color}</span>
                        <span className="text-zinc-400 text-xs font-bold tabular-nums shrink-0">+{s[pointsField]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
