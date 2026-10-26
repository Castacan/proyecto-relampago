-- ============================================================
-- Recepción con reconocimiento facial (2026-10-26).
-- Requiere erp_crm.sql (córrelo DESPUÉS). Idempotente.
--
--   Flujo de Inge:
--   · Cliente nuevo: escanea un QR en recepción → /registro en su celular:
--     crea su cuenta, llena sus datos y firma responsiva, reglamento y aviso de
--     privacidad (que incluye el uso de su cara). En recepción se le toma la
--     foto con la webcam y se guarda su "huella" facial (128 números, no la
--     foto). Luego la primera venta.
--   · Cliente que ya vino: se asoma a la webcam, la laptop lo reconoce y
--     muestra su perfil y si su membresía está activa; si no, se le cobra.
--   · Vender: lista de quién ya entró o compró hoy, para elegirlo rápido.
--
--   El reconocimiento corre en el navegador de la laptop (face-api). Aquí solo
--   se guardan los descriptores y solo el staff los puede leer.
-- ============================================================

-- ------------------------------------------------------------
-- Aviso de privacidad con consentimiento biométrico (BORRADOR)
-- ------------------------------------------------------------
INSERT INTO public.legal_documents (doc_key, version, kind, title, body, required, sort_order)
SELECT 'privacidad', 1, 'other', 'Aviso de privacidad y uso de mi rostro',
$txt$AVISO DE PRIVACIDAD (BORRADOR — revisar con un abogado antes de usarlo)

Jaibamuro es responsable del tratamiento de tus datos personales.

1. Datos que recabamos: nombre, celular, correo, fecha de nacimiento, contacto de emergencia, datos del tutor si eres menor, tu historial de visitas y compras y, si lo autorizas, una fotografía de tu rostro y una representación numérica de tus rasgos faciales (dato biométrico, considerado dato personal sensible).

2. Para qué los usamos: registrar tus visitas y tu membresía, cobrarte, contactarte en caso de emergencia y, con tu rostro, reconocerte en recepción para registrar tu entrada sin necesidad de credencial ni código.

3. Tu rostro: la representación numérica se guarda en nuestro sistema, solo la usa el personal de recepción para identificarte y no se comparte con terceros. Se borra cuando lo pidas o después de 2 años sin visitas.

4. Tus derechos (ARCO): puedes pedir acceso, rectificación o cancelación de tus datos, oponerte a su uso o revocar tu consentimiento escribiendo a recepción o al correo del gimnasio. Si no quieres usar tu rostro, en recepción te buscamos por nombre.

5. Consentimiento: al firmar, otorgo mi consentimiento expreso y por escrito para el tratamiento de mis datos personales, incluidos los sensibles (biométricos), con las finalidades descritas. Si soy menor de edad, firma mi madre, padre o tutor.$txt$,
true, 3
WHERE NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc_key = 'privacidad');

