import { supabase } from './supabase'
import { ERP_ERRORS } from './erp'

// Checklist diario del staff (erp_checklist.sql).

export type TaskKind = 'normal' | 'cash_open' | 'cash_close' | 'teardown'

export interface DayTask {
  id: string; block_title: string; block_start: string | null; block_end: string | null; block_note: string | null; block_position: number
  text: string; start_time: string | null; end_time: string | null; position: number
  requires_photo: boolean; requires_amount: boolean; requires_note: boolean; required: boolean; kind: TaskKind
  done_at: string | null; done_by: string | null; done_by_name: string | null; photo_path: string | null; amount_cents: number | null; note: string | null
  skipped_reason: string | null; skipped_by: string | null; skipped_by_name: string | null; skipped_at: string | null
}
export interface ChecklistDay {
  date: string; dow: number; today: string; generated: boolean; status: 'open' | 'closed'
  lead_id: string | null; lead_name: string | null; closed_at: string | null; closed_by_name: string | null
  log: { happened: string; pending: string; broken: string } | null
  rules: string; teardown_note: string | null
  teardown_routes: { id: string; route_number: number; color: string; grade: string; zone: string | null; status: string; retired_at: string | null }[]
  tasks: DayTask[]
  notes: { id: string; created_at: string; text: string; photo_path: string | null; by: string | null }[]
  cash: { opened_at: string; opening_cents: number; closed_at: string | null; expected_cents: number | null; counted_cents: number | null; difference_cents: number | null; note: string | null } | null
  cash_open_other_day: boolean
  prev: { date: string; status: string; log: ChecklistDay['log']; lead_name: string | null; notes: string[]; not_done: { text: string; reason: string | null }[] } | null
  is_admin: boolean; me: string
}

export interface TemplateTask {
  id?: string; text: string; start_time: string | null; end_time: string | null; days: number[] | null
  requires_photo: boolean; requires_amount: boolean; requires_note: boolean; required: boolean; kind: TaskKind
}
export interface TemplateBlock {
  id?: string; title: string; start_time: string | null; end_time: string | null; days: number[]; note: string | null; tasks: TemplateTask[]
}

export const DOW_SHORT = ['', 'L', 'M', 'Mi', 'J', 'V', 'S', 'D']
export const DOW_LONG = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export const KIND_LABELS: Record<TaskKind, string> = {
  normal: 'Normal', cash_open: 'Abrir caja (fondo)', cash_close: 'Corte de caja', teardown: 'Desmontaje (rutas)',
}

export const CHECKLIST_ERRORS: Record<string, string> = {
  ...ERP_ERRORS,
  not_today: 'Solo se puede marcar el checklist de hoy.',
  day_closed: 'El turno ya se cerró.',
  photo_required: 'Esta tarea necesita foto.',
  note_required: 'Esta tarea necesita que escribas el reporte.',
  amount_required: 'Escribe el monto.',
  invalid_photo: 'La foto no es de hoy. Vuelve a tomarla.',
  not_yours: 'Solo quien la marcó (o el admin) puede desmarcarla.',
  reason_required: 'Escribe el motivo.',
  already_done: 'Esa tarea ya está hecha.',
  text_required: 'Escribe qué pasó.',
  cash_not_open: 'La caja no está abierta.',
  not_lead: 'Solo el encargado de turno puede cerrarlo.',
  tasks_pending: 'Faltan tareas obligatorias: márcalas o escribe por qué no se hicieron.',
  log_required: 'Llena las 3 líneas de la bitácora (si no hubo nada, escribe "nada").',
  not_in_teardown: 'Esa ruta no está en la lista de desmontaje.',
  already_started: 'Ya hay tareas marcadas ese día; no se puede volver a generar.',
  title_required: 'Cada bloque necesita nombre.',
  days_required: 'Cada bloque necesita al menos un día.',
  task_days: 'Los días de una tarea deben estar dentro de los días de su bloque.',
}
export const checklistError = (code?: string | null) => (code && CHECKLIST_ERRORS[code]) || 'No se pudo completar. Intenta de nuevo.'

export const hhmm = (t: string | null | undefined) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}
export const timeRange = (a: string | null, b: string | null) => (a && b && a !== b ? `${hhmm(a)}–${hhmm(b)}` : hhmm(a))

// Reduce la foto del celular (JPEG ~1600 px) antes de subirla.
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    return blob ?? file
  } catch {
    return file
  }
}

export async function uploadChecklistPhoto(date: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const blob = await shrink(file)
  if (blob.size > 10 * 1024 * 1024) return { path: null, error: 'La foto pesa más de 10 MB.' }
  const path = `${date}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('checklist').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) return { path: null, error: 'No se pudo subir la foto. Revisa tu internet e intenta de nuevo.' }
  return { path, error: null }
}
export async function checklistPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('checklist').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}
