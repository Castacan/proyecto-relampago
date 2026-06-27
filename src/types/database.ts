export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; name: string; role: 'staff' | 'admin'; created_at: string }
        Insert: { id: string; name: string; role?: 'staff' | 'admin'; created_at?: string }
        Update: { name?: string; role?: 'staff' | 'admin' }
        Relationships: []
      }
      zones: {
        Row: {
          id: string
          name: string
          slug: string
          order_index: number
          map_x: number
          map_y: number
          canvas_x_start: number
          canvas_x_end: number
          image_url: string | null
        }
        Insert: { name: string; slug: string; order_index: number; map_x: number; map_y: number; canvas_x_start: number; canvas_x_end: number; image_url?: string | null }
        Update: { name?: string; slug?: string; order_index?: number; map_x?: number; map_y?: number; canvas_x_start?: number; canvas_x_end?: number; image_url?: string | null }
        Relationships: []
      }
      routes: {
        Row: {
          id: string
          color: string
          grade: string
          setter_id: string
          zone_id: string
          status: 'active' | 'retired'
          placed_at: string
          retired_at: string | null
          notes: string | null
          blob_path: { x: number; y: number }[]
        }
        Insert: {
          color: string
          grade: string
          setter_id: string
          zone_id: string
          blob_path: { x: number; y: number }[]
          status?: 'active' | 'retired'
          notes?: string | null
        }
        Update: {
          color?: string
          grade?: string
          setter_id?: string
          zone_id?: string
          status?: 'active' | 'retired'
          placed_at?: string
          retired_at?: string | null
          notes?: string | null
          blob_path?: { x: number; y: number }[]
        }
        Relationships: []
      }
      qr_codes: {
        Row: {
          id: string
          status: 'available' | 'in_use'
          route_id: string | null
        }
        Insert: { id: string; status?: 'available' | 'in_use'; route_id?: string | null }
        Update: { status?: 'available' | 'in_use'; route_id?: string | null }
        Relationships: []
      }
      votes: {
        Row: {
          id: string
          route_id: string
          value: 'up' | 'down'
          device_id: string
          created_at: string
        }
        Insert: { route_id: string; value: 'up' | 'down'; device_id: string }
        Update: { value?: 'up' | 'down' }
        Relationships: []
      }
      betas: {
        Row: {
          id: string
          route_id: string
          file_url: string
          uploaded_by: string
          created_at: string
        }
        Insert: { route_id: string; file_url: string; uploaded_by: string }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
