import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-fondo flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">🧗</div>
      <h1 className="text-texto-principal font-black text-xl mb-2 tracking-tight">Página no encontrada</h1>
      <p className="text-zinc-500 text-sm mb-8">Esta dirección no existe en Jaibamuro.</p>
      <Link
        to="/muro"
        className="px-6 py-3.5 bg-primario hover:bg-primario-hover text-texto-en-acento font-bold rounded-2xl text-sm shadow-lg shadow-primario/20 active:scale-95 transition-all"
      >
        Ver el muro →
      </Link>
    </div>
  )
}
