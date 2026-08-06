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
          chain_id: string | null
          chain_position: number
          render_scale: number
          render_y_offset: number
        }
        Insert: {
          name: string
          slug: string
          order_index: number
          map_x: number
          map_y: number
          canvas_x_start: number
          canvas_x_end: number
          image_url?: string | null
          chain_id?: string | null
          chain_position?: number
          render_scale?: number
          render_y_offset?: number
        }
        Update: {
          name?: string
          slug?: string
          order_index?: number
          map_x?: number
          map_y?: number
          canvas_x_start?: number
          canvas_x_end?: number
          image_url?: string | null
          chain_id?: string | null
          chain_position?: number
          render_scale?: number
          render_y_offset?: number
        }
        Relationships: []
      }
      routes: {
        Row: {
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
        Insert: {
          color: string
          grade: string
          setter_id?: string | null
          zone_id: string
          chain_id?: string | null
          blob_path: { x: number; y: number }[]
          status?: 'active' | 'retired'
          notes?: string | null
        }
        Update: {
          color?: string
          grade?: string
          setter_id?: string | null
          zone_id?: string
          chain_id?: string | null
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
      chains: {
        Row: {
          id: string
          name: string
          axis: 'horizontal' | 'vertical'
          entry_from: string | null
        }
        Insert: { name: string; axis?: 'horizontal' | 'vertical'; entry_from?: string | null }
        Update: { name?: string; axis?: 'horizontal' | 'vertical'; entry_from?: string | null }
        Relationships: []
      }
      zone_anchors: {
        Row: {
          id: string
          chain_id: string
          zone_a_id: string
          zone_b_id: string
          a_overlap_start: number
          a_overlap_end: number
          b_overlap_start: number
          b_overlap_end: number
          point_pairs: { a: { x: number; y: number }; b: { x: number; y: number } }[]
        }
        Insert: {
          chain_id: string
          zone_a_id: string
          zone_b_id: string
          a_overlap_start?: number
          a_overlap_end?: number
          b_overlap_start?: number
          b_overlap_end?: number
          point_pairs?: { a: { x: number; y: number }; b: { x: number; y: number } }[]
        }
        Update: {
          a_overlap_start?: number
          a_overlap_end?: number
          b_overlap_start?: number
          b_overlap_end?: number
          point_pairs?: { a: { x: number; y: number }; b: { x: number; y: number } }[]
        }
        Relationships: []
      }
      volumes: {
        Row: {
          id: string
          zone_id: string
          chain_id: string | null
          status: 'active' | 'retired'
          placed_at: string
          retired_at: string | null
          perimeter: { x: number; y: number }[]
          details: { x: number; y: number }[][]
          zone_offsets: Record<string, { dx: number; dy: number }>
          catalog_id: string | null
          rotation: number
          vol_scale: number
        }
        Insert: {
          zone_id: string
          chain_id?: string | null
          perimeter: { x: number; y: number }[]
          details?: { x: number; y: number }[][]
          zone_offsets?: Record<string, { dx: number; dy: number }>
          catalog_id?: string | null
          rotation?: number
          vol_scale?: number
          status?: 'active' | 'retired'
        }
        Update: {
          status?: 'active' | 'retired'
          placed_at?: string
          retired_at?: string | null
          perimeter?: { x: number; y: number }[]
          details?: { x: number; y: number }[][]
          zone_offsets?: Record<string, { dx: number; dy: number }>
          catalog_id?: string | null
          rotation?: number
          vol_scale?: number
        }
        Relationships: []
      }
      volume_catalog: {
        Row: {
          id: string
          name: string
          shape: { x: number; y: number }[]
          details: { x: number; y: number }[][]
          quantity: number | null
          created_at: string
        }
        Insert: {
          name: string
          shape: { x: number; y: number }[]
          details?: { x: number; y: number }[][]
          quantity?: number | null
        }
        Update: {
          name?: string
          shape?: { x: number; y: number }[]
          details?: { x: number; y: number }[][]
          quantity?: number | null
        }
        Relationships: []
      }
      climbers: {
        Row: {
          id: string
          email: string
          display_name: string
          visible_in_leaderboard: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          display_name: string
          visible_in_leaderboard?: boolean
          updated_at?: string
        }
        Update: {
          email?: string
          display_name?: string
          visible_in_leaderboard?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      scans: {
        Row: {
          id: string
          user_id: string | null
          device_id: string
          route_id: string
          scanned_at: string
        }
        Insert: { user_id?: string | null; device_id: string; route_id: string }
        Update: Record<string, never>
        Relationships: []
      }
      sends: {
        Row: {
          id: string
          user_id: string
          route_id: string
          sent_at: string
          points_daily: number
          points_monthly: number
        }
        Insert: { user_id: string; route_id: string; points_daily: number; points_monthly: number }
        Update: Record<string, never>
        Relationships: []
      }
      spraywall_settings: {
        Row: {
          id: boolean
          photo_url: string | null
          photo_w: number | null
          photo_h: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          photo_url?: string | null
          photo_w?: number | null
          photo_h?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          photo_url?: string | null
          photo_w?: number | null
          photo_h?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spraywall_routes: {
        Row: {
          id: string
          name: string
          grade: string
          setter_name: string
          notes: string | null
          holds: { x: number; y: number; role: 'top' | 'disponible' | 'inicio_pie' | 'inicio_mano'; label?: string }[]
          status: 'pending' | 'active' | 'retired' | 'rejected'
          created_by_profile_id: string | null
          created_by_climber_id: string | null
          created_at: string
          updated_at: string
          retired_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          name: string
          grade: string
          setter_name: string
          notes?: string | null
          holds?: { x: number; y: number; role: 'top' | 'disponible' | 'inicio_pie' | 'inicio_mano'; label?: string }[]
          status?: 'pending' | 'active' | 'retired' | 'rejected'
          created_by_profile_id?: string | null
          created_by_climber_id?: string | null
        }
        Update: {
          name?: string
          grade?: string
          setter_name?: string
          notes?: string | null
          holds?: { x: number; y: number; role: 'top' | 'disponible' | 'inicio_pie' | 'inicio_mano'; label?: string }[]
          status?: 'pending' | 'active' | 'retired' | 'rejected'
          retired_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: []
      }
      spraywall_sends: {
        Row: {
          id: string
          route_id: string
          climber_id: string
          sent_at: string
        }
        Insert: { route_id: string; climber_id: string; sent_at?: string }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
