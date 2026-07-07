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

export interface ZoneAnchor {
  id: string
  chain_id: string
  zone_a_id: string
  zone_b_id: string
  a_overlap_start: number
  a_overlap_end: number
  b_overlap_start: number
  b_overlap_end: number
}
