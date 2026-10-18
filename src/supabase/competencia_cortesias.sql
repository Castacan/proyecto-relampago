-- ============================================================
-- Competencia — cortesías con código (2026-10-17)
-- Staff genera un código en el panel y se lo manda a la persona; ella se
-- inscribe sola en /competencia, escribe el código y queda inscrita sin
-- pasar por Clip (payment_method = 'courtesy'). Requiere competencia.sql.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_courtesy_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id),
  code           TEXT NOT NULL UNIQUE,      -- en mayúsculas, sin espacios
  label          TEXT,                      -- para quién / nota
  max_uses       INT NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 500),
  revoked_at     TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.competition_courtesy_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_courtesy_codes FROM anon, authenticated;

ALTER TABLE public.competition_registrations
  ADD COLUMN IF NOT EXISTS courtesy_code_id UUID REFERENCES public.competition_courtesy_codes(id);

-- Un uso = inscripción activa con ese código. Si staff cancela la
-- inscripción, el uso se libera.
CREATE OR REPLACE FUNCTION public.competition_courtesy_uses(p_code_id UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT count(*)::int FROM competition_registrations r
  WHERE r.courtesy_code_id = p_code_id AND r.status IN ('paid','needs_attention');
$function$;

-- Para la Edge Function (service_role), acción 'courtesy'. Todo en una
-- transacción: si el código no sirve, no se crea nada; si la inscripción
-- falla (cerrada, duplicado, cupo...), el código no se gasta.
CREATE OR REPLACE FUNCTION public.competition_register_courtesy(
  p_slug           TEXT,
  p_full_name      TEXT,
  p_birth_date     DATE,
  p_email          TEXT,
  p_phone          TEXT,
  p_category_id    UUID,
  p_shirt_size     TEXT,
  p_accept_privacy BOOLEAN,
  p_accept_waiver  BOOLEAN,
  p_code           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_code   competition_courtesy_codes%ROWTYPE;
  v_result JSONB;
  v_new    competition_registrations%ROWTYPE;
BEGIN
  SELECT k.* INTO v_code FROM competition_courtesy_codes k
  JOIN competitions c ON c.id = k.competition_id
  WHERE k.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) AND c.slug = p_slug
  FOR UPDATE OF k;
  IF NOT FOUND OR v_code.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  IF competition_courtesy_uses(v_code.id) >= v_code.max_uses THEN RETURN jsonb_build_object('error', 'code_used_up'); END IF;

  v_result := register_for_competition(p_slug, p_full_name, p_birth_date, p_email, p_phone,
                                       p_category_id, p_shirt_size, p_accept_privacy, p_accept_waiver);
  IF v_result ? 'error' THEN RETURN v_result; END IF;

  UPDATE competition_registrations r SET
    status = 'paid', paid_at = now(), payment_method = 'courtesy', hold_expires_at = NULL,
    courtesy_code_id = v_code.id, updated_at = now()
  WHERE r.folio = v_result->>'folio'
  RETURNING * INTO v_new;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (NULL, 'courtesy_register', v_new.competition_id, v_new.id, NULL, to_jsonb(v_new),
          'Cortesía con código ' || v_code.code);

  RETURN v_result - 'hold_expires_at' - 'payment_link_url' - 'payment_instructions'
         || jsonb_build_object('courtesy', true, 'price_cents', 0);
END;
$function$;

-- ------------------------------------------------------------
-- Panel (solo admin)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_courtesy_code(
  p_slug TEXT, p_label TEXT, p_max_uses INT DEFAULT 1, p_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp     competitions%ROWTYPE;
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT := nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '');
  v_label    TEXT := nullif(btrim(coalesce(p_label, '')), '');
  v_tries    INT := 0;
  v_id       UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_max_uses IS NULL OR p_max_uses < 1 OR p_max_uses > 500 THEN RETURN jsonb_build_object('error', 'invalid_max_uses'); END IF;
  IF v_label IS NOT NULL AND length(v_label) > 120 THEN RETURN jsonb_build_object('error', 'invalid_label'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF v_code IS NOT NULL THEN
    IF v_code !~ '^[A-Z0-9-]{4,30}$' THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
    IF EXISTS (SELECT 1 FROM competition_courtesy_codes k WHERE k.code = v_code) THEN
      RETURN jsonb_build_object('error', 'code_taken');
    END IF;
  ELSE
    LOOP
      v_code := v_comp.folio_prefix || 'C-' || (
        SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
        FROM generate_series(1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_courtesy_codes k WHERE k.code = v_code);
      v_tries := v_tries + 1;
      IF v_tries > 20 THEN RETURN jsonb_build_object('error', 'code_failed'); END IF;
    END LOOP;
  END IF;

  INSERT INTO competition_courtesy_codes (competition_id, code, label, max_uses, created_by)
  VALUES (v_comp.id, v_code, v_label, p_max_uses, auth.uid()) RETURNING id INTO v_id;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, after, reason)
  VALUES (auth.uid(), 'courtesy_code_create', v_comp.id,
          jsonb_build_object('id', v_id, 'code', v_code, 'label', v_label, 'max_uses', p_max_uses), v_label);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_courtesy_code(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_code competition_courtesy_codes%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE competition_courtesy_codes k SET revoked_at = now()
  WHERE k.id = p_id AND k.revoked_at IS NULL RETURNING * INTO v_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, after, reason)
  VALUES (auth.uid(), 'courtesy_code_revoke', v_code.competition_id,
          jsonb_build_object('id', v_code.id, 'code', v_code.code), NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Códigos con sus usos. Revocar no cancela a quien ya se inscribió.
CREATE OR REPLACE FUNCTION public.get_competition_courtesy_codes_admin(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('codes', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', k.id, 'code', k.code, 'label', k.label, 'max_uses', k.max_uses,
      'revoked_at', k.revoked_at, 'created_at', k.created_at,
      'uses', competition_courtesy_uses(k.id),
      'registrations', coalesce((
        SELECT jsonb_agg(jsonb_build_object('folio', r.folio, 'full_name', r.full_name, 'status', r.status)
                         ORDER BY r.created_at)
        FROM competition_registrations r WHERE r.courtesy_code_id = k.id), '[]'::jsonb)
    ) ORDER BY k.created_at DESC)
    FROM competition_courtesy_codes k
    JOIN competitions c ON c.id = k.competition_id
    WHERE c.slug = p_slug), '[]'::jsonb));
