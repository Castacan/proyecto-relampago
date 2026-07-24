import { Outlet, NavLink } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { useProfile } from '../../hooks/useProfile'

export default function StaffLayout() {
  const { profile } = useProfile()
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Top header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-zinc-800/60 bg-zinc-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-yellow-400 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-sm leading-none">⚡</span>
          </div>
          <span className="text-white font-bold text-sm tracking-tight">Jaibamuro</span>
          <span className="text-zinc-600 text-[11px] font-medium bg-zinc-800 px-1.5 py-0.5 rounded-md ml-0.5">staff</span>
        </div>
        <button
          onClick={signOut}
          className="text-zinc-400 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 transition-all"
        >
          Salir
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden min-h-0 pb-16">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-zinc-950 border-t border-zinc-800 flex items-center justify-around px-6 z-40">
        <NavLink to="/staff" end className="flex-1 flex justify-center">
          {({ isActive }) => (
            <div className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all text-sm font-bold ${
              isActive
                ? 'bg-yellow-400 text-zinc-950 shadow-lg shadow-yellow-400/25'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700'
            }`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <span>Muro</span>
            </div>
          )}
        </NavLink>

        <NavLink to="/staff/qr" className="flex-1 flex justify-center">
          {({ isActive }) => (
            <div className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all text-sm font-bold ${
              isActive
                ? 'bg-yellow-400 text-zinc-950 shadow-lg shadow-yellow-400/25'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700'
            }`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect x="7" y="7" width="3" height="3" />
                <rect x="14" y="7" width="3" height="3" />
                <rect x="7" y="14" width="3" height="3" />
                <path d="M14 14h3v3" />
              </svg>
              <span>QRs</span>
            </div>
          )}
        </NavLink>

        {isAdmin && <NavLink to="/staff/stats" className="flex-1 flex justify-center">
          {({ isActive }) => (
            <div className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all text-sm font-bold ${
              isActive
                ? 'bg-yellow-400 text-zinc-950 shadow-lg shadow-yellow-400/25'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700'
            }`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="12" width="4" height="10" rx="1" />
                <rect x="10" y="7" width="4" height="15" rx="1" />
                <rect x="17" y="2" width="4" height="20" rx="1" />
              </svg>
              <span>Stats</span>
            </div>
          )}
        </NavLink>}

        {isAdmin && (
          <NavLink to="/staff/admin" className="flex-1 flex justify-center">
            {({ isActive }) => (
              <div className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all text-sm font-bold ${
                isActive
                  ? 'bg-yellow-400 text-zinc-950 shadow-lg shadow-yellow-400/25'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700'
              }`}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2z" />
                  <path d="M12 14c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z" />
                  <circle cx="19" cy="8" r="1.5" />
                  <path d="M19 6v1.5M19 9.5V11M17.2 7l1.3.75M20.8 9.25l1.3.75M17.2 9.25l1.3-.75M20.8 7l1.3-.75" />
                </svg>
                <span>Admin</span>
              </div>
            )}
          </NavLink>
        )}
      </nav>
    </div>
  )
}
