import { useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { isOwner } from '../../lib/owner'
import logoHorizontal from '../../assets/logo-horizontal.png'

// Menú lateral desplegable por secciones (como el de EVO). En pantallas
// grandes queda fijo a la izquierda y se puede encoger a solo íconos; en el
// celular se abre con el botón ☰. Las secciones abiertas se recuerdan.

interface Item { to: string; label: string; icon: string; end?: boolean; show?: boolean; external?: boolean }
interface Group { id: string; label: string; icon: string; items: Item[] }

const ICONS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  cart: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 7v10M18 7v10',
  receipt: 'M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  wall: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2zM19 15h2v2h-2z',
  spray: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 9h.01M15 9h.01M8 14s1.5 2 4 2 4-2 4-2',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  tv: 'M2 7h20v13H2zM17 2l-5 5-5-5',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  box: 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01',
  door: 'M3 21h18M6 21V3h12v18M14 12h.01',
  badge: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21v-1a6 6 0 0 1 12 0v1M18 8h4M20 6v4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4',
  mail: 'M4 4h16v16H4zM22 6l-10 7L2 6',
  chevron: 'M6 9l6 6 6-6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  collapse: 'M15 18l-6-6 6-6',
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={ICONS[name] ?? ICONS.home} />
    </svg>
  )
}

const OPEN_KEY = 'staff-menu-open'
const COMPACT_KEY = 'staff-menu-compact'
function readJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* sin almacenamiento */ } }

