export interface Zone {
  id: string
  name: string
  slug: string
  order_index: number
  map_x: number
  map_y: number
  canvas_x_start: number
  canvas_x_end: number
  image_url: string | null
  chain_id: string | null
  chain_position: number
  render_scale: number
  render_y_offset: number
}

export interface Route {
  id: string
  color: string
  grade: string
  setter_id: string | null
  zone_id: string
  chain_id: string | null
  status: 'active' | 'retired'
  placed_at: string
  retired_at: string | null
  notes: string | null
  blob_path: { x: number; y: number }[]
  route_number: number
}

export interface Profile {
  id: string
  name: string
  role: 'staff' | 'admin'
  created_at: string
}

export interface Chain {
  id: string
  name: string
  axis: 'horizontal' | 'vertical'
  entry_from: string | null
}

export interface PointPair {
  a: { x: number; y: number }
  b: { x: number; y: number }
}

export interface ZoneAnchor {
  id: string
  chain_id: string
  zone_a_id: string
  zone_b_id: string
  a_overlap_start: number
  a_overlap_end: number
  b_overlap_start: number
  b_overlap_end: number
  point_pairs: PointPair[]
}

export interface Volume {
  id: string
  zone_id: string
  chain_id: string | null
  status: 'active' | 'retired'
  placed_at: string
  retired_at: string | null
  perimeter: { x: number; y: number }[]
  details: { x: number; y: number }[][]
  zone_offsets?: Record<string, { dx: number; dy: number }>
  catalog_id?: string | null
  rotation?: number
  vol_scale?: number
}

export interface VolumeCatalogItem {
  id: string
  name: string
  shape: { x: number; y: number }[]
  details: { x: number; y: number }[][]
  quantity: number | null
  created_at: string
}

export interface Climber {
  id: string
  email: string
  display_name: string
  visible_in_leaderboard: boolean
  created_at: string
}

export interface Send {
  id: string
  user_id: string
  route_id: string
  sent_at: string
  points_daily: number
  points_monthly: number
}

export interface LeaderboardEntry {
  display_name: string
  total_points: number
}

export interface RecentEvent {
  display_name: string
  grade: string
  color: string
  sent_at: string
}

export interface SpraywallHold {
  x: number
  y: number
  role: 'top' | 'disponible' | 'inicio_pie' | 'inicio_mano'
  label?: string
}

export interface SpraywallPhoto {
  id: string
  photo_url: string
  photo_w: number
  photo_h: number
  created_at: string
}

export interface SpraywallRoute {
  id: string
  name: string
  grade: string
  setter_name: string
  notes: string | null
  holds: SpraywallHold[]
  status: 'pending' | 'active' | 'retired' | 'rejected'
  created_by_profile_id: string | null
  created_by_climber_id: string | null
  created_at: string
  updated_at: string
  retired_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  photo_id: string | null
  // Join embebido (spraywall_routes.photo_id → spraywall_photos.id) — la
  // foto CON LA QUE SE MARCÓ esta ruta específica, no necesariamente la
  // más reciente (2026-08-26, ver comentario en schema.sql). Null solo
  // para filas viejas de antes de esta migración (no debería haber
  // ninguna en producción a esta fecha).
  photo: { photo_url: string; photo_w: number; photo_h: number } | null
}

export interface SpraywallSend {
  id: string
  route_id: string
  climber_id: string
  sent_at: string
}

export type SponsorPeriod = 'top_1_daily' | 'top_1_weekly' | 'top_1_monthly'

export interface Sponsorship {
  id: string
  sponsor_name: string
  sponsor_logo: string
  prize_text: string
  winner_rule: SponsorPeriod
  starts_at: string
  ends_at: string
  is_active: boolean
  winner_user_id: string | null
  prize_delivered: boolean
  created_at: string
  winner?: { display_name: string } | null
}

export interface DisplaySlide {
  id: string
  title: string
  image_url: string
  overlay_text: string | null
  display_seconds: number
  sort_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

export interface DisplaySettingsMap {
  slide_interval_seconds: number
  fade_duration_ms: number
}
