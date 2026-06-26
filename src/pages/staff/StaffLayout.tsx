import { Outlet, NavLink } from 'react-router-dom'
import { signOut } from '../../lib/auth'

export default function StaffLayout() {
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Top header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-13 border-b border-zinc-800/60 bg-zinc-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-yellow-400 rounded-lg flex items-center justify-center">
            <span className="text-sm leading-none">⚡</span>
          </div>
          <span className="text-white font-bold text-sm tracking-tight">Relámpago</span>
          <span className="text-zinc-600 text-[11px] font-medium bg-zinc-800 px-1.5 py-0.5 rounded-md ml-0.5">staff</span>
        </div>
        <button
          onClick={signOut}
          className="text-zinc-400 hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-all"
        >
          Salir
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden pb-16">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800/60 flex z-40">
        <NavLink
          to="/staff"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-all relative ${
              isActive ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <div className="absolute top-0 left-6 right-6 h-0.5 bg-yellow-400 rounded-full" />
              )}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <span>Muro</span>
            </>
          )}
        </NavLink>

        <NavLink
          to="/staff/qr"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-all relative ${
              isActive ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <div className="absolute top-0 left-6 right-6 h-0.5 bg-yellow-400 rounded-full" />
              )}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
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
            </>
          )}
        </NavLink>
      </nav>
    </div>
  )
}
