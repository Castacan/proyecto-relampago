-- ============================================================
-- Competencia — inscripción manual desde el panel (2026-10-04)
-- Para quien llega al gym y paga en efectivo (o por otro medio fuera de la
-- app). Requiere competencia.sql. Idempotente.
-- ============================================================

-- Una inscripción de mostrador puede no traer correo ni celular. Se guardan
-- como NULL (no como texto vacío) para que la consulta pública por
-- folio + correo nunca coincida con una inscripción sin correo.
ALTER TABLE public.competition_registrations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.competition_registrations ALTER COLUMN phone DROP NOT NULL;

-- Crea la inscripción YA PAGADA. Solo admin. No depende de que las
-- inscripciones en línea estén abiertas. Respeta cupo y la regla de "una
-- inscripción activa por persona". Deja rastro en competition_audit_log.
-- El aviso de privacidad y el deslinde se firman en papel en el gym: aquí
-- solo se guarda la fecha del registro (waiver_accepted_at queda NULL).
CREATE OR REPLACE FUNCTION public.admin_register_participant(
  p_slug        TEXT,
  p_full_name   TEXT,
  p_birth_date  DATE,
  p_category_id UUID,
  p_shirt_size  TEXT,
  p_method      TEXT DEFAULT 'cash',
  p_email       TEXT DEFAULT NULL,
  p_phone       TEXT DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp     competitions%ROWTYPE;
  v_cat      competition_categories%ROWTYPE;
  v_new      competition_registrations%ROWTYPE;
  v_name     TEXT := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_email    TEXT := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone    TEXT := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_today    DATE := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_folio    TEXT;
  v_tries    INT := 0;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF p_birth_date IS NULL OR p_birth_date < DATE '1920-01-01' OR p_birth_date > v_today THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RETURN jsonb_build_object('error', 'invalid_email');
  END IF;
  IF v_phone IS NOT NULL AND length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF p_shirt_size IS NULL OR p_shirt_size NOT IN ('S','M','L','XL') THEN RETURN jsonb_build_object('error', 'invalid_shirt_size'); END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','card','transfer','link','other') THEN RETURN jsonb_build_object('error', 'invalid_method'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT cc.* INTO v_cat FROM competition_categories cc
  WHERE cc.id = p_category_id AND cc.competition_id = v_comp.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_category'); END IF;

  -- Misma persona con inscripción activa. Si lo que tiene es un pendiente
  -- en línea, staff debe marcar ESE como pagado en vez de crear otro.
  IF EXISTS (
    SELECT 1 FROM competition_registrations r
    WHERE r.competition_id = v_comp.id AND lower(r.full_name) = lower(v_name)
      AND r.birth_date = p_birth_date
      AND r.status IN ('pending_payment','paid','needs_attention')) THEN
    RETURN jsonb_build_object('error', 'duplicate');
  END IF;

  IF competition_spots_taken(v_comp.id) >= v_comp.capacity_total THEN RETURN jsonb_build_object('error', 'full'); END IF;
  IF v_cat.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, v_cat.id) >= v_cat.capacity THEN
    RETURN jsonb_build_object('error', 'category_full');
  END IF;

  LOOP
    v_folio := v_comp.folio_prefix || '-' || (
      SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      FROM generate_series(1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_registrations r WHERE r.folio = v_folio);
    v_tries := v_tries + 1;
    IF v_tries > 20 THEN RETURN jsonb_build_object('error', 'folio_failed'); END IF;
  END LOOP;

  INSERT INTO competition_registrations (
    competition_id, folio, full_name, birth_date, email, phone, category_id, shirt_size,
    status, paid_at, payment_method, privacy_accepted_at
  ) VALUES (
    v_comp.id, v_folio, v_name, p_birth_date, v_email, v_phone, v_cat.id, p_shirt_size,
    'paid', now(), p_method, now()
  ) RETURNING * INTO v_new;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'manual_register', v_comp.id, v_new.id, NULL, to_jsonb(v_new),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Inscripción manual en el gym'));

  RETURN jsonb_build_object(
    'success', true, 'folio', v_folio, 'full_name', v_name, 'category_name', v_cat.name,
    'is_minor', p_birth_date > (v_comp.event_date - INTERVAL '18 years')::date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_register_participant(TEXT, TEXT, DATE, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_participant(TEXT, TEXT, DATE, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
