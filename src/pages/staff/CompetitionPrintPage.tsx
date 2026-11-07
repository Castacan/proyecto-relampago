import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SLUG } from '../../lib/competition'

// /staff/competencia/imprimir — todo lo que se imprime para el día de la competencia (pedido del
// dueño, 2026-11-07): carteles con QR, listas de recepción y por horario, hojas de respaldo para los
// jueces y números para el pecho. Usa los datos de get_competition_checkin_admin (pagados y
// pendientes con número), así que se puede volver a imprimir si algo cambia.
// La hoja se imprime con un portal (#comp-print-sheet); ver src/index.css.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as any

const ORIGIN = 'https://app.jaibamuro.com'
const URLS = {
  checkin: `${ORIGIN}/competencia/checkin`,
  reglamento: `${ORIGIN}/competencia/reglamento`,
  juez: `${ORIGIN}/juez`,
}

interface Person {
  registration_id: string; bib: number | null; full_name: string; time_slot_id: string | null
  shirt_size: string | null; is_minor: boolean; pending_payment?: boolean
}
interface Slot { id: string; label: string }

type SectionKey = 'qrCheckin' | 'qrReglamento' | 'qrJuez' | 'recepcion' | 'horarios' | 'respaldo' | 'numeros'
const SECTIONS: { key: SectionKey; title: string; detail: string; on: boolean }[] = [
  { key: 'qrCheckin', title: 'Cartel: QR de check-in', detail: '1 hoja. Para recepción.', on: true },
  { key: 'qrReglamento', title: 'Cartel: QR de "¿Cómo se califica?"', detail: '1 hoja. Para la pared o junto a los bloques.', on: true },
  { key: 'qrJuez', title: 'Cartel: QR para jueces', detail: '1 hoja. Abre la página del juez en su celular.', on: false },
  { key: 'recepcion', title: 'Lista de recepción (A–Z)', detail: 'Nombre, número, horario, talla, efectivo/menor y casillas de check-in y playera. Respaldo si falla el internet.', on: true },
  { key: 'horarios', title: 'Lista por horario', detail: 'Una hoja por horario, ordenada por número, con casilla de "llegó".', on: true },
  { key: 'respaldo', title: 'Hojas de respaldo para jueces', detail: 'Para anotar en papel si se cae el internet; después se capturan en Puntos → Agregar intento.', on: true },
  { key: 'numeros', title: 'Números para el pecho', detail: '2 por hoja, con nombre. Solo si no tienen números impresos.', on: false },
]

const page: React.CSSProperties = { fontFamily: 'Arial, Helvetica, sans-serif', color: '#000' }
const th: React.CSSProperties = { border: '1px solid #000', padding: '4px 6px', textAlign: 'left', fontSize: '10pt', background: '#eee' }
const td: React.CSSProperties = { border: '1px solid #000', padding: '5px 6px', fontSize: '10.5pt', verticalAlign: 'middle' }
const box: React.CSSProperties = { display: 'inline-block', width: '14px', height: '14px', border: '1.5px solid #000' }

function Poster({ title, subtitle, url, steps }: { title: string; subtitle: string; url: string; steps?: string[] }) {
  return (
    <div className="cp-page" style={{ ...page, textAlign: 'center', paddingTop: '0.6cm' }}>
      <p style={{ fontSize: '14pt', fontWeight: 700, letterSpacing: '2px', margin: 0 }}>JAM · JAIBAS AL MURO 2026</p>
      <p style={{ fontSize: '40pt', fontWeight: 900, margin: '0.3cm 0 0.2cm', lineHeight: 1.05 }}>{title}</p>
      <p style={{ fontSize: '16pt', margin: '0 0 0.6cm' }}>{subtitle}</p>
      <div style={{ display: 'inline-block', padding: '0.4cm', border: '2px solid #000' }}>
        <QRCode value={url} size={430} />
      </div>
      <p style={{ fontSize: '13pt', fontFamily: 'monospace', margin: '0.3cm 0 0' }}>{url.replace('https://', '')}</p>
      {steps && (
        <ol style={{ textAlign: 'left', display: 'inline-block', fontSize: '15pt', lineHeight: 1.5, margin: '0.6cm 0 0', paddingLeft: '1cm' }}>
          {steps.map(s => <li key={s}>{s}</li>)}
        </ol>
      )}
    </div>
  )
}

function Header({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #000', marginBottom: '0.3cm', paddingBottom: '0.1cm' }}>
      <span style={{ fontSize: '16pt', fontWeight: 900 }}>{title}</span>
      <span style={{ fontSize: '9pt' }}>{note}</span>
    </div>
  )
}

