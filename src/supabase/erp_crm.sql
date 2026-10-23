-- ============================================================
-- CRM, documentos, acceso, empleados, estados financieros y correos
-- automáticos de Jaibamuro (2026-10-23).
-- Requiere clases.sql, erp.sql y erp_finanzas.sql (córrelo DESPUÉS).
-- Idempotente: se puede correr más de una vez.
--
--   1. Domiciliación: cargos próximos e historial de intentos por persona
--   2. Bitácora: quién del staff hizo qué
--   3. Responsivas y reglamento electrónicos (versionados, con firma)
--   4. Documentos en la ficha (Supabase Storage, bucket privado)
--   5. Acceso / check-in (base para el torniquete con reconocimiento facial)
--   6. Empleados (ficha, documentos, pagos de nómina → Egresos)
--   7. Estado de resultados y flujo de efectivo
--   8. Correos automáticos (bienvenida, cumpleaños, por vencer, vencida,
--      inactivo) — TODOS APAGADOS hasta que el dueño los prenda
-- ============================================================

-- ------------------------------------------------------------
-- 1. Domiciliación: cargos próximos + intentos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_subscription_history(p_subscription_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s subscriptions%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_s FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object(
    -- Los siguientes 6 cargos (fecha y monto, con la promo congelada).
    'upcoming', CASE WHEN v_s.status = 'cancelled' OR v_s.cancel_at_period_end THEN '[]'::jsonb ELSE (
      SELECT jsonb_agg(jsonb_build_object('cycle', c, 'date', greatest((v_s.start_on + make_interval(months => c - 1))::date, v_s.next_charge_on),
                                          'amount_cents', erp_cycle_amount(v_s, c), 'promo', v_s.promo_price_cents IS NOT NULL AND c <= v_s.promo_cycles) ORDER BY c)
      FROM generate_series(v_s.cycles_paid + 1, v_s.cycles_paid + 6) c) END,
    -- Cada intento (aprobado, rechazado, autenticación) y eventos de la tarjeta.
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'created_at', e.created_at,
        'cycle', (SELECT c.cycle FROM billing_charges c WHERE c.id = e.charge_id),
        'attempt', nullif(split_part(e.payload->>'key', '-', 6), '')::int,
        'error_code', e.payload->>'error_code', 'error_message', e.payload->>'error_message',
        'provider_charge_id', e.payload->>'provider_charge_id',
        'card', CASE WHEN e.kind = 'card_attached' THEN (e.payload->>'brand') || ' •••• ' || (e.payload->>'last4') END)
      ORDER BY e.created_at DESC)
      FROM (SELECT * FROM billing_events WHERE subscription_id = p_subscription_id
            AND kind IN ('attempt_paid','attempt_failed','attempt_needs_action','card_attached','cancelled_at_period_end','email_sent','email_error')
            ORDER BY created_at DESC LIMIT 200) e), '[]'::jsonb)
  );
END;
$function$;

