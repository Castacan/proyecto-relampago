-- ============================================================
-- Pendientes de pago CON número cuentan como inscritos (pedido del dueño, 2026-11-06)
-- ============================================================
-- Personas que avisaron que pagan en efectivo el día del evento: el admin les
-- pone número (admin_set_bib) y desde ese momento pueden hacer check-in,
-- competir con los jueces, salir en el ranking y entrar a la rifa. El dueño las
-- marca como pagadas después; al pagar conservan su número.
-- Sin número (reserva vencida, expiradas, canceladas) siguen fuera.
-- Correr DESPUÉS de competencia_checkin.sql (redefine las funciones de abajo con
-- ese único cambio; el resto es idéntico a su archivo de origen). Se puede correr más de una vez.

CREATE OR REPLACE FUNCTION public.competition_in_event(p_status TEXT, p_bib INT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $function$
  SELECT p_status = 'paid' OR (p_status = 'pending_payment' AND p_bib IS NOT NULL);
$function$;

-- De competencia_checkin.sql
CREATE OR REPLACE FUNCTION public.competition_checkin_start(p_slug TEXT, p_bib INT, p_first_name TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp   competitions%ROWTYPE;
  v_reg    competition_registrations%ROWTYPE;
  v_token  TEXT;
  v_minor  BOOLEAN;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  -- Freno: 5 fallos seguidos con el mismo número en 10 min, o 30 fallos en total en 10 min.
  IF (SELECT count(*) FROM competition_checkin_tries t
      WHERE t.competition_id = v_comp.id AND t.bib = p_bib AND NOT t.ok AND t.created_at > now() - interval '10 minutes') >= 5
     OR (SELECT count(*) FROM competition_checkin_tries t
         WHERE t.competition_id = v_comp.id AND NOT t.ok AND t.created_at > now() - interval '10 minutes') >= 30 THEN
    RETURN jsonb_build_object('error', 'too_many_tries');
  END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.competition_id = v_comp.id AND r.bib = p_bib AND competition_in_event(r.status, r.bib);
  IF NOT FOUND OR competition_first_name_key(v_reg.full_name) <> competition_first_name_key(p_first_name)
     OR competition_first_name_key(p_first_name) = '' THEN
    INSERT INTO competition_checkin_tries (competition_id, bib, ok) VALUES (v_comp.id, p_bib, false);
    RETURN jsonb_build_object('error', 'checkin_not_found');
  END IF;
  INSERT INTO competition_checkin_tries (competition_id, bib, ok) VALUES (v_comp.id, p_bib, true);

  IF NOT EXISTS (SELECT 1 FROM competition_documents d WHERE d.competition_id = v_comp.id AND d.active) THEN
    RETURN jsonb_build_object('error', 'no_documents');
  END IF;

  v_minor := v_reg.birth_date > (v_comp.event_date - INTERVAL '18 years')::date;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  DELETE FROM competition_checkin_sessions WHERE expires_at < now() - interval '1 day';
  INSERT INTO competition_checkin_sessions (token, registration_id, expires_at)
  VALUES (v_token, v_reg.id, now() + interval '45 minutes');

  RETURN jsonb_build_object(
    'token', v_token,
    'full_name', v_reg.full_name,
    'bib', v_reg.bib,
    'is_minor', v_minor,
    'checked_in_at', v_reg.checked_in_at,
    -- Solo los documentos que le faltan por firmar.
    'documents', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'body', d.body)
             ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
      FROM competition_documents d
      WHERE d.competition_id = v_comp.id AND d.active
        AND NOT EXISTS (SELECT 1 FROM competition_signatures s WHERE s.registration_id = v_reg.id AND s.document_id = d.id))
  );
END;
$function$;

