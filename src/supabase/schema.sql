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
-- Documentación retroactiva (2026-08-06): columnas y tablas que ya
-- existen en producción pero nunca se agregaron a este archivo cuando
-- se crearon vía el SQL Editor del dashboard. Nada de esto necesita
-- correrse — es documentación de lo que ya está corrido, usando
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS para que sea
-- seguro re-ejecutar si algún día se necesita reconstruir la base
-- desde cero. Verificado contra datos reales vía REST API directa
-- (curl a /rest/v1/... con la anon key), no adivinado.
-- ============================================================

-- profiles: rol de staff (agregado junto con StatsPage/AdminPage guards)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin'));

-- zones: cadena panorámica + ajustes de render por zona
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS chain_id UUID;
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS chain_position INT NOT NULL DEFAULT 0;
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS render_scale FLOAT NOT NULL DEFAULT 1;
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS render_y_offset FLOAT NOT NULL DEFAULT 0;

-- routes: a qué cadena pertenece (para cross-zone rendering)
ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS chain_id UUID;

-- Cadenas panorámicas (agrupan zonas en una tira horizontal/vertical)
CREATE TABLE IF NOT EXISTS public.chains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  axis        TEXT NOT NULL DEFAULT 'horizontal' CHECK (axis IN ('horizontal', 'vertical')),
  entry_from  UUID REFERENCES public.zones(id)
);

-- Nota: zones.chain_id y routes.chain_id se agregaron arriba como UUID
-- simple, sin FK explícita a chains(id) — no se verificó si producción
-- tiene esa constraint activa. `ALTER TABLE ADD CONSTRAINT` no soporta
-- `IF NOT EXISTS` en PostgreSQL (a diferencia de ADD COLUMN), así que
-- si se necesita agregarla en una reconstrucción desde cero, hacerlo
-- después de crear `chains` con un ALTER TABLE normal (sin IF NOT EXISTS).

-- Calibración por puntos entre cada par de zonas contiguas en una cadena
CREATE TABLE IF NOT EXISTS public.zone_anchors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id          UUID NOT NULL REFERENCES public.chains(id) ON DELETE CASCADE,
  zone_a_id         UUID NOT NULL REFERENCES public.zones(id),
  zone_b_id         UUID NOT NULL REFERENCES public.zones(id),
  a_overlap_start   FLOAT NOT NULL DEFAULT 0.8,
  a_overlap_end     FLOAT NOT NULL DEFAULT 1.0,
  b_overlap_start   FLOAT NOT NULL DEFAULT 0.0,
  b_overlap_end     FLOAT NOT NULL DEFAULT 0.2,
  point_pairs       JSONB NOT NULL DEFAULT '[]'::jsonb
  -- point_pairs: [{ a: {x,y}, b: {x,y} }, ...] máx 8 pares, normalizado 0-1
);

-- Catálogo de formas de volumen reutilizables (dibujadas una vez, colocadas N veces)
-- Debe crearse antes que `volumes`, que la referencia vía catalog_id.
CREATE TABLE IF NOT EXISTS public.volume_catalog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  shape       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{x,y}] normalizado 0-1 en canvas 220×220
  details     JSONB NOT NULL DEFAULT '[]'::jsonb,
  quantity    INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Volúmenes colocados sobre el muro (desde el catálogo)
CREATE TABLE IF NOT EXISTS public.volumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       UUID NOT NULL REFERENCES public.zones(id),
  chain_id      UUID REFERENCES public.chains(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  placed_at     TIMESTAMPTZ DEFAULT NOW(),
  retired_at    TIMESTAMPTZ,
  perimeter     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{x,y}] normalizado 0-1
  details       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [[{x,y}], ...] trazos internos
  zone_offsets  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {zoneId: {dx,dy}} reposicionamiento cross-zone
  catalog_id    UUID REFERENCES public.volume_catalog(id),
  rotation      FLOAT NOT NULL DEFAULT 0,
  vol_scale     FLOAT NOT NULL DEFAULT 1
);

