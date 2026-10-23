import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { call, erpError, fmtDateTime } from '../../../lib/erp'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall } from '../../../components/erp/ui'

// ---------------------------------------------------------------------------
// Correos automáticos
// ---------------------------------------------------------------------------
interface Automation {
  key: string; enabled: boolean; days: number; subject: string; heading: string; body: string
  button_text: string | null; button_url: string | null; marketing: boolean; sent_30d?: number
}
interface EmailsData { automations: Automation[]; log: { created_at: string; key: string; email: string; status: string; error: string | null; person_name: string | null }[]; my_email: string | null }

const INFO: Record<string, { name: string; when: (days: number) => string; daysLabel?: string }> = {
  welcome: { name: 'Bienvenida', when: () => 'Cuando se registra una persona nueva (desde que lo prendes).' },
  birthday: { name: 'Cumpleaños', when: () => 'El día de su cumpleaños.' },
  expiring: { name: 'Membresía por vencer', when: d => `${d} días antes de que venza (no a quien tiene domiciliación).`, daysLabel: 'Días antes' },
  expired: { name: 'Membresía vencida', when: d => `${d} día(s) después de que venció, si no renovó.`, daysLabel: 'Días después' },
  inactive: { name: 'Hace días que no viene', when: d => `Si tiene membresía vigente y lleva ${d} días sin registrar entrada (usa Acceso).`, daysLabel: 'Días sin venir' },
}

async function fn<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('crm-emails', { body })
  if (error) return { data: null, error: 'No se pudo usar la función crm-emails (¿ya se desplegó?).' }
  if (data?.error) return { data: null, error: data.message ?? data.error }
  return { data, error: null }
}