-- ------------------------------------------------------------
-- 2. Bitácora (admin): cambios registrados + ventas + inventario
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_audit_log(p_from DATE, p_to DATE, p_actor UUID DEFAULT NULL, p_area TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) ORDER BY name) FROM profiles), '[]'::jsonb),
    'rows', coalesce((SELECT jsonb_agg(r ORDER BY (r->>'at') DESC) FROM (
      SELECT jsonb_build_object('at', a.created_at, 'actor_id', a.actor_id, 'actor', pr.name, 'action', a.action, 'entity', a.entity,
               'entity_id', a.entity_id, 'after', a.after, 'before', a.before,
               'person', (SELECT full_name FROM people WHERE id = coalesce(a.entity_id, nullif(a.after->>'person_id', '')::uuid)
                          AND a.entity IN ('person','membership','booking') LIMIT 1)) AS r
      FROM class_audit_log a LEFT JOIN profiles pr ON pr.id = a.actor_id
      WHERE (a.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_from AND p_to
        AND (p_actor IS NULL OR a.actor_id = p_actor)
        AND (p_area IS NULL OR p_area = 'cambios')
      UNION ALL
      SELECT jsonb_build_object('at', m.created_at, 'actor_id', m.created_by, 'actor', pr.name, 'action', 'stock_' || m.kind, 'entity', 'product',
               'entity_id', m.product_id, 'after', jsonb_build_object('product', p.name, 'quantity', m.quantity, 'stock_after', m.stock_after, 'note', m.note))
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN profiles pr ON pr.id = m.created_by
      WHERE m.kind NOT IN ('sale','sale_void') AND (m.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_from AND p_to
        AND (p_actor IS NULL OR m.created_by = p_actor) AND (p_area IS NULL OR p_area = 'inventario')
      UNION ALL
      SELECT jsonb_build_object('at', a.created_at, 'actor_id', a.actor_id, 'actor', pr.name, 'action', 'access_' || a.result, 'entity', 'access',
               'entity_id', a.person_id, 'after', jsonb_build_object('reasons', a.reasons, 'method', a.method), 'person', pe.full_name)
      FROM access_events a LEFT JOIN profiles pr ON pr.id = a.actor_id LEFT JOIN people pe ON pe.id = a.person_id
      WHERE (a.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_from AND p_to
        AND (p_actor IS NULL OR a.actor_id = p_actor) AND p_area = 'acceso'
      LIMIT 2000) x), '[]'::jsonb),
    -- Ventas por persona del staff en el periodo
    'sales_by_staff', coalesce((SELECT jsonb_agg(jsonb_build_object('actor', coalesce(pr.name, 'Automático / en línea'), 'count', n, 'total_cents', t, 'voided', v) ORDER BY t DESC)
      FROM (SELECT created_by, count(*) FILTER (WHERE status = 'completed')::int n, coalesce(sum(total_cents) FILTER (WHERE status = 'completed'), 0)::int t,
                   count(*) FILTER (WHERE status = 'voided')::int v
            FROM sales WHERE (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_from AND p_to
              AND (p_actor IS NULL OR created_by = p_actor) GROUP BY created_by) s
      LEFT JOIN profiles pr ON pr.id = s.created_by), '[]'::jsonb)
  );
END;
$function$;

-- ------------------------------------------------------------
-- 3. Responsivas y reglamento electrónicos
-- ------------------------------------------------------------
-- Cada versión es una fila inmutable; editar crea la versión siguiente.
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_key     TEXT NOT NULL,                       -- 'responsiva', 'reglamento', …
  version     INT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'waiver' CHECK (kind IN ('waiver','rules','other')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  required    BOOLEAN NOT NULL DEFAULT true,       -- se pide antes de entrar / reservar
  is_current  BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_current ON public.legal_documents (doc_key) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.legal_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  document_id      UUID NOT NULL REFERENCES public.legal_documents(id),
  doc_key          TEXT NOT NULL,
  version          INT NOT NULL,
  signer_name      TEXT NOT NULL,
  is_minor         BOOLEAN NOT NULL DEFAULT false,
  guardian_name    TEXT,
  guardian_relation TEXT,
  signature_png    TEXT NOT NULL CHECK (signature_png LIKE 'data:image/png;base64,%' AND length(signature_png) < 400000),
  channel          TEXT NOT NULL CHECK (channel IN ('client_app','staff_tablet')),
  collected_by     UUID,
  user_agent       TEXT,
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_signatures_person_idx ON public.legal_signatures (person_id, doc_key, version);

CREATE OR REPLACE FUNCTION public.legal_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  -- Solo se puede cambiar is_current/sort_order/required de un documento; firmas: nada.
  IF TG_TABLE_NAME = 'legal_documents' AND TG_OP = 'UPDATE' THEN
    IF NEW.body = OLD.body AND NEW.title = OLD.title AND NEW.version = OLD.version AND NEW.doc_key = OLD.doc_key THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% no se puede modificar (solo inserción)', TG_TABLE_NAME;
END;
$function$;
DROP TRIGGER IF EXISTS legal_documents_immutable ON public.legal_documents;
CREATE TRIGGER legal_documents_immutable BEFORE UPDATE OR DELETE ON public.legal_documents FOR EACH ROW EXECUTE FUNCTION public.legal_immutable();
DROP TRIGGER IF EXISTS legal_signatures_immutable ON public.legal_signatures;
CREATE TRIGGER legal_signatures_immutable BEFORE UPDATE ON public.legal_signatures FOR EACH ROW EXECUTE FUNCTION public.legal_immutable();

-- Textos iniciales (BORRADOR: el dueño debe revisarlos, de preferencia con un abogado).
INSERT INTO public.legal_documents (doc_key, version, kind, title, body, required, sort_order)
SELECT 'responsiva', 1, 'waiver', 'Carta responsiva y aceptación de riesgos',
$txt$Declaro que de manera libre y voluntaria deseo usar las instalaciones de Jaibamuro (muro de escalada / boulder) y participar en sus actividades y clases.

1. Conozco los riesgos. La escalada y el boulder son actividades físicas con riesgo inherente de lesiones, incluyendo caídas, golpes, esguinces, fracturas, lesiones graves o incluso la muerte, aun cuando se usen correctamente las instalaciones y el equipo.

2. Estado de salud. Declaro estar en condiciones físicas y de salud adecuadas para realizar esta actividad y no tener padecimientos que me lo impidan. Me comprometo a informar al personal cualquier condición médica relevante.

3. Reglas. Me comprometo a cumplir el reglamento de Jaibamuro y las indicaciones del personal. Entiendo que puedo ser retirado(a) de las instalaciones si no lo hago.

4. Responsabilidad. Asumo la responsabilidad por mi seguridad y por los daños que pueda causar a terceros o a las instalaciones por no seguir las reglas. Libero a Jaibamuro, sus dueños y personal de toda responsabilidad por lesiones o daños derivados de los riesgos propios de la actividad, salvo negligencia comprobada de su parte.

5. Atención médica. Autorizo al personal a solicitar atención médica de emergencia en mi nombre si fuera necesario; los gastos correrán por mi cuenta.

6. Imagen. Acepto que en las instalaciones se pueden tomar fotos o videos con fines de difusión. Si no deseo aparecer, lo informaré al personal.

7. Menores de edad. Si quien firma es menor de 18 años, su madre, padre o tutor acepta esta responsiva en su nombre y se hace responsable de su supervisión.

He leído y entendido este documento y lo acepto.$txt$, true, 1
WHERE NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc_key = 'responsiva');

INSERT INTO public.legal_documents (doc_key, version, kind, title, body, required, sort_order)
SELECT 'reglamento', 1, 'rules', 'Reglamento de Jaibamuro',
$txt$1. Es obligatorio registrarse en recepción y tener la responsiva firmada antes de escalar.
2. Calienta antes de escalar. Si es tu primera vez, toma la inducción con el personal.
3. No camines ni te pares debajo de alguien que está escalando. Respeta las zonas de caída.
4. Una persona por ruta o línea a la vez. Baja escalando o desciende con cuidado; evita saltar desde lo alto.
5. Usa calzado de escalada o el que indique el personal. Prohibido escalar descalzo o en calcetines.
6. Quítate anillos, relojes y objetos que puedan engancharse o caerse. Nada en los bolsillos.
7. No se permite comida ni bebidas (salvo agua) en la zona de colchones.
8. Los menores de edad deben estar acompañados o supervisados por un adulto responsable.
9. Cuida el equipo y las presas. Reporta al personal cualquier presa floja o daño.
10. Respeta a los demás, el material y las indicaciones del personal. El incumplimiento puede ser motivo de retiro sin reembolso.$txt$, true, 2
WHERE NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE doc_key = 'reglamento');

-- Documentos vigentes obligatorios que a una persona le faltan por firmar.
CREATE OR REPLACE FUNCTION public.erp_pending_documents(p_person_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'doc_key', d.doc_key, 'version', d.version, 'title', d.title, 'kind', d.kind,
           'signed_older', EXISTS (SELECT 1 FROM legal_signatures s WHERE s.person_id = p_person_id AND s.doc_key = d.doc_key))
         ORDER BY d.sort_order), '[]'::jsonb)
  FROM legal_documents d
  WHERE d.is_current AND d.required
    AND NOT EXISTS (SELECT 1 FROM legal_signatures s WHERE s.person_id = p_person_id AND s.document_id = d.id);
$function$;