-- Cuentas de clientes (gamificación / leaderboard)
CREATE TABLE IF NOT EXISTS public.climbers (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  visible_in_leaderboard  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Escaneos de QR (ventana de 30 min que habilita submit_send)
CREATE TABLE IF NOT EXISTS public.scans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.climbers(id),
  device_id   TEXT NOT NULL,
  route_id    UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  scanned_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Envíos ("sends") registrados por submit_send — fuente del leaderboard
CREATE TABLE IF NOT EXISTS public.sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.climbers(id) ON DELETE CASCADE,
  route_id        UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  points_daily    INT NOT NULL,
  points_monthly  INT NOT NULL
);

-- RLS: solo se documenta el estado conocido (lectura pública amplia,
-- necesaria para /muro, /q/:qrId y el leaderboard). Las policies
-- exactas de estas 7 tablas no se recuperaron todavía del dashboard
-- (a diferencia de zones/routes/qr_codes/betas, ver hardening abajo) —
-- pendiente si se necesita auditar a fondo.
ALTER TABLE public.chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volume_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.climbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sends ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS hardening (2026-08-06): las policies "solo staff" originales de
-- zones/routes/qr_codes/betas usaban `auth.uid() IS NOT NULL`, que NO
-- distingue staff de climbers (un cliente logueado por magic link
-- también pasa esa condición). Hallazgo de la auditoría de 2026-07-25,
-- corregido aquí con el mismo patrón ya usado en Spraywall:
-- `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())`.
-- SQL a correr en el SQL Editor de Supabase:
-- ============================================================

DROP POLICY IF EXISTS "zones_write_staff" ON public.zones;
CREATE POLICY "zones_write_staff" ON public.zones
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "routes_all_staff" ON public.routes;
CREATE POLICY "routes_all_staff" ON public.routes
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "qr_write_staff" ON public.qr_codes;
CREATE POLICY "qr_write_staff" ON public.qr_codes
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "betas_write_staff" ON public.betas;
CREATE POLICY "betas_write_staff" ON public.betas
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