export default function StaffLayout() {
  const { profile, email } = useProfile()
  const isAdmin = profile?.role === 'admin'
  const showInsights = isAdmin && isOwner(email)
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [compact, setCompact] = useState<boolean>(() => readJson(COMPACT_KEY, false))
  const [open, setOpen] = useState<Record<string, boolean>>(() => readJson(OPEN_KEY, { clientes: true, ventas: true, finanzas: true, clases: true, muro: true }))

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const groups: Group[] = [
    { id: 'clientes', label: 'Clientes', icon: 'users', items: [
      { to: '/staff/acceso', label: 'Acceso (recepción)', icon: 'door' },
      { to: '/staff/personas', label: 'Personas', icon: 'users' },
      { to: '/staff/domiciliaciones', label: 'Domiciliaciones', icon: 'repeat' },
    ] },
    { id: 'ventas', label: 'Ventas', icon: 'cart', items: [
      { to: '/staff/vender', label: 'Vender', icon: 'cart' },
      { to: '/staff/caja', label: 'Caja', icon: 'cash' },
      { to: '/staff/ventas', label: 'Historial de ventas', icon: 'receipt' },
      { to: '/staff/inventario', label: 'Inventario', icon: 'box' },
    ] },
    { id: 'finanzas', label: 'Finanzas', icon: 'chart', items: [
      { to: '/staff/egresos', label: 'Egresos', icon: 'wallet', show: isAdmin },
      { to: '/staff/reportes', label: 'Reporte del mes', icon: 'chart' },
      { to: '/staff/estados', label: 'Estados financieros', icon: 'receipt', show: isAdmin },
    ] },
    { id: 'equipo', label: 'Equipo', icon: 'users', items: [
      { to: '/staff/turnos', label: 'Turnos y encargados', icon: 'calendar', show: isAdmin },
      { to: '/staff/asistencia/reporte', label: 'Asistencia', icon: 'clock', show: isAdmin },
      { to: '/staff/empleados', label: 'Empleados', icon: 'badge', show: isAdmin },
      { to: '/staff/bitacora', label: 'Bitácora', icon: 'list', show: isAdmin },
    ] },
    { id: 'clases', label: 'Clases', icon: 'calendar', items: [
      { to: '/staff/clases', label: 'Clases y reservas', icon: 'calendar' },
    ] },
    { id: 'muro', label: 'Muro', icon: 'wall', items: [
      { to: '/staff', label: 'Muro', icon: 'wall', end: true },
      { to: '/staff/qr', label: 'QRs', icon: 'qr' },
      { to: '/staff/spraywall', label: 'Spraywall', icon: 'spray' },
      { to: '/staff/sends', label: 'Envíos', icon: 'check', show: isAdmin },
      { to: '/staff/stats', label: 'Stats', icon: 'chart', show: isAdmin },
      { to: '/staff/insights', label: 'Insights', icon: 'bulb', show: showInsights },
    ] },
    { id: 'eventos', label: 'Pantalla y eventos', icon: 'tv', items: [
      { to: '/staff/display', label: 'Pantalla (TV)', icon: 'tv', show: isAdmin },
      { to: '/staff/competencia', label: 'Competencia', icon: 'trophy', show: isAdmin },
    ] },
    { id: 'config', label: 'Configuración', icon: 'settings', items: [
      { to: '/staff/config/productos', label: 'Productos y planes', icon: 'box', show: isAdmin },
      { to: '/staff/config/integraciones', label: 'Integraciones y pagos', icon: 'plug', show: isAdmin },
      { to: '/staff/config/checklist', label: 'Plantilla del checklist', icon: 'list', show: isAdmin },
      { to: '/staff/config/documentos', label: 'Responsiva y reglamento', icon: 'file', show: isAdmin },
      { to: '/staff/config/correos', label: 'Correos automáticos', icon: 'mail', show: isAdmin },
      { to: '/staff/config/general', label: 'Ajustes generales', icon: 'sliders', show: isAdmin },
      { to: '/staff/admin', label: 'Admin del muro', icon: 'shield', show: isAdmin },
    ] },
  ].map(g => ({ ...g, items: g.items.filter(i => i.show !== false) })).filter(g => g.items.length > 0)

  const toggleGroup = (id: string) => {
    const next = { ...open, [id]: open[id] === false }
    setOpen(next); writeJson(OPEN_KEY, next)
  }
  const toggleCompact = () => { setCompact(c => { writeJson(COMPACT_KEY, !c); return !c }) }

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
      isActive ? 'bg-primario text-texto-en-acento shadow-lg shadow-primario/20' : 'text-zinc-300 hover:bg-superficie-alta hover:text-texto-principal'}`

  const nav = (isCompact: boolean) => (
    <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-3 space-y-1">
      <NavLink to="/staff/inicio" className={({ isActive }) => linkClass(isActive)} title="Inicio">
        <Icon name="home" />{!isCompact && <span>Inicio</span>}
      </NavLink>
      <NavLink to="/staff/turno" end className={({ isActive }) => linkClass(isActive)} title="Turno de hoy">
        <Icon name="check" />{!isCompact && <span>Turno de hoy</span>}
      </NavLink>
      <NavLink to="/staff/asistencia" end className={({ isActive }) => linkClass(isActive)} title="Mi asistencia">
        <Icon name="clock" />{!isCompact && <span>Mi asistencia</span>}
      </NavLink>
      {groups.map(g => (
        <div key={g.id} className="pt-1">
          {isCompact ? (
            <div className="border-t border-zinc-800/80 mx-2 my-1" />
          ) : (
            <button onClick={() => toggleGroup(g.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300">
              <span className="flex-1 text-left">{g.label}</span>
              <span className={`transition-transform ${open[g.id] !== false ? '' : '-rotate-90'}`}><Icon name="chevron" size={14} /></span>
            </button>
          )}
          {(isCompact || open[g.id] !== false) && (
            <div className="space-y-0.5">
              {g.items.map(i => (
                <NavLink key={i.to} to={i.to} end={i.end} title={i.label} className={({ isActive }) => linkClass(isActive)}>
                  <Icon name={i.icon} />{!isCompact && <span className="truncate">{i.label}</span>}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="pt-3">
        <a href="/mi-cuenta" target="_blank" rel="noreferrer" title="Ver la app como cliente" className={linkClass(false)}>
          <Icon name="eye" />{!isCompact && <span>Ver como cliente ↗</span>}
        </a>
      </div>
    </nav>
  )

  return (
    <div className="h-screen bg-fondo flex overflow-hidden">
      {/* Menú fijo (pantallas grandes) */}
      <aside className={`hidden lg:flex flex-col shrink-0 border-r border-zinc-800/60 bg-fondo transition-all ${compact ? 'w-16' : 'w-60'}`}>
        <div className="h-12 flex items-center gap-2 px-3 border-b border-zinc-800/60">
          {!compact && <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />}
          <button onClick={toggleCompact} title={compact ? 'Expandir menú' : 'Encoger menú'}
            className={`text-zinc-400 hover:text-texto-principal p-1.5 rounded-lg hover:bg-superficie-alta ${compact ? 'mx-auto rotate-180' : 'ml-auto'}`}>
            <Icon name="collapse" />
          </button>
        </div>
        {nav(compact)}
        <div className="border-t border-zinc-800/60 p-2">
          {!compact && <button onClick={() => setPwOpen(true)} className="w-full text-left text-zinc-500 hover:text-texto-principal text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-superficie-alta">Cambiar mi contraseña</button>}
          <button onClick={signOut} className={`w-full text-zinc-400 hover:text-texto-principal text-xs font-semibold px-3 py-2 rounded-lg hover:bg-superficie-alta ${compact ? 'text-center' : 'text-left'}`}>
            {compact ? '⏻' : `Salir${profile?.name ? ` · ${profile.name}` : ''}`}
          </button>
        </div>
      </aside>

      {/* Menú del celular */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-fondo border-r border-zinc-800 flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b border-zinc-800/60">
              <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
              <button onClick={() => setMobileOpen(false)} className="text-zinc-400 text-xl px-2">×</button>
            </div>
            {nav(false)}
            <div className="border-t border-zinc-800/60 p-2">
              <button onClick={() => setPwOpen(true)} className="w-full text-left text-zinc-500 hover:text-texto-principal text-xs font-semibold px-3 py-1.5">Cambiar mi contraseña</button>
              <button onClick={signOut} className="w-full text-left text-zinc-400 hover:text-texto-principal text-xs font-semibold px-3 py-2">Salir</button>
            </div>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden shrink-0 flex items-center gap-3 px-3 h-12 border-b border-zinc-800/60 bg-fondo/95">
          <button onClick={() => setMobileOpen(true)} className="text-zinc-200 p-1.5 rounded-lg bg-superficie-alta border border-zinc-700/50" aria-label="Abrir menú">
            <Icon name="menu" />
          </button>
          <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
          <span className="text-zinc-600 text-[11px] font-medium bg-superficie-alta px-1.5 py-0.5 rounded-md">staff</span>
        </header>
        <main className="flex-1 overflow-hidden min-h-0">
          <Outlet />
        </main>
      </div>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

// El staff cambia su propia contraseña (con la sesión ya iniciada).
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (pw.length < 8) { setMsg({ text: 'Mínimo 8 caracteres.', ok: false }); return }
    if (pw !== pw2) { setMsg({ text: 'Las dos contraseñas no coinciden.', ok: false }); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    setMsg(error ? { text: 'No se pudo cambiar. Intenta de nuevo.', ok: false } : { text: 'Listo, tu contraseña cambió.', ok: true })
    if (!error) { setPw(''); setPw2('') }
  }
  const field = 'w-full bg-superficie-alta border border-zinc-700/50 rounded-xl px-3 py-2.5 text-texto-principal text-sm focus:outline-none focus:border-primario/60'
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-superficie rounded-2xl border border-zinc-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="text-texto-principal font-bold">Cambiar mi contraseña</h2>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Contraseña nueva (mín. 8)" autoComplete="new-password" className={field} />
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Repítela" autoComplete="new-password" className={field} />
        {msg && <p className={`text-sm font-semibold ${msg.ok ? 'text-exito' : 'text-alerta'}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-primario text-texto-en-acento font-bold text-sm disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-superficie-alta text-zinc-300 text-sm font-bold">Cerrar</button>
        </div>
      </div>
    </div>
  )
}
