import { useEffect, useRef, useState } from 'react'
import { call, erpError, uploadExpedienteFile } from '../../lib/erp'
import { loadFaceApi, detectFace, bestMatch, averageDescriptors, frameToJpeg, type IndexedFace } from '../../lib/face'
import { btnPrimary, btnGhost, Msg } from './ui'

// Webcam de recepción: escaneo continuo (FaceScanner) y registro de la cara de
// una persona (FaceEnroll). Todo corre en el navegador.

function useWebcam() {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        if (ref.current) { ref.current.srcObject = s; ref.current.play().then(() => setReady(true)).catch(() => setReady(true)) }
      })
      .catch(() => setError('No se pudo abrir la cámara. Revisa que la webcam esté conectada y que el navegador tenga permiso.'))
    if (!navigator.mediaDevices) setError('Este navegador no permite usar la cámara (se necesita https).')
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return { ref, ready, error }
}

function useModels() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => { loadFaceApi().then(() => setState('ready')).catch(() => setState('error')) }, [])
  return state
}

export function FaceScanner({ faces, paused, onMatch }: {
  faces: IndexedFace[]; paused: boolean; onMatch: (id: string, distance: number) => void
}) {
  const { ref, ready, error } = useWebcam()
  const models = useModels()
  const [status, setStatus] = useState<'searching' | 'unknown' | 'several' | 'match'>('searching')
  const last = useRef<{ id: string | null; n: number; misses: number }>({ id: null, n: 0, misses: 0 })
  const facesRef = useRef(faces); facesRef.current = faces
  const pausedRef = useRef(paused); pausedRef.current = paused
  const onMatchRef = useRef(onMatch); onMatchRef.current = onMatch

  useEffect(() => {
    if (!ready || models !== 'ready') return
    let stop = false
    const tick = async () => {
      if (stop) return
      const v = ref.current
      if (!pausedRef.current && v && v.readyState >= 2) {
        try {
          const hit = await detectFace(v)
          if (!hit) { last.current = { id: null, n: 0, misses: 0 }; setStatus('searching') }
          else {
            const m = bestMatch(hit.descriptor, facesRef.current)
            if (!m) {
              last.current.misses++
              last.current.id = null; last.current.n = 0
              if (last.current.misses >= 3) setStatus(hit.count > 1 ? 'several' : 'unknown')
            } else {
              last.current.misses = 0
              last.current.n = last.current.id === m.face.id ? last.current.n + 1 : 1
              last.current.id = m.face.id
              // Dos cuadros seguidos con la misma persona para no confundir.
              if (last.current.n >= 2) { setStatus('match'); last.current.n = 0; onMatchRef.current(m.face.id, m.distance) }
            }
          }
        } catch { /* cuadro malo: seguir */ }
      }
      setTimeout(tick, 300)
    }
    tick()
    return () => { stop = true }
  }, [ready, models, ref])

  const label = error ? error
    : models === 'loading' ? 'Cargando reconocimiento facial…'
    : models === 'error' ? 'No se pudo cargar el reconocimiento. Recarga la página.'
    : paused ? 'Pausado'
    : status === 'unknown' ? 'No reconozco esta cara: búscalo por nombre (o es cliente nuevo).'
    : status === 'several' ? 'Hay varias caras: que se acerque una persona.'
    : faces.length === 0 ? 'Aún no hay caras registradas.'
    : 'Asómate a la cámara…'
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
      <video ref={ref} muted playsInline className="w-full h-full object-cover -scale-x-100" />
      <p className={`absolute bottom-0 inset-x-0 px-3 py-2 text-sm font-semibold ${status === 'unknown' && !paused ? 'bg-amarillo-suave/90 text-black' : 'bg-black/60 text-white'}`}>{label}</p>
    </div>
  )
}

export function FaceEnroll({ person, faces, onDone, onCancel }: {
  person: { id: string; full_name: string }; faces?: IndexedFace[]; onDone: () => void; onCancel: () => void
}) {
  const { ref, ready, error } = useWebcam()
  const models = useModels()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [similar, setSimilar] = useState<{ name: string; d: number[]; blob: Blob } | null>(null)

  const save = async (d: number[], blob: Blob) => {
    setBusy(true)
    const up = await uploadExpedienteFile('person', person.id, new File([blob], 'cara.jpg', { type: 'image/jpeg' }))
    const { error } = await call('staff_save_face', { p_person_id: person.id, p_descriptor: d, p_photo_path: up.path })
    setBusy(false)
    if (error) { setMsg(error === 'face_consent_required' ? 'Primero tiene que firmar el aviso de privacidad (en su celular o en su ficha → Documentos).' : erpError(error)); return }
    onDone()
  }

  const capture = async () => {
    const v = ref.current
    if (!v) return
    setBusy(true); setMsg(null); setSimilar(null)
    const samples: Float32Array[] = []
    for (let i = 0; i < 6 && samples.length < 3; i++) {
      const hit = await detectFace(v, true)
      if (hit && hit.count > 1) { setBusy(false); setMsg('Hay más de una cara en la cámara. Que solo salga la persona.'); return }
      if (hit) samples.push(hit.descriptor)
      await new Promise(r => setTimeout(r, 250))
    }
    if (samples.length < 3) { setBusy(false); setMsg('No se ve bien la cara. Que mire de frente a la cámara, con buena luz y sin lentes oscuros ni gorra.'); return }
    const d = averageDescriptors(samples)
    const blob = await frameToJpeg(v)
    setBusy(false)
    if (!blob) { setMsg('No se pudo tomar la foto.'); return }
    const other = bestMatch(Float32Array.from(d), (faces ?? []).filter(f => f.id !== person.id))
    if (other) { setSimilar({ name: other.face.name, d, blob }); return }
    save(d, blob)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-xl bg-superficie rounded-3xl border border-zinc-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-texto-principal font-bold text-lg">Foto de {person.full_name}</h2>
          <button onClick={onCancel} className="text-zinc-400 text-2xl leading-none px-1">×</button>
        </div>
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
          <video ref={ref} muted playsInline className="w-full h-full object-cover -scale-x-100" />
          {(!ready || models !== 'ready') && <p className="absolute inset-0 grid place-items-center text-white text-sm">{error ?? (models === 'error' ? 'No se pudo cargar el reconocimiento.' : 'Preparando cámara…')}</p>}
        </div>
        <p className="text-zinc-400 text-xs">Que mire de frente, sin gorra ni lentes oscuros. Se guarda la foto en su ficha y su huella facial para reconocerlo la próxima vez.</p>
        {similar ? (
          <div className="rounded-xl border border-amarillo-suave/50 bg-amarillo-suave/10 p-3 space-y-2">
            <p className="text-amarillo-suave text-sm font-semibold">Esta cara se parece mucho a la de {similar.name}. ¿Seguro que es {person.full_name}?</p>
            <div className="flex gap-2">
              <button onClick={() => save(similar.d, similar.blob)} disabled={busy} className={btnPrimary}>Sí, guardar</button>
              <button onClick={() => setSimilar(null)} className={btnGhost}>Volver a tomar</button>
            </div>
          </div>
        ) : (
          <button onClick={capture} disabled={busy || !ready || models !== 'ready'} className={`${btnPrimary} w-full py-3.5`}>{busy ? 'Tomando…' : '📷 Tomar foto'}</button>
        )}
        <Msg text={msg} />
      </div>
    </div>
  )
}