-- ============================================================
-- RPCs: leaderboard (/leaderboard/display)
-- Ya viven en producción (creadas desde el SQL Editor del dashboard,
-- sin pasar por este archivo). Documentadas aquí a partir de
-- `select proname, pg_get_functiondef(oid) from pg_proc where
-- proname in (...)` exportado como CSV el 2026-08-06 (el copy-paste
-- normal del panel "Show definition" se corta a la mitad en funciones
-- largas, mismo problema que con submit_send). Texto verbatim de la
-- definición real, sin reformatear.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_daily_leaderboard()
 RETURNS TABLE(display_name text, total_points bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT c.display_name, SUM(s.points_daily)
    FROM sends s JOIN climbers c ON c.id = s.user_id    WHERE s.sent_at >= date_trunc('day', now() AT TIME ZONE 'America/Mexico_City')
                        AT TIME ZONE 'America/Mexico_City'      AND c.visible_in_leaderboard = true
    GROUP BY c.id, c.display_name ORDER BY 2 DESC LIMIT 10;
  $function$;

CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard()
 RETURNS TABLE(display_name text, total_points bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT c.display_name, SUM(s.points_monthly)
    FROM sends s JOIN climbers c ON c.id = s.user_id    WHERE s.sent_at >= date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')
                        AT TIME ZONE 'America/Mexico_City'      AND c.visible_in_leaderboard = true
      AND s.points_monthly > 0
    GROUP BY c.id, c.display_name ORDER BY 2 DESC LIMIT 5;
  $function$;

-- get_weekly_leaderboard (2026-08-23): agregado para el leaderboard TV de 3
-- columnas (Hoy/Semana/Mes). Semana calendario lunes-domingo hora CDMX
-- (date_trunc('week', ...) trunca a lunes en Postgres), mismo patrón que
-- día/mes. Usa points_daily (no existe points_weekly ni falta agregarlo:
-- points_daily ya es el valor real de cada send individual, grado + bonus
-- de ruta nueva desde el ajuste de submit_send del mismo día) — sin filtro
-- > 0 porque un send válido siempre tiene points_daily >= 1 (V0 = 1 punto).
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard()
 RETURNS TABLE(display_name text, total_points bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT c.display_name, SUM(s.points_daily)
    FROM sends s JOIN climbers c ON c.id = s.user_id    WHERE s.sent_at >= date_trunc('week', now() AT TIME ZONE 'America/Mexico_City')
                        AT TIME ZONE 'America/Mexico_City'      AND c.visible_in_leaderboard = true
    GROUP BY c.id, c.display_name ORDER BY 2 DESC LIMIT 10;
  $function$;

GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard() TO anon, authenticated;

-- get_leaderboard_for_range (2026-08-23): utilidad para el generador de
-- imagen de ganador en /staff/display → Ganadores → "📸 Crear imagen". A
-- diferencia de get_daily/weekly/monthly_leaderboard (que siempre calculan
-- sobre la ventana relativa a "ahora"), esta recibe un rango arbitrario —
-- necesario porque Ganadores muestra patrocinios YA TERMINADOS, cuya
-- ventana starts_at/ends_at ya no coincide con "esta semana"/"este mes"
-- para cuando el staff genera la imagen días o semanas después.
-- p_monthly=true replica el criterio de determine_sponsorship_winner para
-- 'top_1_monthly' (SUM(points_monthly), filtro > 0); false replica
-- 'top_1_daily'/'top_1_weekly' (SUM(points_daily), sin filtro).
CREATE OR REPLACE FUNCTION public.get_leaderboard_for_range(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_monthly BOOLEAN DEFAULT false, p_limit INT DEFAULT 10)
 RETURNS TABLE(display_name text, total_points bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT c.display_name, SUM(CASE WHEN p_monthly THEN s.points_monthly ELSE s.points_daily END)
    FROM sends s JOIN climbers c ON c.id = s.user_id
    WHERE s.sent_at >= p_start AND s.sent_at <= p_end
      AND c.visible_in_leaderboard = true
      AND (NOT p_monthly OR s.points_monthly > 0)
    GROUP BY c.id, c.display_name ORDER BY 2 DESC LIMIT p_limit;
  $function$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_for_range(TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_recent_events(lim integer DEFAULT 8)
 RETURNS TABLE(display_name text, grade text, color text, sent_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT c.display_name, r.grade, r.color, s.sent_at
    FROM sends s JOIN climbers c ON c.id = s.user_id JOIN routes r ON r.id = s.route_id    WHERE s.sent_at > now() - interval '3 hours'
      AND c.visible_in_leaderboard = true    ORDER BY s.sent_at DESC LIMIT lim;
  $function$;

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
-- Dependen de climbers/sends, documentadas arriba.
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
-- 2026-07-31; actualizada 2026-08-01 con bonus +1 mensual; actualizada
-- 2026-08-23 para que el bonus también cuente en daily/weekly, no solo
-- monthly — ver razón abajo.
-- Firma sin cambios: submit_send(p_route_id uuid, p_device_id text).
-- Reglas de puntos:
--   - points_daily: puntos por grado (V0=1 ... V9=10) + bonus (ver abajo),
--     una vez al día por ruta (dedup vía `already_sent_today` — no hace
--     falta dedup adicional aquí, ya es imposible mandar 2 veces la misma
--     ruta el mismo día).
--   - points_monthly: igual (grado + bonus), pero deduplicado por mes: si
--     la ruta ya se envió este mes, 0.
--   - Bonus (+1): si la ruta enviada fue puesta el mismo día calendario
--     (hora CDMX) que la ruta ACTIVA con route_number más alto (la más
--     reciente de verdad, inmune a placed_at editado). Antes (2026-08-01)
--     solo se sumaba a points_monthly, lo que hacía que Mes se viera más
--     alto que Hoy/Semana en el leaderboard TV de 3 columnas (commit
--     2026-08-23) sin razón visible para el usuario — el usuario pidió
--     que las 3 columnas sumen consistente, así que ahora el bonus cuenta
--     en las 3. Sigue sin poder farmearse: el dedup mensual de arriba ya
--     evita repetir el bonus reenviando la "más nueva" día tras día dentro
--     del mismo mes (el dedup DIARIO ya lo impedía de por sí, por ruta).
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
    v_pts_daily INT;
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

    v_pts_daily := v_pts + v_bonus;

    v_pts_monthly := CASE WHEN EXISTS (
      SELECT 1 FROM sends
      WHERE user_id = v_uid AND route_id = p_route_id AND sent_at >= v_month_start
    ) THEN 0 ELSE v_pts_daily END;

    INSERT INTO sends(user_id, route_id, points_daily, points_monthly)
    VALUES (v_uid, p_route_id, v_pts_daily, v_pts_monthly);

    RETURN jsonb_build_object('success', true,
      'points_daily', v_pts_daily, 'points_monthly', v_pts_monthly, 'bonus', v_bonus);
  END; $function$;

-- ============================================================
-- RPC: get_admin_insights (2026-08-07)
-- Dashboard de datos de clientes/desempeño (/staff/insights).
-- SOLO accesible por el dueño (esz1996mx@gmail.com) — el guard real
-- vive AQUÍ, no en el frontend: la función es SECURITY DEFINER y
-- verifica auth.jwt()->>'email' antes de tocar cualquier tabla, así
-- que aunque el frontend se manipulara, nadie más puede sacar datos
-- de climbers/scans/sends/votes vía este RPC. Cambiar el email acá
-- Y en src/lib/owner.ts si algún día cambia el dueño o se agrega otro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_insights()
 RETURNS JSONB
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_result JSONB;
  BEGIN
    IF lower(auth.jwt() ->> 'email') IS DISTINCT FROM 'esz1996mx@gmail.com' THEN
      RETURN '{"error":"not_authorized"}'::JSONB;
    END IF;

    SELECT jsonb_build_object(
      'climbers_total', (SELECT COUNT(*) FROM climbers),
      'climbers_new_7d', (SELECT COUNT(*) FROM climbers WHERE created_at >= now() - interval '7 days'),
      'climbers_new_30d', (SELECT COUNT(*) FROM climbers WHERE created_at >= now() - interval '30 days'),
      'active_climbers', (SELECT COUNT(DISTINCT user_id) FROM sends),

      'climbers_by_week', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('week_start', week_start, 'count', cnt) ORDER BY week_start), '[]'::jsonb)
        FROM (
          SELECT date_trunc('week', created_at AT TIME ZONE 'America/Mexico_City')::date AS week_start, COUNT(*) AS cnt
          FROM climbers
          WHERE created_at >= now() - interval '56 days'
          GROUP BY 1
        ) w
      ),

      'sends_total', (SELECT COUNT(*) FROM sends),
      'sends_7d', (SELECT COUNT(*) FROM sends WHERE sent_at >= now() - interval '7 days'),
      'sends_30d', (SELECT COUNT(*) FROM sends WHERE sent_at >= now() - interval '30 days'),

      'sends_by_day', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'count', cnt) ORDER BY day), '[]'::jsonb)
        FROM (
          SELECT (sent_at AT TIME ZONE 'America/Mexico_City')::date AS day, COUNT(*) AS cnt
          FROM sends
          WHERE sent_at >= now() - interval '30 days'
          GROUP BY 1
        ) d
      ),

      'scans_30d', (SELECT COUNT(*) FROM scans WHERE scanned_at >= now() - interval '30 days'),

      'top_routes_by_sends', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT r.id AS route_id, r.color, r.grade, z.name AS zone_name, COUNT(s.id) AS send_count
          FROM sends s
          JOIN routes r ON r.id = s.route_id
          LEFT JOIN zones z ON z.id = r.zone_id
          GROUP BY r.id, r.color, r.grade, z.name
          ORDER BY send_count DESC
          LIMIT 10
        ) t
      ),

      'top_routes_by_scans', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT r.id AS route_id, r.color, r.grade, z.name AS zone_name, COUNT(sc.id) AS scan_count
          FROM scans sc
          JOIN routes r ON r.id = sc.route_id
          LEFT JOIN zones z ON z.id = r.zone_id
          GROUP BY r.id, r.color, r.grade, z.name
          ORDER BY scan_count DESC
          LIMIT 10
        ) t
      ),

      'votes_up', (SELECT COUNT(*) FROM votes WHERE value = 'up'),
      'votes_down', (SELECT COUNT(*) FROM votes WHERE value = 'down'),

      'peak_hours', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', hour, 'count', cnt) ORDER BY hour), '[]'::jsonb)
        FROM (
          SELECT EXTRACT(HOUR FROM scanned_at AT TIME ZONE 'America/Mexico_City')::int AS hour, COUNT(*) AS cnt
          FROM scans
          WHERE scanned_at >= now() - interval '30 days'
          GROUP BY 1
        ) h
      ),

      'peak_weekdays', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', dow, 'count', cnt) ORDER BY dow), '[]'::jsonb)
        FROM (
          SELECT EXTRACT(DOW FROM scanned_at AT TIME ZONE 'America/Mexico_City')::int AS dow, COUNT(*) AS cnt
          FROM scans
          WHERE scanned_at >= now() - interval '30 days'
          GROUP BY 1
        ) wd
      ),

      'retained_climbers', (
        SELECT COUNT(*) FROM (
          SELECT user_id
          FROM sends
          GROUP BY user_id
          HAVING COUNT(DISTINCT date_trunc('week', sent_at AT TIME ZONE 'America/Mexico_City')) >= 2
        ) r
      )
    ) INTO v_result;

    RETURN v_result;
  END; $function$;

