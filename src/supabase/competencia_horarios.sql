-- ============================================================
-- Competencia — horarios (bloques) mezclando categorías (2026-11-03)
--
-- Requiere competencia.sql, competencia_manual.sql y
-- competencia_cortesias.sql. Se puede correr más de una vez.
--
-- Decisiones del dueño:
--   * Ya no se compite por categoría en horarios separados: cada bloque
--     de 2 h mezcla categorías. Bloques: 10:00–12:00, 12:30–2:30 y
--     3:00–5:00 (clausura y premiación 5:30–6:00).
--   * Cupo por bloque que SUBE SOLO: empieza en slot_capacity (15). Cuando
--     TODOS los bloques llegan al cupo, todos suben slot_capacity_step (5)
--     lugares: 15 → 20 → 25... (con step 0 nunca sube).
--   * Quien se inscribe elige su bloque. Quien ya estaba inscrito lo elige
--     una vez desde "Consulta tu inscripción" (le llega un correo con el
--     link). Ya elegido, solo el staff lo cambia.
--   * El staff puede asignar a cualquier bloque aunque esté lleno.
--
-- Los lugares ocupados de un bloque se cuentan igual que el cupo general:
-- pagados + por atender + pendientes con reserva vigente.
-- Las funciones viejas (register_for_competition, competition_register_
-- courtesy, admin_register_participant) no se tocan: las nuevas las
-- envuelven en la misma transacción.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_time_slots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id),
  label          TEXT NOT NULL,          -- lo que ve la gente, ej. "10:00 am a 12:00 pm"
  starts_at      TIME NOT NULL,
  ends_at        TIME NOT NULL,
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, starts_at)
);

ALTER TABLE public.competition_time_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_time_slots FROM anon, authenticated;

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS slot_capacity      INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS slot_capacity_step INT NOT NULL DEFAULT 5;

ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS time_slot_id        UUID REFERENCES public.competition_time_slots(id),
  ADD COLUMN IF NOT EXISTS slot_invite_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS competition_registrations_slot_idx
  ON public.competition_registrations (time_slot_id);

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.competition_slot_taken(p_slot_id UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT count(*)::int
  FROM competition_registrations r
  WHERE r.time_slot_id = p_slot_id
    AND (r.status IN ('paid','needs_attention')
         OR (r.status = 'pending_payment' AND r.hold_expires_at > now()));
$function$;

-- Cupo vigente de cada bloque (igual para todos). Sube un escalón cada
-- vez que el bloque con MENOS gente ya llegó al cupo: así solo crece
-- cuando todos están llenos.
CREATE OR REPLACE FUNCTION public.competition_slot_capacity(p_competition_id UUID)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_base INT;
  v_step INT;
  v_min  INT;
BEGIN
  SELECT c.slot_capacity, c.slot_capacity_step INTO v_base, v_step
  FROM competitions c WHERE c.id = p_competition_id;
  SELECT min(competition_slot_taken(s.id)) INTO v_min
  FROM competition_time_slots s WHERE s.competition_id = p_competition_id;
  IF v_min IS NULL OR v_min < v_base OR coalesce(v_step, 0) <= 0 THEN RETURN v_base; END IF;
  RETURN v_base + v_step * ((v_min - v_base) / v_step + 1);
END;
$function$;

-- Lista de bloques para mostrar. p_detail = true agrega cuántos hay
-- (solo para el panel).
CREATE OR REPLACE FUNCTION public.competition_slots_json(p_competition_id UUID, p_detail BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_cap INT := competition_slot_capacity(p_competition_id);
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object('id', s.id, 'label', s.label, 'is_full', t.taken >= v_cap)
      || CASE WHEN p_detail THEN jsonb_build_object('taken', t.taken, 'starts_at', s.starts_at) ELSE '{}'::jsonb END
      ORDER BY s.sort_order, s.starts_at), '[]'::jsonb)
    FROM competition_time_slots s
    CROSS JOIN LATERAL (SELECT competition_slot_taken(s.id) AS taken) t
    WHERE s.competition_id = p_competition_id
  );
END;
$function$;

