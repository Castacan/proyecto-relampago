-- ============================================================
-- Competencia — conteo de puntos el día del evento (2026-10-30)
--
-- Requiere competencia.sql. Se puede correr más de una vez.
--
-- Reglas (definidas por el dueño con el armador):
--   * Por ruta cuenta el mejor resultado: top = 10, zona = 4.
--   * CADA intento que no es top resta 0.01, aunque no saque nada en esa
--     ruta (un intento que llega a zona y se cae también resta).
--     Los tres valores son ajustes de la competencia (score_*).
--   * Intentos ilimitados. Después del top ya no se capturan intentos.
--   * Cada categoría tiene su lista de rutas (route_numbers). Solo cuentan
--     las rutas de su lista. Dos categorías se pueden juntar (merge_into):
--     compiten con las rutas y el ranking de la categoría destino.
--   * Al subir a alguien de categoría empieza de cero: cada intento guarda
--     la categoría que tenía la persona en ese momento y solo cuentan los
--     de su categoría actual (los anteriores quedan guardados).
--   * Desempate: puntos → más tops → más flashes → más zonas → quien
--     consiguió antes sus últimos puntos (la hora en que logró su mejor
--     resultado más reciente: top, o zona si no hizo top) → lugar compartido.
--
-- Jueces: entran a /juez con una palabra clave que les da el admin
-- (sin contraseña). Todas sus
-- funciones reciben ese código; las tablas no tienen policies.
-- ============================================================

-- Ajustes de puntos y si el ranking se puede ver sin sesión (TV).
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS score_top             NUMERIC(6,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS score_zone            NUMERIC(6,2) NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS score_attempt_penalty NUMERIC(6,3) NOT NULL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS ranking_public        BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.competition_categories
  ADD COLUMN IF NOT EXISTS route_numbers INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS merge_into    UUID REFERENCES public.competition_categories(id);

-- Número de competidor (dorsal). Fijo aunque la persona cambie de categoría.
ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS bib INT;

CREATE UNIQUE INDEX IF NOT EXISTS competition_registrations_bib_idx
  ON public.competition_registrations (competition_id, bib) WHERE bib IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.competition_judges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id),
  name           TEXT NOT NULL,
  code           TEXT NOT NULL UNIQUE,      -- palabra clave, en mayúsculas
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un renglón por intento. Nada se borra: un error se anula (voided_at).
-- client_id lo genera el celular del juez: si la red falla y reintenta,
-- el mismo intento no se guarda dos veces.
CREATE TABLE IF NOT EXISTS public.competition_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES public.competitions(id),
  registration_id UUID NOT NULL REFERENCES public.competition_registrations(id),
  category_id     UUID NOT NULL REFERENCES public.competition_categories(id),
  route_number    INT  NOT NULL CHECK (route_number BETWEEN 1 AND 999),
  result          TEXT NOT NULL CHECK (result IN ('top','zone','fail')),
  judge_id        UUID REFERENCES public.competition_judges(id),  -- NULL = capturado por admin
  actor_id        UUID,                                           -- admin que lo capturó
  client_id       UUID UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT
);

CREATE INDEX IF NOT EXISTS competition_attempts_reg_idx
  ON public.competition_attempts (registration_id, route_number, created_at);
CREATE INDEX IF NOT EXISTS competition_attempts_judge_idx
  ON public.competition_attempts (judge_id, created_at DESC);

ALTER TABLE public.competition_judges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_judges, public.competition_attempts FROM anon, authenticated;

-- ------------------------------------------------------------
-- Números de competidor: por categoría y luego alfabético
-- (admin_renumber_bibs, antes del evento). Quien queda pagado después
-- (las inscripciones del mismo día) recibe el siguiente número libre.
-- Se puede cambiar a mano.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_assign_bib()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.status = 'paid' AND NEW.bib IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('competition_bib:' || NEW.competition_id::text));
    SELECT coalesce(max(r.bib), 0) + 1 INTO NEW.bib
    FROM competition_registrations r WHERE r.competition_id = NEW.competition_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS competition_registrations_bib ON public.competition_registrations;
CREATE TRIGGER competition_registrations_bib
  BEFORE INSERT OR UPDATE OF status ON public.competition_registrations
  FOR EACH ROW EXECUTE FUNCTION public.competition_assign_bib();