-- ------------------------------------------------------------
-- Caras (descriptor de 128 números por persona)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.person_faces (
  person_id   UUID PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  descriptor  REAL[] NOT NULL CHECK (array_length(descriptor, 1) = 128),
  photo_path  TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.erp_face_consent(p_person_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM legal_signatures WHERE person_id = p_person_id AND doc_key = 'privacidad');
$function$;

-- ------------------------------------------------------------
-- Cliente: registro desde su celular (/registro)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_registration()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  RETURN jsonb_build_object(
    'email', lower(auth.jwt() ->> 'email'),
    'is_staff', class_is_staff(),
    'person', (SELECT jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'birth_date', p.birth_date, 'gender', p.gender,
                        'emergency_name', p.emergency_name, 'emergency_phone', p.emergency_phone,
                        'guardian_name', p.guardian_name, 'guardian_phone', p.guardian_phone, 'allow_marketing', p.allow_marketing,
                        'is_minor', p.birth_date IS NOT NULL AND p.birth_date > (erp_today() - INTERVAL '18 years')::date,
                        'has_face', EXISTS (SELECT 1 FROM person_faces f WHERE f.person_id = p.id))
               FROM people p WHERE p.id = v_pid),
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'doc_key', d.doc_key, 'title', d.title, 'body', d.body, 'required', d.required,
                 'signed_at', (SELECT max(s.signed_at) FROM legal_signatures s WHERE s.person_id = v_pid AND s.document_id = d.id)) ORDER BY d.sort_order)
                 FROM legal_documents d WHERE d.is_current), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_registration(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r JSONB;
  v_pid UUID;
  v_birth DATE;
  v_minor BOOLEAN;
  v_em_phone TEXT := nullif(regexp_replace(coalesce(p->>'emergency_phone', ''), '\D', '', 'g'), '');
  v_gu_phone TEXT := nullif(regexp_replace(coalesce(p->>'guardian_phone', ''), '\D', '', 'g'), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  BEGIN
    v_birth := nullif(p->>'birth_date', '')::date;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END;
  IF v_birth IS NULL THEN RETURN jsonb_build_object('error', 'birth_date_required'); END IF;
  IF length(btrim(coalesce(p->>'emergency_name', ''))) < 3 OR v_em_phone IS NULL OR length(v_em_phone) <> 10 THEN
    RETURN jsonb_build_object('error', 'emergency_required');
  END IF;
  v_minor := v_birth > (erp_today() - INTERVAL '18 years')::date;
  IF v_minor AND (length(btrim(coalesce(p->>'guardian_name', ''))) < 3 OR v_gu_phone IS NULL OR length(v_gu_phone) <> 10) THEN
    RETURN jsonb_build_object('error', 'guardian_required');
  END IF;
  r := upsert_my_person(p->>'full_name', p->>'phone', v_birth);
  IF r ? 'error' THEN RETURN r; END IF;
  v_pid := (r->>'person_id')::uuid;
  UPDATE people SET
    gender = nullif(btrim(coalesce(p->>'gender', '')), ''),
    emergency_name = btrim(p->>'emergency_name'), emergency_phone = v_em_phone,
    guardian_name = CASE WHEN v_minor THEN btrim(p->>'guardian_name') END,
    guardian_phone = CASE WHEN v_minor THEN v_gu_phone END,
    allow_marketing = coalesce((p->>'allow_marketing')::boolean, allow_marketing),
    source = coalesce(source, 'recepcion'),
    updated_at = now()
  WHERE id = v_pid;
  RETURN jsonb_build_object('success', true, 'person_id', v_pid, 'is_minor', v_minor);
END;
$function$;

-- ------------------------------------------------------------
-- Recepción (staff)
-- ------------------------------------------------------------
-- p_descriptor: arreglo JSON de 128 números (face-api). La foto va aparte al
-- bucket 'expedientes' y queda como foto de la ficha.
CREATE OR REPLACE FUNCTION public.staff_save_face(p_person_id UUID, p_descriptor JSONB, p_photo_path TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_d REAL[];
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT erp_face_consent(p_person_id) THEN RETURN jsonb_build_object('error', 'face_consent_required'); END IF;
  IF jsonb_typeof(p_descriptor) <> 'array' OR jsonb_array_length(p_descriptor) <> 128 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  SELECT array_agg(x::real ORDER BY i) INTO v_d FROM jsonb_array_elements_text(p_descriptor) WITH ORDINALITY t(x, i);
  INSERT INTO person_faces (person_id, descriptor, photo_path, created_by)
  VALUES (p_person_id, v_d, p_photo_path, auth.uid())
  ON CONFLICT (person_id) DO UPDATE SET descriptor = EXCLUDED.descriptor, photo_path = coalesce(EXCLUDED.photo_path, person_faces.photo_path),
    created_by = EXCLUDED.created_by, updated_at = now();
  IF p_photo_path IS NOT NULL THEN UPDATE people SET photo_path = p_photo_path, updated_at = now() WHERE id = p_person_id; END IF;
  PERFORM erp_audit('face_saved', 'person', p_person_id, NULL, jsonb_build_object('photo_path', p_photo_path));
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('error', 'invalid_value');
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_delete_face(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  DELETE FROM person_faces WHERE person_id = p_person_id;
  PERFORM erp_audit('face_deleted', 'person', p_person_id, NULL, NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Todas las caras registradas (para comparar en la laptop).
CREATE OR REPLACE FUNCTION public.get_face_index()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('faces', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', f.person_id, 'name', p.full_name, 'd', to_jsonb(f.descriptor)))
    FROM person_faces f JOIN people p ON p.id = f.person_id
    WHERE NOT p.is_archived), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_face_status(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'has_face', EXISTS (SELECT 1 FROM person_faces WHERE person_id = p_person_id),
    'updated_at', (SELECT updated_at FROM person_faces WHERE person_id = p_person_id),
    'consent', erp_face_consent(p_person_id));
END;
$function$;

-- Nuevos de los últimos 3 días que aún no tienen cara registrada.
CREATE OR REPLACE FUNCTION public.get_reception_pending()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('people', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'created_at', p.created_at,
                     'consent', erp_face_consent(p.id), 'pending_documents', jsonb_array_length(erp_pending_documents(p.id)))
                     ORDER BY p.created_at DESC)
    FROM people p
    WHERE NOT p.is_archived AND p.created_at >= now() - interval '3 days'
      AND NOT EXISTS (SELECT 1 FROM person_faces f WHERE f.person_id = p.id)), '[]'::jsonb));
END;
$function$;

-- Quién entró o compró hoy (para Vender).
CREATE OR REPLACE FUNCTION public.get_today_people()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('people', coalesce((
    WITH ev AS (
      SELECT a.person_id, a.created_at AS at, 'entry'::text AS kind, NULL::text AS what
      FROM access_events a
      WHERE a.person_id IS NOT NULL AND a.result IN ('granted','override') AND (a.created_at AT TIME ZONE 'America/Mexico_City')::date = v_today
      UNION ALL
      SELECT s.person_id, s.created_at, 'sale', (SELECT string_agg(i.description, ', ' ORDER BY i.description) FROM sale_items i WHERE i.sale_id = s.id)
      FROM sales s
      WHERE s.person_id IS NOT NULL AND s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date = v_today
    ), g AS (
      SELECT person_id, max(at) AS last_at, min(at) FILTER (WHERE kind = 'entry') AS entered_at,
             string_agg(what, ', ' ORDER BY at) FILTER (WHERE kind = 'sale') AS bought
      FROM ev GROUP BY person_id
    )
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
                     'entered_at', g.entered_at, 'bought', g.bought, 'last_at', g.last_at,
                     'membership_until', erp_membership_until(p.id)) ORDER BY g.last_at DESC)
    FROM g JOIN people p ON p.id = g.person_id), '[]'::jsonb));
END;
$function$;

-- ------------------------------------------------------------
-- Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.person_faces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.person_faces FROM anon, authenticated;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.erp_face_consent(uuid) FROM PUBLIC, anon, authenticated';
  FOREACH f IN ARRAY ARRAY[
    'get_my_registration()', 'save_my_registration(jsonb)',
    'staff_save_face(uuid,jsonb,text)', 'staff_delete_face(uuid)', 'get_face_index()', 'get_face_status(uuid)',
    'get_reception_pending()', 'get_today_people()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END;
$grants$;