-- De competencia_checkin.sql
CREATE OR REPLACE FUNCTION public.competition_checkin_sign(
  p_token TEXT, p_document_id UUID, p_signer_name TEXT, p_signature_png TEXT,
  p_guardian_name TEXT, p_guardian_relation TEXT, p_user_agent TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sess   competition_checkin_sessions%ROWTYPE;
  v_reg    competition_registrations%ROWTYPE;
  v_comp   competitions%ROWTYPE;
  v_doc    competition_documents%ROWTYPE;
  v_minor  BOOLEAN;
  v_name   TEXT := btrim(coalesce(p_signer_name, ''));
  v_gname  TEXT := nullif(btrim(coalesce(p_guardian_name, '')), '');
  v_left   INT;
BEGIN
  SELECT * INTO v_sess FROM competition_checkin_sessions WHERE token = p_token;
  IF NOT FOUND OR v_sess.expires_at < now() THEN RETURN jsonb_build_object('error', 'checkin_expired'); END IF;
  SELECT * INTO v_reg FROM competition_registrations WHERE id = v_sess.registration_id FOR UPDATE;
  SELECT * INTO v_comp FROM competitions WHERE id = v_reg.competition_id;
  IF NOT competition_in_event(v_reg.status, v_reg.bib) THEN RETURN jsonb_build_object('error', 'checkin_not_found'); END IF;
  SELECT * INTO v_doc FROM competition_documents WHERE id = p_document_id AND competition_id = v_comp.id AND active;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF length(v_name) < 3 OR length(v_name) > 160 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF p_signature_png IS NULL OR p_signature_png NOT LIKE 'data:image/png;base64,%'
     OR length(p_signature_png) < 500 OR length(p_signature_png) > 600000 THEN
    RETURN jsonb_build_object('error', 'signature_required');
  END IF;
  v_minor := v_reg.birth_date > (v_comp.event_date - INTERVAL '18 years')::date;
  IF v_minor AND (v_gname IS NULL OR length(v_gname) < 3) THEN RETURN jsonb_build_object('error', 'guardian_required'); END IF;

  INSERT INTO competition_signatures (registration_id, document_id, document_title, document_body, signer_name,
                                      signature_png, is_minor, guardian_name, guardian_relation, user_agent)
  VALUES (v_reg.id, v_doc.id, v_doc.title, v_doc.body, v_name, p_signature_png, v_minor,
          CASE WHEN v_minor THEN v_gname END,
          CASE WHEN v_minor THEN nullif(btrim(coalesce(p_guardian_relation, '')), '') END,
          left(p_user_agent, 400))
  ON CONFLICT (registration_id, document_id) DO NOTHING;

  SELECT count(*) INTO v_left FROM competition_documents d
  WHERE d.competition_id = v_comp.id AND d.active
    AND NOT EXISTS (SELECT 1 FROM competition_signatures s WHERE s.registration_id = v_reg.id AND s.document_id = d.id);

  IF v_left = 0 AND v_reg.checked_in_at IS NULL THEN
    UPDATE competition_registrations SET checked_in_at = now() WHERE id = v_reg.id;
    INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
    VALUES (NULL, 'self_check_in', v_comp.id, v_reg.id, NULL, jsonb_build_object('signed', true), NULL);
  END IF;

  RETURN jsonb_build_object('success', true, 'remaining', v_left,
    'checked_in_at', (SELECT checked_in_at FROM competition_registrations WHERE id = v_reg.id));
END;
$function$;

-- De competencia_checkin.sql
CREATE OR REPLACE FUNCTION public.get_competition_checkin_admin(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object(
    'documents', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'body', d.body,
               'sort_order', d.sort_order, 'active', d.active,
               'signed', (SELECT count(*) FROM competition_signatures s WHERE s.document_id = d.id))
             ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
      FROM competition_documents d WHERE d.competition_id = v_comp.id),
    'people', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'registration_id', r.id, 'bib', r.bib, 'full_name', r.full_name, 'time_slot_id', r.time_slot_id,
               'shirt_size', r.shirt_size, 'checked_in_at', r.checked_in_at, 'pending_payment', r.status <> 'paid',
               'is_minor', r.birth_date > (v_comp.event_date - INTERVAL '18 years')::date,
               'signed', (SELECT count(*) FROM competition_signatures s
                          JOIN competition_documents d ON d.id = s.document_id AND d.active
                          WHERE s.registration_id = r.id),
               'last_signed_at', (SELECT max(s.signed_at) FROM competition_signatures s WHERE s.registration_id = r.id))
             ORDER BY r.bib NULLS LAST, r.full_name), '[]'::jsonb)
      FROM competition_registrations r
      WHERE r.competition_id = v_comp.id AND competition_in_event(r.status, r.bib)),
    'slots', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label) ORDER BY s.sort_order), '[]'::jsonb)
      FROM competition_time_slots s WHERE s.competition_id = v_comp.id)
  );
