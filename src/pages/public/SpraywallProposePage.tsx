import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { useSpraywallPhotos } from '../../hooks/useSpraywallPhotos'
import SpraywallForm from '../../components/SpraywallForm'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'

export default function SpraywallProposePage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { climber, loading: climberLoading, refetch: refetchClimber } = useClimber()
  const { current, loading: photosLoading } = useSpraywallPhotos()
  const [authSheetOpen, setAuthSheetOpen] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  if (photosLoading || climberLoading) return (
    <div className="min-h-screen bg-fondo flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-primario border-t-transparent animate-spin" />
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-fondo flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h1 className="text-texto-principal font-black text-xl mb-2 tracking-tight">Propuesta enviada</h1>
      <p className="text-zinc-500 text-sm mb-8">El staff la va a revisar antes de que aparezca en el catálogo.</p>
      <Link to="/spraywall" className="px-6 py-3.5 bg-primario hover:bg-primario-hover text-texto-en-acento font-bold rounded-2xl text-sm shadow-lg shadow-primario/20 active:scale-95 transition-all">
        Volver al Spraywall
      </Link>
    </div>
  )

  if (!session?.user || !climber) {
    return (
      <div className="min-h-screen bg-fondo flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-texto-principal font-black text-xl mb-2 tracking-tight">Inicia sesión para proponer</h1>
        <p className="text-zinc-500 text-sm mb-8">Necesitas una cuenta para colocar tu ruta.</p>
        <button
          onClick={() => setAuthSheetOpen(true)}
          className="px-6 py-3.5 bg-primario hover:bg-primario-hover text-texto-en-acento font-bold rounded-2xl text-sm shadow-lg shadow-primario/20 active:scale-95 transition-all"
        >
          Entrar
        </button>
        <ClimberAuthSheet
          isOpen={authSheetOpen}
          onClose={() => setAuthSheetOpen(false)}
          onDone={() => { setAuthSheetOpen(false); refetchClimber() }}
          startAtSetup={!!session?.user}
        />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-fondo flex items-center justify-center p-8 text-center">
        <p className="text-zinc-500 text-sm">La spraywall todavía no tiene foto configurada.</p>
      </div>
    )
  }

  return (
    <SpraywallForm
      authorRole="climber"
      authorId={climber.id}
      authorName={climber.display_name}
      photoUrl={current.photo_url}
      photoW={current.photo_w}
      photoH={current.photo_h}
      photoId={current.id}
      onSave={() => setSubmitted(true)}
      onCancel={() => navigate('/spraywall')}
    />
  )
}