export function EmailsConfigPage() {
  const [d, setD] = useState<EmailsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await call<EmailsData>('get_email_automations')
    if (error || !data) { setError(error === 'forbidden' ? 'Solo un admin.' : 'No se pudo cargar. ¿Ya se corrió erp_crm.sql?'); return }
    setD(data)
  }, [])
  useEffect(() => { load() }, [load])
  if (error) return <Page title="Correos automáticos"><p className="text-alerta text-sm">{error}</p></Page>
  if (!d) return <Page title="Correos automáticos"><Spinner /></Page>
  return (
    <Page title="Correos automáticos" subtitle="Se mandan solos una vez al día (10:00). Todos vienen apagados: revisa el texto, mándate una prueba y luego prende el que quieras.">
      {d.automations.map(a => <AutomationCard key={a.key} a={a} myEmail={d.my_email} onSaved={load} />)}
      <Card title="Últimos envíos">
        {d.log.length === 0 ? <Empty>Todavía no se ha mandado nada.</Empty> : (
          <div className="divide-y divide-zinc-800/80">
            {d.log.map((l, i) => (
              <div key={i} className="py-1.5 flex justify-between gap-3 text-sm">
                <span className="text-zinc-300 min-w-0 truncate">{INFO[l.key]?.name ?? l.key} · {l.person_name ?? l.email}{l.error ? <span className="text-alerta"> · {l.error}</span> : ''}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge cls={l.status === 'sent' ? 'text-exito bg-exito/10' : l.status === 'test' ? undefined : 'text-white bg-alerta'}>{l.status === 'sent' ? 'Enviado' : l.status === 'test' ? 'Prueba' : 'Error'}</Badge>
                  <span className="text-zinc-500 text-xs">{fmtDateTime(l.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  )
}

function AutomationCard({ a, myEmail, onSaved }: { a: Automation; myEmail: string | null; onSaved: () => void }) {
  const info = INFO[a.key]
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ subject: a.subject, heading: a.heading, body: a.body, button_text: a.button_text ?? '', button_url: a.button_url ?? '', days: String(a.days) })
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const draft = { subject: f.subject, heading: f.heading, body: f.body, button_text: f.button_text || null, button_url: f.button_url || null }

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setMsg(null)
    const { error } = await call('admin_save_email_automation', { p: { key: a.key, ...draft, days: f.days, ...extra } })
    setBusy(false)
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    setMsg({ text: 'Guardado.', tone: 'ok' }); onSaved()
  }
  const doPreview = async () => {
    const { data, error } = await fn<{ subject: string; html: string }>({ action: 'preview', key: a.key, draft })
    if (error || !data) { setMsg({ text: error ?? 'Error', tone: 'error' }); return }
    setPreview(data)
  }
  const test = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await fn<{ to: string }>({ action: 'test', key: a.key, draft })
    setBusy(false)
    setMsg(error || !data ? { text: error ?? 'Error', tone: 'error' } : { text: `Prueba enviada a ${data.to}.`, tone: 'ok' })
  }
  const toggle = async () => {
    if (!a.enabled && !window.confirm(`Al prender "${info.name}" se mandará automáticamente a tus clientes cada día. ¿Prender?`)) return
    save({ enabled: !a.enabled })
  }

  return (
    <Card tone={a.enabled ? 'success' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setOpen(v => !v)} className="text-left min-w-0">
          <p className="text-texto-principal font-bold">{info.name} {a.enabled ? <Badge cls="text-exito bg-exito/10">Prendido</Badge> : <Badge>Apagado</Badge>} {a.marketing && <Badge>Promocional</Badge>}</p>
          <p className="text-zinc-400 text-xs">{info.when(Number(f.days))}{a.sent_30d ? ` · ${a.sent_30d} enviados en 30 días` : ''}</p>
        </button>
        <span className="flex gap-2">
          <button onClick={() => setOpen(v => !v)} className={btnSmall}>{open ? 'Cerrar' : 'Editar'}</button>
          <button onClick={toggle} disabled={busy} className={a.enabled ? btnSmall : btnPrimary}>{a.enabled ? 'Apagar' : 'Prender'}</button>
        </span>
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-zinc-500 text-xs">Puedes usar {'{{nombre}}'}{a.key !== 'welcome' && a.key !== 'birthday' ? ', {{fecha}}' : ''}{a.key === 'inactive' ? ', {{dias}}' : ''}. Separa párrafos con una línea en blanco.{a.marketing ? ' Solo llega a quien acepta promociones.' : ''}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Asunto</label><input value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} className={input} /></div>
            <div><label className={label}>Título dentro del correo</label><input value={f.heading} onChange={e => setF({ ...f, heading: e.target.value })} className={input} /></div>
          </div>
          <div><label className={label}>Texto</label><textarea value={f.body} onChange={e => setF({ ...f, body: e.target.value })} rows={5} className={input} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className={label}>Botón (opcional)</label><input value={f.button_text} onChange={e => setF({ ...f, button_text: e.target.value })} className={input} /></div>
            <div><label className={label}>Enlace del botón</label><input value={f.button_url} onChange={e => setF({ ...f, button_url: e.target.value })} placeholder="https://app.jaibamuro.com/…" className={input} /></div>
            {info.daysLabel && <div><label className={label}>{info.daysLabel}</label><input type="number" min={0} max={120} value={f.days} onChange={e => setF({ ...f, days: e.target.value })} className={input} /></div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => save()} disabled={busy} className={btnPrimary}>Guardar</button>
            <button onClick={doPreview} className={btnGhost}>Vista previa</button>
            <button onClick={test} disabled={busy} className={btnGhost}>Mandarme una prueba{myEmail ? ` (${myEmail})` : ''}</button>
          </div>
          {preview && (
            <div className="rounded-xl overflow-hidden border border-zinc-700/50">
              <p className="bg-superficie-alta px-3 py-2 text-xs text-zinc-300">Asunto: <span className="text-texto-principal font-semibold">{preview.subject}</span></p>
              <iframe title="Vista previa" srcDoc={preview.html} className="w-full h-[480px] bg-white" sandbox="" />
            </div>
          )}
        </div>
      )}
      {msg && <div className="mt-2"><Msg text={msg.text} tone={msg.tone} /></div>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Responsivas y reglamento
// ---------------------------------------------------------------------------
interface LegalDoc { id: string; doc_key: string; version: number; kind: string; title: string; body: string; required: boolean; is_current: boolean; sort_order: number; created_at: string; signed_count: number }

export function LegalDocsConfigPage() {
  const [docs, setDocs] = useState<LegalDoc[] | null>(null)
  const [pendingPeople, setPendingPeople] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => {
    const { data } = await call<{ documents: LegalDoc[]; people_pending: number }>('get_legal_documents')
    setDocs(data?.documents ?? []); setPendingPeople(data?.people_pending ?? 0)
  }, [])
  useEffect(() => { load() }, [load])
  if (!docs) return <Page title="Responsiva y reglamento"><Spinner /></Page>
  const current = docs.filter(d => d.is_current)
  const keys = [...new Set(docs.map(d => d.doc_key))]

  return (
    <Page title="Responsiva y reglamento" subtitle="Lo que cada persona firma con el dedo (en la tablet del gym o desde su cuenta). Si cambias el texto se crea una versión nueva y se les vuelve a pedir firmar."
      actions={<button onClick={() => setCreating(v => !v)} className={btnPrimary}>{creating ? 'Cerrar' : '+ Otro documento'}</button>}>
      <p className="text-amarillo-suave text-sm">Los textos iniciales son un borrador. Revísalos (de preferencia con un abogado) antes de pedir firmas a todos.</p>
      {pendingPeople > 0 && <p className="text-zinc-400 text-sm">{pendingPeople} persona(s) activa(s) tienen algo pendiente de firmar.</p>}
      {creating && <Card title="Nuevo documento" tone="accent"><LegalForm onSaved={() => { setCreating(false); load() }} /></Card>}
      {keys.map(k => {
        const cur = current.find(d => d.doc_key === k)
        const versions = docs.filter(d => d.doc_key === k)
        const latest = cur ?? versions[0]
        return (
          <Card key={k} tone={cur ? undefined : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className={`font-bold ${cur ? 'text-texto-principal' : 'text-zinc-500'}`}>{latest.title} <span className="text-zinc-500 font-normal">v{latest.version}</span></p>
                <p className="text-zinc-400 text-xs">{cur ? (cur.required ? 'Obligatorio para entrar' : 'Opcional') : 'Retirado (ya no se pide)'} · {latest.signed_count} firmas de esta versión · {versions.length} versión(es)</p>
              </div>
              <button onClick={() => setEditing(editing === k ? null : k)} className={btnSmall}>{editing === k ? 'Cerrar' : 'Ver / editar'}</button>
            </div>
            {editing === k && <div className="mt-3"><LegalForm doc={latest} onSaved={() => { setEditing(null); load() }} /></div>}
          </Card>
        )
      })}
    </Page>
  )
}

function LegalForm({ doc, onSaved }: { doc?: LegalDoc; onSaved: () => void }) {
  const [f, setF] = useState({ doc_key: doc?.doc_key ?? '', title: doc?.title ?? '', body: doc?.body ?? '', kind: doc?.kind ?? 'other', required: doc?.required ?? true })
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const save = async () => {
    const { data, error } = await call<{ new_version: boolean }>('admin_save_legal_document', { p: f })
    if (error || !data) { setMsg({ text: erpError(error ?? undefined), tone: 'error' }); return }
    setMsg({ text: data.new_version ? 'Se publicó una versión nueva: a todos se les pedirá firmarla.' : 'Guardado (sin cambio de texto).', tone: 'ok' })
    onSaved()
  }
  const retire = async () => {
    if (!doc || !window.confirm('¿Dejar de pedir este documento? Las firmas se conservan.')) return
    await call('admin_retire_legal_document', { p_doc_key: doc.doc_key })
    onSaved()
  }
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        {!doc && <div><label className={label}>Clave corta (sin espacios)</label><input value={f.doc_key} onChange={e => setF({ ...f, doc_key: e.target.value })} placeholder="aviso-privacidad" className={input} /></div>}
        <div className="sm:col-span-2"><label className={label}>Título</label><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} className={input} /></div>
      </div>
      <div><label className={label}>Texto completo</label><textarea value={f.body} onChange={e => setF({ ...f, body: e.target.value })} rows={14} className={`${input} font-mono text-xs leading-relaxed`} /></div>
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input type="checkbox" checked={f.required} onChange={e => setF({ ...f, required: e.target.checked })} className="accent-primario w-4 h-4" />
        Obligatorio (sin firmarlo no puede entrar, si en Acceso está activado "pide responsiva")
      </label>
      {msg && <Msg text={msg.text} tone={msg.tone} />}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} className={btnPrimary}>Guardar</button>
        {doc?.is_current && <button onClick={retire} className={btnGhost}>Retirar</button>}
      </div>
    </div>
  )
}
