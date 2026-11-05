-- ============================================================
-- Check-in con firma de documentos (pedido del dueño, 2026-11-05)
-- ============================================================
-- Flujo el día del evento:
--   1. El competidor llega a recepción y dice su nombre. El staff lo busca y le
--      da su NÚMERO de participante (nadie más lo conoce: así nadie hace
--      check-in sin estar físicamente en recepción) y el QR de /competencia/checkin.
--   2. En su celular escribe su primer nombre y su número.
--   3. Lee y firma cada documento con el dedo (si es menor, también su tutor).
--   4. Al firmar el último queda hecho el check-in y se le entrega su kit.
-- Los documentos los edita el admin; cada firma guarda una copia del texto
-- que se firmó (si el texto cambia después, la firma no cambia).
-- Correr después de competencia.sql. Se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS public.competition_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES public.competitions (id),
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  body            TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 60000),
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.competition_documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.competition_checkin_sessions (
  token            TEXT PRIMARY KEY,
  registration_id  UUID NOT NULL REFERENCES public.competition_registrations (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.competition_checkin_sessions ENABLE ROW LEVEL SECURITY;

-- Intentos de entrar (para frenar a quien prueba números al azar).
CREATE TABLE IF NOT EXISTS public.competition_checkin_tries (
  id              BIGSERIAL PRIMARY KEY,
  competition_id  UUID NOT NULL,
  bib             INT,
  ok              BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competition_checkin_tries_recent ON public.competition_checkin_tries (competition_id, created_at);
ALTER TABLE public.competition_checkin_tries ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.competition_signatures (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id        UUID NOT NULL REFERENCES public.competition_registrations (id),
  document_id            UUID NOT NULL REFERENCES public.competition_documents (id),
  document_title         TEXT NOT NULL,
  document_body          TEXT NOT NULL,   -- copia exacta de lo que se firmó
  signer_name            TEXT NOT NULL,
  signature_png          TEXT NOT NULL,
  is_minor               BOOLEAN NOT NULL DEFAULT false,
  guardian_name          TEXT,
  guardian_relation      TEXT,
  user_agent             TEXT,
  signed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registration_id, document_id)
);
ALTER TABLE public.competition_signatures ENABLE ROW LEVEL SECURITY;
-- Sin políticas: todo pasa por las funciones de abajo.

-- Normaliza un nombre para compararlo: minúsculas, sin acentos, solo la primera palabra.
CREATE OR REPLACE FUNCTION public.competition_first_name_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $function$
  SELECT split_part(lower(translate(btrim(coalesce(p, '')), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou')), ' ', 1);
$function$;

-- ------------------------------------------------------------
-- Público: entrar con primer nombre + número
-- ------------------------------------------------------------
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
  WHERE r.competition_id = v_comp.id AND r.bib = p_bib AND r.status = 'paid';
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

-- Firma un documento. Al firmar el último que falta, queda hecho el check-in.
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
  IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'checkin_not_found'); END IF;
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

-- ------------------------------------------------------------
-- Panel (admin)
-- ------------------------------------------------------------
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
               'shirt_size', r.shirt_size, 'checked_in_at', r.checked_in_at,
               'is_minor', r.birth_date > (v_comp.event_date - INTERVAL '18 years')::date,
               'signed', (SELECT count(*) FROM competition_signatures s
                          JOIN competition_documents d ON d.id = s.document_id AND d.active
                          WHERE s.registration_id = r.id),
               'last_signed_at', (SELECT max(s.signed_at) FROM competition_signatures s WHERE s.registration_id = r.id))
             ORDER BY r.bib NULLS LAST, r.full_name), '[]'::jsonb)
      FROM competition_registrations r
      WHERE r.competition_id = v_comp.id AND r.status = 'paid'),
    'slots', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label) ORDER BY s.sort_order), '[]'::jsonb)
      FROM competition_time_slots s WHERE s.competition_id = v_comp.id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_checkin_save_document(p_slug TEXT, p_id UUID, p_title TEXT, p_body TEXT, p_sort_order INT, p_active BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_id   UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 160 OR length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 60000 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO competition_documents (competition_id, title, body, sort_order, active)
    VALUES (v_comp.id, btrim(p_title), btrim(p_body),
            coalesce(p_sort_order, (SELECT coalesce(max(sort_order), 0) + 1 FROM competition_documents WHERE competition_id = v_comp.id)),
            coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE competition_documents SET title = btrim(p_title), body = btrim(p_body),
           sort_order = coalesce(p_sort_order, sort_order), active = coalesce(p_active, active), updated_at = now()
     WHERE id = p_id AND competition_id = v_comp.id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  END IF;
  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), 'checkin_document', v_comp.id, NULL, NULL, jsonb_build_object('id', v_id, 'title', btrim(p_title), 'active', p_active), NULL);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Lo que firmó una persona (con las firmas), para verlo o imprimirlo.
CREATE OR REPLACE FUNCTION public.admin_checkin_signatures(p_registration_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'registration', (SELECT jsonb_build_object('full_name', r.full_name, 'bib', r.bib, 'folio', r.folio,
                       'checked_in_at', r.checked_in_at) FROM competition_registrations r WHERE r.id = p_registration_id),
    'signatures', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'document_title', s.document_title, 'document_body', s.document_body, 'signer_name', s.signer_name,
               'signature_png', s.signature_png, 'is_minor', s.is_minor, 'guardian_name', s.guardian_name,
               'guardian_relation', s.guardian_relation, 'signed_at', s.signed_at)
             ORDER BY s.signed_at), '[]'::jsonb)
      FROM competition_signatures s WHERE s.registration_id = p_registration_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_checkin_start(TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.competition_checkin_sign(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_checkin_start(TEXT, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_checkin_sign(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_competition_checkin_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_checkin_save_document(TEXT, UUID, TEXT, TEXT, INT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_checkin_signatures(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competition_checkin_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_checkin_save_document(TEXT, UUID, TEXT, TEXT, INT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_checkin_signatures(UUID) TO authenticated;

-- La ruleta pública ya no expone el número de participante de quienes están en la
-- tómbola (el número es la "llave" del check-in). Ver competencia_ruleta.sql.
DO $$
BEGIN
  IF to_regprocedure('public.get_competition_raffle_wheel(text)') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.get_competition_raffle_wheel(p_slug TEXT)
      RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $b$
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
      $b$;
    $f$;
  END IF;
END $$;

SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('competition_checkin_start', 'competition_checkin_sign')) AS checkin_listo;
