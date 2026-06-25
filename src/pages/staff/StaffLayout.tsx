import { Outlet, NavLink } from 'react-router-dom'
import { signOut } from '../../lib/auth'

export default function StaffLayout() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-white font-bold text-lg">⚡ Relámpago</span>
        <div className="flex items-center gap-3">
          <NavLink
            to="/staff"
            end
            className={({ isActive }) =>
              `text-sm px-3 py-1.5 rounded-lg transition-all ${isActive ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`
            }
          >
            Muro
          </NavLink>
          <NavLink
            to="/staff/qr"
            className={({ isActive }) =>
              `text-sm px-3 py-1.5 rounded-lg transition-all ${isActive ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`
            }
          >
            QRs
          </NavLink>
          <button onClick={signOut} className="text-zinc-500 text-sm hover:text-white">
            Salir
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
