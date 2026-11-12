-- ============================================================
-- Menores a cargo desde /registro (2026-11-12).
-- Correr DESPUÉS de erp.sql, erp_crm.sql, erp_recepcion.sql y erp_gatas.sql.
--
-- Una mamá/papá/tutor ya registrado registra a sus hijos desde su celular.
-- El menor queda como ficha propia (sin correo ni cuenta), ligada a quien lo
-- registró (people.guardian_person_id), y el tutor firma por él.
--
-- · get_my_dependents(): mis menores con sus documentos (firmados o no).
-- · save_my_dependent(p): alta o corrección (nombre, nacimiento, género, talla).
--   Solo menores de 18. El tutor y el contacto de emergencia son quien registra.
-- · sign_dependent_document(p_person_id, p): el tutor firma por su menor.
-- Idempotente.
-- ============================================================

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS guardian_person_id UUID REFERENCES public.people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS people_guardian_idx ON public.people (guardian_person_id) WHERE guardian_person_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_my_dependents()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('dependents', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('dependents', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'birth_date', p.birth_date, 'gender', p.gender, 'shoe_size', p.shoe_size,
      'is_minor', p.birth_date IS NOT NULL AND p.birth_date > (erp_today() - INTERVAL '18 years')::date,
      'has_face', EXISTS (SELECT 1 FROM person_faces f WHERE f.person_id = p.id),
      'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'doc_key', d.doc_key, 'title', d.title, 'body', d.body,
                     'required', d.required,
                     'signed_at', (SELECT max(s.signed_at) FROM legal_signatures s WHERE s.person_id = p.id AND s.document_id = d.id))
                     ORDER BY d.sort_order) FROM legal_documents d WHERE d.is_current), '[]'::jsonb))
      ORDER BY p.created_at)
    FROM people p WHERE p.guardian_person_id = v_pid AND NOT p.is_archived), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_dependent(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_me    people%ROWTYPE;
  v_id    UUID := nullif(p->>'id', '')::uuid;
  v_name  TEXT := regexp_replace(btrim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_birth DATE;
  v_shoe  TEXT := nullif(btrim(coalesce(p->>'shoe_size', '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  SELECT * INTO v_me FROM people WHERE id = class_my_person_id();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  IF v_me.birth_date IS NOT NULL AND v_me.birth_date > (erp_today() - INTERVAL '18 years')::date THEN
    RETURN jsonb_build_object('error', 'guardian_must_be_adult');
  END IF;
  IF v_me.phone IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  BEGIN
    v_birth := nullif(p->>'birth_date', '')::date;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('error', 'invalid_birth_date');
  END;
  IF v_birth IS NULL THEN RETURN jsonb_build_object('error', 'birth_date_required'); END IF;
  IF v_birth > erp_today() OR v_birth < (erp_today() - INTERVAL '18 years')::date + 1 THEN
    RETURN jsonb_build_object('error', 'not_a_minor');
  END IF;
  IF v_shoe IS NOT NULL AND length(v_shoe) > 12 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;

  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM people WHERE guardian_person_id = v_me.id AND NOT is_archived) >= 8 THEN
      RETURN jsonb_build_object('error', 'too_many');
    END IF;
    INSERT INTO people (full_name, birth_date, gender, shoe_size, source, note, guardian_person_id,
                        guardian_name, guardian_phone, emergency_name, emergency_phone, allow_marketing)
    VALUES (v_name, v_birth, nullif(btrim(coalesce(p->>'gender', '')), ''), v_shoe, 'web',
            'Registrado por su tutor desde /registro', v_me.id,
            v_me.full_name, v_me.phone, v_me.full_name, v_me.phone, false)
    RETURNING id INTO v_id;
  ELSE
    UPDATE people SET full_name = v_name, birth_date = v_birth,
           gender = nullif(btrim(coalesce(p->>'gender', '')), ''), shoe_size = v_shoe,
           guardian_name = v_me.full_name, guardian_phone = v_me.phone, updated_at = now()
    WHERE id = v_id AND guardian_person_id = v_me.id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sign_dependent_document(p_person_id UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_me people%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  SELECT * INTO v_me FROM people WHERE id = class_my_person_id();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id AND guardian_person_id = v_me.id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  -- Firma el tutor: su nombre siempre queda como tutor.
  RETURN erp_sign_document(p_person_id,
    p || jsonb_build_object('guardian_name', v_me.full_name,
                            'guardian_relation', coalesce(nullif(btrim(coalesce(p->>'guardian_relation', '')), ''), 'Tutor')),
    'client_app');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_dependents() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_dependent(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_dependent_document(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_dependents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_dependent(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_dependent_document(UUID, JSONB) TO authenticated;

SELECT 'menores a cargo' AS que, 'ok' AS valor;
