import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useClimber } from '../../hooks/useClimber'
import { useSpraywallSettings } from '../../hooks/useSpraywallSettings'
import SpraywallForm from '../../components/SpraywallForm'
import ClimberAuthSheet from '../../components/ClimberAuthSheet'

export default function SpraywallProposePage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { climber, loading: climberLoading, refetch: refetchClimber } = useClimber()
  const { settings, loading: settingsLoading } = useSpraywallSettings()
  const [authSheetOpen, setAuthSheetOpen] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  if (settingsLoading || climberLoading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h1 className="text-white font-black text-xl mb-2 tracking-tight">Propuesta enviada</h1>
      <p className="text-zinc-500 text-sm mb-8">El staff la va a revisar antes de que aparezca en el catálogo.</p>
      <Link to="/spraywall" className="px-6 py-3.5 bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold rounded-2xl text-sm shadow-lg shadow-yellow-400/20 active:scale-95 transition-all">
        Volver al Spraywall
      </Link>
    </div>
  )

  if (!session?.user || !climber) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-white font-black text-xl mb-2 tracking-tight">Inicia sesión para proponer</h1>
        <p className="text-zinc-500 text-sm mb-8">Necesitas una cuenta para colocar tu ruta.</p>
        <button
          onClick={() => setAuthSheetOpen(true)}
          className="px-6 py-3.5 bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-bold rounded-2xl text-sm shadow-lg shadow-yellow-400/20 active:scale-95 transition-all"
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

  if (!settings?.photo_url) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8 text-center">
        <p className="text-zinc-500 text-sm">La spraywall todavía no tiene foto configurada.</p>
      </div>
    )
  }

  return (
    <SpraywallForm
      authorRole="climber"
      authorId={climber.id}
      authorName={climber.display_name}
      photoUrl={settings.photo_url}
      photoW={settings.photo_w}
      photoH={settings.photo_h}
      onSave={() => setSubmitted(true)}
      onCancel={() => navigate('/spraywall')}
    />
  )
}
