import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { call, fmtDate } from '../../../lib/erp'
import { Page, Card, Badge, Empty, Spinner, input, btnPrimary } from '../../../components/erp/ui'
import PersonForm from '../../../components/erp/PersonForm'

interface PersonRow {
  id: string; full_name: string; phone: string | null; email: string | null; has_login: boolean
  membership_until: string | null; membership_last_until: string | null; subscription_status: string | null
}

export default function PeoplePage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<PersonRow[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await call<{ people: PersonRow[] }>('admin_search_people', { p_query: query })
      setPeople(data?.people ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  return (
    <Page title="Personas" subtitle="Clientes y prospectos. Toca a alguien para ver su ficha."
      actions={<button onClick={() => setCreating(v => !v)} className={btnPrimary}>{creating ? 'Cerrar' : '+ Nueva persona'}</button>}>
      {creating && (
        <Card title="Nueva persona" tone="accent">
          <PersonForm onSaved={id => navigate(`/staff/personas/${id}`)} onCancel={() => setCreating(false)} />
        </Card>
      )}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, celular o correo…" className={input} autoFocus />
      {people === null ? <Spinner /> : people.length === 0 ? <Empty>No hay nadie{query && ' con ese dato'}.</Empty> : (
        <div className="bg-superficie rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/80 overflow-hidden">
          {people.map(p => (
            <Link key={p.id} to={`/staff/personas/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-superficie-alta">
              <div className="w-9 h-9 rounded-full bg-superficie-alta flex items-center justify-center text-zinc-300 font-bold text-sm shrink-0">
                {p.full_name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-texto-principal font-bold text-sm truncate">{p.full_name}</p>
                <p className="text-zinc-400 text-xs truncate">{[p.phone, p.email].filter(Boolean).join(' · ') || 'Sin contacto'}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {p.membership_until
                  ? <Badge cls="text-exito bg-exito/10">Miembro hasta {fmtDate(p.membership_until)}</Badge>
                  : p.membership_last_until ? <Badge>Venció {fmtDate(p.membership_last_until)}</Badge> : <Badge>Prospecto</Badge>}
                {p.subscription_status && p.subscription_status !== 'active' && (
                  <Badge cls={p.subscription_status === 'past_due' ? 'text-white bg-alerta' : 'text-amarillo-suave bg-amarillo-suave/10'}>
                    {p.subscription_status === 'past_due' ? 'Cobro pendiente' : 'Falta tarjeta'}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  )
}
