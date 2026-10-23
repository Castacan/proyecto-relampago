import { useCallback, useEffect, useState } from 'react'
import { call, billing, erpError, money, toCents, toPesos, durationLabel, scheduleLabel, KIND_LABELS, type Product, type ProductKind } from '../../../lib/erp'
import { Page, Card, Badge, Empty, Spinner, Msg, input, label, btnPrimary, btnGhost, btnSmall, MoneyField } from '../../../components/erp/ui'

// ---------------------------------------------------------------------------
// Productos y planes
// ---------------------------------------------------------------------------
export function ProductsConfigPage() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => {
    const { data } = await call<{ products: Product[] }>('get_products', { p_include_inactive: true })
    setProducts(data?.products ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <Page title="Productos y planes" subtitle="Todo lo que se vende: membresías, pases, clases sueltas y productos."
      actions={<button onClick={() => setCreating(v => !v)} className={btnPrimary}>{creating ? 'Cerrar' : '+ Nuevo'}</button>}>
      {creating && <Card title="Nuevo producto" tone="accent"><ProductForm onSaved={() => { setCreating(false); load() }} /></Card>}
      {products === null ? <Spinner /> : products.length === 0 ? <Empty>No hay productos.</Empty> : (
        <div className="space-y-2">
          {products.map(p => (
            <Card key={p.id}>
              <button onClick={() => setEditing(editing === p.id ? null : p.id)} className="w-full text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={`font-bold ${p.is_active ? 'text-texto-principal' : 'text-zinc-500'}`}>{p.name}</span>
                    <Badge>{KIND_LABELS[p.kind]}</Badge>
                    {p.is_recurring && <Badge cls="text-primario bg-primario/10">Domiciliación</Badge>}
                    {!p.is_active && <Badge>Inactivo</Badge>}
                  </span>
                  <span className="text-texto-principal font-black">{money(p.price_cents)}</span>
                </div>
                <p className="text-zinc-400 text-xs mt-1">
                  {p.grants_membership ? `Da membresía de ${durationLabel(p)}` : 'No da membresía'}
                  {p.is_recurring && ` · ${p.promo_active ? `Promo activa: ${scheduleLabel(p.price_cents, p.promo_cycles, p.promo_price_cents)}` : 'Sin promoción'}`}
                  {p.track_stock && ` · ${p.stock ?? 0} en inventario`}
                </p>
              </button>
              {editing === p.id && <div className="mt-4"><ProductForm p={p} onSaved={() => { setEditing(null); load() }} /></div>}
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}

function ProductForm({ p, onSaved }: { p?: Product; onSaved: () => void }) {
  const [f, setF] = useState({
    kind: (p?.kind ?? 'plan') as ProductKind, name: p?.name ?? '', description: p?.description ?? '', price: toPesos(p?.price_cents ?? 0),
    grants_membership: p?.grants_membership ?? true, duration_unit: p?.duration_unit ?? 'month', duration_value: String(p?.duration_value ?? 1),
    is_recurring: p?.is_recurring ?? false, promo_active: p?.promo_active ?? false, promo_cycles: String(p?.promo_cycles ?? ''),
    promo_price: toPesos(p?.promo_price_cents ?? null), track_stock: p?.track_stock ?? false, stock: String(p?.stock ?? ''),
    is_active: p?.is_active ?? true, sort_order: String(p?.sort_order ?? 0),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (x: Partial<typeof f>) => { setF(v => ({ ...v, ...x })); setError(null) }
  const isPlan = f.kind === 'plan' || f.kind === 'pass'

  const save = async () => {
    setBusy(true)
    const { error } = await call('admin_save_product', { p_product: {
      id: p?.id ?? null, kind: f.kind, name: f.name, description: f.description, price_cents: toCents(f.price),
      grants_membership: isPlan && f.grants_membership, duration_unit: f.is_recurring ? 'month' : f.duration_unit,
      duration_value: f.is_recurring ? 1 : Number(f.duration_value), is_recurring: f.kind === 'plan' && f.is_recurring,
      promo_active: f.is_recurring && f.promo_active, promo_cycles: f.promo_cycles || '', promo_price_cents: f.promo_price === '' ? '' : toCents(f.promo_price),
      track_stock: f.track_stock, stock: f.stock, is_active: f.is_active, sort_order: Number(f.sort_order), class_type_id: p?.class_type_id ?? null,
    } })
    setBusy(false)
    if (error) { setError(erpError(error)); return }
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label}>Tipo</label>
          <select value={f.kind} onChange={e => set({ kind: e.target.value as ProductKind })} className={input}>
            {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={label}>Nombre</label><input value={f.name} onChange={e => set({ name: e.target.value })} className={input} /></div>
        <MoneyField id="pf-price" label={f.is_recurring ? 'Precio mensual normal' : 'Precio'} value={f.price} onChange={v => set({ price: v })} />
        <div><label className={label}>Orden en la lista</label><input type="number" value={f.sort_order} onChange={e => set({ sort_order: e.target.value })} className={input} /></div>
      </div>
      <div><label className={label}>Descripción (opcional)</label><input value={f.description} onChange={e => set({ description: e.target.value })} className={input} /></div>

      {isPlan && (
        <div className="rounded-xl bg-fondo/60 p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={f.grants_membership} onChange={e => set({ grants_membership: e.target.checked })} className="accent-primario w-4 h-4" />
            Da membresía (precio de miembro y clase gratis del mes)
          </label>
          {f.kind === 'plan' && (
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input type="checkbox" checked={f.is_recurring} onChange={e => set({ is_recurring: e.target.checked, grants_membership: e.target.checked || f.grants_membership })} className="accent-primario w-4 h-4" />
              Domiciliación: se cobra solo cada mes a la tarjeta
            </label>
          )}
          {f.grants_membership && !f.is_recurring && (
            <div className="flex gap-2 items-end">
              <div className="w-24"><label className={label}>Dura</label><input type="number" min={1} value={f.duration_value} onChange={e => set({ duration_value: e.target.value })} className={input} /></div>
              <select value={f.duration_unit} onChange={e => set({ duration_unit: e.target.value as 'day' | 'month' })} className={`${input} max-w-[8rem]`}>
                <option value="day">días</option><option value="month">meses</option>
              </select>
            </div>
          )}
          {f.is_recurring && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={f.promo_active} onChange={e => set({ promo_active: e.target.checked })} className="accent-primario w-4 h-4" />
                Promoción para nuevas domiciliaciones
              </label>
              {f.promo_active && (
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="w-28"><label className={label}>Primeros meses</label><input type="number" min={1} value={f.promo_cycles} onChange={e => set({ promo_cycles: e.target.value })} className={input} /></div>
                  <div className="w-40"><MoneyField id="pf-promo" label="A precio de" value={f.promo_price} onChange={v => set({ promo_price: v })} /></div>
                </div>
              )}
              <p className="text-zinc-500 text-xs">Apagar la promoción no afecta a quien ya la tiene: conserva sus meses con precio especial.</p>
            </div>
          )}
        </div>
      )}
      {(f.kind === 'product') && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={f.track_stock} onChange={e => set({ track_stock: e.target.checked })} className="accent-primario w-4 h-4" />
            Llevar inventario
          </label>
          {f.track_stock && <div className="w-28"><label className={label}>En existencia</label><input type="number" value={f.stock} onChange={e => set({ stock: e.target.value })} className={input} /></div>}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} className="accent-primario w-4 h-4" />
        Activo (se puede vender)
      </label>
      <Msg text={error} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integraciones y pagos
// ---------------------------------------------------------------------------
interface Integrations { recurring_provider: string | null; openpay_merchant_id: string | null; openpay_public_key: string | null; openpay_sandbox: boolean; stripe_publishable_key: string | null }
interface BillingStatus {
  openpay: { private_key: boolean; merchant_id: boolean; public_key: boolean; sandbox: boolean }
  stripe: { secret_key: boolean; secret_mode: string | null; webhook_secret: boolean; publishable_key: boolean; publishable_mode: string | null }
  resend: boolean; cron_key: boolean; webhook_urls: { stripe: string; openpay: string }
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <p className={`text-sm ${ok ? 'text-exito' : 'text-amarillo-suave'}`}>{ok ? '✓' : '•'} {children}</p>
}

export function IntegrationsPage() {
  const [intg, setIntg] = useState<Integrations | null>(null)
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [f, setF] = useState({ recurring_provider: '', openpay_merchant_id: '', openpay_public_key: '', openpay_sandbox: true, stripe_publishable_key: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [test, setTest] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await call<{ integrations: Integrations }>('get_erp_settings')
    if (data?.integrations) {
      setIntg(data.integrations)
      setF({ recurring_provider: data.integrations.recurring_provider ?? '', openpay_merchant_id: data.integrations.openpay_merchant_id ?? '',
        openpay_public_key: data.integrations.openpay_public_key ?? '', openpay_sandbox: data.integrations.openpay_sandbox,
        stripe_publishable_key: data.integrations.stripe_publishable_key ?? '' })
    }
    const st = await billing<BillingStatus>({ action: 'status' })
    if (st.error || !st.data) setStatusError(true); else { setStatusError(false); setStatus(st.data) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setMsg(null)
    const { error } = await call('admin_update_integrations', { p_patch: f })
    setBusy(false)
    if (error) { setMsg({ text: erpError(error), tone: 'error' }); return }
    setMsg({ text: 'Guardado.', tone: 'ok' }); load()
  }
  const runTest = async (provider: string) => {
    setTest(t => ({ ...t, [provider]: 'Probando…' }))
    // La prueba lee lo guardado: si hay cambios sin guardar, se guardan primero.
    const saved = { recurring_provider: intg?.recurring_provider ?? '', openpay_merchant_id: intg?.openpay_merchant_id ?? '',
      openpay_public_key: intg?.openpay_public_key ?? '', openpay_sandbox: intg?.openpay_sandbox ?? true, stripe_publishable_key: intg?.stripe_publishable_key ?? '' }
    if (JSON.stringify(saved) !== JSON.stringify(f)) {
      const { error } = await call('admin_update_integrations', { p_patch: f })
      if (error) { setTest(t => ({ ...t, [provider]: `✗ ${erpError(error)}` })); return }
      await load()
    }
    const { data } = await billing<{ ok: boolean; message: string }>({ action: 'test_connection', provider })
    setTest(t => ({ ...t, [provider]: data ? `${data.ok ? '✓' : '✗'} ${data.message}` : 'No se pudo probar (¿función "billing" desplegada?)' }))
  }

  if (!intg) return <Page title="Integraciones y pagos"><Spinner /></Page>

  return (
    <Page title="Integraciones y pagos" subtitle="Con qué proveedor se cobran las domiciliaciones. Las llaves secretas viven en Supabase, nunca aquí.">
      <Card title="Proveedor de cobro recurrente" tone="accent">
        <div className="grid sm:grid-cols-3 gap-2">
          {[['', 'Ninguno (desactivado)'], ['openpay', 'Openpay'], ['stripe', 'Stripe']].map(([k, v]) => (
            <button key={k} onClick={() => setF({ ...f, recurring_provider: k })}
              className={`rounded-xl border px-3 py-3 text-sm font-bold ${f.recurring_provider === k ? 'border-primario bg-primario/10 text-texto-principal' : 'border-zinc-700/50 text-zinc-300'}`}>{v}</button>
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-2">Las domiciliaciones nuevas usan el proveedor elegido. Las que ya existen siguen con el suyo (la tarjeta está guardada allá).</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Openpay">
          <div className="space-y-3">
            <div><label className={label}>ID de comercio (Merchant ID)</label><input value={f.openpay_merchant_id} onChange={e => setF({ ...f, openpay_merchant_id: e.target.value })} className={input} placeholder="m..." /></div>
            <div><label className={label}>Llave pública</label><input value={f.openpay_public_key} onChange={e => setF({ ...f, openpay_public_key: e.target.value })} className={input} placeholder="pk_..." /></div>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input type="checkbox" checked={f.openpay_sandbox} onChange={e => setF({ ...f, openpay_sandbox: e.target.checked })} className="accent-primario w-4 h-4" />
              Modo pruebas (sandbox). Quítalo para cobrar de verdad.
            </label>
            {status && <div className="rounded-xl bg-fondo/60 p-3 space-y-1">
              <Check ok={status.openpay.private_key}>Llave privada en Supabase (secreto <code>OPENPAY_PRIVATE_KEY</code>)</Check>
              <Check ok={status.openpay.merchant_id && status.openpay.public_key}>ID de comercio y llave pública guardados</Check>
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runTest('openpay')} className={btnSmall}>Probar conexión</button>
              {test.openpay && <span className="text-xs text-zinc-300">{test.openpay}</span>}
            </div>
            {status && <p className="text-zinc-500 text-xs break-all">Webhook para el panel de Openpay: <span className="text-zinc-300">{status.webhook_urls.openpay}</span></p>}
          </div>
        </Card>
        <Card title="Stripe">
          <div className="space-y-3">
            <div><label className={label}>Llave publicable</label><input value={f.stripe_publishable_key} onChange={e => setF({ ...f, stripe_publishable_key: e.target.value })} className={input} placeholder="pk_test_... o pk_live_..." /></div>
            {status && <div className="rounded-xl bg-fondo/60 p-3 space-y-1">
              <Check ok={status.stripe.secret_key}>Llave secreta en Supabase (secreto <code>STRIPE_SECRET_KEY</code>){status.stripe.secret_mode ? ` · modo ${status.stripe.secret_mode === 'live' ? 'producción' : 'pruebas'}` : ''}</Check>
              <Check ok={status.stripe.webhook_secret}>Secreto del webhook (<code>STRIPE_WEBHOOK_SECRET</code>)</Check>
              {status.stripe.secret_mode && status.stripe.publishable_mode && (status.stripe.secret_mode === 'live') !== (status.stripe.publishable_mode === 'live') &&
                <p className="text-alerta text-sm">La llave secreta y la publicable no son del mismo modo (pruebas vs producción).</p>}
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runTest('stripe')} className={btnSmall}>Probar conexión</button>
              {test.stripe && <span className="text-xs text-zinc-300">{test.stripe}</span>}
            </div>
            {status && <p className="text-zinc-500 text-xs break-all">Webhook para Stripe (eventos payment_intent.*): <span className="text-zinc-300">{status.webhook_urls.stripe}</span></p>}
          </div>
        </Card>
      </div>

      <Msg text={msg?.text ?? null} tone={msg?.tone} />
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar integraciones'}</button>

      <Card title="Otras integraciones">
        {statusError && <p className="text-amarillo-suave text-sm mb-2">No se pudo leer el estado de la función "billing" (¿ya está desplegada?).</p>}
        <div className="space-y-1">
          <Check ok={!!status?.resend}>Correos (Resend): recibos y avisos de cobro</Check>
          <Check ok={true}>Clip: cobro de inscripciones a la competencia</Check>
          <Check ok={!!status?.cron_key}>Llave del cobro automático diario (<code>BILLING_CRON_KEY</code>) — recomendada</Check>
        </div>
        <details className="mt-3 text-sm text-zinc-300">
          <summary className="cursor-pointer text-primario font-bold">Cómo dejar listo el cobro automático (paso a paso)</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1 text-zinc-400">
            <li>En el panel del proveedor copia la llave <b>privada/secreta</b> y ponla en Supabase → Edge Functions → Secrets (<code>OPENPAY_PRIVATE_KEY</code> o <code>STRIPE_SECRET_KEY</code>).</li>
            <li>Aquí pon el ID de comercio y la llave <b>pública</b>, elige el proveedor y guarda.</li>
            <li>Da de alta el webhook con la dirección de arriba (en Stripe copia su secreto <code>whsec_…</code> a <code>STRIPE_WEBHOOK_SECRET</code>; en Openpay el código de verificación aparece en la bitácora).</li>
            <li>Corre el SQL del cobro diario (archivo <code>src/supabase/erp_cron.sql</code>) para que se cobre solo cada mañana.</li>
            <li>Haz una prueba en modo pruebas con una tarjeta de prueba antes de pasar a producción.</li>
          </ol>
        </details>
      </Card>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Ajustes generales
// ---------------------------------------------------------------------------
interface ErpSettings { business_name: string; require_open_cash: boolean; retry_days: number[]; setup_link_days: number; expiring_notice_days: number; receipt_footer: string | null }

export function GeneralSettingsPage() {
  const [s, setS] = useState<ErpSettings | null>(null)
  const [retry, setRetry] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  useEffect(() => {
    call<{ erp: ErpSettings }>('get_erp_settings').then(({ data }) => { if (data?.erp) { setS(data.erp); setRetry(data.erp.retry_days.join(', ')) } })
  }, [])
  if (!s) return <Page title="Ajustes generales"><Spinner /></Page>

  const save = async () => {
    setBusy(true); setMsg(null)
    const days = retry.split(/[,\s]+/).filter(Boolean).map(Number)
    const { error } = await call('admin_update_erp_settings', { p_patch: { ...s, retry_days: days } })
    setBusy(false)
    setMsg(error ? { text: erpError(error), tone: 'error' } : { text: 'Guardado.', tone: 'ok' })
  }

  return (
    <Page title="Ajustes generales">
      <Card>
        <div className="space-y-4">
          <div><label className={label}>Nombre del negocio (aparece en recibos)</label><input value={s.business_name} onChange={e => setS({ ...s, business_name: e.target.value })} className={input} /></div>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={s.require_open_cash} onChange={e => setS({ ...s, require_open_cash: e.target.checked })} className="accent-primario w-4 h-4" />
            Obligar a abrir caja para poder vender o cobrar
          </label>
          <div>
            <label className={label}>Reintentos de cobro rechazado (días después de cada intento)</label>
            <input value={retry} onChange={e => setRetry(e.target.value)} className={`${input} max-w-xs`} placeholder="1, 3, 5" />
            <p className="text-zinc-500 text-xs mt-1">Ej. "1, 3, 5": si el cobro falla, se reintenta al día siguiente, luego 3 días después y luego 5. Después de eso, ya no se intenta solo.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Vigencia del link de tarjeta (días)</label><input type="number" min={1} value={s.setup_link_days} onChange={e => setS({ ...s, setup_link_days: Number(e.target.value) })} className={input} /></div>
            <div><label className={label}>Avisar membresías que vencen en (días)</label><input type="number" min={1} value={s.expiring_notice_days} onChange={e => setS({ ...s, expiring_notice_days: Number(e.target.value) })} className={input} /></div>
          </div>
          <div><label className={label}>Pie de recibo (opcional)</label><input value={s.receipt_footer ?? ''} onChange={e => setS({ ...s, receipt_footer: e.target.value })} className={input} /></div>
          <Msg text={msg?.text ?? null} tone={msg?.tone} />
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </Card>
      <p className="text-zinc-500 text-xs">Las reglas de clases (cancelación, clase gratis, sobrecupo) están en Clases → Configuración.</p>
      <button onClick={() => window.history.back()} className={btnGhost}>Volver</button>
    </Page>
  )
}
