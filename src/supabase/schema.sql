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
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  color         TEXT NOT NULL,
  grade         TEXT NOT NULL,
  setter_id     UUID REFERENCES public.profiles(id),
  zone_id       UUID REFERENCES public.zones(id),
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  placed_at     TIMESTAMPTZ DEFAULT NOW(),
  retired_at    TIMESTAMPTZ,
  notes         TEXT,
  blob_path     JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_number  BIGINT GENERATED ALWAYS AS IDENTITY -- orden real de creación, inmutable (ver migración abajo)
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

-- ============================================================
-- Migración: route_number (2026-07-31)
-- routes.route_number ya existía como tabla en producción antes de esta
-- columna. Se agrega vía backfill manual (no GENERATED ALWAYS AS IDENTITY
-- directo) porque IDENTITY sobre una tabla con filas existentes no
-- garantiza orden por placed_at — usamos ROW_NUMBER() para que el
-- backfill respete el orden cronológico ya conocido, y de ahí en
-- adelante una secuencia normal asigna el siguiente número a cada INSERT.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase:
--
-- ALTER TABLE public.routes ADD COLUMN route_number BIGINT;
--
-- UPDATE public.routes r
-- SET route_number = sub.rn
-- FROM (
--   SELECT id, ROW_NUMBER() OVER (ORDER BY placed_at ASC, id ASC) AS rn
--   FROM public.routes
-- ) sub
-- WHERE r.id = sub.id;
--
-- ALTER TABLE public.routes ALTER COLUMN route_number SET NOT NULL;
--
-- CREATE SEQUENCE IF NOT EXISTS public.routes_route_number_seq
--   OWNED BY public.routes.route_number;
-- SELECT setval('public.routes_route_number_seq', (SELECT COALESCE(MAX(route_number), 0) FROM public.routes));
-- ALTER TABLE public.routes ALTER COLUMN route_number SET DEFAULT nextval('public.routes_route_number_seq');
-- ============================================================

-- ============================================================
-- RPCs: cuenta del cliente (/mi-cuenta)
-- Ya viven en producción (creadas desde el SQL Editor del dashboard,
-- sin pasar por este archivo). Documentadas aquí a partir del
-- "Show definition" del dashboard el 2026-07-24; firma (params/tipos
-- de retorno) reconstruida por inferencia — el dashboard solo mostró
-- el cuerpo, no el CREATE FUNCTION completo. Verificar contra
-- information_schema.routines si se necesita exactitud total.
-- Dependen de las tablas climbers, sends (ver memoria de proyecto),
-- que tampoco están definidas en este schema.sql desactualizado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_day_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_daily_points BIGINT;
  v_monthly_points BIGINT;
  v_daily_rank BIGINT;
  v_monthly_rank BIGINT;
