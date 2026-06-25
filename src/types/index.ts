export interface Zone {
  id: string
  name: string
  slug: string
  order_index: number
  map_x: number
  map_y: number
  canvas_x_start: number
  canvas_x_end: number
}

export interface Route {
  id: string
  color: string
  grade: string
  setter_id: string | null
  zone_id: string
  status: 'active' | 'retired'
  placed_at: string
  retired_at: string | null
  notes: string | null
  blob_path: { x: number; y: number }[]
}

export interface Profile {
  id: string
  name: string
  created_at: string
}
