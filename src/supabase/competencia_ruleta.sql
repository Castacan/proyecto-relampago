-- ============================================================
-- Ruleta de la rifa en la TV + boletos extra (pedido del dueño, 2026-11-05)
-- ============================================================
-- * Boletos extra: el admin le da boletos adicionales a quien completó una
--   dinámica previa (p. ej. 10 personas con +1). Boletos = zonas + extra.
-- * Ruleta pública (TV / proyector): get_competition_raffle_wheel regresa quién
--   está en la tómbola con cuántos boletos y los sorteos hechos, para que la
--   pantalla gire sola cuando el admin pica "Sortear".
-- Correr DESPUÉS de competencia_rifa.sql y competencia_bloques.sql.
-- Se puede correr más de una vez.

ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS raffle_bonus INT NOT NULL DEFAULT 0;
-- Modo neutral (2026-11-05): los sorteos hechos hasta esta hora ya no se anuncian en la pantalla.
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS raffle_wheel_cleared_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_registrations_raffle_bonus_range') THEN
    ALTER TABLE public.competition_registrations
      ADD CONSTRAINT competition_registrations_raffle_bonus_range CHECK (raffle_bonus BETWEEN 0 AND 20);
  END IF;
END $$;

-- Boletos por persona: 1 por bloque/ruta con zona (el top cuenta) + boletos extra.
CREATE OR REPLACE FUNCTION public.competition_raffle_tickets(p_competition_id UUID)
RETURNS TABLE (registration_id UUID, tickets INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT r.id, (coalesce(z.n, 0) + r.raffle_bonus)::int
  FROM competition_registrations r
  LEFT JOIN (SELECT rr.registration_id, count(*) FILTER (WHERE rr.zoned)::int AS n
             FROM competition_route_results(p_competition_id) rr
             GROUP BY rr.registration_id) z ON z.registration_id = r.id
  WHERE r.competition_id = p_competition_id
    AND (coalesce(z.n, 0) > 0 OR r.raffle_bonus > 0);
$function$;
REVOKE ALL ON FUNCTION public.competition_raffle_tickets(UUID) FROM PUBLIC, anon, authenticated;

-- Panel de la rifa: igual que antes, más zonas y extra por persona.
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
      WHERE r.competition_id = v_comp.id AND r.status = 'paid')
  );
END;
$function$;

-- Boletos extra de una persona (0 a 20).
CREATE OR REPLACE FUNCTION public.admin_raffle_set_bonus(p_registration_id UUID, p_bonus INT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_reg competition_registrations%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_bonus IS NULL OR p_bonus < 0 OR p_bonus > 20 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  SELECT * INTO v_reg FROM competition_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE competition_registrations SET raffle_bonus = p_bonus WHERE id = p_registration_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'raffle_bonus', v_reg.competition_id, v_reg.id,
          jsonb_build_object('raffle_bonus', v_reg.raffle_bonus), jsonb_build_object('raffle_bonus', p_bonus), NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Pública (TV): quién está en la tómbola y los sorteos hechos. Solo nombres y boletos.
CREATE OR REPLACE FUNCTION public.get_competition_raffle_wheel(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'name', v_comp.name,
    'now', now(),
    'cleared_at', v_comp.raffle_wheel_cleared_at,
    'entries', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'bib', NULL, 'tickets', x.tickets)
             ORDER BY r.bib NULLS LAST, r.id), '[]'::jsonb)
      FROM competition_raffle_pool(v_comp.id) x
      JOIN competition_registrations r ON r.id = x.registration_id),
    'draws', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'prize_id', p.id, 'prize', p.name, 'sponsor', p.sponsor, 'drawn_at', p.drawn_at,
               'winner_id', r.id, 'full_name', r.full_name, 'bib', r.bib, 'tickets', p.winner_tickets)
             ORDER BY p.drawn_at), '[]'::jsonb)
      FROM competition_raffle_prizes p
      JOIN competition_registrations r ON r.id = p.winner_registration_id
      WHERE p.competition_id = v_comp.id),
    'prizes_total', (SELECT count(*) FROM competition_raffle_prizes p WHERE p.competition_id = v_comp.id),
    'next_prize', (
      SELECT jsonb_build_object('name', p.name, 'sponsor', p.sponsor)
      FROM competition_raffle_prizes p
      WHERE p.competition_id = v_comp.id AND p.winner_registration_id IS NULL
      ORDER BY p.sort_order, p.created_at LIMIT 1)
  );
END;
$function$;

-- Modo neutral: la pantalla quita el anuncio y los nombres del último ganador (entre giro y giro).
CREATE OR REPLACE FUNCTION public.admin_raffle_clear_wheel(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE competitions SET raffle_wheel_cleared_at = now() WHERE id = v_comp.id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_raffle_clear_wheel(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_raffle_clear_wheel(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_raffle_set_bonus(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_raffle_set_bonus(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_raffle_wheel(TEXT) TO anon, authenticated;

SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('get_competition_raffle_wheel', 'admin_raffle_clear_wheel')) AS ruleta_lista;