BEGIN
  IF v_uid IS NULL THEN RETURN '{"error":"not_authenticated"}'::JSONB; END IF;
  v_day_start   := date_trunc('day',   now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City';
  v_month_start := date_trunc('month', now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City';
  SELECT COALESCE(SUM(points_daily),   0) INTO v_daily_points   FROM sends WHERE user_id = v_uid AND sent_at >= v_day_start;
  SELECT COALESCE(SUM(points_monthly), 0) INTO v_monthly_points FROM sends WHERE user_id = v_uid AND sent_at >= v_month_start;
  SELECT COUNT(*) + 1 INTO v_daily_rank FROM (
    SELECT s.user_id FROM sends s JOIN climbers c ON c.id = s.user_id
    WHERE s.sent_at >= v_day_start AND c.visible_in_leaderboard = true
    GROUP BY s.user_id HAVING SUM(s.points_daily) > v_daily_points
  ) sub;
  SELECT COUNT(*) + 1 INTO v_monthly_rank FROM (
    SELECT s.user_id FROM sends s JOIN climbers c ON c.id = s.user_id
    WHERE s.sent_at >= v_month_start AND c.visible_in_leaderboard = true AND s.points_monthly > 0
    GROUP BY s.user_id HAVING SUM(s.points_monthly) > v_monthly_points
  ) sub;
  RETURN jsonb_build_object(
    'daily_points',  v_daily_points,
    'monthly_points', v_monthly_points,
    'daily_rank',  CASE WHEN v_daily_points  > 0 THEN v_daily_rank  ELSE NULL END,
    'monthly_rank', CASE WHEN v_monthly_points > 0 THEN v_monthly_rank ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_sends(lim INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  sent_at TIMESTAMPTZ,
  points_daily INT,
  points_monthly INT,
  grade TEXT,
  color TEXT,
  zone_name TEXT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT s.id, s.sent_at, s.points_daily, s.points_monthly, r.grade, r.color, z.name AS zone_name
  FROM sends s
  JOIN routes r ON r.id = s.route_id
  LEFT JOIN zones z ON z.id = r.zone_id
  WHERE s.user_id = auth.uid()
  ORDER BY s.sent_at DESC LIMIT lim;
$$;

-- ============================================================
-- RPC: submit_send (obtenida vía pg_get_functiondef + export CSV,
-- 2026-07-31; actualizada 2026-08-01 con bonus +1 mensual)
-- Firma sin cambios: submit_send(p_route_id uuid, p_device_id text).
-- Reglas de puntos:
--   - points_daily: puntos por grado (V0=1 ... V9=10), una vez al día
--     por ruta (dedup vía `already_sent_today`).
--   - points_monthly: igual, deduplicado por mes; +1 bonus si la ruta
--     enviada fue puesta el mismo día calendario (hora CDMX) que la
--     ruta ACTIVA con route_number más alto (la más reciente de verdad,
--     inmune a placed_at editado). El bonus vive dentro del mismo CASE
--     de dedup mensual, así que si la ruta ya se envió este mes no se
--     otorga de nuevo (evita farmear reenviando la "más nueva" a diario).
-- Requiere scan reciente (<30 min) en `scans` por user_id o device_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_send(p_route_id uuid, p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_uid UUID := auth.uid();
    v_grade TEXT;
    v_route_placed_at TIMESTAMPTZ;
    v_pts INT;
    v_pts_monthly INT;
    v_day_start TIMESTAMPTZ;
    v_month_start TIMESTAMPTZ;
    v_newest_day DATE;
    v_route_day DATE;
    v_bonus INT;
  BEGIN
    IF v_uid IS NULL THEN RETURN '{"error":"not_authenticated"}'::JSONB; END IF;

    SELECT grade, placed_at INTO v_grade, v_route_placed_at
    FROM routes WHERE id = p_route_id AND status = 'active';
    IF NOT FOUND THEN RETURN '{"error":"route_not_found"}'::JSONB; END IF;

    v_day_start   := date_trunc('day',   now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City';
    v_month_start := date_trunc('month', now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City';

    IF NOT EXISTS (
      SELECT 1 FROM scans
      WHERE route_id = p_route_id
        AND (user_id = v_uid OR device_id = p_device_id)
        AND scanned_at > now() - interval '30 minutes'
    ) THEN RETURN '{"error":"no_recent_scan"}'::JSONB; END IF;

    IF EXISTS (
      SELECT 1 FROM sends
      WHERE user_id = v_uid AND route_id = p_route_id AND sent_at >= v_day_start
    ) THEN RETURN '{"error":"already_sent_today"}'::JSONB; END IF;

    v_pts := CASE v_grade
      WHEN 'V0' THEN 1 WHEN 'V1' THEN 2 WHEN 'V2' THEN 3 WHEN 'V3' THEN 4
      WHEN 'V4' THEN 5 WHEN 'V5' THEN 6 WHEN 'V6' THEN 7 WHEN 'V7' THEN 8
      WHEN 'V8' THEN 9 WHEN 'V9' THEN 10 ELSE 1
    END;

    SELECT (placed_at AT TIME ZONE 'America/Mexico_City')::date INTO v_newest_day
    FROM routes WHERE status = 'active' ORDER BY route_number DESC LIMIT 1;
    v_route_day := (v_route_placed_at AT TIME ZONE 'America/Mexico_City')::date;
    v_bonus := CASE WHEN v_route_day = v_newest_day THEN 1 ELSE 0 END;

    v_pts_monthly := CASE WHEN EXISTS (
      SELECT 1 FROM sends
      WHERE user_id = v_uid AND route_id = p_route_id AND sent_at >= v_month_start
    ) THEN 0 ELSE v_pts + v_bonus END;

    INSERT INTO sends(user_id, route_id, points_daily, points_monthly)
    VALUES (v_uid, p_route_id, v_pts, v_pts_monthly);

    RETURN jsonb_build_object('success', true,
      'points_daily', v_pts, 'points_monthly', v_pts_monthly, 'bonus', v_bonus);
  END; $function$;
