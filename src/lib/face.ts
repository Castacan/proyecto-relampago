// Reconocimiento facial en el navegador (erp_recepcion.sql).
// face-api se carga solo en las pantallas que lo usan (≈1 MB + 13 MB de modelos
// en /models/face, que el navegador guarda en caché).

type FaceApi = typeof import('@vladmandic/face-api')

let api: Promise<FaceApi> | null = null
export function loadFaceApi(): Promise<FaceApi> {
  if (!api) {
    api = (async () => {
      const faceapi = await import('@vladmandic/face-api')
      await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready()
      const url = '/models/face'
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        faceapi.nets.faceLandmark68Net.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
      ])
      // La primera detección compila todo en la tarjeta de video (~10 s): se hace aquí.
      const warm = document.createElement('canvas')
      warm.width = 320; warm.height = 240
      await faceapi.detectAllFaces(warm, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 })).withFaceLandmarks().withFaceDescriptors()
      await faceapi.detectAllFaces(warm, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks().withFaceDescriptors()
      return faceapi
    })()
    api.catch(() => { api = null })
  }
  return api
}

export interface FaceHit { descriptor: Float32Array; box: { x: number; y: number; width: number; height: number }; count: number }

// precise = SSD (más lento, para registrar); si no, el detector chico (para el escaneo continuo).
export async function detectFace(input: HTMLVideoElement | HTMLCanvasElement, precise = false): Promise<FaceHit | null> {
  const faceapi = await loadFaceApi()
  const opts = precise ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }) : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  const all = await faceapi.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors()
  if (all.length === 0) return null
  const best = all.reduce((a, b) => (b.detection.box.area > a.detection.box.area ? b : a))
  const { x, y, width, height } = best.detection.box
  return { descriptor: best.descriptor, box: { x, y, width, height }, count: all.length }
}

export interface IndexedFace { id: string; name: string; d: number[] }

// Distancia euclidiana: < 0.5 es la misma persona con buena confianza.
export const MATCH_THRESHOLD = 0.5
export function bestMatch(desc: Float32Array, faces: IndexedFace[]): { face: IndexedFace; distance: number } | null {
  let best: { face: IndexedFace; distance: number } | null = null
  for (const f of faces) {
    let s = 0
    for (let i = 0; i < 128; i++) { const t = desc[i] - f.d[i]; s += t * t }
    const distance = Math.sqrt(s)
    if (!best || distance < best.distance) best = { face: f, distance }
  }
  return best && best.distance < MATCH_THRESHOLD ? best : null
}

export function averageDescriptors(list: Float32Array[]): number[] {
  const out = new Array(128).fill(0)
  for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i] / list.length
  return out
}

// Cuadro de la cámara a JPEG (para la foto de la ficha).
export function frameToJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  const c = document.createElement('canvas')
  const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
  c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale)
  c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85))
}
