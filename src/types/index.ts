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