-- Orden alfabético sin que los acentos muevan a nadie de lugar.
CREATE OR REPLACE FUNCTION public.competition_sort_name(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $function$
  SELECT translate(lower(p_name), 'áéíóúüàèìòùñ', 'aeiouuaeioun');
$function$;

-- Numera de nuevo a todos los pagados: categoría (en su orden) y luego
-- nombre. Se niega si ya hay intentos capturados, para no cambiarle el
-- número a nadie a media competencia.
CREATE OR REPLACE FUNCTION public.competition_renumber_bibs(p_competition_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('competition_bib:' || p_competition_id::text));
  UPDATE competition_registrations SET bib = NULL WHERE competition_id = p_competition_id;
  WITH todo AS (
    SELECT r.id, row_number() OVER (ORDER BY cc.sort_order, cc.name, competition_sort_name(r.full_name), r.created_at) AS n
    FROM competition_registrations r JOIN competition_categories cc ON cc.id = r.category_id
    WHERE r.competition_id = p_competition_id AND r.status = 'paid'
  )
  UPDATE competition_registrations r SET bib = todo.n FROM todo WHERE r.id = todo.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Primera vez: numerar a los pagados que ya existen.
SELECT competition_renumber_bibs(c.id) FROM competitions c
WHERE NOT EXISTS (SELECT 1 FROM competition_registrations r WHERE r.competition_id = c.id AND r.bib IS NOT NULL);

-- ------------------------------------------------------------
-- Cálculo (interno)
-- ------------------------------------------------------------

-- Categoría con la que compite (la destino si está juntada).
CREATE OR REPLACE FUNCTION public.competition_effective_category(p_category_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT coalesce(cc.merge_into, cc.id) FROM competition_categories cc WHERE cc.id = p_category_id;
$function$;

-- Las columnas de estas dos cambiaron durante el desarrollo: se borran
-- antes para que CREATE OR REPLACE no falle.
DROP FUNCTION IF EXISTS public.competition_ranking(UUID);
DROP FUNCTION IF EXISTS public.competition_route_results(UUID);

-- Resumen por persona y ruta, solo con intentos que cuentan: no anulados,
-- hechos en su categoría actual y en una ruta de la lista de su categoría
-- (si la lista está vacía, cuentan todas).
CREATE OR REPLACE FUNCTION public.competition_route_results(p_competition_id UUID)
RETURNS TABLE (
  registration_id UUID, route_number INT, attempts INT, fails INT,
  topped BOOLEAN, zoned BOOLEAN, flash BOOLEAN, zone_first BOOLEAN,
  points NUMERIC, last_at TIMESTAMPTZ, achieved_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH c AS (SELECT * FROM competitions WHERE id = p_competition_id),
  a AS (
    SELECT at.registration_id, at.route_number, at.result, at.created_at,
           row_number() OVER (PARTITION BY at.registration_id, at.route_number ORDER BY at.created_at, at.id) AS n
    FROM competition_attempts at
    JOIN competition_registrations r ON r.id = at.registration_id
    JOIN competition_categories ec ON ec.id = coalesce(
           (SELECT cc.merge_into FROM competition_categories cc WHERE cc.id = r.category_id), r.category_id)
    WHERE at.competition_id = p_competition_id
      AND at.voided_at IS NULL
      AND at.category_id = r.category_id
      AND (cardinality(ec.route_numbers) = 0 OR at.route_number = ANY (ec.route_numbers))
  )
  SELECT a.registration_id, a.route_number,
         count(*)::int,
         count(*) FILTER (WHERE a.result <> 'top')::int,
         bool_or(a.result = 'top'),
         bool_or(a.result IN ('top','zone')),
         bool_or(a.result = 'top' AND a.n = 1),
         bool_or(a.result IN ('top','zone') AND a.n = 1),
         (CASE WHEN bool_or(a.result = 'top') THEN max(c.score_top)
               WHEN bool_or(a.result = 'zone') THEN max(c.score_zone) ELSE 0 END)
           - count(*) FILTER (WHERE a.result <> 'top') * max(c.score_attempt_penalty),
         max(a.created_at),
         -- Cuándo logró su mejor resultado en esta ruta (primer top; si no, primera zona).
         coalesce(min(a.created_at) FILTER (WHERE a.result = 'top'), min(a.created_at) FILTER (WHERE a.result = 'zone'))
  FROM a CROSS JOIN c
  GROUP BY a.registration_id, a.route_number;
$function$;

-- Ranking por categoría efectiva. Incluye a todos los pagados, aunque
-- aún no tengan intentos (salen con 0).
CREATE OR REPLACE FUNCTION public.competition_ranking(p_competition_id UUID)
RETURNS TABLE (
  registration_id UUID, bib INT, full_name TEXT, category_id UUID, effective_category_id UUID,
  points NUMERIC, tops INT, zones INT, flashes INT, attempts INT, routes_tried INT,
  topped_routes INT[], last_at TIMESTAMPTZ, achieved_at TIMESTAMPTZ, place INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH rr AS (SELECT * FROM competition_route_results(p_competition_id)),
  per AS (
    SELECT r.id, r.bib, r.full_name, r.category_id,
           coalesce(cc.merge_into, cc.id) AS eff,
           round(coalesce(sum(rr.points), 0), 3) AS points,
           count(*) FILTER (WHERE rr.topped)::int AS tops,
           count(*) FILTER (WHERE rr.zoned)::int AS zones,
           count(*) FILTER (WHERE rr.flash)::int AS flashes,
           coalesce(sum(rr.attempts), 0)::int AS attempts,
           count(rr.route_number)::int AS routes_tried,
           coalesce(array_agg(rr.route_number ORDER BY rr.route_number DESC) FILTER (WHERE rr.topped), '{}') AS topped_routes,
           max(rr.last_at) AS last_at,
           max(rr.achieved_at) AS achieved_at
    FROM competition_registrations r
    JOIN competition_categories cc ON cc.id = r.category_id
    LEFT JOIN rr ON rr.registration_id = r.id
    WHERE r.competition_id = p_competition_id AND r.status = 'paid'
    GROUP BY r.id, r.bib, r.full_name, r.category_id, cc.merge_into, cc.id
  )
  SELECT per.id, per.bib, per.full_name, per.category_id, per.eff,
         per.points, per.tops, per.zones, per.flashes, per.attempts, per.routes_tried,
         per.topped_routes, per.last_at, per.achieved_at,
         rank() OVER (PARTITION BY per.eff
                      ORDER BY per.points DESC, per.tops DESC, per.flashes DESC,
                               per.zones DESC, per.achieved_at ASC NULLS LAST)::int
  FROM per;
$function$;

-- Aviso para reubicar. Regla provisional mientras llega la fórmula del
-- armador: encadenó (top) todas las rutas de su categoría, o hizo flash
-- en al menos 80 % de ellas.
CREATE OR REPLACE FUNCTION public.competition_promotion_hint(p_tops INT, p_flashes INT, p_route_count INT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_route_count = 0 THEN NULL
    WHEN p_flashes >= p_route_count THEN 'Flash en todas las rutas de su categoría'
    WHEN p_tops >= p_route_count THEN 'Top en todas las rutas de su categoría'
    WHEN p_flashes >= ceil(p_route_count * 0.8) THEN 'Flash en ' || p_flashes || ' de ' || p_route_count || ' rutas'
  END;
$function$;

-- Palabra del juez normalizada: mayúsculas, sin espacios ni acentos
-- ("tiburón" = "TIBURON").
CREATE OR REPLACE FUNCTION public.competition_judge_code(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $function$
  SELECT translate(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), 'ÁÉÍÓÚÜ', 'AEIOUU');
$function$;

-- Juez activo por su palabra (NULL si no existe o está desactivado).
CREATE OR REPLACE FUNCTION public.competition_judge_by_code(p_code TEXT)
RETURNS public.competition_judges LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT j.* FROM competition_judges j
  WHERE j.code = competition_judge_code(p_code) AND j.active;
$function$;

-- Lo que ve el juez de un competidor: datos, rutas y cómo va en cada una.
CREATE OR REPLACE FUNCTION public.competition_competitor_card(p_registration_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'registration_id', r.id,
    'bib', r.bib,
    'full_name', r.full_name,
    'category_name', ec.name,
    'route_numbers', to_jsonb(ec.route_numbers),
    'routes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'route_number', rr.route_number, 'attempts', rr.attempts,
               'topped', rr.topped, 'zoned', rr.zoned, 'flash', rr.flash, 'points', rr.points)
             ORDER BY rr.route_number), '[]'::jsonb)
      FROM competition_route_results(r.competition_id) rr WHERE rr.registration_id = r.id),
    'points', (SELECT k.points FROM competition_ranking(r.competition_id) k WHERE k.registration_id = r.id)
  )
  FROM competition_registrations r
  JOIN competition_categories cc ON cc.id = r.category_id
  JOIN competition_categories ec ON ec.id = coalesce(cc.merge_into, cc.id)
  WHERE r.id = p_registration_id;
$function$;

REVOKE ALL ON FUNCTION public.competition_assign_bib() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_renumber_bibs(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_effective_category(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_route_results(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_ranking(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_judge_by_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_competitor_card(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Juez (anon, con su código)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.judge_login(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge competition_judges%ROWTYPE;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  RETURN jsonb_build_object(
    'judge_name', v_judge.name,
    'competition_name', (SELECT c.name FROM competitions c WHERE c.id = v_judge.competition_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.judge_lookup(p_code TEXT, p_bib INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge competition_judges%ROWTYPE;
  v_reg   competition_registrations%ROWTYPE;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.competition_id = v_judge.competition_id AND r.bib = p_bib;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bib_not_found'); END IF;
  IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;
  RETURN competition_competitor_card(v_reg.id);
END;
$function$;

-- p_result: 'top' | 'zone' | 'fail'. Regresa la tarjeta actualizada.
-- Ruta fuera de la lista de su categoría o ruta ya encadenada: no se
-- guarda salvo que el juez confirme (p_force); lo de fuera de la lista
-- se guarda pero no cuenta.
CREATE OR REPLACE FUNCTION public.judge_record_attempt(
  p_code TEXT, p_bib INT, p_route INT, p_result TEXT, p_client_id UUID, p_force BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge  competition_judges%ROWTYPE;
  v_reg    competition_registrations%ROWTYPE;
  v_routes INT[];
  v_id     UUID;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  IF p_result NOT IN ('top','zone','fail') THEN RETURN jsonb_build_object('error', 'invalid_result'); END IF;
  IF p_route IS NULL OR p_route < 1 OR p_route > 999 THEN RETURN jsonb_build_object('error', 'invalid_route'); END IF;

  -- Reintento del mismo intento (se cortó la red): ya está guardado.
  SELECT at.id INTO v_id FROM competition_attempts at WHERE at.client_id = p_client_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'attempt_id', v_id, 'duplicate', true,
      'card', competition_competitor_card((SELECT at.registration_id FROM competition_attempts at WHERE at.id = v_id)));
  END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.competition_id = v_judge.competition_id AND r.bib = p_bib FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bib_not_found'); END IF;
  IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;

  IF NOT coalesce(p_force, false) THEN
    SELECT cc.route_numbers INTO v_routes FROM competition_categories cc
    WHERE cc.id = competition_effective_category(v_reg.category_id);
    IF cardinality(v_routes) > 0 AND NOT (p_route = ANY (v_routes)) THEN
      RETURN jsonb_build_object('error', 'route_not_in_category');
    END IF;
    IF EXISTS (SELECT 1 FROM competition_attempts at
               WHERE at.registration_id = v_reg.id AND at.route_number = p_route
                 AND at.category_id = v_reg.category_id AND at.result = 'top' AND at.voided_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'already_topped');
    END IF;
  END IF;

  INSERT INTO competition_attempts (competition_id, registration_id, category_id, route_number, result, judge_id, client_id)
  VALUES (v_judge.competition_id, v_reg.id, v_reg.category_id, p_route, p_result, v_judge.id, p_client_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'attempt_id', v_id, 'card', competition_competitor_card(v_reg.id));
END;
$function$;

-- El juez solo anula intentos suyos de los últimos 30 minutos.
CREATE OR REPLACE FUNCTION public.judge_undo_attempt(p_code TEXT, p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge competition_judges%ROWTYPE;
  v_at    competition_attempts%ROWTYPE;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  SELECT at.* INTO v_at FROM competition_attempts at WHERE at.id = p_attempt_id AND at.judge_id = v_judge.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_at.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_voided'); END IF;
  IF v_at.created_at < now() - INTERVAL '30 minutes' THEN RETURN jsonb_build_object('error', 'too_old'); END IF;
  UPDATE competition_attempts SET voided_at = now(), void_reason = 'Deshecho por el juez' WHERE id = v_at.id;
  RETURN jsonb_build_object('success', true, 'card', competition_competitor_card(v_at.registration_id));
END;
$function$;

-- Últimos intentos que capturó este juez.
CREATE OR REPLACE FUNCTION public.judge_recent(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge competition_judges%ROWTYPE;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  RETURN jsonb_build_object('attempts', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id, 'bib', x.bib, 'full_name', x.full_name, 'route_number', x.route_number,
             'result', x.result, 'created_at', x.created_at, 'voided', x.voided_at IS NOT NULL)
           ORDER BY x.created_at DESC), '[]'::jsonb)
    FROM (SELECT at.*, r.bib, r.full_name FROM competition_attempts at
          JOIN competition_registrations r ON r.id = at.registration_id
          WHERE at.judge_id = v_judge.id ORDER BY at.created_at DESC LIMIT 15) x));
END;
$function$;

-- ------------------------------------------------------------
-- Admin
-- ------------------------------------------------------------

-- Todo lo del panel de puntos: ajustes, categorías con rutas, jueces,
-- ranking con detalle por ruta y aviso de reubicación.
CREATE OR REPLACE FUNCTION public.get_competition_scoring_admin(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'competition', jsonb_build_object(
      'name', v_comp.name, 'score_top', v_comp.score_top, 'score_zone', v_comp.score_zone,
      'score_attempt_penalty', v_comp.score_attempt_penalty, 'ranking_public', v_comp.ranking_public),
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', cc.id, 'name', cc.name, 'route_numbers', to_jsonb(cc.route_numbers), 'merge_into', cc.merge_into)
             ORDER BY cc.sort_order, cc.name), '[]'::jsonb)
      FROM competition_categories cc WHERE cc.competition_id = v_comp.id),
    'judges', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', j.id, 'name', j.name, 'code', j.code, 'active', j.active,
               'attempts', (SELECT count(*) FROM competition_attempts at WHERE at.judge_id = j.id AND at.voided_at IS NULL))
             ORDER BY j.created_at), '[]'::jsonb)
      FROM competition_judges j WHERE j.competition_id = v_comp.id),
    'ranking', (
      SELECT coalesce(jsonb_agg(to_jsonb(k) || jsonb_build_object(
               'routes', (
                 SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'route_number', rr.route_number, 'attempts', rr.attempts, 'topped', rr.topped,
                          'zoned', rr.zoned, 'flash', rr.flash, 'zone_first', rr.zone_first, 'points', rr.points)
                        ORDER BY rr.route_number), '[]'::jsonb)
                 FROM competition_route_results(v_comp.id) rr WHERE rr.registration_id = k.registration_id),
               'promotion_hint', competition_promotion_hint(k.tops, k.flashes,
                 (SELECT cardinality(ec.route_numbers) FROM competition_categories ec WHERE ec.id = k.effective_category_id)))
             ORDER BY k.place, k.bib), '[]'::jsonb)
      FROM competition_ranking(v_comp.id) k),
    'attempts', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'bib', x.bib, 'full_name', x.full_name, 'route_number', x.route_number,
               'result', x.result, 'judge_name', x.judge_name, 'created_at', x.created_at,
               'voided_at', x.voided_at, 'void_reason', x.void_reason, 'counts', x.counts)
             ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT at.*, r.bib, r.full_name, j.name AS judge_name, at.category_id = r.category_id AS counts
            FROM competition_attempts at
            JOIN competition_registrations r ON r.id = at.registration_id
            LEFT JOIN competition_judges j ON j.id = at.judge_id
            WHERE at.competition_id = v_comp.id
            ORDER BY at.created_at DESC LIMIT 300) x)
  );