function Sheet({ on, people, slots, copies, printedAt }: {
  on: Record<SectionKey, boolean>; people: Person[]; slots: Slot[]; copies: number; printedAt: string
}) {
  const slotLabel = (id: string | null) => slots.find(s => s.id === id)?.label ?? '—'
  const byName = [...people].sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  const byBib = [...people].sort((a, b) => (a.bib ?? 9999) - (b.bib ?? 9999))
  const notes = (p: Person) => [p.pending_payment ? 'PAGA EFECTIVO' : '', p.is_minor ? 'MENOR' : ''].filter(Boolean).join(' · ')
  const pairs: Person[][] = []
  for (let i = 0; i < byBib.length; i += 2) pairs.push(byBib.slice(i, i + 2))

  return (
    <div style={{ background: '#fff', color: '#000' }}>
      {on.qrCheckin && (
        <Poster title="CHECK-IN" subtitle="Escanea con la cámara de tu celular" url={URLS.checkin} steps={[
          'Di tu nombre en recepción: te damos tu número.',
          'Escanea el QR.',
          'Escribe tu primer nombre y tu número.',
          'Lee y firma los documentos.',
          'Enseña la pantalla verde y recibe tu kit.',
        ]} />
      )}
      {on.qrReglamento && (
        <Poster title="¿Cómo se califica?" subtitle="Puntos, categorías, empates y rifa" url={URLS.reglamento} steps={[
          'Top = valor del bloque. Zona = la mitad.',
          'Cada intento extra resta 0.01.',
          'Cuentan tus 5 bloques que más puntos te den.',
          'Cada zona o top = 1 boleto para la rifa.',
        ]} />
      )}
      {on.qrJuez && (
        <Poster title="JUECES" subtitle="Abre esta página y escribe tu palabra de juez" url={URLS.juez} />
      )}

      {on.recepcion && (
        <div className="cp-page" style={page}>
          <Header title={`Lista de recepción · ${people.length} personas`} note={`Ordenada por nombre · impresa ${printedAt}`} />
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Nombre</th><th style={{ ...th, width: '1.2cm' }}>#</th><th style={th}>Horario</th>
              <th style={{ ...th, width: '1.1cm' }}>Talla</th><th style={th}>Notas</th>
              <th style={{ ...th, width: '1.6cm' }}>Check-in</th><th style={{ ...th, width: '1.6cm' }}>Playera</th>
            </tr></thead>
            <tbody>
              {byName.map(p => (
                <tr key={p.registration_id} style={{ breakInside: 'avoid' }}>
                  <td style={td}>{p.full_name}</td>
                  <td style={{ ...td, fontWeight: 900, fontSize: '12pt' }}>{p.bib ?? '—'}</td>
                  <td style={td}>{slotLabel(p.time_slot_id)}</td>
                  <td style={td}>{p.shirt_size ?? ''}</td>
                  <td style={{ ...td, fontWeight: 700, fontSize: '9pt' }}>{notes(p)}</td>
                  <td style={{ ...td, textAlign: 'center' }}><span style={box} /></td>
                  <td style={{ ...td, textAlign: 'center' }}><span style={box} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {on.horarios && [...slots, { id: '__none', label: 'Sin horario' }].map(s => {
        const list = byBib.filter(p => (s.id === '__none' ? !p.time_slot_id || !slots.some(x => x.id === p.time_slot_id) : p.time_slot_id === s.id))
        if (list.length === 0) return null
        return (
          <div key={s.id} className="cp-page" style={page}>
            <Header title={`Horario ${s.label} · ${list.length} personas`} note={`Ordenada por número · impresa ${printedAt}`} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, width: '1.2cm' }}>#</th><th style={th}>Nombre</th><th style={th}>Notas</th>
                <th style={{ ...th, width: '1.6cm' }}>Llegó</th>
              </tr></thead>
              <tbody>
                {list.map(p => (
                  <tr key={p.registration_id}>
                    <td style={{ ...td, fontWeight: 900, fontSize: '12pt' }}>{p.bib ?? '—'}</td>
                    <td style={td}>{p.full_name}</td>
                    <td style={{ ...td, fontWeight: 700, fontSize: '9pt' }}>{notes(p)}</td>
                    <td style={{ ...td, textAlign: 'center' }}><span style={box} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {on.respaldo && Array.from({ length: copies }, (_, i) => (
        <div key={i} className="cp-page" style={page}>
          <Header title="Hoja de respaldo del juez" note="Solo si se cae el internet. Después se captura en Puntos → Agregar intento." />
          <p style={{ fontSize: '11pt', margin: '0 0 0.25cm' }}>Juez: ______________________ &nbsp;&nbsp; Horario: ______________ &nbsp;&nbsp; Hoja ___</p>
          <p style={{ fontSize: '9.5pt', margin: '0 0 0.25cm' }}>Una fila por intento, en el orden en que pasan. Encierra el resultado: <b>C</b> = caída · <b>Z</b> = zona · <b>T</b> = top.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, width: '1.8cm' }}>Hora</th><th style={{ ...th, width: '2cm' }}>Número</th>
              <th style={{ ...th, width: '2cm' }}>Bloque</th><th style={th}>Resultado</th><th style={th}>Nota</th>
            </tr></thead>
            <tbody>
              {Array.from({ length: 26 }, (_, r) => (
                <tr key={r}>
                  <td style={{ ...td, height: '0.72cm' }} /><td style={td} /><td style={td} />
                  <td style={{ ...td, fontWeight: 700, letterSpacing: '10px' }}>C Z T</td><td style={td} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {on.numeros && pairs.map((pair, i) => (
        <div key={i} className="cp-page" style={{ ...page, display: 'flex', flexDirection: 'column', gap: '0.4cm' }}>
          {pair.map(p => (
            <div key={p.registration_id} style={{ border: '2px dashed #999', height: '12.4cm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '12pt', fontWeight: 700, letterSpacing: '2px', margin: 0 }}>JAM · JAIBAS AL MURO 2026</p>
              <p style={{ fontSize: '170pt', fontWeight: 900, lineHeight: 1, margin: '0.2cm 0' }}>{p.bib ?? '—'}</p>
              <p style={{ fontSize: '18pt', fontWeight: 700, margin: 0 }}>{p.full_name}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function CompetitionPrintPage() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [on, setOn] = useState<Record<SectionKey, boolean>>(() => Object.fromEntries(SECTIONS.map(s => [s.key, s.on])) as Record<SectionKey, boolean>)
  const [copies, setCopies] = useState(6)

  useEffect(() => {
    db.rpc('get_competition_checkin_admin', { p_slug: COMPETITION_SLUG }).then(({ data, error: err }: { data: { error?: string; people: Person[]; slots: Slot[] } | null; error: unknown }) => {
      if (err || !data || data.error) { setError('No se pudieron cargar los datos. Recarga la página.'); return }
      setPeople(data.people.filter(p => p.bib != null))
      setSlots(data.slots)
    })
  }, [])

  const printedAt = useMemo(() => new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }), [people])
  const anyOn = Object.values(on).some(Boolean)

  return (
    <div className="h-full overflow-y-auto bg-fondo">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div>
          <p className="text-zinc-400 text-xs">
            <Link to="/staff/competencia" className="text-primario font-bold">Inscripciones</Link>
            {' · '}<Link to="/staff/competencia/checkin" className="text-primario font-bold">Check-in</Link>
          </p>
          <h1 className="text-texto-principal font-black text-2xl mt-1">Imprimir para la competencia</h1>
          <p className="text-zinc-400 text-sm mt-1">Marca lo que quieras y pica Imprimir. Cada cosa sale en su propia hoja. Los datos son los de ahorita: si algo cambia, vuelve a imprimir.</p>
        </div>

        {error && <p className="text-alerta text-sm font-semibold">{error}</p>}

        <div className="rounded-2xl bg-superficie border border-zinc-800 divide-y divide-zinc-800">
          {SECTIONS.map(s => (
            <label key={s.key} className="flex items-start gap-3 px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={on[s.key]} onChange={e => setOn({ ...on, [s.key]: e.target.checked })} className="mt-1 w-4 h-4 accent-primario" />
              <span className="min-w-0">
                <span className="block text-texto-principal font-bold text-sm">{s.title}</span>
                <span className="block text-zinc-400 text-xs">{s.detail}</span>
                {s.key === 'respaldo' && on.respaldo && (
                  <span className="flex items-center gap-2 mt-2 text-xs text-zinc-300" onClick={e => e.preventDefault()}>
                    Copias:
                    <input type="number" min={1} max={30} value={copies} onChange={e => setCopies(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                      className="w-16 bg-superficie-alta text-texto-principal rounded-lg px-2 py-1 border border-zinc-700/50" />
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} disabled={!people || !anyOn}
            className="px-5 py-3 rounded-xl bg-primario text-texto-en-acento font-black disabled:opacity-50">Imprimir</button>
          <p className="text-zinc-400 text-xs">{people ? `${people.length} personas con número.` : 'Cargando…'} En el diálogo de impresión quita "Encabezados y pies de página".</p>
        </div>

        {people && anyOn && (
          <div>
            <p className="text-zinc-400 text-xs font-bold mb-2">Vista previa</p>
            <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-white p-6 max-h-[70vh] overflow-y-auto">
              <Sheet on={on} people={people} slots={slots} copies={copies} printedAt={printedAt} />
            </div>
          </div>
        )}
      </div>

      {people && anyOn && createPortal(
        <div id="comp-print-sheet"><Sheet on={on} people={people} slots={slots} copies={copies} printedAt={printedAt} /></div>,
        document.body,
      )}
    </div>
  )
}
