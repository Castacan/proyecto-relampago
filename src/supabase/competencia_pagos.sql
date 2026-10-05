-- ============================================================
-- Competencia — cobro en línea con Clip (Etapa 2, 2026-10-04)
--
-- Requiere competencia.sql ya corrido. Idempotente.
--
-- Flujo: la Edge Function `competition-payments` (supabase/functions)
-- crea un link de pago de Clip POR INSCRIPCIÓN, con el folio como
-- referencia. Clip avisa por webhook cuando cambia el estado; el webhook
-- no trae firma, así que NUNCA se le cree al cuerpo: solo se toma el id
-- del link y se consulta su estado real a la API de Clip. Lo mismo hace
-- la revisión manual ("Revisar pagos con Clip") por si un webhook no llega.
--
-- Garantías:
--   * Se escribe el pago local ANTES de pedirle el link a Clip.
--   * Todo evento se guarda crudo en competition_payment_events (solo
--     inserción) antes de procesarse.
--   * Procesar el mismo estado N veces da el mismo resultado; un pago
--     'completed' nunca retrocede.
--   * Un pago completado nunca se descarta: si no se puede aplicar limpio
--     (sin cupo, duplicado, monto distinto, inscripción cancelada) queda
--     marcado con review_reason y aparece en el panel.
--
-- Las funciones de este archivo solo las puede ejecutar service_role (la
-- Edge Function), salvo las de admin del final.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     UUID NOT NULL REFERENCES public.competition_registrations(id),
  provider            TEXT NOT NULL DEFAULT 'clip',
  provider_payment_id TEXT UNIQUE,          -- payment_request_id de Clip; NULL hasta que Clip responde
  payment_url         TEXT,
  amount_cents        INT  NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created','pending','completed','cancelled','expired','failed')),
  provider_status     TEXT,                 -- estado crudo de Clip
  receipt_no          TEXT,
  -- NULL = aplicado limpio. Si no: 'duplicate' | 'amount_mismatch' |
  -- 'no_room' | 'registration_inactive'. Requiere decisión de staff.
  review_reason       TEXT,
  reviewed_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competition_payments_registration_idx ON public.competition_payments (registration_id);
CREATE INDEX IF NOT EXISTS competition_payments_status_idx ON public.competition_payments (status, created_at);

-- Bitácora cruda de todo lo que pasa con un pago. Solo inserción.
-- kind: 'create' (respuesta de Clip al crear el link) | 'raw' (webhook tal
-- cual llegó) | 'status' (estado consultado a Clip y qué se hizo con él) |
-- 'error'.
CREATE TABLE IF NOT EXISTS public.competition_payment_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          UUID,
  provider_payment_id TEXT,
  source              TEXT NOT NULL,        -- 'create' | 'webhook' | 'check' | 'reconcile'
  kind                TEXT NOT NULL,
  payload             JSONB,
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competition_payment_events_provider_idx ON public.competition_payment_events (provider_payment_id);

CREATE OR REPLACE FUNCTION public.competition_payment_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'competition_payment_events es de solo inserción';
END;
$function$;

DROP TRIGGER IF EXISTS competition_payment_events_no_change ON public.competition_payment_events;
CREATE TRIGGER competition_payment_events_no_change
  BEFORE UPDATE OR DELETE ON public.competition_payment_events
  FOR EACH ROW EXECUTE FUNCTION public.competition_payment_events_immutable();

ALTER TABLE public.competition_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_payments, public.competition_payment_events FROM anon, authenticated;

-- ------------------------------------------------------------
-- Para la Edge Function (service_role)
-- ------------------------------------------------------------

