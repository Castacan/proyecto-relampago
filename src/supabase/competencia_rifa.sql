-- ============================================================
-- Rifa de premios al final de la competencia (pedido del dueño, 2026-11-04)
-- ============================================================
-- Reglas:
--   * Cada ruta en la que el competidor llegó a zona le da 1 boleto. Un top
--     también cuenta (para llegar al top pasó por la zona). Se cuentan las
--     mismas rutas que en el ranking: intentos no anulados, de su categoría.
--   * Cada persona gana máximo 1 premio: quien gana sale de las rifas siguientes.
--   * No hay que estar presente para ganar.
--   * El staff no participa: el admin marca a una persona "fuera de la rifa".
--   * Solo participan inscripciones pagadas (incluye cortesías) con al menos 1 boleto.
-- Requiere competencia_jueces.sql (competition_route_results).
-- Se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS public.competition_raffle_prizes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES public.competitions (id),
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sponsor         TEXT CHECK (sponsor IS NULL OR length(sponsor) <= 80),
  sort_order      INT NOT NULL DEFAULT 0,
  winner_registration_id UUID REFERENCES public.competition_registrations (id),
  drawn_at        TIMESTAMPTZ,
  drawn_by        UUID,
  winner_tickets  INT,   -- boletos del ganador al momento del sorteo
  pool_tickets    INT,   -- boletos en la tómbola al momento del sorteo
  pool_people     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competition_raffle_prizes_comp ON public.competition_raffle_prizes (competition_id, sort_order);
-- Una persona no puede tener dos premios.
CREATE UNIQUE INDEX IF NOT EXISTS competition_raffle_one_prize
  ON public.competition_raffle_prizes (winner_registration_id) WHERE winner_registration_id IS NOT NULL;

ALTER TABLE public.competition_raffle_prizes ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo se usa a través de las funciones de abajo.

ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS raffle_excluded BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- Boletos por persona
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_raffle_tickets(p_competition_id UUID)
RETURNS TABLE (registration_id UUID, tickets INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT rr.registration_id, count(*) FILTER (WHERE rr.zoned)::int
  FROM competition_route_results(p_competition_id) rr
  GROUP BY rr.registration_id;
$function$;

-- Quiénes pueden ganar ahora: pagados, no excluidos, sin premio y con boletos.
CREATE OR REPLACE FUNCTION public.competition_raffle_pool(p_competition_id UUID)
RETURNS TABLE (registration_id UUID, tickets INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT t.registration_id, t.tickets
  FROM competition_raffle_tickets(p_competition_id) t
  JOIN competition_registrations r ON r.id = t.registration_id
  WHERE r.status = 'paid' AND NOT r.raffle_excluded AND t.tickets > 0
    AND NOT EXISTS (SELECT 1 FROM competition_raffle_prizes p WHERE p.winner_registration_id = r.id);
$function$;

-- ------------------------------------------------------------
-- Panel
-- ------------------------------------------------------------
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
               'tickets', coalesce(t.tickets, 0), 'excluded', r.raffle_excluded,
               'won', (SELECT p.name FROM competition_raffle_prizes p WHERE p.winner_registration_id = r.id))
             ORDER BY coalesce(t.tickets, 0) DESC, r.full_name), '[]'::jsonb)
      FROM competition_registrations r
      JOIN competition_categories cc ON cc.id = r.category_id
      LEFT JOIN competition_raffle_tickets(v_comp.id) t ON t.registration_id = r.id
      WHERE r.competition_id = v_comp.id AND r.status = 'paid')
  );
END;
$function$;

-- Sortea un premio. Elige al azar entre los boletos de quienes pueden ganar.
CREATE OR REPLACE FUNCTION public.admin_raffle_draw(p_prize_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_prize competition_raffle_prizes%ROWTYPE;
  v_total INT;
  v_people INT;
  v_pick INT;
  v_winner UUID;
  v_tickets INT;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_prize FROM competition_raffle_prizes WHERE id = p_prize_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  -- Un sorteo a la vez por competencia (dos clics al mismo tiempo no eligen a la misma persona).
  PERFORM 1 FROM competitions WHERE id = v_prize.competition_id FOR UPDATE;
  SELECT * INTO v_prize FROM competition_raffle_prizes WHERE id = p_prize_id FOR UPDATE;
  IF v_prize.winner_registration_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_drawn'); END IF;

  SELECT coalesce(sum(tickets), 0)::int, count(*)::int INTO v_total, v_people
  FROM competition_raffle_pool(v_prize.competition_id);
  IF v_total = 0 THEN RETURN jsonb_build_object('error', 'no_tickets'); END IF;

  -- Boleto ganador entre 0 y total-1; gana quien lo tiene (cada boleto pesa igual).
  v_pick := floor(random() * v_total)::int;
  SELECT p.registration_id, p.tickets INTO v_winner, v_tickets
  FROM (SELECT x.registration_id, x.tickets, sum(x.tickets) OVER (ORDER BY x.registration_id) AS upto
        FROM competition_raffle_pool(v_prize.competition_id) x) p
  WHERE p.upto > v_pick ORDER BY p.upto LIMIT 1;

  UPDATE competition_raffle_prizes
     SET winner_registration_id = v_winner, drawn_at = now(), drawn_by = auth.uid(),
         winner_tickets = v_tickets, pool_tickets = v_total, pool_people = v_people
   WHERE id = p_prize_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'raffle_draw', v_prize.competition_id, v_winner, NULL,
          jsonb_build_object('prize', v_prize.name, 'tickets', v_tickets, 'pool_tickets', v_total, 'pool_people', v_people), NULL);

  RETURN (SELECT jsonb_build_object('success', true, 'prize', v_prize.name,
            'winner', jsonb_build_object('registration_id', r.id, 'full_name', r.full_name, 'bib', r.bib,
                                         'folio', r.folio, 'category', cc.name),
            'tickets', v_tickets, 'pool_tickets', v_total, 'pool_people', v_people)
          FROM competition_registrations r JOIN competition_categories cc ON cc.id = r.category_id
          WHERE r.id = v_winner);
