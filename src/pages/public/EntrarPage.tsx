import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, signOut } from '../../lib/auth'
import { setPasswordPending } from '../../lib/passwordPending'
import ClientPasswordAuth from '../../components/auth/ClientPasswordAuth'
import logoHorizontal from '../../assets/logo-horizontal.png'

// /entrar: entrada de clientes (el /login es solo del staff). Sin sesión:
// correo + contraseña o crear cuenta. Con sesión: su menú (clases, datos,
// puntos, contraseña, salir). ?next=/ruta regresa a donde venía.

const tile = 'block w-full text-left rounded-2xl bg-superficie border border-zinc-800/60 hover:border-primario/60 px-4 py-3.5 transition-colors'

export default function EntrarPage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = params.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null

  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <Link to="/clases"><img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" /></Link>
        <Link to="/clases" className="text-zinc-400 hover:text-texto-principal text-xs font-bold">Clases</Link>
      </header>
      <main className="max-w-md mx-auto px-5 py-8 space-y-5">
        {loading ? (
          <p className="text-zinc-500 text-sm">Cargando…</p>
        ) : session?.user ? (
          <>
            <div>
              <h1 className="text-texto-principal font-black text-2xl tracking-tight">Mi cuenta</h1>
              <p className="text-zinc-400 text-sm mt-1">{session.user.email}</p>
            </div>
            <div className="space-y-2">
              <Link to="/clases" className={tile}><p className="text-texto-principal font-bold">Mis clases</p><p className="text-zinc-400 text-xs">Reservar, ver y cancelar mis clases</p></Link>
              <Link to="/registro" className={tile}><p className="text-texto-principal font-bold">Mis datos y firmas</p><p className="text-zinc-400 text-xs">Datos, responsiva y menores a mi cargo</p></Link>
              <Link to="/mi-cuenta" className={tile}><p className="text-texto-principal font-bold">Mis puntos</p><p className="text-zinc-400 text-xs">Rutas encadenadas y leaderboard</p></Link>
              <button onClick={() => setPasswordPending(true)} className={tile}><p className="text-texto-principal font-bold">Contraseña</p><p className="text-zinc-400 text-xs">Crear o cambiar mi contraseña</p></button>
            </div>
            <button onClick={() => signOut()} className="text-zinc-500 hover:text-texto-principal text-sm underline">Salir</button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-texto-principal font-black text-2xl tracking-tight">Entrar</h1>
              <p className="text-zinc-400 text-sm mt-1">Tu cuenta de Jaibamuro: clases, datos y puntos.</p>
            </div>
            <ClientPasswordAuth theme="dark" onAuthed={() => { if (safeNext) navigate(safeNext) }} />
          </>
        )}
      </main>
    </div>
  )
}