-- Paso 1 de "Pagar": valida la inscripción y devuelve el link vigente si
-- ya hay uno, o crea el pago local (status 'created', sin link todavía)
-- para que la función le pida el link a Clip.
-- Si la reserva ya venció: se re-aparta el lugar si queda cupo; si no,
-- se rechaza ANTES de cobrar ('full') — no se cobra un lugar que no existe.
CREATE OR REPLACE FUNCTION public.competition_begin_payment(p_folio TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_reg  competition_registrations%ROWTYPE;
  v_cat  competition_categories%ROWTYPE;
  v_pay  competition_payments%ROWTYPE;
  v_id   UUID;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c
  WHERE c.id = (SELECT r.competition_id FROM competition_registrations r
                WHERE r.folio = upper(btrim(coalesce(p_folio, ''))) AND r.email = lower(btrim(coalesce(p_email, ''))))
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.folio = upper(btrim(p_folio)) AND r.email = lower(btrim(p_email)) FOR UPDATE;

  IF v_reg.status = 'paid' THEN RETURN jsonb_build_object('error', 'already_paid'); END IF;
  IF v_reg.status <> 'pending_payment' THEN RETURN jsonb_build_object('error', 'not_payable'); END IF;

  IF v_reg.hold_expires_at <= now() THEN
    SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
    IF competition_spots_taken(v_comp.id) >= v_comp.capacity_total
       OR (v_cat.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, v_cat.id) >= v_cat.capacity) THEN
      RETURN jsonb_build_object('error', 'full');
    END IF;
    UPDATE competition_registrations r
    SET hold_expires_at = now() + make_interval(hours => v_comp.hold_hours), updated_at = now()
    WHERE r.id = v_reg.id;
  END IF;

  -- ¿Ya hay un intento abierto?
  SELECT p.* INTO v_pay FROM competition_payments p
  WHERE p.registration_id = v_reg.id AND p.status IN ('created','pending')
  ORDER BY p.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_pay.provider_payment_id IS NOT NULL
       AND v_pay.amount_cents = v_comp.price_cents
       AND (v_pay.expires_at IS NULL OR v_pay.expires_at > now() + INTERVAL '10 minutes') THEN
      RETURN jsonb_build_object('reuse', true, 'payment_id', v_pay.id,
        'provider_payment_id', v_pay.provider_payment_id, 'payment_url', v_pay.payment_url);
    END IF;
    IF v_pay.provider_payment_id IS NULL THEN
      -- Otro clic está pidiéndole el link a Clip en este momento.
      IF v_pay.created_at > now() - INTERVAL '90 seconds' THEN RETURN jsonb_build_object('error', 'busy'); END IF;
      -- Intento que nunca recibió link: nadie pudo pagarlo.
      UPDATE competition_payments p SET status = 'failed', updated_at = now() WHERE p.id = v_pay.id;
    END IF;
    -- Si tiene link pero está por vencer o cambió el precio, se deja como
    -- está (la revisión contra Clip lo cierra) y se crea uno nuevo.
  END IF;

  INSERT INTO competition_payments (registration_id, amount_cents)
  VALUES (v_reg.id, v_comp.price_cents) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'payment_id', v_id,
    'amount_cents', v_comp.price_cents,
    'competition_name', v_comp.name,
    'folio', v_reg.folio,
    'full_name', v_reg.full_name,
    'email', v_reg.email,
    'phone', v_reg.phone
  );
END;
$function$;