END;
$function$;

-- Deshace un sorteo (por error): el premio vuelve a quedar sin ganador y la persona vuelve a la tómbola.
CREATE OR REPLACE FUNCTION public.admin_raffle_undo(p_prize_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_prize competition_raffle_prizes%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_prize FROM competition_raffle_prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_prize.winner_registration_id IS NULL THEN RETURN jsonb_build_object('error', 'not_drawn'); END IF;
  UPDATE competition_raffle_prizes
     SET winner_registration_id = NULL, drawn_at = NULL, drawn_by = NULL,
         winner_tickets = NULL, pool_tickets = NULL, pool_people = NULL
   WHERE id = p_prize_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'raffle_undo', v_prize.competition_id, v_prize.winner_registration_id,
          jsonb_build_object('prize', v_prize.name), NULL, nullif(trim(coalesce(p_reason, '')), ''));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Agrega (p_id NULL) o edita un premio.
CREATE OR REPLACE FUNCTION public.admin_raffle_save_prize(p_slug TEXT, p_id UUID, p_name TEXT, p_sponsor TEXT, p_sort_order INT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_name TEXT := trim(coalesce(p_name, ''));
  v_sponsor TEXT := nullif(trim(coalesce(p_sponsor, '')), '');
  v_id UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(v_name) NOT BETWEEN 1 AND 120 OR length(coalesce(v_sponsor, '')) > 80 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO competition_raffle_prizes (competition_id, name, sponsor, sort_order)
    VALUES (v_comp.id, v_name, v_sponsor,
            coalesce(p_sort_order, (SELECT coalesce(max(sort_order), 0) + 1 FROM competition_raffle_prizes WHERE competition_id = v_comp.id)))
    RETURNING id INTO v_id;
  ELSE
    UPDATE competition_raffle_prizes
       SET name = v_name, sponsor = v_sponsor, sort_order = coalesce(p_sort_order, sort_order)
     WHERE id = p_id AND competition_id = v_comp.id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Borra un premio que todavía no se sortea.
CREATE OR REPLACE FUNCTION public.admin_raffle_delete_prize(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_prize competition_raffle_prizes%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_prize FROM competition_raffle_prizes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_prize.winner_registration_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_drawn'); END IF;
  DELETE FROM competition_raffle_prizes WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Saca (o regresa) a una persona de la rifa: el staff no participa.
CREATE OR REPLACE FUNCTION public.admin_raffle_set_excluded(p_registration_id UUID, p_excluded BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_reg competition_registrations%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_reg FROM competition_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE competition_registrations SET raffle_excluded = coalesce(p_excluded, false) WHERE id = p_registration_id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'raffle_excluded', v_reg.competition_id, v_reg.id,
          jsonb_build_object('raffle_excluded', v_reg.raffle_excluded),
          jsonb_build_object('raffle_excluded', coalesce(p_excluded, false)), NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_raffle_tickets(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_raffle_pool(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_competition_raffle_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_raffle_draw(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_raffle_undo(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_raffle_save_prize(TEXT, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_raffle_delete_prize(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_raffle_set_excluded(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competition_raffle_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_raffle_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_raffle_undo(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_raffle_save_prize(TEXT, UUID, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_raffle_delete_prize(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_raffle_set_excluded(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- Premios al 2026-11-04 (solo si todavía no hay ninguno). El hangboard va al final.
-- ------------------------------------------------------------
INSERT INTO public.competition_raffle_prizes (competition_id, name, sponsor, sort_order)
SELECT c.id, v.name, v.sponsor, v.sort_order
FROM public.competitions c
CROSS JOIN (VALUES
  ('Clase gratis (1 de 2)',  'Casa Luma',   1),
  ('Clase gratis (2 de 2)',  'Casa Luma',   2),
  ('Cortesía',               'Complemento', 3),
  ('Magnesiera chica',       'Acopa',       4),
  ('Magnesiera grande',      'Acopa',       5),
  ('Magnesia (1 de 3)',      'Yohua',       6),
  ('Magnesia (2 de 3)',      'Yohua',       7),
  ('Magnesia (3 de 3)',      'Yohua',       8),
  ('Tapete de yoga',         'Casa Luma',   9),
  ('Par de pullups',         'Eskalametra', 10),
  ('Sudadera (1 de 2)',      'Yohua',       11),
  ('Sudadera (2 de 2)',      'Yohua',       12),
  ('Hangboard',              'Eskalametra', 13)
) AS v(name, sponsor, sort_order)
WHERE c.slug = 'competencia-2026'
  AND NOT EXISTS (SELECT 1 FROM public.competition_raffle_prizes p WHERE p.competition_id = c.id);
