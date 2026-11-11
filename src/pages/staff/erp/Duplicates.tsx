// Posibles fichas duplicadas y botón para unirlas (src/supabase/erp_unir_personas.sql).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { call, erpError, fmtDate } from '../../../lib/erp'
import { Card, Badge, Empty, Spinner, Msg, btnSmall, btnDanger, btnGhost } from '../../../components/erp/ui'

interface DupPerson {
  id: string; full_name: string; email: string | null; phone: string | null; source: string | null
  has_login: boolean; created_at: string; sales: number; membership_until: string | null
}
interface DupPair { reason: 'email' | 'phone' | 'same_name' | 'similar_name'; a: DupPerson; b: DupPerson }

const REASONS: Record<DupPair['reason'], string> = {
  email: 'Mismo correo', phone: 'Mismo celular', same_name: 'Mismo nombre', similar_name: 'Nombre parecido',
}
const MERGE_ERRORS: Record<string, string> = {
  both_have_login: 'Las dos fichas tienen cuenta en la app; no se pueden unir.',
  forbidden: 'Solo un admin puede unir fichas.',
}

function Who({ p }: { p: DupPerson }) {
  return (
    <div className="min-w-0">
      <Link to={`/staff/personas/${p.id}`} className="text-texto-principal font-bold text-sm hover:text-primario">{p.full_name}</Link>
      <p className="text-zinc-400 text-xs truncate">{[p.phone, p.email].filter(Boolean).join(' · ') || 'Sin contacto'}</p>
      <p className="text-zinc-500 text-xs">
        {p.source === 'evo' ? 'De EVO' : p.has_login ? 'Con cuenta en la app' : 'Registrado ' + fmtDate(p.created_at.slice(0, 10))}
        {' · '}{p.sales} compra{p.sales === 1 ? '' : 's'}
        {p.membership_until && ` · miembro hasta ${fmtDate(p.membership_until)}`}
      </p>
    </div>
  )
}

/** Confirmación: `keep` se queda, `remove` se borra después de pasarle todo. */
function MergeConfirm({ keep, remove, onDone, onCancel }: { keep: DupPerson; remove: DupPerson; onDone: (keptId: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    const { data, error } = await call<{ person_id: string }>('admin_merge_people', { p_keep: keep.id, p_remove: remove.id })
    setBusy(false)
    if (error || !data) { setErr(MERGE_ERRORS[error ?? ''] ?? erpError(error ?? undefined, 'No se pudo unir.')); return }
    onDone(data.person_id)
  }
  return (
    <div className="mt-2 rounded-xl border border-alerta/40 bg-alerta/5 p-3 space-y-2 text-sm">
      <p className="text-texto-principal">
        Se queda <b>{keep.full_name}</b>. Todo lo de <b>{remove.full_name}</b> (compras, membresías, domiciliación, clases, firmas, cara y accesos)
        pasa a esa ficha, los datos que le falten se llenan con los de la otra, y la ficha de <b>{remove.full_name}</b> se borra.
      </p>
      <p className="text-zinc-400 text-xs">No se puede deshacer. Si no estás seguro de que son la misma persona, no lo hagas.</p>
      <Msg text={err} />
      <div className="flex gap-2">
        <button onClick={go} disabled={busy} className={btnDanger}>{busy ? 'Uniendo…' : 'Sí, unir'}</button>
        <button onClick={onCancel} disabled={busy} className={btnGhost}>Cancelar</button>
      </div>
    </div>
  )
}

function PairRow({ pair, here, isAdmin, onMerged }: { pair: DupPair; here?: string; isAdmin: boolean; onMerged: (keptId: string) => void }) {
  // En la ficha: "aquí" es la que se queda por defecto. En la lista: la que tiene más historial.
  const defaultKeep = here ? (pair.a.id === here ? pair.a : pair.b)
    : (pair.b.sales > pair.a.sales || (pair.b.membership_until && !pair.a.membership_until) ? pair.b : pair.a)
  const [keepId, setKeepId] = useState<string | null>(null)
  const keep = keepId ? (pair.a.id === keepId ? pair.a : pair.b) : null
  const remove = keep ? (keep.id === pair.a.id ? pair.b : pair.a) : null
  const other = here ? (pair.a.id === here ? pair.b : pair.a) : null
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2">
          {other ? <Who p={other} /> : <><Who p={pair.a} /><Who p={pair.b} /></>}
        </div>
        <Badge cls={pair.reason === 'similar_name' ? undefined : 'text-amarillo-suave bg-amarillo-suave/10'}>{REASONS[pair.reason]}</Badge>
      </div>
      {isAdmin && !keep && (
        <div className="flex flex-wrap gap-2 mt-2">
          <button onClick={() => setKeepId(defaultKeep.id)} className={btnSmall}>
            {here ? 'Unir con esta ficha' : `Unir (se queda ${defaultKeep.full_name})`}
          </button>
          {!here && <button onClick={() => setKeepId(defaultKeep.id === pair.a.id ? pair.b.id : pair.a.id)} className={btnSmall}>
            Unir (se queda {(defaultKeep.id === pair.a.id ? pair.b : pair.a).full_name})
          </button>}
        </div>
      )}
      {keep && remove && <MergeConfirm keep={keep} remove={remove} onDone={onMerged} onCancel={() => setKeepId(null)} />}
    </div>
  )
}

/** En la ficha: solo aparece si hay posibles duplicados de esta persona. */
export function PersonDuplicates({ personId, isAdmin, onMerged }: { personId: string; isAdmin: boolean; onMerged: () => void }) {
  const [pairs, setPairs] = useState<DupPair[]>([])
  const load = useCallback(async () => {
    const { data } = await call<{ pairs: DupPair[] }>('erp_duplicate_candidates', { p_person_id: personId })
    setPairs(data?.pairs ?? [])
  }, [personId])
  useEffect(() => { load() }, [load])
  if (pairs.length === 0) return null
  return (
    <Card title="¿Es la misma persona?" tone="accent">
      <p className="text-zinc-400 text-xs">Encontramos {pairs.length === 1 ? 'otra ficha parecida' : `${pairs.length} fichas parecidas`}. Si es la misma persona, únelas para no perder su historial.{!isAdmin && ' Pídeselo a un admin.'}</p>
      <div className="divide-y divide-zinc-800/80">
        {pairs.map(p => <PairRow key={p.a.id + p.b.id} pair={p} here={personId} isAdmin={isAdmin} onMerged={() => { load(); onMerged() }} />)}
      </div>
    </Card>
  )
}

/** En Personas: todos los pares. */
export function DuplicatesList({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate()
  const [pairs, setPairs] = useState<DupPair[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await call<{ pairs: DupPair[] }>('erp_duplicate_candidates', { p_person_id: null })
    if (error) { setErr(erpError(error, 'No se pudo cargar. ¿Ya se corrió erp_unir_personas.sql?')); setPairs([]); return }
    setPairs(data?.pairs ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  return (
    <Card title="Posibles duplicados">
      <p className="text-zinc-400 text-xs">Fichas con el mismo correo, celular o un nombre parecido. Revisa antes de unir: dos personas pueden llamarse igual.</p>
      <Msg text={err} />
      {pairs === null ? <Spinner /> : pairs.length === 0 ? <Empty>No hay posibles duplicados.</Empty> : (
        <div className="divide-y divide-zinc-800/80">
          {pairs.map(p => <PairRow key={p.a.id + p.b.id} pair={p} isAdmin={isAdmin} onMerged={id => navigate(`/staff/personas/${id}`)} />)}
        </div>
      )}
    </Card>
  )
}