-- Firma (interno). p: {document_id, signer_name, signature_png, guardian_name?, guardian_relation?, user_agent?}
CREATE OR REPLACE FUNCTION public.erp_sign_document(p_person_id UUID, p JSONB, p_channel TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_d     legal_documents%ROWTYPE;
  v_p     people%ROWTYPE;
  v_minor BOOLEAN;
  v_name  TEXT := regexp_replace(btrim(coalesce(p->>'signer_name', '')), '\s+', ' ', 'g');
  v_sig   TEXT := p->>'signature_png';
  v_id    UUID;
BEGIN
  SELECT * INTO v_p FROM people WHERE id = p_person_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  SELECT * INTO v_d FROM legal_documents WHERE id = nullif(p->>'document_id', '')::uuid;
  IF NOT FOUND OR NOT v_d.is_current THEN RETURN jsonb_build_object('error', 'document_outdated'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_sig IS NULL OR v_sig NOT LIKE 'data:image/png;base64,%' OR length(v_sig) < 200 OR length(v_sig) >= 400000 THEN
    RETURN jsonb_build_object('error', 'signature_required');
  END IF;
  v_minor := v_p.birth_date IS NOT NULL AND v_p.birth_date > (erp_today() - INTERVAL '18 years')::date;
  IF v_minor AND length(btrim(coalesce(p->>'guardian_name', ''))) < 3 THEN RETURN jsonb_build_object('error', 'guardian_required'); END IF;
  IF EXISTS (SELECT 1 FROM legal_signatures WHERE person_id = p_person_id AND document_id = v_d.id) THEN
    RETURN jsonb_build_object('success', true, 'already', true);
  END IF;
  INSERT INTO legal_signatures (person_id, document_id, doc_key, version, signer_name, is_minor, guardian_name, guardian_relation,
                                signature_png, channel, collected_by, user_agent)
  VALUES (p_person_id, v_d.id, v_d.doc_key, v_d.version, left(v_name, 120), v_minor,
          nullif(left(btrim(coalesce(p->>'guardian_name', '')), 120), ''), nullif(left(btrim(coalesce(p->>'guardian_relation', '')), 40), ''),
          v_sig, p_channel, CASE WHEN p_channel = 'staff_tablet' THEN auth.uid() END, left(p->>'user_agent', 300))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'pending', erp_pending_documents(p_person_id));
END;
$function$;

-- Cliente: lo que le falta firmar (con el texto completo para leerlo).
CREATE OR REPLACE FUNCTION public.get_my_documents()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('person', NULL); END IF;
  RETURN jsonb_build_object(
    'person', (SELECT jsonb_build_object('full_name', full_name, 'is_minor', birth_date IS NOT NULL AND birth_date > (erp_today() - INTERVAL '18 years')::date,
                                         'guardian_name', guardian_name) FROM people WHERE id = v_pid),
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'doc_key', d.doc_key, 'version', d.version, 'title', d.title, 'body', d.body,
                 'required', d.required,
                 'signed_at', (SELECT max(s.signed_at) FROM legal_signatures s WHERE s.person_id = v_pid AND s.document_id = d.id)) ORDER BY d.sort_order)
                 FROM legal_documents d WHERE d.is_current), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.sign_my_document(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  RETURN erp_sign_document(v_pid, p, 'client_app');
END;
$function$;

-- Staff: firmar en la tablet del gym en nombre de la persona (ella firma con el dedo).
CREATE OR REPLACE FUNCTION public.staff_sign_document(p_person_id UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_r JSONB;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  v_r := erp_sign_document(p_person_id, p, 'staff_tablet');
  IF v_r ? 'id' THEN PERFORM erp_audit('document_signed', 'person', p_person_id, NULL, jsonb_build_object('document_id', p->>'document_id')); END IF;
  RETURN v_r;
END;
$function$;

-- Ficha: documentos de la persona (firmados y pendientes).
CREATE OR REPLACE FUNCTION public.get_person_documents(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'current', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'doc_key', d.doc_key, 'version', d.version, 'title', d.title, 'body', d.body,
                 'required', d.required) ORDER BY d.sort_order) FROM legal_documents d WHERE d.is_current), '[]'::jsonb),
    'pending', erp_pending_documents(p_person_id),
    'signatures', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'doc_key', s.doc_key, 'version', s.version, 'title', d.title,
                 'signer_name', s.signer_name, 'guardian_name', s.guardian_name, 'guardian_relation', s.guardian_relation, 'is_minor', s.is_minor,
                 'channel', s.channel, 'signed_at', s.signed_at, 'collected_by', (SELECT name FROM profiles WHERE id = s.collected_by),
                 'is_current', d.is_current) ORDER BY s.signed_at DESC)
                 FROM legal_signatures s JOIN legal_documents d ON d.id = s.document_id WHERE s.person_id = p_person_id), '[]'::jsonb),
    'files', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'file_name', f.file_name, 'label', f.label, 'mime', f.mime,
                 'size_bytes', f.size_bytes, 'created_at', f.created_at, 'uploaded_by', (SELECT name FROM profiles WHERE id = f.uploaded_by)) ORDER BY f.created_at DESC)
                 FROM person_files f WHERE f.owner_kind = 'person' AND f.owner_id = p_person_id), '[]'::jsonb)
  );
END;
$function$;

-- Una firma completa para verla / imprimirla (con el texto exacto que se firmó).
CREATE OR REPLACE FUNCTION public.get_signature(p_signature_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID;
BEGIN
  SELECT person_id INTO v_pid FROM legal_signatures WHERE id = p_signature_id;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT class_is_staff() AND v_pid IS DISTINCT FROM class_my_person_id() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN (SELECT to_jsonb(s) || jsonb_build_object('title', d.title, 'body', d.body,
            'person', (SELECT jsonb_build_object('full_name', full_name, 'email', email, 'phone', phone, 'birth_date', birth_date) FROM people WHERE id = s.person_id),
            'collected_by_name', (SELECT name FROM profiles WHERE id = s.collected_by))
          FROM legal_signatures s JOIN legal_documents d ON d.id = s.document_id WHERE s.id = p_signature_id);
END;
$function$;

-- Admin: documentos (vigentes + historial de versiones) y cuántos han firmado.
CREATE OR REPLACE FUNCTION public.get_legal_documents()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'documents', coalesce((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'signed_count', (SELECT count(*) FROM legal_signatures s WHERE s.document_id = d.id)) ORDER BY d.sort_order, d.doc_key, d.version DESC)
      FROM legal_documents d), '[]'::jsonb),
    'people_pending', (SELECT count(*) FROM people p WHERE NOT coalesce(p.is_archived, false)
                         AND jsonb_array_length(erp_pending_documents(p.id)) > 0
                         AND (erp_membership_until(p.id) IS NOT NULL OR p.created_at > now() - INTERVAL '60 days'))
  );
END;
$function$;

-- Guardar: si cambia el texto o el título se crea una versión nueva (las firmas
-- anteriores quedan con su versión y a la gente se le pide firmar la nueva).
CREATE OR REPLACE FUNCTION public.admin_save_legal_document(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_key   TEXT := lower(regexp_replace(btrim(coalesce(p->>'doc_key', '')), '[^a-zA-Z0-9]+', '-', 'g'));
  v_cur   legal_documents%ROWTYPE;
  v_title TEXT := btrim(coalesce(p->>'title', ''));
  v_body  TEXT := btrim(coalesce(p->>'body', ''));
  v_id    UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_key) < 2 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF length(v_title) < 3 OR length(v_body) < 20 THEN RETURN jsonb_build_object('error', 'text_required'); END IF;
  IF coalesce(p->>'kind', 'waiver') NOT IN ('waiver','rules','other') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  SELECT * INTO v_cur FROM legal_documents WHERE doc_key = v_key AND is_current FOR UPDATE;
  IF FOUND AND v_cur.title = v_title AND v_cur.body = v_body THEN
    UPDATE legal_documents SET required = coalesce((p->>'required')::boolean, required), sort_order = coalesce((p->>'sort_order')::int, sort_order)
    WHERE id = v_cur.id;
    RETURN jsonb_build_object('success', true, 'id', v_cur.id, 'new_version', false);
  END IF;
  IF FOUND THEN UPDATE legal_documents SET is_current = false WHERE id = v_cur.id; END IF;
  INSERT INTO legal_documents (doc_key, version, kind, title, body, required, sort_order, created_by)
  VALUES (v_key, coalesce((SELECT max(version) FROM legal_documents WHERE doc_key = v_key), 0) + 1,
          coalesce(p->>'kind', v_cur.kind, 'waiver'), v_title, v_body,
          coalesce((p->>'required')::boolean, v_cur.required, true), coalesce((p->>'sort_order')::int, v_cur.sort_order, 0), auth.uid())
  RETURNING id INTO v_id;
  PERFORM erp_audit('legal_document_version', 'legal_document', v_id, NULL, jsonb_build_object('doc_key', v_key));
  RETURN jsonb_build_object('success', true, 'id', v_id, 'new_version', true);
