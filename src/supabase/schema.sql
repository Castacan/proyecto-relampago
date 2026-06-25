-- ============================================================
-- Proyecto Relámpago — Schema de base de datos
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- Perfiles de staff (complemento de auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Zonas del muro (para mini-mapa y filtros)
CREATE TABLE IF NOT EXISTS public.zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  order_index     INT NOT NULL,
  map_x           FLOAT NOT NULL,
  map_y           FLOAT NOT NULL,
  canvas_x_start  FLOAT NOT NULL,
  canvas_x_end    FLOAT NOT NULL
);

-- Rutas de boulder
CREATE TABLE IF NOT EXISTS public.routes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  color       TEXT NOT NULL,
  grade       TEXT NOT NULL,
  setter_id   UUID REFERENCES public.profiles(id),
  zone_id     UUID REFERENCES public.zones(id),
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  placed_at   TIMESTAMPTZ DEFAULT NOW(),
  retired_at  TIMESTAMPTZ,
  notes       TEXT,
  blob_path   JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- QR codes (inventario físico reutilizable)
CREATE TABLE IF NOT EXISTS public.qr_codes (
  id          TEXT PRIMARY KEY,
  status      TEXT DEFAULT 'available' CHECK (status IN ('available', 'in_use')),
  route_id    UUID REFERENCES public.routes(id) UNIQUE
);

-- Votos de escaladores
CREATE TABLE IF NOT EXISTS public.votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID REFERENCES public.routes(id) ON DELETE CASCADE,
  value       TEXT NOT NULL CHECK (value IN ('up', 'down')),
  device_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (route_id, device_id)
);

-- Beta (GIFs/videos)
CREATE TABLE IF NOT EXISTS public.betas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID REFERENCES public.routes(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.betas ENABLE ROW LEVEL SECURITY;

-- profiles: solo el propio staff puede leer/editar su perfil
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- zones: lectura pública, escritura solo staff autenticado
CREATE POLICY "zones_read_public" ON public.zones
  FOR SELECT USING (true);
CREATE POLICY "zones_write_staff" ON public.zones
  FOR ALL USING (auth.uid() IS NOT NULL);

-- routes: lectura pública de rutas activas (sin notes, setter_id lo filtra el frontend)
CREATE POLICY "routes_read_public" ON public.routes
  FOR SELECT USING (status = 'active');
CREATE POLICY "routes_all_staff" ON public.routes
  FOR ALL USING (auth.uid() IS NOT NULL);

-- qr_codes: lectura pública para saber a qué ruta apunta
CREATE POLICY "qr_read_public" ON public.qr_codes
  FOR SELECT USING (true);
CREATE POLICY "qr_write_staff" ON public.qr_codes
  FOR ALL USING (auth.uid() IS NOT NULL);

-- votes: cualquiera puede insertar/actualizar su propio voto (por device_id)
CREATE POLICY "votes_insert_public" ON public.votes
  FOR INSERT WITH CHECK (true);
CREATE POLICY "votes_update_own" ON public.votes
  FOR UPDATE USING (true);
CREATE POLICY "votes_read_staff" ON public.votes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- betas: lectura pública del file_url, escritura solo staff
CREATE POLICY "betas_read_public" ON public.betas
  FOR SELECT USING (true);
CREATE POLICY "betas_write_staff" ON public.betas
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Trigger: crear perfil automáticamente al registrar usuario
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