-- Paso 2: Clip respondió con el link.
CREATE OR REPLACE FUNCTION public.competition_attach_payment(
  p_payment_id UUID, p_provider_payment_id TEXT, p_payment_url TEXT, p_expires_at TIMESTAMPTZ, p_raw JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  UPDATE competition_payments p SET
    provider_payment_id = p_provider_payment_id, payment_url = p_payment_url, expires_at = p_expires_at,
    status = 'pending', provider_status = p_raw->>'status', updated_at = now()
  WHERE p.id = p_payment_id AND p.status = 'created';
  INSERT INTO competition_payment_events (payment_id, provider_payment_id, source, kind, payload)
  VALUES (p_payment_id, p_provider_payment_id, 'create', 'create', p_raw);
END;
$function$;

-- Paso 2 alterno: Clip falló o no respondió. El intento queda 'failed'.
CREATE OR REPLACE FUNCTION public.competition_fail_payment(p_payment_id UUID, p_error JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  UPDATE competition_payments p SET status = 'failed', updated_at = now()
  WHERE p.id = p_payment_id AND p.status = 'created';
  INSERT INTO competition_payment_events (payment_id, source, kind, payload)
  VALUES (p_payment_id, 'create', 'error', p_error);
END;
$function$;

-- Guarda un evento tal cual (webhook crudo, errores) ANTES de procesar.
CREATE OR REPLACE FUNCTION public.competition_record_payment_event(
  p_provider_payment_id TEXT, p_source TEXT, p_kind TEXT, p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  INSERT INTO competition_payment_events (payment_id, provider_payment_id, source, kind, payload)
  VALUES ((SELECT p.id FROM competition_payments p WHERE p.provider_payment_id = p_provider_payment_id),
          p_provider_payment_id, p_source, p_kind, p_payload);
END;
$function$;

-- Aplica el estado REAL de un link (el que respondió la API de Clip, no
-- el cuerpo de un webhook). Idempotente.
CREATE OR REPLACE FUNCTION public.competition_apply_payment_status(
  p_provider_payment_id TEXT,
  p_provider_status     TEXT,
  p_amount              NUMERIC,
  p_receipt_no          TEXT,
  p_source              TEXT,
  p_raw                 JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp    competitions%ROWTYPE;
  v_reg     competition_registrations%ROWTYPE;
  v_new     competition_registrations%ROWTYPE;
  v_cat     competition_categories%ROWTYPE;
  v_pay     competition_payments%ROWTYPE;
  v_status  TEXT;
  v_review  TEXT;
  v_holds   BOOLEAN;
  v_room    BOOLEAN;
  v_result  JSONB;
BEGIN
  v_status := CASE upper(coalesce(p_provider_status, ''))
    WHEN 'CHECKOUT_COMPLETED' THEN 'completed' WHEN 'COMPLETED' THEN 'completed'
    WHEN 'CHECKOUT_CANCELLED' THEN 'cancelled' WHEN 'CANCELLED' THEN 'cancelled' WHEN 'CANCELED' THEN 'cancelled'
    WHEN 'CHECKOUT_EXPIRED' THEN 'expired' WHEN 'EXPIRED' THEN 'expired'
    ELSE 'pending' END;

  -- Mismo orden de bloqueo que el resto: competencia → inscripción → pago.
  SELECT c.* INTO v_comp FROM competitions c
  WHERE c.id = (SELECT r.competition_id FROM competition_registrations r
                JOIN competition_payments p ON p.registration_id = r.id
                WHERE p.provider_payment_id = p_provider_payment_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    v_result := jsonb_build_object('error', 'unknown_payment');
    INSERT INTO competition_payment_events (provider_payment_id, source, kind, payload, result)
    VALUES (p_provider_payment_id, p_source, 'status', p_raw, v_result);
    RETURN v_result;
  END IF;

  SELECT p.* INTO v_pay FROM competition_payments p WHERE p.provider_payment_id = p_provider_payment_id;
  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = v_pay.registration_id FOR UPDATE;
  SELECT p.* INTO v_pay FROM competition_payments p WHERE p.id = v_pay.id FOR UPDATE;

  IF v_pay.status = 'completed' THEN
    -- Ya aplicado: no retrocede ni se aplica dos veces.
    v_result := jsonb_build_object('status', 'completed', 'noop', true);
  ELSIF v_status <> 'completed' THEN
    UPDATE competition_payments p SET status = v_status, provider_status = p_provider_status, updated_at = now()
    WHERE p.id = v_pay.id;
    v_result := jsonb_build_object('status', v_status);
  ELSE
    v_new := v_reg;
    v_holds := v_reg.status IN ('paid','needs_attention')
               OR (v_reg.status = 'pending_payment' AND v_reg.hold_expires_at > now());
    SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
    v_room := competition_spots_taken(v_comp.id) < v_comp.capacity_total
              AND (v_cat.capacity IS NULL OR competition_spots_taken(v_comp.id, v_cat.id) < v_cat.capacity);

    IF v_reg.status IN ('paid','needs_attention') THEN
      v_review := 'duplicate';              -- ya había dinero recibido para esta inscripción
    ELSIF v_reg.status <> 'pending_payment' THEN
      v_review := 'registration_inactive';  -- cancelada / reembolsada / vencida y reinscrita
    ELSE
      v_new.paid_at := now();
      v_new.payment_method := 'clip';
      IF p_amount IS NULL OR round(p_amount * 100) <> v_pay.amount_cents THEN
        v_review := 'amount_mismatch';
        v_new.status := 'needs_attention';
      ELSIF v_holds OR v_room THEN
        v_new.status := 'paid';
      ELSE
        v_review := 'no_room';
        v_new.status := 'needs_attention';
      END IF;
      v_new.updated_at := now();
      UPDATE competition_registrations r SET
        status = v_new.status, paid_at = v_new.paid_at, payment_method = v_new.payment_method, updated_at = v_new.updated_at
      WHERE r.id = v_reg.id;
      INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
      VALUES (NULL, 'online_payment', v_comp.id, v_reg.id, to_jsonb(v_reg), to_jsonb(v_new),
              'Pago Clip ' || coalesce(p_receipt_no, p_provider_payment_id));
    END IF;

    UPDATE competition_payments p SET
      status = 'completed', provider_status = p_provider_status, receipt_no = p_receipt_no,
      review_reason = v_review, completed_at = now(), updated_at = now()
    WHERE p.id = v_pay.id;
    v_result := jsonb_build_object('status', 'completed', 'registration_status', v_new.status, 'review_reason', v_review);
  END IF;

  INSERT INTO competition_payment_events (payment_id, provider_payment_id, source, kind, payload, result)
  VALUES (v_pay.id, p_provider_payment_id, p_source, 'status', p_raw, v_result);
  RETURN v_result;
END;
$function$;

-- Links abiertos que hay que consultar en Clip. Con p_folio/p_email se
-- limita a los de una inscripción (lo usa la página de consulta).
CREATE OR REPLACE FUNCTION public.competition_payments_to_check(p_folio TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL)
RETURNS TABLE (provider_payment_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT p.provider_payment_id
  FROM competition_payments p
  JOIN competition_registrations r ON r.id = p.registration_id
  WHERE p.status IN ('created','pending') AND p.provider_payment_id IS NOT NULL
    AND p.created_at > now() - INTERVAL '15 days'
    AND (p_folio IS NULL OR (r.folio = upper(btrim(p_folio)) AND r.email = lower(btrim(coalesce(p_email, '')))))
  ORDER BY p.created_at;
$function$;

REVOKE ALL ON FUNCTION public.competition_begin_payment(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_attach_payment(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_fail_payment(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_record_payment_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_apply_payment_status(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_payments_to_check(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_payment_events_immutable() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.competition_begin_payment(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_attach_payment(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_fail_payment(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_record_payment_event(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_apply_payment_status(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_payments_to_check(TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- Admin
-- ------------------------------------------------------------

-- La Edge Function la llama con el JWT de quien presiona "Revisar pagos
-- con Clip" para confirmar que es admin. Solo dice sí/no sobre uno mismo.
GRANT EXECUTE ON FUNCTION public.competition_is_admin() TO authenticated;

-- Resumen de pagos en línea + los que requieren decisión de staff.
CREATE OR REPLACE FUNCTION public.get_competition_payments_admin(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp_id UUID;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT c.id INTO v_comp_id FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'completed', (SELECT count(*) FROM competition_payments p JOIN competition_registrations r ON r.id = p.registration_id
                  WHERE r.competition_id = v_comp_id AND p.status = 'completed'),
    'open', (SELECT count(*) FROM competition_payments p JOIN competition_registrations r ON r.id = p.registration_id
             WHERE r.competition_id = v_comp_id AND p.status IN ('created','pending') AND p.provider_payment_id IS NOT NULL),
    'last_check_at', (SELECT max(e.created_at) FROM competition_payment_events e WHERE e.kind = 'status'),
    'unknown_events', (SELECT count(*) FROM competition_payment_events e
                       WHERE e.kind = 'status' AND e.payment_id IS NULL AND e.result->>'error' = 'unknown_payment'),
    'review', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'folio', r.folio, 'full_name', r.full_name, 'registration_status', r.status,
               'amount_cents', p.amount_cents, 'receipt_no', p.receipt_no,
               'review_reason', p.review_reason, 'completed_at', p.completed_at
             ) ORDER BY p.completed_at DESC), '[]'::jsonb)
      FROM competition_payments p JOIN competition_registrations r ON r.id = p.registration_id
      WHERE r.competition_id = v_comp_id AND p.review_reason IS NOT NULL AND p.reviewed_at IS NULL)
  );
END;
$function$;

-- Staff ya resolvió un pago marcado (lo reembolsó en Clip, lo admitió, etc.).
CREATE OR REPLACE FUNCTION public.admin_resolve_payment_review(p_payment_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_pay    competition_payments%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;

  SELECT p.* INTO v_pay FROM competition_payments p WHERE p.id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.review_reason IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  UPDATE competition_payments p SET reviewed_at = now(), updated_at = now() WHERE p.id = v_pay.id;
  INSERT INTO competition_audit_log (actor_id, action, registration_id, before, after, reason)
  VALUES (auth.uid(), 'resolve_payment_review', v_pay.registration_id, to_jsonb(v_pay),
          to_jsonb(v_pay) || jsonb_build_object('reviewed_at', now()), v_reason);
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_competition_payments_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_payment_review(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competition_payments_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_payment_review(UUID, TEXT) TO authenticated;

-- admin_update_competition: ahora también acepta price_cents (para la
-- prueba con $1 y volver a $500 sin tocar SQL). Mínimo $1.
CREATE OR REPLACE FUNCTION public.admin_update_competition(p_slug TEXT, p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_new  competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_new := v_comp;

  IF p_patch ? 'is_open' THEN v_new.is_open := (p_patch->>'is_open')::boolean; END IF;
  IF p_patch ? 'capacity_total' THEN v_new.capacity_total := (p_patch->>'capacity_total')::int; END IF;
  IF p_patch ? 'hold_hours' THEN v_new.hold_hours := (p_patch->>'hold_hours')::int; END IF;
  IF p_patch ? 'price_cents' THEN v_new.price_cents := (p_patch->>'price_cents')::int; END IF;
  IF p_patch ? 'payment_link_url' THEN v_new.payment_link_url := nullif(btrim(p_patch->>'payment_link_url'), ''); END IF;
  IF p_patch ? 'payment_instructions' THEN v_new.payment_instructions := nullif(btrim(p_patch->>'payment_instructions'), ''); END IF;

  IF v_new.capacity_total < 0 OR v_new.hold_hours < 1 OR v_new.hold_hours > 720
     OR v_new.price_cents IS NULL OR v_new.price_cents < 100 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF v_new.payment_link_url IS NOT NULL AND v_new.payment_link_url !~* '^https://' THEN
    RETURN jsonb_build_object('error', 'invalid_link');
  END IF;

  UPDATE competitions c SET
    is_open = v_new.is_open, capacity_total = v_new.capacity_total, hold_hours = v_new.hold_hours,
    price_cents = v_new.price_cents,
    payment_link_url = v_new.payment_link_url, payment_instructions = v_new.payment_instructions
  WHERE c.id = v_comp.id;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'update_competition', v_comp.id, to_jsonb(v_comp), to_jsonb(v_new));

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Con cobro en línea ya no aplica "escribe tu folio en el concepto".
UPDATE public.competitions
SET payment_instructions = 'Pagas con tarjeta de débito o crédito en la página segura de Clip. Tu lugar se confirma solo en cuanto se aprueba el pago.'
WHERE slug = 'competencia-2026' AND payment_instructions LIKE 'Al pagar, escribe tu folio%';