END;
$function$;

-- Retirar un documento (deja de pedirse); las firmas se conservan.
CREATE OR REPLACE FUNCTION public.admin_retire_legal_document(p_doc_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE legal_documents SET is_current = false WHERE doc_key = p_doc_key AND is_current;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- 4. Documentos subidos (INE, responsiva en papel, certificados…)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.person_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind  TEXT NOT NULL CHECK (owner_kind IN ('person','employee')),
  owner_id    UUID NOT NULL,
  path        TEXT NOT NULL UNIQUE,                 -- ruta dentro del bucket 'expedientes'
  file_name   TEXT NOT NULL,
  label       TEXT,
  mime        TEXT,
  size_bytes  BIGINT,
  uploaded_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_files_owner_idx ON public.person_files (owner_kind, owner_id);

-- Para las políticas del bucket (las corre el rol authenticated).
CREATE OR REPLACE FUNCTION public.erp_storage_is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid());
$function$;

DO $storage$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('expedientes', 'expedientes', false, 10485760)
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS expedientes_staff_select ON storage.objects;
    DROP POLICY IF EXISTS expedientes_staff_insert ON storage.objects;
    DROP POLICY IF EXISTS expedientes_staff_delete ON storage.objects;
    CREATE POLICY expedientes_staff_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'expedientes' AND public.erp_storage_is_staff());
    CREATE POLICY expedientes_staff_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'expedientes' AND public.erp_storage_is_staff());
    CREATE POLICY expedientes_staff_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'expedientes' AND public.erp_storage_is_staff());
  END IF;
END;
$storage$;

