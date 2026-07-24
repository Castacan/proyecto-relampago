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
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      {/* Branding */}
      <div className="mb-10 text-center">
        <div className="w-18 h-18 bg-yellow-400 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-yellow-400/30">
          <span className="text-4xl">⚡</span>
        </div>
        <h1 className="text-white text-3xl font-black tracking-tight">Jaibamuro</h1>
        <p className="text-zinc-500 text-sm font-medium mt-1.5">Acceso para setters del gym</p>
      </div>

      {/* Form card */}
      <div className="w-full max-w-sm bg-zinc-900 rounded-3xl p-6 border border-zinc-800/80 shadow-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Correo</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3.5 text-sm outline-none border border-zinc-700/50 focus:border-yellow-400/60 focus:ring-2 focus:ring-yellow-400/20 placeholder-zinc-600 transition-all hover:border-zinc-600"
              placeholder="setter@gym.com"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-zinc-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3.5 text-sm outline-none border border-zinc-700/50 focus:border-yellow-400/60 focus:ring-2 focus:ring-yellow-400/20 placeholder-zinc-600 transition-all hover:border-zinc-600"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-400 text-sm font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold rounded-xl py-3.5 text-sm disabled:opacity-50 active:scale-[0.98] transition-all mt-2 shadow-lg shadow-yellow-400/20"
          >
            {loading ? 'Entrando...' : 'Entrar →'}
          </button>
        </form>
      </div>
    </div>
  )
}