GRANT EXECUTE ON FUNCTION public.get_admin_insights() TO authenticated;

-- ============================================================
-- Spraywall (2026-08-01)
-- Pared fija de agarres (nunca cambian), una sola foto base
-- compartida por todas las rutas. Sin puntos/leaderboard/QR-scan —
-- solo catálogo público + checklist personal de "enviado" para
-- climbers logueados + propuestas de rutas por clientes (pending
-- hasta aprobación de staff). Tablas propias, no tocan routes/zones
-- del muro principal.
--
-- IMPORTANTE: a diferencia de zones_write_staff/routes_all_staff/
-- qr_write_staff/betas_write_staff (arriba), que usan
-- `auth.uid() IS NOT NULL` para "solo staff" — eso NO distingue
-- staff de climbers, porque climbers.id también es auth.uid() (ver
-- ClimberAuthSheet). Las policies de Spraywall SÍ verifican
-- pertenencia a `profiles` explícitamente.
-- ============================================================

-- Config singleton: foto base compartida por todas las rutas
CREATE TABLE IF NOT EXISTS public.spraywall_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  photo_url   TEXT,
  photo_w     INT,
  photo_h     INT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES public.profiles(id)
);
INSERT INTO public.spraywall_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Rutas del spraywall
CREATE TABLE IF NOT EXISTS public.spraywall_routes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  grade                 TEXT NOT NULL,
  setter_name           TEXT NOT NULL,
  notes                 TEXT,
  holds                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- holds: [{ x: float(0-1), y: float(0-1), role: 'top'|'disponible'|'inicio_pie'|'inicio_mano', label?: string }]
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('pending','active','retired','rejected')),
  created_by_profile_id UUID REFERENCES public.profiles(id),
  created_by_climber_id UUID REFERENCES public.climbers(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  retired_at            TIMESTAMPTZ,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES public.profiles(id),
  CHECK ((created_by_profile_id IS NOT NULL)::int + (created_by_climber_id IS NOT NULL)::int = 1)
);

