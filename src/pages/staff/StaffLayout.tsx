import { Outlet } from 'react-router-dom'
import { signOut } from '../../lib/auth'

export default function StaffLayout() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-white font-bold text-lg">⚡ Relámpago</span>
        <button
          onClick={signOut}
          className="text-zinc-400 text-sm hover:text-white"
        >
          Salir
        </button>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
