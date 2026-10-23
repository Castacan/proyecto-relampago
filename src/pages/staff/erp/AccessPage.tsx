import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, erpError, fmtDate, fmtDateTime, expedienteUrl, ACCESS_REASONS, ACCESS_OK_BY } from '../../../lib/erp'
import { Page, Card, Stat, Badge, Empty, Spinner, Msg, input, btnPrimary, btnSmall } from '../../../components/erp/ui'

// Recepción: check-in con QR (lector o teclado) o buscando a la persona.
// Es la base del torniquete: la misma regla decide si alguien puede entrar.

interface Decision {
  result?: string; allowed: boolean; reasons: string[]; ok_by: string | null; membership_until: string | null
  person: { id: string; full_name: string; photo_path: string | null; access_code: string; block_reason: string | null; is_minor: boolean }
  pending_documents: { title: string }[]; last_entry: string | null
}
interface Today { require_documents: boolean; unique_today: number; events: { id: string; created_at: string; result: string; reasons: string[]; method: string; note: string | null; person_id: string | null; person_name: string | null; by: string | null }[] }
interface PersonRow { id: string; full_name: string; phone: string | null; email: string | null }

export default function AccessPage() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PersonRow[] | null>(null)
  const [dec, setDec] = useState<Decision | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [today, setToday] = useState<Today | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [override, setOverride] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadToday = useCallback(async () => { const { data } = await call<Today>('get_access_today'); setToday(data) }, [])
  useEffect(() => { loadToday(); call<{ is_admin: boolean }>('get_erp_settings').then(({ data }) => setIsAdmin(!!data?.is_admin)) }, [loadToday])

  const show = async (d: Decision) => {
    setDec(d); setOverride(''); setResults(null); setQ('')
    setPhoto(d.person.photo_path ? await expedienteUrl(d.person.photo_path, 600) : null)
    loadToday(); inputRef.current?.focus()
  }
  const checkIn = async (personId: string | null, code: string | null, method: 'manual' | 'qr', reason?: string) => {
    setError(null)
    const { data, error } = await call<Decision>('staff_check_in', { p_person_id: personId, p_code: code, p_method: method, p_override_reason: reason ?? null })
    if (error || !data) { setError(erpError(error ?? undefined)); setDec(null); return }
    show(data)
  }
  const submit = async () => {
    const v = q.trim()
    if (!v) return
    if (/^JM[A-Z0-9]{8}$/i.test(v)) { checkIn(null, v.toUpperCase(), 'qr'); return }
    const { data } = await call<{ people: PersonRow[] }>('admin_search_people', { p_query: v })
    setResults(data?.people ?? [])
  }
  const toggleDocs = async () => {
    if (!today) return
    await call('admin_set_access_settings', { p_require_documents: !today.require_documents })
    loadToday()
  }

  const granted = dec && (dec.result === 'granted' || dec.result === 'override')
  return (
    <Page title="Acceso" subtitle="Escanea el QR de la persona (o escribe su nombre) para registrar su entrada. Más adelante el torniquete usará esta misma regla."
      actions={isAdmin && today ? <button onClick={toggleDocs} className={btnSmall}>{today.require_documents ? 'Pide responsiva firmada ✓' : 'No pide responsiva'}</button> : undefined}>
      <div className="flex gap-2">
        <input ref={inputRef} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Código del QR (JM…) o nombre / celular" className={`${input} text-lg py-3`} />
        <button onClick={submit} className={btnPrimary}>Buscar</button>
      </div>
      <Msg text={error} />

      {results && (
        <Card>
          {results.length === 0 ? <Empty>No encontramos a nadie.</Empty> : (
            <div className="divide-y divide-zinc-800/80">
              {results.map(p => (
                <button key={p.id} onClick={() => checkIn(p.id, null, 'manual')} className="w-full text-left py-2.5 flex justify-between gap-3 hover:bg-superficie-alta px-2 rounded-lg">
                  <span className="text-texto-principal font-semibold">{p.full_name}</span>
                  <span className="text-zinc-500 text-sm">{p.phone ?? p.email ?? ''} · registrar entrada →</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {dec && (
        <section className={`rounded-2xl border-2 p-5 ${granted ? 'border-exito bg-exito/10' : 'border-alerta bg-alerta/10'}`}>
          <div className="flex gap-4 items-center">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-fondo/60 shrink-0 flex items-center justify-center">
              {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-zinc-500 text-xs">Sin foto</span>}
            </div>
            <div className="min-w-0">
              <p className={`font-black text-3xl ${granted ? 'text-exito' : 'text-alerta'}`}>{dec.result === 'override' ? 'PASA (autorizado)' : granted ? 'PUEDE PASAR' : 'NO PUEDE PASAR'}</p>
              <p className="text-texto-principal font-bold text-xl truncate">{dec.person.full_name} {dec.person.is_minor && <Badge cls="text-texto-en-acento bg-amarillo-suave">Menor</Badge>}</p>
              <p className="text-zinc-300 text-sm">
                {dec.allowed ? (ACCESS_OK_BY[dec.ok_by ?? ''] ?? '') + (dec.membership_until ? ` hasta ${fmtDate(dec.membership_until)}` : '')
                  : dec.reasons.map(r => (ACCESS_REASONS[r] ?? r) + (r === 'blocked' && dec.person.block_reason ? `: ${dec.person.block_reason}` : '')).join(' · ')}
              </p>
              {dec.pending_documents.length > 0 && <p className="text-amarillo-suave text-sm">Falta firmar: {dec.pending_documents.map(d => d.title).join(', ')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link to={`/staff/personas/${dec.person.id}`} className={btnSmall}>Ver ficha{dec.pending_documents.length > 0 ? ' / firmar' : ''}</Link>
            {!granted && !dec.reasons.includes('blocked') && (
              <>
                <input value={override} onChange={e => setOverride(e.target.value)} placeholder="Dejar pasar de todos modos: ¿por qué?" className={`${input} max-w-xs`} />
                <button onClick={() => checkIn(dec.person.id, null, 'manual', override)} disabled={override.trim().length < 3} className={btnSmall}>Dejar pasar</button>
              </>
            )}
          </div>
        </section>
      )}

      {!today ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Personas hoy" value={today.unique_today} tone="accent" />
            <Stat label="Entradas registradas" value={today.events.filter(e => e.result !== 'denied').length} />
            <Stat label="Negadas" value={today.events.filter(e => e.result === 'denied').length} tone={today.events.some(e => e.result === 'denied') ? 'alert' : undefined} />
            <Stat label="Con autorización" value={today.events.filter(e => e.result === 'override').length} />
          </div>
          <Card title="Entradas de hoy">
            {today.events.length === 0 ? <Empty>Nadie ha entrado hoy.</Empty> : (
              <div className="divide-y divide-zinc-800/80">
                {today.events.map(e => (
                  <div key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      {e.person_id ? <Link to={`/staff/personas/${e.person_id}`} className="text-texto-principal font-semibold hover:text-primario">{e.person_name}</Link> : <span className="text-zinc-400">Código desconocido</span>}
                      <p className="text-zinc-500 text-xs">{fmtDateTime(e.created_at)} · {e.method === 'qr' ? 'QR' : e.method === 'face' ? 'cara' : e.method === 'device' ? 'torniquete' : 'manual'}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</p>
                    </div>
                    {e.result === 'granted' ? <Badge cls="text-exito bg-exito/10">Entró</Badge>
                      : e.result === 'override' ? <Badge cls="text-amarillo-suave bg-amarillo-suave/10">Autorizado</Badge>
                      : <Badge cls="text-white bg-alerta">{e.reasons.map(r => ACCESS_REASONS[r] ?? r).join(', ') || 'Negado'}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
