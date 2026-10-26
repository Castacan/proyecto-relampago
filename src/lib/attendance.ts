import { supabase } from './supabase'
import { ERP_ERRORS } from './erp'

// Asistencia del staff con selfie + WiFi del muro (erp_asistencia.sql).

export type DayStatus = 'ok' | 'late' | 'absent' | 'absent_late' | 'excused' | 'pending' | 'extra'

export interface AttendanceDay {
  day_date: string; dow: number; start_time: string | null; end_time: string | null
  first_in: string | null; last_out: string | null; minutes_late: number | null; status: DayStatus; excuse: string | null
}
export interface Punch { id: string; kind: 'in' | 'out'; at: string; source: 'phone' | 'admin'; photo_path?: string | null; note?: string | null; ip?: string | null }
export interface Summary { lates: number; absences: number; on_time: number; excused: number; absences_from_lates: number; total_absences: number }
export interface AttendanceSettings {
  tolerance_min: number; absence_min: number; lates_per_absence: number; require_wifi: boolean; counts_from: string; consent_version: number
}
export interface MyAttendance {
  employee: { id: string; full_name: string } | null
  ip: string | null; at_gym: boolean
  today?: string; now?: string; settings?: AttendanceSettings
  needs_consent?: boolean; consent_text?: string
  schedule_today?: { start_time: string; end_time: string | null } | null
  punches_today?: Punch[]
  month?: string; summary?: Summary; days?: AttendanceDay[]
}

export const STATUS: Record<DayStatus, { label: string; cls: string }> = {
  ok: { label: 'A tiempo', cls: 'text-exito bg-exito/10' },
  late: { label: 'Retardo', cls: 'text-amarillo-suave bg-amarillo-suave/10' },
  absent: { label: 'Falta', cls: 'text-alerta bg-alerta/10' },
  absent_late: { label: 'Falta (llegó tarde)', cls: 'text-alerta bg-alerta/10' },
  excused: { label: 'Justificado', cls: 'text-zinc-300 bg-superficie-alta' },
  pending: { label: 'Aún no llega', cls: 'text-zinc-400 bg-superficie-alta' },
  extra: { label: 'Sin horario', cls: 'text-zinc-400 bg-superficie-alta' },
}

export const ATTENDANCE_ERRORS: Record<string, string> = {
  ...ERP_ERRORS,
  not_employee: 'Esta pantalla es para el staff (los admins no checan). Si eres staff, revisa en Empleados que tu ficha no esté dada de baja.',
  consent_required: 'Primero acepta el aviso de uso de tu foto.',
  name_required: 'Escribe tu nombre completo.',
  not_at_gym: 'No estás conectado al WiFi del muro. Conéctate al WiFi (no datos móviles) e intenta de nuevo.',
  photo_required: 'Toma tu foto primero.',
  already_in: 'Ya registraste tu entrada. Lo que sigue es la salida.',
  not_in: 'Primero registra tu entrada.',
  bad_minutes: 'La tolerancia debe ser menor que los minutos para falta.',
  bad_times: 'La hora de salida debe ser después de la de entrada.',
  no_ip: 'No se pudo leer tu red. Intenta de nuevo.',
  reason_required: 'Escribe el motivo.',
}
export const attendanceError = (code?: string | null) => (code && ATTENDANCE_ERRORS[code]) || 'No se pudo completar. Intenta de nuevo.'

const TZ = 'America/Mexico_City'
export const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—'

// Selfie reducida (JPEG ~1000 px) en <fecha>/<empleado>/… — la base revisa ese prefijo.
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    return blob ?? file
  } catch {
    return file
  }
}

export async function uploadSelfie(day: string, employeeId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const blob = await shrink(file)
  if (blob.size > 10 * 1024 * 1024) return { path: null, error: 'La foto pesa más de 10 MB.' }
  const path = `${day}/${employeeId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('asistencia').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) return { path: null, error: 'No se pudo subir la foto. Revisa tu internet e intenta de nuevo.' }
  return { path, error: null }
}
export async function selfieUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('asistencia').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}