END;
$function$;

-- Ajustes: score_top, score_zone, score_attempt_penalty, ranking_public.
CREATE OR REPLACE FUNCTION public.admin_update_scoring(p_slug TEXT, p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_new  competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_new := v_comp;
  IF p_patch ? 'score_top' THEN v_new.score_top := (p_patch->>'score_top')::numeric; END IF;
  IF p_patch ? 'score_zone' THEN v_new.score_zone := (p_patch->>'score_zone')::numeric; END IF;
  IF p_patch ? 'score_attempt_penalty' THEN v_new.score_attempt_penalty := (p_patch->>'score_attempt_penalty')::numeric; END IF;
  IF p_patch ? 'ranking_public' THEN v_new.ranking_public := (p_patch->>'ranking_public')::boolean; END IF;
  IF v_new.score_top <= 0 OR v_new.score_zone < 0 OR v_new.score_zone >= v_new.score_top
     OR v_new.score_attempt_penalty < 0 OR v_new.score_attempt_penalty > 1 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  UPDATE competitions SET score_top = v_new.score_top, score_zone = v_new.score_zone,
    score_attempt_penalty = v_new.score_attempt_penalty, ranking_public = v_new.ranking_public
  WHERE id = v_comp.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'update_scoring', v_comp.id, to_jsonb(v_comp), to_jsonb(v_new));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Rutas de una categoría y, opcional, juntarla con otra (p_merge_into
-- NULL = separada). No se puede juntar con una que a su vez está juntada.
CREATE OR REPLACE FUNCTION public.admin_set_category_routes(p_category_id UUID, p_routes INT[], p_merge_into UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_cat    competition_categories%ROWTYPE;
  v_routes INT[];
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = p_category_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_routes FROM unnest(coalesce(p_routes, '{}')) x;
  IF EXISTS (SELECT 1 FROM unnest(v_routes) x WHERE x < 1 OR x > 999) THEN
    RETURN jsonb_build_object('error', 'invalid_route');
  END IF;
  IF p_merge_into IS NOT NULL THEN
    IF p_merge_into = v_cat.id
       OR NOT EXISTS (SELECT 1 FROM competition_categories t
                      WHERE t.id = p_merge_into AND t.competition_id = v_cat.competition_id AND t.merge_into IS NULL)
       OR EXISTS (SELECT 1 FROM competition_categories s WHERE s.merge_into = v_cat.id) THEN
      RETURN jsonb_build_object('error', 'invalid_merge');
    END IF;
  END IF;
  UPDATE competition_categories SET route_numbers = v_routes, merge_into = p_merge_into WHERE id = v_cat.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'set_category_routes', v_cat.competition_id, to_jsonb(v_cat),
          to_jsonb(v_cat) || jsonb_build_object('route_numbers', v_routes, 'merge_into', p_merge_into));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Jueces. p_action: 'create' {name, code} | 'deactivate' | 'activate'.