-- ¿Se puede elegir este bloque ahora? Devuelve NULL si sí, o el código
-- de error. Debe llamarse con la fila de la competencia bloqueada.
CREATE OR REPLACE FUNCTION public.competition_check_slot(p_competition_id UUID, p_slot_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF p_slot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM competition_time_slots s WHERE s.id = p_slot_id AND s.competition_id = p_competition_id) THEN
    RETURN 'invalid_slot';
  END IF;
  IF competition_slot_taken(p_slot_id) >= competition_slot_capacity(p_competition_id) THEN
    RETURN 'slot_full';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_slot_taken(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_slot_capacity(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_slots_json(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_check_slot(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Públicas
-- ------------------------------------------------------------

-- Bloques de la competencia para el formulario. Sin conteos: solo si
-- están llenos.
CREATE OR REPLACE FUNCTION public.get_competition_slots_public(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  SELECT c.id INTO v_id FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('slots', competition_slots_json(v_id));
END;
$function$;

-- Inscripción con horario. Misma transacción: si el bloque está lleno no
-- se crea nada; si la inscripción falla, no se aparta el bloque.
CREATE OR REPLACE FUNCTION public.register_for_competition_slot(
  p_slug           TEXT,
  p_full_name      TEXT,
  p_birth_date     DATE,
  p_email          TEXT,
  p_phone          TEXT,
  p_category_id    UUID,
  p_shirt_size     TEXT,
  p_accept_privacy BOOLEAN,
  p_accept_waiver  BOOLEAN,
  p_time_slot_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp_id UUID;
  v_err     TEXT;
  v_result  JSONB;
  v_label   TEXT;
BEGIN
  SELECT c.id INTO v_comp_id FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_err := competition_check_slot(v_comp_id, p_time_slot_id);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;

  v_result := register_for_competition(p_slug, p_full_name, p_birth_date, p_email, p_phone,
                                       p_category_id, p_shirt_size, p_accept_privacy, p_accept_waiver);
  IF v_result ? 'error' THEN RETURN v_result; END IF;

  UPDATE competition_registrations r SET time_slot_id = p_time_slot_id
  WHERE r.folio = v_result->>'folio';
  SELECT s.label INTO v_label FROM competition_time_slots s WHERE s.id = p_time_slot_id;
  RETURN v_result || jsonb_build_object('time_slot_label', v_label);
END;
$function$;

-- Lo mismo con código de cortesía (lo llama la Edge Function).
CREATE OR REPLACE FUNCTION public.competition_register_courtesy_slot(
  p_slug           TEXT,
  p_full_name      TEXT,
  p_birth_date     DATE,
  p_email          TEXT,
  p_phone          TEXT,
  p_category_id    UUID,
  p_shirt_size     TEXT,
  p_accept_privacy BOOLEAN,
  p_accept_waiver  BOOLEAN,
  p_code           TEXT,
  p_time_slot_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp_id UUID;
  v_err     TEXT;
  v_result  JSONB;
  v_label   TEXT;
BEGIN
  SELECT c.id INTO v_comp_id FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_err := competition_check_slot(v_comp_id, p_time_slot_id);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;

  v_result := competition_register_courtesy(p_slug, p_full_name, p_birth_date, p_email, p_phone,
                                            p_category_id, p_shirt_size, p_accept_privacy, p_accept_waiver, p_code);
  IF v_result ? 'error' THEN RETURN v_result; END IF;

  UPDATE competition_registrations r SET time_slot_id = p_time_slot_id
  WHERE r.folio = v_result->>'folio';
  SELECT s.label INTO v_label FROM competition_time_slots s WHERE s.id = p_time_slot_id;
  RETURN v_result || jsonb_build_object('time_slot_label', v_label);
END;
$function$;

-- Horario de una inscripción (consulta pública, folio + correo). Si aún
-- no tiene, devuelve los bloques para que elija.
CREATE OR REPLACE FUNCTION public.get_registration_slot(p_folio TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_reg   competition_registrations%ROWTYPE;
  v_label TEXT;
BEGIN
  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.folio = upper(btrim(coalesce(p_folio, ''))) AND r.email = lower(btrim(coalesce(p_email, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF v_reg.time_slot_id IS NOT NULL THEN
    SELECT s.label INTO v_label FROM competition_time_slots s WHERE s.id = v_reg.time_slot_id;
    RETURN jsonb_build_object('time_slot_id', v_reg.time_slot_id, 'time_slot_label', v_label);
  END IF;
  RETURN jsonb_build_object(
    'time_slot_id', NULL,
    'can_choose', v_reg.status IN ('pending_payment','paid','needs_attention'),
    'slots', competition_slots_json(v_reg.competition_id));
END;
$function$;

-- La persona elige su horario UNA vez. Después solo el staff lo cambia.
CREATE OR REPLACE FUNCTION public.competition_choose_slot(p_folio TEXT, p_email TEXT, p_time_slot_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_reg   competition_registrations%ROWTYPE;
  v_err   TEXT;
  v_label TEXT;
BEGIN
  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.folio = upper(btrim(coalesce(p_folio, ''))) AND r.email = lower(btrim(coalesce(p_email, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  -- Mismo orden de bloqueo que las inscripciones: competencia primero.
  PERFORM 1 FROM competitions c WHERE c.id = v_reg.competition_id FOR UPDATE;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = v_reg.id FOR UPDATE;

  IF v_reg.status NOT IN ('pending_payment','paid','needs_attention') THEN RETURN jsonb_build_object('error', 'not_active'); END IF;
  IF v_reg.time_slot_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_chosen'); END IF;
  v_err := competition_check_slot(v_reg.competition_id, p_time_slot_id);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;

  UPDATE competition_registrations r SET time_slot_id = p_time_slot_id, updated_at = now() WHERE r.id = v_reg.id;
  SELECT s.label INTO v_label FROM competition_time_slots s WHERE s.id = p_time_slot_id;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (NULL, 'choose_slot', v_reg.competition_id, v_reg.id,
          jsonb_build_object('time_slot_id', NULL), jsonb_build_object('time_slot_id', p_time_slot_id),
          'Elegido por el participante: ' || v_label);

  RETURN jsonb_build_object('success', true, 'time_slot_id', p_time_slot_id, 'time_slot_label', v_label);
END;
$function$;

-- ------------------------------------------------------------
-- Admin
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_competition_slots_admin(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'slots', competition_slots_json(v_comp.id, true),
    'capacity', competition_slot_capacity(v_comp.id),
    'base', v_comp.slot_capacity,
    'step', v_comp.slot_capacity_step,
    -- Activos sin horario, y cuántos de ellos pueden recibir el correo.
    'unassigned', (SELECT count(*) FROM competition_registrations r
                   WHERE r.competition_id = v_comp.id AND r.time_slot_id IS NULL
                     AND (r.status IN ('paid','needs_attention')
                          OR (r.status = 'pending_payment' AND r.hold_expires_at > now()))),
    'invite_pending', (SELECT count(*) FROM competition_registrations r
                       WHERE r.competition_id = v_comp.id AND r.time_slot_id IS NULL
                         AND r.email IS NOT NULL AND r.slot_invite_sent_at IS NULL
                         AND r.status IN ('paid','needs_attention','pending_payment'))
  );
END;
$function$;

-- Staff asigna o cambia el horario (puede pasarse del cupo). p_time_slot_id
-- NULL = quitarle el horario.
CREATE OR REPLACE FUNCTION public.admin_set_registration_slot(p_folio TEXT, p_time_slot_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_reg  competition_registrations%ROWTYPE;
  v_over BOOLEAN := false;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.folio = upper(btrim(coalesce(p_folio, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  PERFORM 1 FROM competitions c WHERE c.id = v_reg.competition_id FOR UPDATE;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = v_reg.id FOR UPDATE;

  IF p_time_slot_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM competition_time_slots s
                   WHERE s.id = p_time_slot_id AND s.competition_id = v_reg.competition_id) THEN
      RETURN jsonb_build_object('error', 'invalid_slot');
    END IF;
    v_over := v_reg.time_slot_id IS DISTINCT FROM p_time_slot_id
              AND competition_slot_taken(p_time_slot_id) >= competition_slot_capacity(v_reg.competition_id);
  END IF;

  UPDATE competition_registrations r SET time_slot_id = p_time_slot_id, updated_at = now() WHERE r.id = v_reg.id;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'set_slot', v_reg.competition_id, v_reg.id,
          jsonb_build_object('time_slot_id', v_reg.time_slot_id), jsonb_build_object('time_slot_id', p_time_slot_id),
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Horario asignado por staff'));

  RETURN jsonb_build_object('success', true, 'over_capacity', v_over);
END;
$function$;

-- Cupo inicial por bloque y cuánto sube cuando todos se llenan.
CREATE OR REPLACE FUNCTION public.admin_update_slot_capacity(p_slug TEXT, p_base INT, p_step INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_base IS NULL OR p_base < 1 OR p_base > 1000 OR p_step IS NULL OR p_step < 0 OR p_step > 1000 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  UPDATE competitions c SET slot_capacity = p_base, slot_capacity_step = p_step WHERE c.id = v_comp.id;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'update_slot_capacity', v_comp.id,
          jsonb_build_object('slot_capacity', v_comp.slot_capacity, 'slot_capacity_step', v_comp.slot_capacity_step),
          jsonb_build_object('slot_capacity', p_base, 'slot_capacity_step', p_step));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Para la Edge Function (service_role): a quién mandarle el correo de
-- "elige tu horario". Marca cada inscripción al devolverla para que un
-- segundo clic no repita correos; si el envío falla, se suelta.
CREATE OR REPLACE FUNCTION public.competition_claim_slot_invites(p_slug TEXT, p_limit INT DEFAULT 50)
RETURNS TABLE (registration_id UUID, folio TEXT, full_name TEXT, email TEXT, category_name TEXT,
               status TEXT, competition_name TEXT, event_date DATE)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT r.id FROM competition_registrations r
    JOIN competitions c ON c.id = r.competition_id
    WHERE c.slug = p_slug AND r.time_slot_id IS NULL AND r.email IS NOT NULL
      AND r.slot_invite_sent_at IS NULL
      AND (r.status IN ('paid','needs_attention')
           OR (r.status = 'pending_payment' AND r.hold_expires_at > now()))
    ORDER BY r.created_at
    LIMIT greatest(least(coalesce(p_limit, 50), 200), 1)
    FOR UPDATE OF r SKIP LOCKED
  ), marked AS (
    UPDATE competition_registrations r SET slot_invite_sent_at = now()
    FROM picked WHERE r.id = picked.id
    RETURNING r.*
  )
  SELECT m.id, m.folio, m.full_name, m.email, cc.name, m.status, c.name, c.event_date
  FROM marked m
  JOIN competitions c ON c.id = m.competition_id
  LEFT JOIN competition_categories cc ON cc.id = m.category_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.competition_release_slot_invite(p_registration_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  UPDATE competition_registrations SET slot_invite_sent_at = NULL WHERE id = p_registration_id;
$function$;

-- Horario de una inscripción por folio (para el correo de confirmación).
CREATE OR REPLACE FUNCTION public.competition_slot_label_by_folio(p_folio TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT s.label FROM competition_registrations r
  JOIN competition_time_slots s ON s.id = r.time_slot_id
  WHERE r.folio = p_folio;
$function$;

REVOKE ALL ON FUNCTION public.get_competition_slots_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_for_competition_slot(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.competition_register_courtesy_slot(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_registration_slot(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.competition_choose_slot(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_competition_slots_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_registration_slot(TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_slot_capacity(TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.competition_claim_slot_invites(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_release_slot_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_slot_label_by_folio(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_competition_slots_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_competition_slot(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_register_courtesy_slot(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_registration_slot(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_choose_slot(TEXT, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_slots_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_registration_slot(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_slot_capacity(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_claim_slot_invites(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_release_slot_invite(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_slot_label_by_folio(TEXT) TO service_role;

-- ------------------------------------------------------------
-- Datos: los tres bloques del 7-nov y el horario general.
-- ------------------------------------------------------------
INSERT INTO public.competition_time_slots (competition_id, label, starts_at, ends_at, sort_order)
SELECT c.id, v.label, v.starts_at, v.ends_at, v.sort_order
FROM public.competitions c
CROSS JOIN (VALUES
  ('10:00 am a 12:00 pm', TIME '10:00', TIME '12:00', 1),
  ('12:30 a 2:30 pm',     TIME '12:30', TIME '14:30', 2),
  ('3:00 a 5:00 pm',      TIME '15:00', TIME '17:00', 3)
) AS v(label, starts_at, ends_at, sort_order)
WHERE c.slug = 'competencia-2026'
ON CONFLICT (competition_id, starts_at) DO NOTHING;

-- El texto general de horario ya no habla de "horarios por categoría"
-- (solo se cambia si sigue con el texto viejo).
UPDATE public.competitions
SET event_time_text = '10:00 am a 6:00 pm · premiación 5:30 pm'
WHERE slug = 'competencia-2026'
  AND event_time_text = 'Inicio 10:00 am (horarios por categoría por definir)';
