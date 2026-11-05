-- ============================================================
-- Competencia — reglas por BLOQUES (acordadas con el dueño 2026-11-04)
-- Ver docs/competencia-reglas.md.
--
-- Requiere competencia_jueces.sql (y competencia_rifa.sql si ya se corrió).
-- Se puede correr más de una vez.
--
-- Mientras no haya bloques capturados (competition_blocks vacía) todo
-- funciona como antes (rutas por categoría). En cuanto el admin guarda
-- el orden de dificultad, aplica el "modo bloques":
--   * Todos intentan cualquier bloque. El juez solo puede capturar números
--     de bloque que existen.
--   * Valor del bloque = su lugar en el orden de dificultad (el más fácil
--     vale 1). Top = valor; zona = valor × zone_ratio (0.5).
--   * Cada intento que no es top resta score_attempt_penalty (0.01), hasta
--     el top. Después del top ya no se puede intentar ese bloque.
--   * Cuentan los count_best (5) bloques que más puntos le den.
--   * Categoría final = género de su inscripción + nivel del bloque más
--     difícil con top (sin tops = básico). Se puede subir y bajar. El
--     admin puede fijar el nivel a mano (level_override).
--   * Desempate: puntos → bloque más difícil con top → flashes en sus
--     bloques que cuentan → su 6º mejor bloque, 7º, … → lugar compartido.
--   * Rifa: 1 boleto por cada bloque con zona o top, de cualquier nivel.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_blocks (
  competition_id UUID NOT NULL REFERENCES public.competitions(id),
  route_number   INT  NOT NULL CHECK (route_number BETWEEN 1 AND 999),
  value          INT  NOT NULL CHECK (value >= 1),
  level          TEXT NOT NULL CHECK (level IN ('basico','intermedio','avanzado')),
  PRIMARY KEY (competition_id, route_number),
  UNIQUE (competition_id, value)
);
ALTER TABLE public.competition_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_blocks FROM anon, authenticated;

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS count_best INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS zone_ratio NUMERIC(4,3) NOT NULL DEFAULT 0.5;

ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS level_override TEXT CHECK (level_override IN ('basico','intermedio','avanzado'));

CREATE OR REPLACE FUNCTION public.competition_blocks_mode(p_competition_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM competition_blocks b WHERE b.competition_id = p_competition_id);
$function$;

