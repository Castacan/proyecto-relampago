import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn } from '../../lib/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const err = await signIn(email, password)
    setLoading(false)
    if (err) {
      setError('Correo o contraseña incorrectos')
    } else {
      navigate('/staff')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-white text-2xl font-bold mb-2">Relámpago</h1>
        <p className="text-zinc-400 text-sm mb-8">Acceso para staff del gimnasio</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-zinc-300 text-sm mb-1">Correo</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="setter@gym.com"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-zinc-300 text-sm mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 text-zinc-950 font-semibold rounded-lg py-3 text-sm disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
