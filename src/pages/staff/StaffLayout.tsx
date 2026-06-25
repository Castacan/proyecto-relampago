import { Outlet, NavLink } from 'react-router-dom'
import { signOut } from '../../lib/auth'

export default function StaffLayout() {
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Top header — slim */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-zinc-800/60">
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400 text-base">⚡</span>
          <span className="text-white font-bold text-sm tracking-wide">Relámpago</span>
          <span className="text-zinc-600 text-xs ml-1">staff</span>
        </div>
        <button
          onClick={signOut}
          className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs px-2 py-1 rounded-md hover:bg-zinc-800"
        >
          Salir
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden pb-14">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-14 bg-zinc-900 border-t border-zinc-800/60 flex z-40">
        <NavLink
          to="/staff"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-yellow-400' : 'text-zinc-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>Muro</span>
            </>
          )}
        </NavLink>

        <NavLink
          to="/staff/qr"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-yellow-400' : 'text-zinc-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
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