-- "Enviado" por climber (toggle: DELETE al desmarcar, INSERT nuevo al remarcar)
CREATE TABLE IF NOT EXISTS public.spraywall_sends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID NOT NULL REFERENCES public.spraywall_routes(id) ON DELETE CASCADE,
  climber_id  UUID NOT NULL REFERENCES public.climbers(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (route_id, climber_id)
);

ALTER TABLE public.spraywall_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spraywall_routes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spraywall_sends    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spraywall_settings_read_public" ON public.spraywall_settings
  FOR SELECT USING (true);
CREATE POLICY "spraywall_settings_write_staff" ON public.spraywall_settings
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "spraywall_routes_read_public" ON public.spraywall_routes
  FOR SELECT USING (status = 'active');
CREATE POLICY "spraywall_routes_read_own_climber" ON public.spraywall_routes
  FOR SELECT USING (created_by_climber_id = auth.uid());
CREATE POLICY "spraywall_routes_all_staff" ON public.spraywall_routes
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "spraywall_routes_insert_climber" ON public.spraywall_routes
  FOR INSERT WITH CHECK (
    created_by_climber_id = auth.uid()
    AND created_by_profile_id IS NULL
    AND status = 'pending'
  );

CREATE POLICY "spraywall_sends_own" ON public.spraywall_sends
  FOR ALL USING (climber_id = auth.uid()) WITH CHECK (climber_id = auth.uid());