CREATE OR REPLACE FUNCTION public.competition_level_rank(p_level TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_level WHEN 'basico' THEN 1 WHEN 'intermedio' THEN 2 WHEN 'avanzado' THEN 3 ELSE 0 END;
$function$;

-- ------------------------------------------------------------
-- Resultado por persona y ruta/bloque. Mismas columnas que antes más
-- block_value y block_level (NULL fuera del modo bloques).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.competition_route_results(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.competition_route_results(p_competition_id UUID)
RETURNS TABLE (
  registration_id UUID, route_number INT, attempts INT, fails INT,
  topped BOOLEAN, zoned BOOLEAN, flash BOOLEAN, zone_first BOOLEAN,
  points NUMERIC, last_at TIMESTAMPTZ, achieved_at TIMESTAMPTZ,
  block_value INT, block_level TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH c AS (SELECT *, competition_blocks_mode(id) AS bm FROM competitions WHERE id = p_competition_id),
  a0 AS (
    SELECT at.registration_id, at.route_number, at.result, at.created_at, at.id,
           b.value AS bvalue, b.level AS blevel
    FROM competition_attempts at
    CROSS JOIN c
    JOIN competition_registrations r ON r.id = at.registration_id
    JOIN competition_categories ec ON ec.id = coalesce(
           (SELECT cc.merge_into FROM competition_categories cc WHERE cc.id = r.category_id), r.category_id)
    LEFT JOIN competition_blocks b ON b.competition_id = at.competition_id AND b.route_number = at.route_number
    WHERE at.competition_id = p_competition_id
      AND at.voided_at IS NULL
      AND CASE WHEN c.bm
            -- Bloques: cualquier categoría, solo números de bloque que existen.
            THEN b.route_number IS NOT NULL
            -- Rutas por categoría (modo anterior).
            ELSE at.category_id = r.category_id
                 AND (cardinality(ec.route_numbers) = 0 OR at.route_number = ANY (ec.route_numbers))
          END
  ),
  a1 AS (
    SELECT a0.*, row_number() OVER (PARTITION BY a0.registration_id, a0.route_number ORDER BY a0.created_at, a0.id) AS n
    FROM a0
  ),
  -- Lo que pase después del primer top no cuenta (en modo bloques ni se
  -- puede capturar; esto cubre lo que el admin agregue a mano).
  a AS (
    SELECT a1.* FROM a1
    WHERE a1.n <= coalesce((SELECT min(x.n) FROM a1 x
                            WHERE x.registration_id = a1.registration_id AND x.route_number = a1.route_number
                              AND x.result = 'top'), a1.n)
  )
  SELECT a.registration_id, a.route_number,
         count(*)::int,
         count(*) FILTER (WHERE a.result <> 'top')::int,
         bool_or(a.result = 'top'),
         bool_or(a.result IN ('top','zone')),
         bool_or(a.result = 'top' AND a.n = 1),
         bool_or(a.result IN ('top','zone') AND a.n = 1),
         CASE WHEN max(c.bm::int) = 1 THEN
           (CASE WHEN bool_or(a.result = 'top') THEN max(a.bvalue)::numeric
                 WHEN bool_or(a.result = 'zone') THEN max(a.bvalue) * max(c.zone_ratio) ELSE 0 END)
         ELSE
           (CASE WHEN bool_or(a.result = 'top') THEN max(c.score_top)
                 WHEN bool_or(a.result = 'zone') THEN max(c.score_zone) ELSE 0 END)
         END - count(*) FILTER (WHERE a.result <> 'top') * max(c.score_attempt_penalty),
         max(a.created_at),
         coalesce(min(a.created_at) FILTER (WHERE a.result = 'top'), min(a.created_at) FILTER (WHERE a.result = 'zone')),
         max(a.bvalue),
         max(a.blevel)
  FROM a CROSS JOIN c
  GROUP BY a.registration_id, a.route_number;
$function$;

-- La rifa usa competition_route_results: se vuelve a crear por si el
-- CASCADE de arriba la quitó (en modo bloques cuenta zonas de cualquier nivel).
DO $$
BEGIN
  -- Si ya se corrió competencia_ruleta.sql (boletos extra), no se pisa su versión.
  IF to_regclass('public.competition_raffle_prizes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'competition_registrations'
                       AND column_name = 'raffle_bonus') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.competition_raffle_tickets(p_competition_id UUID)
      RETURNS TABLE (registration_id UUID, tickets INT)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $b$
        SELECT rr.registration_id, count(*) FILTER (WHERE rr.zoned)::int
        FROM competition_route_results(p_competition_id) rr
        GROUP BY rr.registration_id;
      $b$;
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.competition_raffle_tickets(UUID) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Ranking. Columnas nuevas: hardest_top, final_level, auto_level,
-- counted_flashes. En modo bloques effective_category_id es la categoría
-- final (género + nivel).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.competition_ranking(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.competition_ranking(p_competition_id UUID)
RETURNS TABLE (
  registration_id UUID, bib INT, full_name TEXT, category_id UUID, effective_category_id UUID,
  points NUMERIC, tops INT, zones INT, flashes INT, attempts INT, routes_tried INT,
  topped_routes INT[], last_at TIMESTAMPTZ, achieved_at TIMESTAMPTZ, place INT,
  hardest_top INT, final_level TEXT, auto_level TEXT, counted_flashes INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_best INT;
BEGIN
  IF NOT competition_blocks_mode(p_competition_id) THEN
    -- Modo anterior (rutas por categoría), igual que en competencia_jueces.sql.
    RETURN QUERY
    WITH rr AS (SELECT * FROM competition_route_results(p_competition_id)),
    per AS (
      SELECT r.id, r.bib, r.full_name, r.category_id,
             coalesce(cc.merge_into, cc.id) AS eff, cc.level,
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
      GROUP BY r.id, r.bib, r.full_name, r.category_id, cc.merge_into, cc.id, cc.level
    )
    SELECT per.id, per.bib, per.full_name, per.category_id, per.eff,
           per.points, per.tops, per.zones, per.flashes, per.attempts, per.routes_tried,
           per.topped_routes, per.last_at, per.achieved_at,
           rank() OVER (PARTITION BY per.eff
                        ORDER BY per.points DESC, per.tops DESC, per.flashes DESC,
                                 per.zones DESC, per.achieved_at ASC NULLS LAST)::int,
           NULL::int, per.level, per.level, per.flashes
    FROM per;
    RETURN;
  END IF;

  SELECT c.count_best INTO v_best FROM competitions c WHERE c.id = p_competition_id;

  RETURN QUERY
  WITH rr AS (
    SELECT x.*, row_number() OVER (PARTITION BY x.registration_id
                                   ORDER BY x.points DESC, x.block_value DESC) AS k
    FROM competition_route_results(p_competition_id) x
  ),
  per AS (
    SELECT r.id, r.bib, r.full_name, r.category_id, cc.gender, r.level_override,
           round(coalesce(sum(rr.points) FILTER (WHERE rr.k <= v_best), 0), 3) AS points,
           count(*) FILTER (WHERE rr.topped)::int AS tops,
           count(*) FILTER (WHERE rr.zoned)::int AS zones,
           count(*) FILTER (WHERE rr.flash)::int AS flashes,
           count(*) FILTER (WHERE rr.flash AND rr.k <= v_best)::int AS counted_flashes,
           coalesce(sum(rr.attempts), 0)::int AS attempts,
           count(rr.route_number)::int AS routes_tried,
           coalesce(array_agg(rr.route_number ORDER BY rr.block_value DESC) FILTER (WHERE rr.topped), '{}') AS topped_routes,
           coalesce(max(rr.block_value) FILTER (WHERE rr.topped), 0) AS hardest_top,
           CASE coalesce(max(competition_level_rank(rr.block_level)) FILTER (WHERE rr.topped), 1)
             WHEN 3 THEN 'avanzado' WHEN 2 THEN 'intermedio' ELSE 'basico' END AS auto_level,
           -- 6º, 7º, … mejor bloque, para desempatar.
           coalesce(array_agg(rr.points ORDER BY rr.k) FILTER (WHERE rr.k > v_best), '{}') AS extra,
           max(rr.last_at) AS last_at,
           max(rr.achieved_at) AS achieved_at
    FROM competition_registrations r
    JOIN competition_categories cc ON cc.id = r.category_id
    LEFT JOIN rr ON rr.registration_id = r.id
    WHERE r.competition_id = p_competition_id AND r.status = 'paid'
    GROUP BY r.id, r.bib, r.full_name, r.category_id, cc.gender, r.level_override
  ),
  fin AS (
    SELECT per.*, coalesce(per.level_override, per.auto_level) AS final_level,
           coalesce(
             (SELECT coalesce(t.merge_into, t.id) FROM competition_categories t
              WHERE t.competition_id = p_competition_id AND t.gender IS NOT DISTINCT FROM per.gender
                AND t.level = coalesce(per.level_override, per.auto_level)
              ORDER BY t.sort_order LIMIT 1),
             (SELECT coalesce(cc.merge_into, cc.id) FROM competition_categories cc WHERE cc.id = per.category_id)
           ) AS eff
    FROM per
  )
  SELECT fin.id, fin.bib, fin.full_name, fin.category_id, fin.eff,
         fin.points, fin.tops, fin.zones, fin.flashes, fin.attempts, fin.routes_tried,
         fin.topped_routes, fin.last_at, fin.achieved_at,
         rank() OVER (PARTITION BY fin.eff
                      ORDER BY fin.points DESC, fin.hardest_top DESC, fin.counted_flashes DESC, fin.extra DESC)::int,
         fin.hardest_top, fin.final_level, fin.auto_level, fin.counted_flashes
  FROM fin;
END;
$function$;

-- Tarjeta del juez. En modo bloques no muestra puntos ni categoría (el
-- competidor podría verla y deducir qué bloques son más difíciles).
CREATE OR REPLACE FUNCTION public.competition_competitor_card(p_registration_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_reg competition_registrations%ROWTYPE;
  v_bm  BOOLEAN;
BEGIN
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = p_registration_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_bm := competition_blocks_mode(v_reg.competition_id);
  RETURN (
    SELECT jsonb_build_object(
      'registration_id', v_reg.id,
      'bib', v_reg.bib,
      'full_name', v_reg.full_name,
      'blocks_mode', v_bm,
      'category_name', CASE WHEN v_bm THEN initcap(coalesce(cc.gender, '')) ELSE ec.name END,
      'route_numbers', CASE WHEN v_bm
        THEN (SELECT coalesce(jsonb_agg(b.route_number ORDER BY b.route_number), '[]'::jsonb)
              FROM competition_blocks b WHERE b.competition_id = v_reg.competition_id)
        ELSE to_jsonb(ec.route_numbers) END,
      'routes', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'route_number', rr.route_number, 'attempts', rr.attempts,
                 'topped', rr.topped, 'zoned', rr.zoned, 'flash', rr.flash,
                 'points', CASE WHEN v_bm THEN NULL ELSE rr.points END)
               ORDER BY rr.route_number), '[]'::jsonb)
        FROM competition_route_results(v_reg.competition_id) rr WHERE rr.registration_id = v_reg.id),
      'points', CASE WHEN v_bm THEN NULL
        ELSE (SELECT k.points FROM competition_ranking(v_reg.competition_id) k WHERE k.registration_id = v_reg.id) END
    )
    FROM competition_categories cc
    JOIN competition_categories ec ON ec.id = coalesce(cc.merge_into, cc.id)
    WHERE cc.id = v_reg.category_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_blocks_mode(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_route_results(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_ranking(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_competitor_card(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Juez: en modo bloques solo números de bloque, y un bloque con top ya
-- no se puede intentar otra vez (ni confirmando).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.judge_record_attempt(
  p_code TEXT, p_bib INT, p_route INT, p_result TEXT, p_client_id UUID, p_force BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_judge  competition_judges%ROWTYPE;
  v_reg    competition_registrations%ROWTYPE;
  v_routes INT[];
  v_id     UUID;
  v_bm     BOOLEAN;
BEGIN
  v_judge := competition_judge_by_code(p_code);
  IF v_judge.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  IF p_result NOT IN ('top','zone','fail') THEN RETURN jsonb_build_object('error', 'invalid_result'); END IF;
  IF p_route IS NULL OR p_route < 1 OR p_route > 999 THEN RETURN jsonb_build_object('error', 'invalid_route'); END IF;

  SELECT at.id INTO v_id FROM competition_attempts at WHERE at.client_id = p_client_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'attempt_id', v_id, 'duplicate', true,
      'card', competition_competitor_card((SELECT at.registration_id FROM competition_attempts at WHERE at.id = v_id)));
  END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.competition_id = v_judge.competition_id AND r.bib = p_bib FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bib_not_found'); END IF;
  IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;

  v_bm := competition_blocks_mode(v_judge.competition_id);
  IF v_bm THEN
    IF NOT EXISTS (SELECT 1 FROM competition_blocks b
                   WHERE b.competition_id = v_judge.competition_id AND b.route_number = p_route) THEN
      RETURN jsonb_build_object('error', 'not_a_block');
    END IF;
    IF EXISTS (SELECT 1 FROM competition_attempts at
               WHERE at.registration_id = v_reg.id AND at.route_number = p_route
                 AND at.result = 'top' AND at.voided_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'already_topped_final', 'card', competition_competitor_card(v_reg.id));
    END IF;
  ELSIF NOT coalesce(p_force, false) THEN
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

-- ------------------------------------------------------------
-- Admin: guardar el orden de dificultad.
-- p_order = números de bloque del más fácil al más difícil (vacío = sin
-- bloques, regresa al modo anterior). Valor = lugar en la lista.
-- Nivel: valor <= p_basico_max → básico; <= p_intermedio_max → intermedio;
-- el resto avanzado. Se puede cambiar en cualquier momento (también
-- después de la competencia, para corregir el orden): el ranking se
-- recalcula solo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_blocks(p_slug TEXT, p_order INT[], p_basico_max INT, p_intermedio_max INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp   competitions%ROWTYPE;
  v_n      INT := coalesce(cardinality(p_order), 0);
  v_before JSONB;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_n > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_order) x WHERE x IS NULL OR x < 1 OR x > 999)
       OR (SELECT count(DISTINCT x) FROM unnest(p_order) x) <> v_n THEN
      RETURN jsonb_build_object('error', 'invalid_blocks');
    END IF;
    IF p_basico_max IS NULL OR p_intermedio_max IS NULL
       OR p_basico_max < 1 OR p_intermedio_max <= p_basico_max OR p_intermedio_max >= v_n THEN
      RETURN jsonb_build_object('error', 'invalid_levels');
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.value), '[]'::jsonb) INTO v_before
  FROM competition_blocks b WHERE b.competition_id = v_comp.id;
  DELETE FROM competition_blocks WHERE competition_id = v_comp.id;
  INSERT INTO competition_blocks (competition_id, route_number, value, level)
  SELECT v_comp.id, x.num, x.ord::int,
         CASE WHEN x.ord <= p_basico_max THEN 'basico' WHEN x.ord <= p_intermedio_max THEN 'intermedio' ELSE 'avanzado' END
  FROM unnest(p_order) WITH ORDINALITY AS x(num, ord);

  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'set_blocks', v_comp.id, v_before,
          jsonb_build_object('order', to_jsonb(p_order), 'basico_max', p_basico_max, 'intermedio_max', p_intermedio_max));
  RETURN jsonb_build_object('success', true, 'count', v_n);
END;
$function$;

-- Fijar el nivel de alguien a mano (NULL = automático por sus tops).
CREATE OR REPLACE FUNCTION public.admin_set_level_override(p_registration_id UUID, p_level TEXT, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_reg    competition_registrations%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_level IS NOT NULL AND p_level NOT IN ('basico','intermedio','avanzado') THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE competition_registrations SET level_override = p_level, updated_at = now() WHERE id = v_reg.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'set_level_override', v_reg.competition_id, v_reg.id,
          jsonb_build_object('level_override', v_reg.level_override), jsonb_build_object('level_override', p_level), v_reason);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Ajustes: además de los de antes, count_best y zone_ratio.
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
  IF p_patch ? 'count_best' THEN v_new.count_best := (p_patch->>'count_best')::int; END IF;
  IF p_patch ? 'zone_ratio' THEN v_new.zone_ratio := (p_patch->>'zone_ratio')::numeric; END IF;
  IF v_new.score_top <= 0 OR v_new.score_zone < 0 OR v_new.score_zone >= v_new.score_top
     OR v_new.score_attempt_penalty < 0 OR v_new.score_attempt_penalty > 1
     OR v_new.count_best < 1 OR v_new.count_best > 50
     OR v_new.zone_ratio < 0 OR v_new.zone_ratio >= 1 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  UPDATE competitions SET score_top = v_new.score_top, score_zone = v_new.score_zone,
    score_attempt_penalty = v_new.score_attempt_penalty, ranking_public = v_new.ranking_public,
    count_best = v_new.count_best, zone_ratio = v_new.zone_ratio
  WHERE id = v_comp.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'update_scoring', v_comp.id, to_jsonb(v_comp), to_jsonb(v_new));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Panel de puntos: igual que antes más los bloques y el modo.
CREATE OR REPLACE FUNCTION public.get_competition_scoring_admin(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_bm   BOOLEAN;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_bm := competition_blocks_mode(v_comp.id);

  RETURN jsonb_build_object(
    'competition', jsonb_build_object(
      'name', v_comp.name, 'score_top', v_comp.score_top, 'score_zone', v_comp.score_zone,
      'score_attempt_penalty', v_comp.score_attempt_penalty, 'ranking_public', v_comp.ranking_public,
      'count_best', v_comp.count_best, 'zone_ratio', v_comp.zone_ratio, 'blocks_mode', v_bm),
    'blocks', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('route_number', b.route_number, 'value', b.value, 'level', b.level)
             ORDER BY b.value), '[]'::jsonb)
      FROM competition_blocks b WHERE b.competition_id = v_comp.id),
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', cc.id, 'name', cc.name, 'route_numbers', to_jsonb(cc.route_numbers), 'merge_into', cc.merge_into,
               'gender', cc.gender, 'level', cc.level)
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
               'level_override', (SELECT r.level_override FROM competition_registrations r WHERE r.id = k.registration_id),
               'routes', (
                 SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'route_number', rr.route_number, 'attempts', rr.attempts, 'topped', rr.topped,
                          'zoned', rr.zoned, 'flash', rr.flash, 'zone_first', rr.zone_first, 'points', rr.points,
                          'block_value', rr.block_value, 'block_level', rr.block_level)
                        ORDER BY rr.points DESC, rr.block_value DESC NULLS LAST, rr.route_number), '[]'::jsonb)
                 FROM competition_route_results(v_comp.id) rr WHERE rr.registration_id = k.registration_id),
               'promotion_hint', CASE WHEN v_bm THEN NULL ELSE competition_promotion_hint(k.tops, k.flashes,
                 (SELECT cardinality(ec.route_numbers) FROM competition_categories ec WHERE ec.id = k.effective_category_id)) END)
             ORDER BY k.place, k.bib), '[]'::jsonb)
      FROM competition_ranking(v_comp.id) k),
    'attempts', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'bib', x.bib, 'full_name', x.full_name, 'route_number', x.route_number,
               'result', x.result, 'judge_name', x.judge_name, 'created_at', x.created_at,
               'voided_at', x.voided_at, 'void_reason', x.void_reason, 'counts', x.counts)
             ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (SELECT at.*, r.bib, r.full_name, j.name AS judge_name,
                   CASE WHEN v_bm THEN EXISTS (SELECT 1 FROM competition_blocks b
                                               WHERE b.competition_id = at.competition_id AND b.route_number = at.route_number)
                        ELSE at.category_id = r.category_id END AS counts
            FROM competition_attempts at
            JOIN competition_registrations r ON r.id = at.registration_id
            LEFT JOIN competition_judges j ON j.id = at.judge_id
            WHERE at.competition_id = v_comp.id
            ORDER BY at.created_at DESC LIMIT 300) x)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_blocks(TEXT, INT[], INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_level_override(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_blocks(TEXT, INT[], INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_level_override(UUID, TEXT, TEXT) TO authenticated;

SELECT 'bloques listo' AS ok,
       (SELECT count(*) FROM competition_blocks) AS bloques;
