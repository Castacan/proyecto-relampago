export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; name: string; created_at: string }
        Insert: { id: string; name: string; created_at?: string }
        Update: { name?: string }
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
        }
        Insert: Omit<Database['public']['Tables']['zones']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['zones']['Insert']>
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
        Insert: Omit<Database['public']['Tables']['routes']['Row'], 'id' | 'placed_at' | 'retired_at' | 'status'> & {
          status?: 'active' | 'retired'
        }
        Update: Partial<Database['public']['Tables']['routes']['Row']>
      }
      qr_codes: {
        Row: {
          id: string
          status: 'available' | 'in_use'
          route_id: string | null
        }
        Insert: { id: string; status?: 'available' | 'in_use'; route_id?: string | null }
        Update: { status?: 'available' | 'in_use'; route_id?: string | null }
      }
      votes: {
        Row: {
          id: string
          route_id: string
          value: 'up' | 'down'
          device_id: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['votes']['Row'], 'id' | 'created_at'>
        Update: { value?: 'up' | 'down' }
      }
      betas: {
        Row: {
          id: string
          route_id: string
          file_url: string
          uploaded_by: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['betas']['Row'], 'id' | 'created_at'>
        Update: never
      }
    }
  }
}