-- code = la palabra clave que el admin le da al juez (si llega vacía se
-- genera una).
CREATE OR REPLACE FUNCTION public.admin_manage_judge(p_slug TEXT, p_action TEXT, p_judge_id UUID DEFAULT NULL, p_payload JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_name TEXT := btrim(coalesce(p_payload->>'name', ''));
  v_code TEXT := competition_judge_code(p_payload->>'code');
  v_id   UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF p_action = 'create' THEN
    IF length(v_name) < 2 OR length(v_name) > 60 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
    IF v_code = '' THEN
      -- Sin letras que se confunden (0/O, 1/I/L).
      LOOP
        v_code := 'JZ-' || (SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
                            FROM generate_series(1, 5));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_judges j WHERE j.code = v_code);
      END LOOP;
    ELSIF v_code !~ '^[A-ZÑ0-9-]{4,20}$' THEN
      RETURN jsonb_build_object('error', 'invalid_code');
    ELSIF EXISTS (SELECT 1 FROM competition_judges j WHERE j.code = v_code) THEN
      RETURN jsonb_build_object('error', 'code_taken');
    END IF;
    INSERT INTO competition_judges (competition_id, name, code) VALUES (v_comp.id, v_name, v_code) RETURNING id INTO v_id;
  ELSIF p_action IN ('deactivate', 'activate') THEN
    UPDATE competition_judges SET active = (p_action = 'activate')
    WHERE id = p_judge_id AND competition_id = v_comp.id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  ELSE
    RETURN jsonb_build_object('error', 'invalid_action');
  END IF;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, after)
  VALUES (auth.uid(), 'judge_' || p_action, v_comp.id, jsonb_build_object('judge_id', v_id, 'name', v_name, 'code', v_code));
  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code);