CREATE POLICY "spraywall_sends_read_staff" ON public.spraywall_sends
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

-- Storage: bucket público para la foto base (primer uso de Storage
-- en este proyecto). Ejecutar junto con lo anterior en el SQL Editor.
insert into storage.buckets (id, name, public)
values ('spraywall-photos', 'spraywall-photos', true)
on conflict (id) do nothing;

create policy "spraywall_photos_write_staff" on storage.objects
  for all using (
    bucket_id = 'spraywall-photos'
    and exists (select 1 from public.profiles where id = auth.uid())
  );

-- ============================================
-- Moderación de sends (admin) — get_recent_sends + delete_send
-- Ejecutado en Supabase 2026-08-09.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_recent_sends(
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  sent_at TIMESTAMPTZ,
  points_daily INT,
  points_monthly INT,
  climber_id UUID,
  display_name TEXT,
  email TEXT,
  route_id UUID,
  grade TEXT,
  color TEXT,
  zone_name TEXT,
  route_number BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RETURN; -- tabla vacía si no es admin
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.sent_at,
    s.points_daily,
    s.points_monthly,
    c.id AS climber_id,
    c.display_name,
    c.email,
    r.id AS route_id,
    r.grade,
    r.color,
    z.name AS zone_name,
    r.route_number
  FROM sends s
  JOIN climbers c ON c.id = s.user_id
  JOIN routes r ON r.id = s.route_id
  LEFT JOIN zones z ON z.id = r.zone_id
  WHERE
    p_search IS NULL
    OR c.display_name ILIKE '%' || p_search || '%'
    OR c.email ILIKE '%' || p_search || '%'
    OR r.grade ILIKE '%' || p_search || '%'
    OR z.name ILIKE '%' || p_search || '%'
  ORDER BY s.sent_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_recent_sends(TEXT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_send(p_send_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_deleted INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN '{"error":"not_authorized"}'::JSONB;
  END IF;

  DELETE FROM sends WHERE id = p_send_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN '{"error":"not_found"}'::JSONB;
  END IF;

  RETURN '{"success":true}'::JSONB;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_send(UUID) TO authenticated;


-- ============================================================
-- Contador de envíos por ruta en /staff/pared (2026-08-24)
-- Cuántas personas distintas han marcado cada ruta como enviada.
-- Abierto a cualquier staff (no solo admin), a diferencia de
-- get_recent_sends/delete_send que son solo-admin.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_route_send_counts(p_route_id UUID DEFAULT NULL)
RETURNS TABLE (
  route_id UUID,
  send_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
  ) THEN
    RETURN; -- tabla vacía si no es staff
  END IF;

  RETURN QUERY
  SELECT s.route_id, COUNT(*) AS send_count
  FROM sends s
  WHERE p_route_id IS NULL OR s.route_id = p_route_id
  GROUP BY s.route_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_route_send_counts(UUID) TO authenticated;


-- ============================================================
-- Historial de ganadores por semana/mes en /staff/display → Ganadores
-- (2026-08-24). Independiente de sponsorships por completo — antes
-- "Ganadores" solo mostraba patrocinios ya terminados (ends_at < now),
-- así que si el premio activo tenía una ventana larga (ej. 12 días en
-- vez de semana calendario) nunca se veía nada aunque sí hubiera
-- participantes. Esto calcula el top 1 real de cada semana/mes
-- calendario (lunes-domingo / día 1 a fin de mes, hora CDMX) directo
-- de sends, mismo criterio que get_weekly/monthly_leaderboard
-- (points_daily sin filtro para semana; points_monthly > 0 para mes).
-- Solo periodos YA TERMINADOS — el actual en curso ya se muestra aparte
-- vía get_weekly/monthly_leaderboard. Se "actualiza solo" cada semana/mes
-- porque no hay nada guardado: se recalcula desde sends en cada llamada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_weekly_winners_history(p_limit INT DEFAULT 8)
RETURNS TABLE (
  period_start DATE,
  period_end DATE,
  display_name TEXT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  WITH weekly AS (
    SELECT
      date_trunc('week', s.sent_at AT TIME ZONE 'America/Mexico_City')::date AS week_start,
      c.id AS climber_id,
      c.display_name,
      SUM(s.points_daily) AS total_points
    FROM sends s
    JOIN climbers c ON c.id = s.user_id
    WHERE c.visible_in_leaderboard = true
    GROUP BY 1, c.id, c.display_name
  ),
  ranked AS (
    SELECT weekly.*, ROW_NUMBER() OVER (PARTITION BY week_start ORDER BY total_points DESC) AS rn
    FROM weekly
  )
  SELECT week_start, (week_start + interval '6 days')::date, display_name, total_points
  FROM ranked
  WHERE rn = 1
    AND week_start < date_trunc('week', now() AT TIME ZONE 'America/Mexico_City')::date
  ORDER BY week_start DESC
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_weekly_winners_history(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_monthly_winners_history(p_limit INT DEFAULT 6)
RETURNS TABLE (
  period_start DATE,
  period_end DATE,
  display_name TEXT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  WITH monthly AS (
    SELECT
      date_trunc('month', s.sent_at AT TIME ZONE 'America/Mexico_City')::date AS month_start,
      c.id AS climber_id,
      c.display_name,
      SUM(s.points_monthly) AS total_points
    FROM sends s
    JOIN climbers c ON c.id = s.user_id
    WHERE c.visible_in_leaderboard = true AND s.points_monthly > 0
    GROUP BY 1, c.id, c.display_name
  ),
  ranked AS (
    SELECT monthly.*, ROW_NUMBER() OVER (PARTITION BY month_start ORDER BY total_points DESC) AS rn
    FROM monthly
  )
  SELECT month_start, (month_start + interval '1 month' - interval '1 day')::date, display_name, total_points
  FROM ranked
  WHERE rn = 1
    AND month_start < date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')::date
  ORDER BY month_start DESC
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_monthly_winners_history(INT) TO anon, authenticated;


-- ============================================================
-- Patrocinadores y Slides en Pantalla (2026-08-19)
-- Dos features nuevas para /leaderboard/display + /leaderboard:
-- banner de patrocinador del mes (ligado al leaderboard mensual
-- existente) y carrusel de slides rotatorios en la TV.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsorships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name      TEXT NOT NULL,
  sponsor_logo      TEXT NOT NULL,
  prize_text        TEXT NOT NULL,
  winner_rule       TEXT NOT NULL DEFAULT 'top_1_monthly' CHECK (winner_rule IN ('top_1_daily', 'top_1_weekly', 'top_1_monthly')),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  winner_user_id    UUID REFERENCES public.climbers(id),
  prize_delivered   BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.display_slides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  image_url         TEXT NOT NULL,
  overlay_text      TEXT,
  display_seconds   INT NOT NULL DEFAULT 8 CHECK (display_seconds > 0),
  sort_order        INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.display_settings (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key   TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL
);
INSERT INTO public.display_settings (key, value) VALUES
  ('slide_interval_seconds', '60'),
  ('fade_duration_ms', '500')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.sponsorships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_slides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_settings ENABLE ROW LEVEL SECURITY;

-- Lectura pública (TV sin auth + móvil), escritura solo admin (hay dinero/
-- premios de por medio → mismo nivel que Stats/Admin/Sends/Insights, no el
-- patrón laxo "cualquier staff" que usa Spraywall).
CREATE POLICY "sponsorships_read_public" ON public.sponsorships FOR SELECT USING (true);
CREATE POLICY "sponsorships_write_admin" ON public.sponsorships FOR ALL
  USING       (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK  (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "display_slides_read_public" ON public.display_slides FOR SELECT USING (true);
CREATE POLICY "display_slides_write_admin" ON public.display_slides FOR ALL
  USING       (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK  (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "display_settings_read_public" ON public.display_settings FOR SELECT USING (true);
CREATE POLICY "display_settings_write_admin" ON public.display_settings FOR ALL
  USING       (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK  (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Storage: bucket público para logos e imágenes de slides. A diferencia de
-- spraywall-photos (singleton, upsert:true sobre 'base.jpg'), aquí cada fila
-- es su propia imagen → nombre único por archivo bajo sponsors/ o slides/.
insert into storage.buckets (id, name, public)
values ('display-assets', 'display-assets', true)
on conflict (id) do nothing;

create policy "display_assets_write_admin" on storage.objects
  for all using (
    bucket_id = 'display-assets'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- RPC: determine_sponsorship_winner
-- Llamable por anon (la TV no tiene auth, igual que get_daily_leaderboard/
-- get_monthly_leaderboard/get_recent_events) pero calcula el ganador de
-- forma independiente — un caller anónimo no puede forjarlo.
-- Solo climbers con visible_in_leaderboard=true son elegibles (decisión
-- confirmada por el usuario 2026-08-19): si el líder mensual tiene el
-- ranking oculto, no gana hasta que lo active. Sus puntos se siguen
-- acumulando igual mientras tanto (visible_in_leaderboard solo filtra qué
-- se muestra, nunca lo que se guarda).
-- Empate: gana quien llegó primero a esa cantidad de puntos (MAX(sent_at)
-- más temprano entre los empatados en el máximo de puntos).
-- Ampliado (2026-08-23) para leaderboard TV de 3 columnas: winner_rule ahora
-- también puede ser 'top_1_daily'/'top_1_weekly', que suman points_daily
-- (el valor real de cada send, grado + bonus de ruta nueva del mismo día)
-- en vez de points_monthly. 'top_1_monthly' conserva exactamente la lógica
-- original (SUM(points_monthly), filtro > 0).
-- ============================================================
CREATE OR REPLACE FUNCTION public.determine_sponsorship_winner()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_sp RECORD;
  v_winner UUID;
  v_results JSONB := '[]'::jsonb;
BEGIN
  FOR v_sp IN
    SELECT * FROM public.sponsorships
    WHERE winner_user_id IS NULL
      AND is_active = true
      AND ends_at < now()
  LOOP
    IF v_sp.winner_rule = 'top_1_monthly' THEN
      SELECT s.user_id INTO v_winner
      FROM public.sends s
      JOIN public.climbers c ON c.id = s.user_id
      WHERE s.sent_at >= v_sp.starts_at
        AND s.sent_at <= v_sp.ends_at
        AND c.visible_in_leaderboard = true
        AND s.points_monthly > 0
      GROUP BY s.user_id
      ORDER BY SUM(s.points_monthly) DESC, MAX(s.sent_at) ASC
      LIMIT 1;
    ELSE -- top_1_daily / top_1_weekly
      SELECT s.user_id INTO v_winner
      FROM public.sends s
      JOIN public.climbers c ON c.id = s.user_id
      WHERE s.sent_at >= v_sp.starts_at
        AND s.sent_at <= v_sp.ends_at
        AND c.visible_in_leaderboard = true
      GROUP BY s.user_id
      ORDER BY SUM(s.points_daily) DESC, MAX(s.sent_at) ASC
      LIMIT 1;
    END IF;

    IF v_winner IS NOT NULL THEN
      UPDATE public.sponsorships SET winner_user_id = v_winner WHERE id = v_sp.id;
      v_results := v_results || jsonb_build_object('sponsorship_id', v_sp.id, 'winner_user_id', v_winner);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_results);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.determine_sponsorship_winner() TO anon, authenticated;

-- ============================================================
-- Migración: sponsorships.winner_rule admite daily/weekly (2026-08-23)
-- Solo necesaria en la DB de producción existente — CREATE TABLE de arriba
-- ya trae el CHECK correcto para instalaciones nuevas.
-- ============================================================
ALTER TABLE public.sponsorships DROP CONSTRAINT IF EXISTS sponsorships_winner_rule_check;
ALTER TABLE public.sponsorships ADD CONSTRAINT sponsorships_winner_rule_check
  CHECK (winner_rule IN ('top_1_daily', 'top_1_weekly', 'top_1_monthly'));