-- Registrar un archivo ya subido al bucket. Ruta esperada: '<owner_kind>/<owner_id>/<archivo>'.
CREATE OR REPLACE FUNCTION public.staff_register_file(p_owner_kind TEXT, p_owner_id UUID, p_path TEXT, p_file_name TEXT,
                                                     p_label TEXT, p_mime TEXT, p_size BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_owner_kind = 'employee' AND NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_owner_kind NOT IN ('person','employee') OR p_path NOT LIKE p_owner_kind || '/' || p_owner_id::text || '/%' THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  INSERT INTO person_files (owner_kind, owner_id, path, file_name, label, mime, size_bytes, uploaded_by)
  VALUES (p_owner_kind, p_owner_id, p_path, left(coalesce(p_file_name, 'archivo'), 200), nullif(left(btrim(coalesce(p_label, '')), 80), ''),
          left(p_mime, 100), p_size, auth.uid())
  RETURNING id INTO v_id;
  PERFORM erp_audit('file_upload', p_owner_kind, p_owner_id, NULL, jsonb_build_object('file', p_file_name, 'label', p_label));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Quitar el registro (el archivo se borra del bucket desde la app con la misma sesión).
CREATE OR REPLACE FUNCTION public.admin_delete_file(p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_f person_files%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  DELETE FROM person_files WHERE id = p_file_id RETURNING * INTO v_f;
  IF v_f.id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM erp_audit('file_delete', v_f.owner_kind, v_f.owner_id, to_jsonb(v_f), NULL);
  RETURN jsonb_build_object('success', true, 'path', v_f.path);
END;
$function$;

-- ------------------------------------------------------------
-- 5. Acceso / check-in (base para el torniquete)
-- ------------------------------------------------------------
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS access_code TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS access_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS access_block_reason TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS photo_path TEXT;        -- en el bucket 'expedientes' (para la cara)
ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS access_require_documents BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.erp_new_access_code()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $function$
DECLARE
  v_alpha TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  TEXT;
BEGIN
  LOOP
    v_code := 'JM' || (SELECT string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '') FROM generate_series(1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM people WHERE access_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$function$;

UPDATE public.people SET access_code = erp_new_access_code() WHERE access_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS people_access_code_idx ON public.people (access_code) WHERE access_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.people_set_access_code()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.access_code IS NULL THEN NEW.access_code := erp_new_access_code(); END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS people_access_code ON public.people;
CREATE TRIGGER people_access_code BEFORE INSERT ON public.people FOR EACH ROW EXECUTE FUNCTION public.people_set_access_code();

CREATE TABLE IF NOT EXISTS public.access_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'turnstile' CHECK (kind IN ('turnstile','tablet','reader')),
  key_hash     TEXT,                 -- sha256 de la llave del aparato (la llave nunca se guarda)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID REFERENCES public.people(id) ON DELETE SET NULL,
  result     TEXT NOT NULL CHECK (result IN ('granted','denied','override')),
  reasons    TEXT[] NOT NULL DEFAULT '{}',
  method     TEXT NOT NULL CHECK (method IN ('manual','qr','face','device')),
  device_id  UUID REFERENCES public.access_devices(id),
  actor_id   UUID,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_events_person_idx ON public.access_events (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS access_events_created_idx ON public.access_events (created_at DESC);

-- ¿Puede entrar hoy? Reglas: no bloqueado; membresía vigente, o pase / clase
-- pagada hoy, o reserva de clase hoy; y (si se pide) documentos firmados.
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
                                 'block_reason', v_p.access_block_reason,
                                 'is_minor', v_p.birth_date IS NOT NULL AND v_p.birth_date > (v_today - INTERVAL '18 years')::date),
    'last_entry', (SELECT max(created_at) FROM access_events WHERE person_id = p_person_id AND result IN ('granted','override')));
END;
$function$;

-- Check-in desde recepción: por persona (búsqueda) o por código (QR / lector).
-- p_override con motivo deja pasar aunque no cumpla (queda registrado).
CREATE OR REPLACE FUNCTION public.staff_check_in(p_person_id UUID, p_code TEXT, p_method TEXT, p_override_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid  UUID := p_person_id;
  v_dec  JSONB;
  v_res  TEXT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(p_method, '') NOT IN ('manual','qr','face') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF v_pid IS NULL THEN
    SELECT id INTO v_pid FROM people WHERE access_code = upper(btrim(coalesce(p_code, '')));
    IF v_pid IS NULL THEN RETURN jsonb_build_object('error', 'code_not_found'); END IF;
  END IF;
  v_dec := erp_access_decision(v_pid);
  IF (v_dec->>'allowed')::boolean THEN v_res := 'granted';
  ELSIF length(btrim(coalesce(p_override_reason, ''))) >= 3 THEN v_res := 'override';
  ELSE v_res := 'denied'; END IF;
  INSERT INTO access_events (person_id, result, reasons, method, actor_id, note)
  VALUES (v_pid, v_res, ARRAY(SELECT jsonb_array_elements_text(v_dec->'reasons')), p_method, auth.uid(), nullif(btrim(coalesce(p_override_reason, '')), ''));
  RETURN v_dec || jsonb_build_object('result', v_res);
END;
$function$;

-- Solo consultar (sin registrar entrada), p. ej. al buscar a alguien en recepción.
CREATE OR REPLACE FUNCTION public.staff_access_status(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN erp_access_decision(p_person_id) || jsonb_build_object(
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', a.created_at, 'result', a.result, 'reasons', a.reasons, 'method', a.method,
                         'by', (SELECT name FROM profiles WHERE id = a.actor_id), 'note', a.note) ORDER BY a.created_at DESC)
                        FROM (SELECT * FROM access_events WHERE person_id = p_person_id ORDER BY created_at DESC LIMIT 20) a), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_access_today()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'require_documents', (SELECT access_require_documents FROM erp_settings WHERE id = 1),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'created_at', a.created_at, 'result', a.result, 'reasons', a.reasons,
                'method', a.method, 'note', a.note, 'person_id', a.person_id, 'person_name', p.full_name, 'by', (SELECT name FROM profiles WHERE id = a.actor_id))
              ORDER BY a.created_at DESC)
              FROM access_events a LEFT JOIN people p ON p.id = a.person_id
              WHERE (a.created_at AT TIME ZONE 'America/Mexico_City')::date = erp_today()), '[]'::jsonb),
    'unique_today', (SELECT count(DISTINCT person_id) FROM access_events
                     WHERE result IN ('granted','override') AND (created_at AT TIME ZONE 'America/Mexico_City')::date = erp_today())
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_access(p_person_id UUID, p_blocked BOOLEAN, p_reason TEXT, p_new_code BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_blocked AND length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  UPDATE people SET access_blocked = p_blocked, access_block_reason = CASE WHEN p_blocked THEN btrim(p_reason) END,
    access_code = CASE WHEN p_new_code THEN erp_new_access_code() ELSE access_code END, updated_at = now()
  WHERE id = p_person_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM erp_audit(CASE WHEN p_blocked THEN 'access_block' ELSE 'access_unblock' END, 'person', p_person_id, NULL,
                    jsonb_build_object('reason', p_reason, 'new_code', p_new_code));
  RETURN jsonb_build_object('success', true, 'access_code', (SELECT access_code FROM people WHERE id = p_person_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_set_photo(p_person_id UUID, p_path TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_path IS NOT NULL AND p_path NOT LIKE 'person/' || p_person_id::text || '/%' THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  UPDATE people SET photo_path = p_path, updated_at = now() WHERE id = p_person_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_access_settings(p_require_documents BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE erp_settings SET access_require_documents = p_require_documents, updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Cliente: su código para el QR de entrada.
CREATE OR REPLACE FUNCTION public.get_my_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('person', NULL); END IF;
  RETURN jsonb_build_object('access_code', (SELECT access_code FROM people WHERE id = v_pid),
                            'pending_documents', erp_pending_documents(v_pid));
END;
$function$;

-- Para el torniquete (Edge Function con service_role, más adelante).
CREATE OR REPLACE FUNCTION public.device_check_in(p_key_hash TEXT, p_code TEXT, p_method TEXT DEFAULT 'device')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_dev access_devices%ROWTYPE;
  v_pid UUID;
  v_dec JSONB;
BEGIN
  SELECT * INTO v_dev FROM access_devices WHERE key_hash = p_key_hash AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'device_unknown'); END IF;
  UPDATE access_devices SET last_seen_at = now() WHERE id = v_dev.id;
  SELECT id INTO v_pid FROM people WHERE access_code = upper(btrim(coalesce(p_code, '')));
  IF v_pid IS NULL THEN
    INSERT INTO access_events (person_id, result, reasons, method, device_id) VALUES (NULL, 'denied', ARRAY['code_not_found'], 'device', v_dev.id);
    RETURN jsonb_build_object('allowed', false, 'reasons', ARRAY['code_not_found']);
  END IF;
  v_dec := erp_access_decision(v_pid);
  INSERT INTO access_events (person_id, result, reasons, method, device_id)
  VALUES (v_pid, CASE WHEN (v_dec->>'allowed')::boolean THEN 'granted' ELSE 'denied' END,
          ARRAY(SELECT jsonb_array_elements_text(v_dec->'reasons')), CASE WHEN p_method = 'face' THEN 'face' ELSE 'device' END, v_dev.id);
  RETURN jsonb_build_object('allowed', v_dec->'allowed', 'reasons', v_dec->'reasons', 'name', v_dec->'person'->>'full_name');
END;
$function$;

-- ------------------------------------------------------------
-- 6. Empleados
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  position        TEXT,                     -- recepción, coach, armador, limpieza…
  profile_id      UUID,                     -- su usuario del panel (si tiene)
  phone           TEXT,
  email           TEXT,
  birth_date      DATE,
  address         TEXT,
  curp            TEXT,
  rfc             TEXT,
  nss             TEXT,
  hire_date       DATE,
  end_date        DATE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  pay_scheme      TEXT CHECK (pay_scheme IN ('weekly','biweekly','monthly','per_class','hourly','per_job')),
  pay_rate_cents  INT CHECK (pay_rate_cents IS NULL OR pay_rate_cents >= 0),
  bank_name       TEXT,
  bank_account    TEXT,                     -- CLABE / cuenta para la transferencia de nómina
  emergency_name  TEXT,
  emergency_phone TEXT,
  notes           TEXT,
  payee_id        UUID REFERENCES public.expense_payees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.get_employees()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'employees', coalesce((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object(
        'login_name', (SELECT name FROM profiles WHERE id = e.profile_id), 'login_role', (SELECT role FROM profiles WHERE id = e.profile_id),
        'paid_this_month', coalesce((SELECT sum(amount_cents) FROM expenses x WHERE x.payee_id = e.payee_id AND x.status = 'paid'
                                     AND x.period_month = erp_month(erp_today())), 0))
      ORDER BY e.status, e.full_name) FROM employees e), '[]'::jsonb),
    'staff_logins', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) ORDER BY name) FROM profiles), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee(p_employee_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_e employees%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object(
    'employee', to_jsonb(v_e),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'folio', x.folio, 'description', x.description, 'amount_cents', x.amount_cents,
                 'status', x.status, 'due_on', x.due_on, 'paid_on', x.paid_on, 'method', x.method, 'period_month', x.period_month) ORDER BY x.due_on DESC)
                 FROM expenses x WHERE x.payee_id = v_e.payee_id AND x.status <> 'cancelled' AND v_e.payee_id IS NOT NULL), '[]'::jsonb),
    'files', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'file_name', f.file_name, 'label', f.label, 'mime', f.mime,
                 'size_bytes', f.size_bytes, 'created_at', f.created_at) ORDER BY f.created_at DESC)
                 FROM person_files f WHERE f.owner_kind = 'employee' AND f.owner_id = p_employee_id), '[]'::jsonb),
    'sales_month', CASE WHEN v_e.profile_id IS NULL THEN NULL ELSE (SELECT jsonb_build_object('count', count(*), 'total_cents', coalesce(sum(total_cents), 0))
                 FROM sales WHERE created_by = v_e.profile_id AND status = 'completed'
                   AND erp_month((created_at AT TIME ZONE 'America/Mexico_City')::date) = erp_month(erp_today())) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_employee(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id    UUID := nullif(p->>'id', '')::uuid;
  v_name  TEXT := regexp_replace(btrim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_payee UUID;
  t       TEXT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  -- Cada empleado tiene su "a quién se paga" para que la nómina caiga en Egresos.
  SELECT id INTO v_payee FROM expense_payees WHERE lower(name) = lower(v_name);
  IF v_payee IS NULL THEN
    INSERT INTO expense_payees (name, kind, default_category) VALUES (v_name, 'employee', 'Nómina') RETURNING id INTO v_payee;
  ELSE
    UPDATE expense_payees SET kind = 'employee', default_category = coalesce(default_category, 'Nómina') WHERE id = v_payee;
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO employees (full_name, payee_id) VALUES (v_name, v_payee) RETURNING id INTO v_id;
    END IF;
    UPDATE employees SET full_name = v_name, payee_id = v_payee,
      position = nullif(btrim(coalesce(p->>'position', '')), ''), profile_id = nullif(p->>'profile_id', '')::uuid,
      phone = nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), ''), email = nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
      birth_date = nullif(p->>'birth_date', '')::date, address = nullif(btrim(coalesce(p->>'address', '')), ''),
      curp = nullif(upper(btrim(coalesce(p->>'curp', ''))), ''), rfc = nullif(upper(btrim(coalesce(p->>'rfc', ''))), ''),
      nss = nullif(btrim(coalesce(p->>'nss', '')), ''), hire_date = nullif(p->>'hire_date', '')::date, end_date = nullif(p->>'end_date', '')::date,
      status = coalesce(nullif(p->>'status', ''), 'active'), pay_scheme = nullif(p->>'pay_scheme', ''),
      pay_rate_cents = nullif(p->>'pay_rate_cents', '')::int, bank_name = nullif(btrim(coalesce(p->>'bank_name', '')), ''),
      bank_account = nullif(btrim(coalesce(p->>'bank_account', '')), ''), emergency_name = nullif(btrim(coalesce(p->>'emergency_name', '')), ''),
      emergency_phone = nullif(regexp_replace(coalesce(p->>'emergency_phone', ''), '\D', '', 'g'), ''), notes = nullif(btrim(coalesce(p->>'notes', '')), ''),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  PERFORM erp_audit('employee_save', 'employee', v_id, NULL, p - 'bank_account');
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Pago de nómina: crea el egreso (Nómina) ligado al empleado.
CREATE OR REPLACE FUNCTION public.admin_pay_employee(p_employee_id UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_e  employees%ROWTYPE;
  v_cc TEXT;
  v_r  JSONB;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT coalesce((SELECT cc FROM unnest(expense_cost_centers) cc WHERE cc ILIKE '%n_mina%' LIMIT 1),
                  (SELECT cc FROM unnest(expense_cost_centers) cc WHERE cc ILIKE '%fijo%' LIMIT 1), expense_cost_centers[1])
    INTO v_cc FROM erp_settings WHERE id = 1;
  v_r := erp_create_expense(jsonb_build_object(
    'payee_id', v_e.payee_id, 'description', coalesce(nullif(btrim(coalesce(p->>'description', '')), ''), 'Nómina ' || v_e.full_name),
    'cost_center', coalesce(nullif(p->>'cost_center', ''), v_cc), 'category', 'Nómina', 'amount_cents', p->>'amount_cents',
    'due_on', coalesce(nullif(p->>'paid_on', ''), erp_today()::text), 'period_month', p->>'period_month',
    'pay_now', true, 'paid_on', p->>'paid_on', 'method', coalesce(nullif(p->>'method', ''), 'transfer'),
    'paid_from', coalesce(nullif(p->>'paid_from', ''), 'bank'), 'notes', p->>'notes'));
  IF NOT (v_r ? 'error') THEN PERFORM erp_audit('employee_pay', 'employee', p_employee_id, NULL, p); END IF;
  RETURN v_r;
END;
$function$;

-- ------------------------------------------------------------
-- 7. Estado de resultados y flujo de efectivo (por mes del año)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_statements(p_year INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_from DATE := make_date(p_year, 1, 1);
  v_to   DATE := make_date(p_year, 12, 31);
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'year', p_year,
    -- Ingresos por tipo de concepto (ventas completadas, por mes de la venta).
    'income', coalesce((SELECT jsonb_agg(jsonb_build_object('group', g, 'month', m, 'cents', c)) FROM (
        SELECT CASE WHEN s.source = 'subscription' THEN 'Domiciliación'
                    WHEN pr.kind = 'plan' THEN 'Membresías' WHEN pr.kind = 'pass' THEN 'Pases'
                    WHEN pr.kind = 'class' OR s.source = 'class' THEN 'Clases' WHEN pr.kind = 'product' THEN 'Productos'
                    WHEN pr.kind = 'service' THEN 'Servicios' ELSE 'Otros' END AS g,
               extract(month FROM (s.created_at AT TIME ZONE 'America/Mexico_City'))::int AS m,
               sum(i.total_cents)::bigint AS c
        FROM sales s JOIN sale_items i ON i.sale_id = s.id LEFT JOIN products pr ON pr.id = i.product_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1, 2) x), '[]'::jsonb),
    -- Descuentos generales de venta (se restan del ingreso).
    'discounts', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', c)) FROM (
        SELECT extract(month FROM (created_at AT TIME ZONE 'America/Mexico_City'))::int m, sum(discount_cents)::bigint c FROM sales
        WHERE status = 'completed' AND discount_cents > 0 AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to GROUP BY 1) x), '[]'::jsonb),
    -- Costo de lo vendido (productos con costo capturado).
    'cogs', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', c)) FROM (
        SELECT extract(month FROM (created_at AT TIME ZONE 'America/Mexico_City'))::int m, sum(-quantity * coalesce(unit_cost_cents, 0))::bigint c
        FROM stock_movements WHERE kind IN ('sale','sale_void') AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to GROUP BY 1) x), '[]'::jsonb),
    -- Gastos por centro de costos (por mes al que corresponden, sin compras de inventario para no contarlas dos veces).
    'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object('group', cost_center, 'month', m, 'cents', c)) FROM (
        SELECT e.cost_center, extract(month FROM e.period_month)::int m, sum(e.amount_cents)::bigint c FROM expenses e
        WHERE e.status <> 'cancelled' AND e.period_month BETWEEN v_from AND v_to
          AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.expense_id = e.id)
        GROUP BY 1, 2) x), '[]'::jsonb),
    'inventory_purchases', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', c)) FROM (
        SELECT extract(month FROM e.period_month)::int m, sum(e.amount_cents)::bigint c FROM expenses e
        WHERE e.status <> 'cancelled' AND e.period_month BETWEEN v_from AND v_to AND EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.expense_id = e.id)
        GROUP BY 1) x), '[]'::jsonb),
    -- Flujo de efectivo: lo que entró (por forma de pago, fecha de la venta) y lo que salió (fecha de pago).
    'cash_in', coalesce((SELECT jsonb_agg(jsonb_build_object('group', method, 'month', m, 'cents', c)) FROM (
        SELECT sp.method, extract(month FROM (s.created_at AT TIME ZONE 'America/Mexico_City'))::int m, sum(sp.amount_cents)::bigint c
        FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to GROUP BY 1, 2) x), '[]'::jsonb),
    'cash_out', coalesce((SELECT jsonb_agg(jsonb_build_object('group', paid_from, 'month', m, 'cents', c)) FROM (
        SELECT paid_from, extract(month FROM paid_on)::int m, sum(amount_cents)::bigint c FROM expenses
        WHERE status = 'paid' AND paid_on BETWEEN v_from AND v_to GROUP BY 1, 2) x), '[]'::jsonb),
    -- Posición al día de hoy (no es un balance general contable).
    'position', jsonb_build_object(
      'inventory_cost_cents', (SELECT coalesce(sum(greatest(stock, 0) * coalesce(cost_cents, 0)), 0) FROM products WHERE track_stock AND is_active),
      'payables_cents', (SELECT coalesce(sum(amount_cents), 0) FROM expenses WHERE status = 'pending'),
      'cash_in_register_cents', (SELECT (erp_cash_summary(id)->>'expected_cash')::int FROM cash_sessions WHERE closed_at IS NULL),
      'active_members', (SELECT count(*) FROM people p WHERE erp_membership_until(p.id) IS NOT NULL),
      'active_subscriptions', (SELECT count(*) FROM subscriptions WHERE status IN ('active','past_due')),
      'mrr_cents', (SELECT coalesce(sum(erp_cycle_amount(s, s.cycles_paid + 1)), 0) FROM subscriptions s WHERE s.status IN ('active','past_due') AND NOT s.cancel_at_period_end))
  );