END;
$function$;

-- De competencia_jueces.sql
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
  IF NOT competition_in_event(v_reg.status, v_reg.bib) THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;
  RETURN competition_competitor_card(v_reg.id);
END;
$function$;

-- De competencia_bloques.sql
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
  IF NOT competition_in_event(v_reg.status, v_reg.bib) THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;

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

-- De competencia_jueces.sql
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
  IF NOT competition_in_event(v_reg.status, v_reg.bib) THEN RETURN jsonb_build_object('error', 'not_paid'); END IF;
  INSERT INTO competition_attempts (competition_id, registration_id, category_id, route_number, result, actor_id)
  VALUES (v_comp.id, v_reg.id, v_reg.category_id, p_route, p_result, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, after, reason)
  VALUES (auth.uid(), 'add_attempt', v_comp.id, v_reg.id,
          jsonb_build_object('attempt_id', v_id, 'route_number', p_route, 'result', p_result), v_reason);
  RETURN jsonb_build_object('success', true, 'attempt_id', v_id);
END;
$function$;

-- De competencia_bloques.sql
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
      WHERE r.competition_id = p_competition_id AND competition_in_event(r.status, r.bib)
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
           -- Solo bloques que dieron puntos (2026-11-07: un bloque de puras caídas no desempata).
           coalesce(array_agg(rr.points ORDER BY rr.k) FILTER (WHERE rr.k > v_best AND rr.points > 0), '{}') AS extra,
           max(rr.last_at) AS last_at,
           max(rr.achieved_at) AS achieved_at
    FROM competition_registrations r
    JOIN competition_categories cc ON cc.id = r.category_id
    LEFT JOIN rr ON rr.registration_id = r.id
    WHERE r.competition_id = p_competition_id AND competition_in_event(r.status, r.bib)
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

-- De competencia_rifa.sql
CREATE OR REPLACE FUNCTION public.competition_raffle_pool(p_competition_id UUID)
RETURNS TABLE (registration_id UUID, tickets INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT t.registration_id, t.tickets
  FROM competition_raffle_tickets(p_competition_id) t
  JOIN competition_registrations r ON r.id = t.registration_id
  WHERE competition_in_event(r.status, r.bib) AND NOT r.raffle_excluded AND t.tickets > 0
    AND NOT EXISTS (SELECT 1 FROM competition_raffle_prizes p WHERE p.winner_registration_id = r.id);
$function$;

-- De competencia_ruleta.sql
CREATE OR REPLACE FUNCTION public.get_competition_raffle_admin(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'name', v_comp.name,
    'prizes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'sponsor', p.sponsor, 'sort_order', p.sort_order,
               'drawn_at', p.drawn_at, 'winner_tickets', p.winner_tickets,
               'pool_tickets', p.pool_tickets, 'pool_people', p.pool_people,
               'winner', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'registration_id', r.id, 'full_name', r.full_name, 'bib', r.bib, 'folio', r.folio,
                 'category', cc.name) END)
             ORDER BY p.sort_order, p.created_at), '[]'::jsonb)
      FROM competition_raffle_prizes p
      LEFT JOIN competition_registrations r ON r.id = p.winner_registration_id
      LEFT JOIN competition_categories cc ON cc.id = r.category_id
      WHERE p.competition_id = v_comp.id),
    'participants', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'registration_id', r.id, 'full_name', r.full_name, 'bib', r.bib, 'category', cc.name,
               'tickets', coalesce(t.tickets, 0), 'bonus', r.raffle_bonus,
               'excluded', r.raffle_excluded,
               'won', (SELECT p.name FROM competition_raffle_prizes p WHERE p.winner_registration_id = r.id))
             ORDER BY coalesce(t.tickets, 0) DESC, r.full_name), '[]'::jsonb)
      FROM competition_registrations r
      JOIN competition_categories cc ON cc.id = r.category_id
      LEFT JOIN competition_raffle_tickets(v_comp.id) t ON t.registration_id = r.id
      WHERE r.competition_id = v_comp.id AND competition_in_event(r.status, r.bib))
  );
END;
$function$;

SELECT count(*) AS pendientes_con_numero FROM competition_registrations WHERE status = 'pending_payment' AND bib IS NOT NULL;