END;
$function$;

-- Staff aplica un código a alguien que ya se inscribió y no ha pagado
-- (pendiente o vencido): p. ej. se ganó la cortesía pero no vio dónde
-- ponerla. La Edge Function (acción 'courtesy_apply') la llama con la
-- sesión del admin y luego manda el correo. (2026-10-18)
CREATE OR REPLACE FUNCTION public.admin_apply_courtesy(p_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_reg  competition_registrations%ROWTYPE;
  v_new  competition_registrations%ROWTYPE;
  v_cat  competition_categories%ROWTYPE;
  v_code competition_courtesy_codes%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  -- Mismo orden de bloqueo que admin_update_registration.
  SELECT c.* INTO v_comp FROM competitions c
  WHERE c.id = (SELECT r.competition_id FROM competition_registrations r WHERE r.id = p_id)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = p_id FOR UPDATE;

  IF v_reg.status NOT IN ('pending_payment','expired') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;

  SELECT k.* INTO v_code FROM competition_courtesy_codes k
  WHERE k.code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) AND k.competition_id = v_comp.id
  FOR UPDATE;
  IF NOT FOUND OR v_code.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'invalid_code'); END IF;
  IF competition_courtesy_uses(v_code.id) >= v_code.max_uses THEN RETURN jsonb_build_object('error', 'code_used_up'); END IF;

  -- Si ya no ocupaba lugar (reserva vencida), tiene que haber cupo y no
  -- debe tener otra inscripción activa.
  IF NOT (v_reg.status = 'pending_payment' AND v_reg.hold_expires_at > now()) THEN
    IF EXISTS (
      SELECT 1 FROM competition_registrations r
      WHERE r.competition_id = v_reg.competition_id AND r.id <> v_reg.id
        AND lower(r.full_name) = lower(v_reg.full_name) AND r.birth_date = v_reg.birth_date
        AND r.status IN ('pending_payment','paid','needs_attention')) THEN
      RETURN jsonb_build_object('error', 'has_other_active');
    END IF;
    SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
    IF competition_spots_taken(v_comp.id) >= v_comp.capacity_total
       OR (v_cat.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, v_cat.id) >= v_cat.capacity) THEN
      RETURN jsonb_build_object('error', 'full');
    END IF;
  END IF;

  UPDATE competition_registrations r SET
    status = 'paid', paid_at = now(), payment_method = 'courtesy', hold_expires_at = NULL,
    courtesy_code_id = v_code.id, checked_in_at = NULL, updated_at = now()
  WHERE r.id = v_reg.id
  RETURNING * INTO v_new;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'courtesy_apply', v_comp.id, v_new.id, to_jsonb(v_reg), to_jsonb(v_new),
          'Cortesía aplicada por staff con código ' || v_code.code);

  RETURN jsonb_build_object('success', true, 'folio', v_new.folio, 'has_email', v_new.email IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_apply_courtesy(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_courtesy(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.competition_courtesy_uses(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_register_courtesy(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_courtesy_code(TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_courtesy_code(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_competition_courtesy_codes_admin(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.competition_register_courtesy(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_courtesy_code(TEXT, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_courtesy_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_courtesy_codes_admin(TEXT) TO authenticated;