END;
$function$;

-- ------------------------------------------------------------
-- 8. Correos automáticos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_automations (
  key         TEXT PRIMARY KEY CHECK (key IN ('welcome','birthday','expiring','expired','inactive')),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  enabled_at  TIMESTAMPTZ,
  days        INT NOT NULL DEFAULT 0 CHECK (days BETWEEN 0 AND 120),
  subject     TEXT NOT NULL,
  heading     TEXT NOT NULL,
  body        TEXT NOT NULL,
  button_text TEXT,
  button_url  TEXT,
  marketing   BOOLEAN NOT NULL DEFAULT false,   -- respeta "acepta promociones" de la persona
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.email_automations (key, days, subject, heading, body, button_text, button_url, marketing) VALUES
  ('welcome', 0, '¡Bienvenid@ a Jaibamuro, {{nombre}}!', '¡Qué gusto tenerte, {{nombre}}!',
   'Ya eres parte de la comunidad de Jaibamuro. Desde tu cuenta puedes ver tu membresía, reservar clases y firmar tu responsiva. Si es tu primera vez, pide tu inducción en recepción. ¡Nos vemos en el muro!',
   'Ir a mi cuenta', 'https://app.jaibamuro.com/mi-cuenta', false),
  ('birthday', 0, '¡Feliz cumpleaños, {{nombre}}! 🎂', '¡Feliz cumpleaños, {{nombre}}!',
   'Todo el equipo de Jaibamuro te desea un gran día. Ven a celebrarlo escalando con nosotros.',
   NULL, NULL, true),
  ('expiring', 3, 'Tu membresía vence el {{fecha}}', '{{nombre}}, tu membresía está por vencer',
   'Tu membresía de Jaibamuro vence el {{fecha}}. Renueva en recepción para seguir escalando sin interrupciones, o pregúntanos por la domiciliación para que se renueve sola cada mes.',
   'Ver mi membresía', 'https://app.jaibamuro.com/mi-cuenta', false),
  ('expired', 1, 'Te extrañamos en el muro, {{nombre}}', '{{nombre}}, tu membresía venció',
   'Tu membresía venció el {{fecha}}. Cuando quieras regresar, renueva en recepción. ¡Te esperamos!',
   NULL, NULL, false),
  ('inactive', 14, '¿Todo bien, {{nombre}}? Hace días que no te vemos', 'Hace {{dias}} días que no te vemos',
   'Tu membresía sigue vigente hasta el {{fecha}} y el muro te está esperando. Hay rutas nuevas cada semana.',
   'Ver clases', 'https://app.jaibamuro.com/clases', true)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key TEXT NOT NULL,
  person_id      UUID REFERENCES public.people(id) ON DELETE SET NULL,
  email          TEXT NOT NULL,
  ref_date       DATE NOT NULL,                     -- evita repetir: (automatización, persona, fecha de referencia)
  status         TEXT NOT NULL CHECK (status IN ('sent','error','test')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_log_once ON public.email_log (automation_key, person_id, ref_date) WHERE status = 'sent';

-- Lo que toca mandar hoy (solo automatizaciones prendidas). Lo usa la Edge Function crm-emails.
CREATE OR REPLACE FUNCTION public.crm_due_emails()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('key', a.key, 'person_id', p.id, 'email', p.email, 'full_name', p.full_name, 'ref_date', d.ref_date,
             'vars', jsonb_build_object('nombre', split_part(p.full_name, ' ', 1), 'fecha', to_char(d.fecha, 'DD/MM/YYYY'), 'dias', d.dias)) AS x
    FROM email_automations a
    CROSS JOIN LATERAL (
      SELECT p.id, p.created_at::date AS ref_date, NULL::date AS fecha, NULL::int AS dias FROM people p
        WHERE a.key = 'welcome' AND p.created_at >= a.enabled_at AND p.created_at::date >= v_today - 2
      UNION ALL
      SELECT p.id, v_today, NULL, NULL FROM people p
        WHERE a.key = 'birthday' AND p.birth_date IS NOT NULL
          AND extract(month FROM p.birth_date) = extract(month FROM v_today) AND extract(day FROM p.birth_date) = extract(day FROM v_today)
      UNION ALL
      SELECT p.id, u.until, u.until, NULL FROM people p CROSS JOIN LATERAL (SELECT erp_membership_until(p.id) AS until) u
        WHERE a.key = 'expiring' AND u.until = v_today + a.days
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.person_id = p.id AND s.status IN ('active','past_due') AND NOT s.cancel_at_period_end)
      UNION ALL
      SELECT p.id, m.last_until, m.last_until, NULL FROM people p
        CROSS JOIN LATERAL (SELECT max(valid_until) AS last_until FROM memberships WHERE person_id = p.id AND NOT is_void) m
        WHERE a.key = 'expired' AND m.last_until = v_today - a.days
      UNION ALL
      SELECT p.id, l.last_in::date, erp_membership_until(p.id), (v_today - l.last_in::date)::int FROM people p
        CROSS JOIN LATERAL (SELECT max(created_at) AS last_in FROM access_events WHERE person_id = p.id AND result IN ('granted','override')) l
        WHERE a.key = 'inactive' AND l.last_in IS NOT NULL AND l.last_in::date = v_today - a.days AND erp_membership_until(p.id) IS NOT NULL
    ) d
    JOIN people p ON p.id = d.id
    WHERE a.enabled AND p.email IS NOT NULL AND NOT coalesce(p.is_archived, false)
      AND (NOT a.marketing OR coalesce(p.allow_marketing, true))
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.automation_key = a.key AND l.person_id = p.id AND l.ref_date = d.ref_date AND l.status = 'sent')
    LIMIT 200) q), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_log_email(p_key TEXT, p_person_id UUID, p_email TEXT, p_ref_date DATE, p_status TEXT, p_error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  INSERT INTO email_log (automation_key, person_id, email, ref_date, status, error)
  VALUES (p_key, p_person_id, p_email, p_ref_date, p_status, left(p_error, 500))
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('success', FOUND);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation(p_key TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT to_jsonb(a) FROM email_automations a WHERE key = p_key;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_automations()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'automations', coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'sent_30d', (SELECT count(*) FROM email_log l WHERE l.automation_key = a.key AND l.status = 'sent' AND l.created_at > now() - INTERVAL '30 days'))
      ORDER BY array_position(ARRAY['welcome','birthday','expiring','expired','inactive'], a.key)) FROM email_automations a), '[]'::jsonb),
    'log', coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', l.created_at, 'key', l.automation_key, 'email', l.email, 'status', l.status,
                     'error', l.error, 'person_name', p.full_name) ORDER BY l.created_at DESC)
                     FROM (SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100) l LEFT JOIN people p ON p.id = l.person_id), '[]'::jsonb),
    'my_email', (SELECT email FROM auth.users WHERE id = auth.uid())
  );
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
  RETURN jsonb_build_object(
    'automations', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.key) FROM email_automations a), '[]'::jsonb), 'log', '[]'::jsonb,
    'my_email', auth.jwt()->>'email');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_email_automation(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_a email_automations%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_a FROM email_automations WHERE key = p->>'key' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(btrim(coalesce(p->>'subject', v_a.subject))) < 3 OR length(btrim(coalesce(p->>'body', v_a.body))) < 10 THEN
    RETURN jsonb_build_object('error', 'text_required');
  END IF;
  BEGIN
    UPDATE email_automations SET
      enabled = coalesce((p->>'enabled')::boolean, enabled),
      enabled_at = CASE WHEN coalesce((p->>'enabled')::boolean, enabled) AND NOT enabled THEN now() ELSE enabled_at END,
      days = coalesce(nullif(p->>'days', '')::int, days),
      subject = left(btrim(coalesce(p->>'subject', subject)), 150), heading = left(btrim(coalesce(p->>'heading', heading)), 150),
      body = left(btrim(coalesce(p->>'body', body)), 3000),
      button_text = CASE WHEN p ? 'button_text' THEN nullif(left(btrim(coalesce(p->>'button_text', '')), 40), '') ELSE button_text END,
      button_url = CASE WHEN p ? 'button_url' THEN nullif(left(btrim(coalesce(p->>'button_url', '')), 300), '') ELSE button_url END,
      updated_at = now()
    WHERE key = v_a.key;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN RETURN jsonb_build_object('error', 'invalid_value');
  END;
  IF p->>'button_url' IS NOT NULL AND p->>'button_url' <> '' AND p->>'button_url' !~ '^https://' THEN
    RAISE EXCEPTION 'url';
  END IF;
  PERFORM erp_audit('email_automation_save', 'settings', NULL, to_jsonb(v_a), p);
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error', 'invalid_url');
END;
$function$;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
ALTER TABLE public.legal_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_signatures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_files      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_devices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_documents, public.legal_signatures, public.person_files, public.access_devices, public.access_events,
              public.employees, public.email_automations, public.email_log FROM anon, authenticated;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'legal_immutable()', 'erp_pending_documents(uuid)', 'erp_sign_document(uuid,jsonb,text)', 'erp_new_access_code()',
    'people_set_access_code()', 'erp_access_decision(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- La política del bucket la evalúa el rol authenticated.
  REVOKE ALL ON FUNCTION public.erp_storage_is_staff() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.erp_storage_is_staff() TO authenticated;
  FOREACH f IN ARRAY ARRAY[
    'get_subscription_history(uuid)', 'get_audit_log(date,date,uuid,text)',
    'get_my_documents()', 'sign_my_document(jsonb)', 'staff_sign_document(uuid,jsonb)', 'get_person_documents(uuid)', 'get_signature(uuid)',
    'get_legal_documents()', 'admin_save_legal_document(jsonb)', 'admin_retire_legal_document(text)',
    'staff_register_file(text,uuid,text,text,text,text,bigint)', 'admin_delete_file(uuid)',
    'staff_check_in(uuid,text,text,text)', 'staff_access_status(uuid)', 'get_access_today()', 'admin_set_access(uuid,boolean,text,boolean)',
    'staff_set_photo(uuid,text)', 'admin_set_access_settings(boolean)', 'get_my_access()',
    'get_employees()', 'get_employee(uuid)', 'admin_save_employee(jsonb)', 'admin_pay_employee(uuid,jsonb)',
    'get_financial_statements(integer)', 'get_email_automations()', 'admin_save_email_automation(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- Solo Edge Functions (service_role).
  FOREACH f IN ARRAY ARRAY[
    'device_check_in(text,text,text)', 'crm_due_emails()', 'crm_log_email(text,uuid,text,date,text,text)', 'crm_automation(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END;
$grants$;
