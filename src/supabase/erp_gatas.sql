-- ============================================================
-- Talla de gatas en la ficha del cliente (2026-11-11).
-- Correr DESPUÉS de erp.sql, erp_crm.sql y erp_recepcion.sql.
--
-- · people.shoe_size: texto libre corto (ej. "40", "26.5 MX", "41 La Sportiva").
-- · admin_save_person la guarda (solo si viene en el JSON, para no borrarla
--   desde pantallas viejas que no la mandan).
-- · erp_access_decision la regresa en person.shoe_size: la tarjeta de Acceso
--   (cámara) la muestra al reconocer al cliente.
-- Idempotente: se puede volver a correr.
-- ============================================================

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS shoe_size TEXT;

CREATE OR REPLACE FUNCTION public.admin_save_person(p_person JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id    UUID := nullif(p_person->>'id', '')::uuid;
  v_name  TEXT := regexp_replace(btrim(coalesce(p_person->>'full_name', '')), '\s+', ' ', 'g');
  v_phone TEXT := nullif(regexp_replace(coalesce(p_person->>'phone', ''), '\D', '', 'g'), '');
  v_email TEXT := nullif(lower(btrim(coalesce(p_person->>'email', ''))), '');
  v_birth DATE := nullif(p_person->>'birth_date', '')::date;
  v_eph   TEXT := nullif(regexp_replace(coalesce(p_person->>'emergency_phone', ''), '\D', '', 'g'), '');
  v_gph   TEXT := nullif(regexp_replace(coalesce(p_person->>'guardian_phone', ''), '\D', '', 'g'), '');
  v_shoe  TEXT := nullif(btrim(coalesce(p_person->>'shoe_size', '')), '');
  v_before people%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_phone IS NOT NULL AND length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('error', 'invalid_email'); END IF;
  IF v_birth IS NOT NULL AND (v_birth < DATE '1920-01-01' OR v_birth > erp_today()) THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;
  IF v_shoe IS NOT NULL AND length(v_shoe) > 12 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE lower(p.email) = v_email AND p.id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'email_taken');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO people (full_name, phone, email, birth_date, source, note, gender, emergency_name, emergency_phone,
                        guardian_name, guardian_phone, allow_marketing, created_by, shoe_size)
    VALUES (v_name, v_phone, v_email, v_birth, coalesce(nullif(p_person->>'source', ''), 'staff'),
            nullif(btrim(coalesce(p_person->>'note', '')), ''), nullif(p_person->>'gender', ''),
            nullif(btrim(coalesce(p_person->>'emergency_name', '')), ''), v_eph,
            nullif(btrim(coalesce(p_person->>'guardian_name', '')), ''), v_gph,
            coalesce((p_person->>'allow_marketing')::boolean, true), auth.uid(), v_shoe)
    RETURNING id INTO v_id;
    PERFORM erp_audit('person_create', 'person', v_id, NULL, p_person);
  ELSE
    SELECT * INTO v_before FROM people WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    UPDATE people SET full_name = v_name, phone = v_phone,
      email = CASE WHEN auth_user_id IS NULL THEN v_email ELSE email END,
      birth_date = v_birth, source = coalesce(nullif(p_person->>'source', ''), source),
      note = nullif(btrim(coalesce(p_person->>'note', '')), ''),
      gender = CASE WHEN p_person ? 'gender' THEN nullif(p_person->>'gender', '') ELSE gender END,
      emergency_name = CASE WHEN p_person ? 'emergency_name' THEN nullif(btrim(coalesce(p_person->>'emergency_name', '')), '') ELSE emergency_name END,
      emergency_phone = CASE WHEN p_person ? 'emergency_phone' THEN v_eph ELSE emergency_phone END,
      guardian_name = CASE WHEN p_person ? 'guardian_name' THEN nullif(btrim(coalesce(p_person->>'guardian_name', '')), '') ELSE guardian_name END,
      guardian_phone = CASE WHEN p_person ? 'guardian_phone' THEN v_gph ELSE guardian_phone END,
      allow_marketing = coalesce((p_person->>'allow_marketing')::boolean, allow_marketing),
      shoe_size = CASE WHEN p_person ? 'shoe_size' THEN v_shoe ELSE shoe_size END,
      is_archived = coalesce((p_person->>'is_archived')::boolean, is_archived),
      updated_at = now()
    WHERE id = v_id;
    PERFORM erp_audit('person_update', 'person', v_id, to_jsonb(v_before), p_person);
  END IF;
  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_access_decision(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p        people%ROWTYPE;
  v_today    DATE := erp_today();
  v_until    DATE;
  v_pass     BOOLEAN;
  v_class    BOOLEAN;
  v_pending  JSONB;
  v_reasons  TEXT[] := '{}';
  v_ok_by    TEXT;
BEGIN
  SELECT * INTO v_p FROM people WHERE id = p_person_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reasons', ARRAY['not_found']); END IF;
  v_until := erp_membership_until(p_person_id);
  v_pass := EXISTS (SELECT 1 FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products pr ON pr.id = i.product_id
                    WHERE s.person_id = p_person_id AND s.status = 'completed' AND pr.kind IN ('pass','class')
                      AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date = v_today);
  v_class := EXISTS (SELECT 1 FROM class_bookings b JOIN class_sessions se ON se.id = b.session_id
                     WHERE b.person_id = p_person_id AND b.status IN ('booked','attended') AND class_mx_date(se.starts_at) = v_today);
  v_pending := erp_pending_documents(p_person_id);
  IF v_p.access_blocked THEN v_reasons := array_append(v_reasons, 'blocked'); END IF;
  IF v_until IS NOT NULL THEN v_ok_by := 'membership'; ELSIF v_pass THEN v_ok_by := 'day_pass'; ELSIF v_class THEN v_ok_by := 'class_today';
  ELSE v_reasons := array_append(v_reasons, 'no_membership'); END IF;
  IF (SELECT access_require_documents FROM erp_settings WHERE id = 1) AND jsonb_array_length(v_pending) > 0 THEN
    v_reasons := array_append(v_reasons, 'documents_pending');
  END IF;
  RETURN jsonb_build_object(
    'allowed', cardinality(v_reasons) = 0, 'reasons', v_reasons, 'ok_by', v_ok_by, 'membership_until', v_until,
    'pending_documents', v_pending,
    'person', jsonb_build_object('id', v_p.id, 'full_name', v_p.full_name, 'photo_path', v_p.photo_path, 'access_code', v_p.access_code,
                                 'block_reason', v_p.access_block_reason, 'shoe_size', v_p.shoe_size,
                                 'is_minor', v_p.birth_date IS NOT NULL AND v_p.birth_date > (v_today - INTERVAL '18 years')::date),
    'last_entry', (SELECT max(created_at) FROM access_events WHERE person_id = p_person_id AND result IN ('granted','override')));
END;
$function$;