END;
$function$;

-- Correcciones del admin: anular un intento o capturar uno a mano.
CREATE OR REPLACE FUNCTION public.admin_void_attempt(p_attempt_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_at     competition_attempts%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT at.* INTO v_at FROM competition_attempts at WHERE at.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_at.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_voided'); END IF;
  UPDATE competition_attempts SET voided_at = now(), void_reason = v_reason WHERE id = v_at.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, reason)
  VALUES (auth.uid(), 'void_attempt', v_at.competition_id, v_at.registration_id, to_jsonb(v_at), v_reason);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_attempt(p_slug TEXT, p_bib INT, p_route INT, p_result TEXT, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp   competitions%ROWTYPE;
  v_reg    competition_registrations%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  IF p_result NOT IN ('top','zone','fail') THEN RETURN jsonb_build_object('error', 'invalid_result'); END IF;
  IF p_route IS NULL OR p_route < 1 OR p_route > 999 THEN RETURN jsonb_build_object('error', 'invalid_route'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.competition_id = v_comp.id AND r.bib = p_bib;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bib_not_found'); END IF;
  IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;
  INSERT INTO competition_attempts (competition_id, registration_id, category_id, route_number, result, actor_id)
  VALUES (v_comp.id, v_reg.id, v_reg.category_id, p_route, p_result, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, after, reason)
  VALUES (auth.uid(), 'add_attempt', v_comp.id, v_reg.id,
          jsonb_build_object('attempt_id', v_id, 'route_number', p_route, 'result', p_result), v_reason);
  RETURN jsonb_build_object('success', true, 'attempt_id', v_id);
END;
$function$;

-- Cambiar el número de competidor (NULL lo quita).
CREATE OR REPLACE FUNCTION public.admin_set_bib(p_registration_id UUID, p_bib INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_reg competition_registrations%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_bib IS NOT NULL AND (p_bib < 1 OR p_bib > 9999) THEN RETURN jsonb_build_object('error', 'invalid_bib'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  BEGIN
    UPDATE competition_registrations SET bib = p_bib, updated_at = now() WHERE id = v_reg.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'bib_taken');
  END;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after)
  VALUES (auth.uid(), 'set_bib', v_reg.competition_id, v_reg.id,
          jsonb_build_object('bib', v_reg.bib), jsonb_build_object('bib', p_bib));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Botón "Numerar por categoría y nombre" del panel.
CREATE OR REPLACE FUNCTION public.admin_renumber_bibs(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp  competitions%ROWTYPE;
  v_count INT;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF EXISTS (SELECT 1 FROM competition_attempts at WHERE at.competition_id = v_comp.id AND at.voided_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'has_attempts');
  END IF;
  v_count := competition_renumber_bibs(v_comp.id);
  INSERT INTO competition_audit_log (actor_id, action, competition_id, after)
  VALUES (auth.uid(), 'renumber_bibs', v_comp.id, jsonb_build_object('count', v_count));
  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$function$;

-- ------------------------------------------------------------
-- Pública (para la TV): solo si el admin la activa (ranking_public).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_competition_ranking_public(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT v_comp.ranking_public AND NOT competition_is_admin() THEN
    RETURN jsonb_build_object('error', 'hidden');
  END IF;
  RETURN jsonb_build_object(
    'name', v_comp.name,
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', cc.id,
               'name', (SELECT string_agg(x.name, ' + ' ORDER BY x.sort_order) FROM competition_categories x
                        WHERE x.id = cc.id OR x.merge_into = cc.id),
               'ranking', (
                 SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'place', k.place, 'bib', k.bib, 'full_name', k.full_name, 'points', k.points,
                          'tops', k.tops, 'zones', k.zones, 'flashes', k.flashes)
                        ORDER BY k.place, k.bib), '[]'::jsonb)
                 FROM competition_ranking(v_comp.id) k WHERE k.effective_category_id = cc.id))
             ORDER BY cc.sort_order), '[]'::jsonb)
      FROM competition_categories cc WHERE cc.competition_id = v_comp.id AND cc.merge_into IS NULL)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.judge_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.judge_lookup(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.judge_record_attempt(TEXT, INT, INT, TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.judge_undo_attempt(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.judge_recent(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_competition_scoring_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_scoring(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_category_routes(UUID, INT[], UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_manage_judge(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_void_attempt(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_add_attempt(TEXT, INT, INT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_bib(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_renumber_bibs(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_competition_ranking_public(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.judge_login(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_lookup(TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_record_attempt(TEXT, INT, INT, TEXT, UUID, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_undo_attempt(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_recent(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_scoring_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_scoring(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_category_routes(UUID, INT[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_judge(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_attempt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_attempt(TEXT, INT, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_bib(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_renumber_bibs(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_ranking_public(TEXT) TO anon, authenticated;
