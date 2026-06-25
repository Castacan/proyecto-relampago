import { useParams } from 'react-router-dom'

export default function PublicRoutePage() {
  const { qrId } = useParams<{ qrId: string }>()

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">
      <p>Ruta QR {qrId} — próximamente</p>
    </div>
  )
}
