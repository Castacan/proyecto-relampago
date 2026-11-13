-- ============================================================
-- Anticipo de clases con Clip (2026-11-13). Reglas de Emiliano:
--   · Toda reserva del cliente paga un anticipo de $100 con tarjeta (link de
--     Clip, igual que la inscripción a la competencia). Al miembro su clase le
--     cuesta $100: el anticipo es todo su pago. Al resto le falta $200 en el gym.
--   · El lugar se aparta 30 min mientras paga. Si no paga, se libera solo.
--   · Si cancela, el anticipo se le guarda UNA vez como saldo para otra clase.
--     Si cancela la clase que reservó con ese saldo, lo pierde.
--   · Si el gym cancela la clase, siempre se le guarda (o se le regresa el saldo).
--   · Si falta sin cancelar, pierde el anticipo.
--   · La clase gratis del mes del miembro no paga anticipo.
-- Correr DESPUÉS de clases.sql, erp.sql y erp_finanzas.sql. Idempotente.
-- Lo usa la Edge Function class-payments (Verify JWT APAGADO).
-- ============================================================

-- 1) Configuración
ALTER TABLE public.class_settings ADD COLUMN IF NOT EXISTS deposit_cents INT NOT NULL DEFAULT 0;
ALTER TABLE public.class_settings ADD COLUMN IF NOT EXISTS deposit_hold_minutes INT NOT NULL DEFAULT 30;
-- Con anticipo ya no se puede reservar "pago en el gym" sin pagar nada.
UPDATE public.class_settings SET deposit_cents = 10000, deposit_hold_minutes = 30, allow_pay_at_gym = false WHERE id = 1;

-- 2) Columnas del anticipo en la reserva
ALTER TABLE public.class_bookings ADD COLUMN IF NOT EXISTS deposit_cents INT NOT NULL DEFAULT 0;
ALTER TABLE public.class_bookings ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.class_bookings ADD COLUMN IF NOT EXISTS deposit_credit_id UUID;
DO $$ BEGIN
  ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_deposit_status_chk
    CHECK (deposit_status IN ('none','pending','paid','credit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Saldo a favor (anticipo guardado)
CREATE TABLE IF NOT EXISTS public.class_deposit_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  amount_cents      INT NOT NULL CHECK (amount_cents > 0),
  source_booking_id UUID REFERENCES public.class_bookings(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','void')),
  used_booking_id   UUID REFERENCES public.class_bookings(id) ON DELETE SET NULL,
  used_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS class_deposit_credits_person_idx ON public.class_deposit_credits (person_id) WHERE status = 'available';
CREATE UNIQUE INDEX IF NOT EXISTS class_deposit_credits_one_per_booking ON public.class_deposit_credits (source_booking_id) WHERE source_booking_id IS NOT NULL;
ALTER TABLE public.class_deposit_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_deposit_credits FROM anon, authenticated;

-- 4) Pagos con Clip (igual que competition_payments)
CREATE TABLE IF NOT EXISTS public.class_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES public.class_bookings(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'clip',
  provider_payment_id TEXT UNIQUE,
  payment_url         TEXT,
  amount_cents        INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','completed','cancelled','expired','failed')),
  provider_status     TEXT,
  receipt_no          TEXT,
  review_reason       TEXT,
  expires_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS class_payments_booking_idx ON public.class_payments (booking_id);
CREATE INDEX IF NOT EXISTS class_payments_open_idx ON public.class_payments (status) WHERE status IN ('created','pending');

CREATE TABLE IF NOT EXISTS public.class_payment_events (
  id                  BIGSERIAL PRIMARY KEY,
  payment_id          UUID REFERENCES public.class_payments(id) ON DELETE SET NULL,
  provider_payment_id TEXT,
  source              TEXT NOT NULL,
  kind                TEXT NOT NULL,
  payload             JSONB,
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.class_payment_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN RAISE EXCEPTION 'class_payment_events es solo de inserción'; END;
$function$;
DROP TRIGGER IF EXISTS class_payment_events_immutable ON public.class_payment_events;
CREATE TRIGGER class_payment_events_immutable BEFORE UPDATE OR DELETE ON public.class_payment_events
  FOR EACH ROW EXECUTE FUNCTION public.class_payment_events_immutable();
ALTER TABLE public.class_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_payments, public.class_payment_events FROM anon, authenticated;

-- 5) Lo que falta por pagar en el gym (precio − anticipo cubierto)
CREATE OR REPLACE FUNCTION public.class_booking_due(p_booking_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT CASE WHEN b.payment_status IN ('paid','not_needed','refunded') THEN 0
              WHEN b.deposit_status IN ('paid','credit') THEN greatest(b.amount_cents - b.deposit_cents, 0)
              ELSE b.amount_cents END
  FROM class_bookings b WHERE b.id = p_booking_id;
$function$;

CREATE OR REPLACE FUNCTION public.class_booking_json(p_booking_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'id', b.id, 'session_id', b.session_id, 'person_id', b.person_id, 'status', b.status,
    'price_tier', b.price_tier, 'payment_method', b.payment_method, 'payment_status', b.payment_status,
    'paid_with', b.paid_with, 'amount_cents', b.amount_cents, 'is_overbook', b.is_overbook,
    'needs_reschedule', b.needs_reschedule, 'booked_at', b.booked_at, 'cancelled_at', b.cancelled_at,
    'deposit_cents', b.deposit_cents, 'deposit_status', b.deposit_status, 'hold_expires_at', b.hold_expires_at,
    'due_cents', class_booking_due(b.id),
    'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
    'is_minor', p.birth_date IS NOT NULL AND p.birth_date > (class_mx_date(v.starts_at) - INTERVAL '18 years')::date,
    'class_name', v.name, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'instructor_name', v.instructor_name
  )
  FROM class_bookings b
  JOIN people p ON p.id = b.person_id
  JOIN class_sessions_v v ON v.id = b.session_id
  WHERE b.id = p_booking_id;
$function$;

CREATE OR REPLACE FUNCTION public.class_settings_json()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'book_ahead_days', s.book_ahead_days, 'cancel_hours', s.cancel_hours,
    'free_classes_per_month', s.free_classes_per_month, 'overbook_tolerance', s.overbook_tolerance,
    'allow_pay_at_gym', s.allow_pay_at_gym, 'rules_text', s.rules_text,
    'deposit_cents', s.deposit_cents, 'deposit_hold_minutes', s.deposit_hold_minutes)
  FROM class_settings s WHERE s.id = 1;
$function$;

-- 6) Al cancelarse una reserva con anticipo: guardarlo como saldo (una vez).
--    Sirve para cancelación del cliente, del staff y del gym (clase cancelada).
CREATE OR REPLACE FUNCTION public.class_booking_deposit_on_cancel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF OLD.status IN ('booked','pending_payment') AND NEW.status IN ('cancelled','cancelled_late','cancelled_by_gym')
     AND NEW.deposit_cents > 0 THEN
    IF NEW.deposit_status = 'paid'
       OR (NEW.deposit_status = 'credit' AND NEW.status = 'cancelled_by_gym') THEN
      INSERT INTO class_deposit_credits (person_id, amount_cents, source_booking_id, reason)
      VALUES (NEW.person_id, NEW.deposit_cents, NEW.id,
              CASE WHEN NEW.status = 'cancelled_by_gym' THEN 'El gym canceló la clase' ELSE 'Canceló su reserva' END)
      ON CONFLICT DO NOTHING;
    END IF;
    -- deposit_status 'credit' cancelado por el cliente: ya usó su única oportunidad, lo pierde.
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS class_booking_deposit_on_cancel ON public.class_bookings;
CREATE TRIGGER class_booking_deposit_on_cancel AFTER UPDATE OF status ON public.class_bookings
  FOR EACH ROW EXECUTE FUNCTION public.class_booking_deposit_on_cancel();

-- 7) Reservar. p_option:
--   'online'       → anticipo con Clip (queda pending_payment 30 min)
--   'credit'       → usa su saldo a favor como anticipo
--   'free_monthly' → clase gratis del mes (miembro), sin anticipo
--   'at_gym'       → solo si allow_pay_at_gym (hoy apagado)
CREATE OR REPLACE FUNCTION public.book_class(p_session_id UUID, p_option TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set     class_settings%ROWTYPE;
  v_person  UUID := class_my_person_id();
  v_sess    class_sessions%ROWTYPE;
  v         class_sessions_v%ROWTYPE;
  v_day     DATE;
  v_member  BOOLEAN;
  v_tier    TEXT;
  v_method  TEXT;
  v_pstatus TEXT;
  v_amount  INT;
  v_status  TEXT := 'booked';
  v_dep     INT := 0;
  v_dstatus TEXT := 'none';
  v_hold    TIMESTAMPTZ;
  v_credit  class_deposit_credits%ROWTYPE;
  v_paidw   TEXT;
  v_id      UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_person IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  IF p_option NOT IN ('free_monthly','at_gym','online','credit') THEN RETURN jsonb_build_object('error', 'invalid_option'); END IF;

  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_sess FROM class_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO v FROM class_sessions_v WHERE id = p_session_id;
  v_day := class_mx_date(v.starts_at);

  IF v.status <> 'scheduled' OR NOT v.type_active THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  IF v.booking_mode <> 'online' THEN RETURN jsonb_build_object('error', 'staff_only'); END IF;
  IF v.starts_at <= now() THEN RETURN jsonb_build_object('error', 'started'); END IF;
  IF v_day > class_today() + v_set.book_ahead_days THEN RETURN jsonb_build_object('error', 'too_early'); END IF;

  -- Un intento anterior que no se pagó a tiempo ya no aparta nada: se cierra.
  UPDATE class_bookings SET status = 'cancelled', deposit_status = 'none', cancelled_at = now(), updated_at = now()
  WHERE session_id = p_session_id AND person_id = v_person AND status = 'pending_payment'
    AND deposit_status = 'pending' AND hold_expires_at <= now();

  IF EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = p_session_id AND b.person_id = v_person
             AND b.status NOT IN ('cancelled','cancelled_late','cancelled_by_gym')) THEN
    RETURN jsonb_build_object('error', 'already_booked');
  END IF;
  IF class_taken(p_session_id) >= v.capacity THEN RETURN jsonb_build_object('error', 'full'); END IF;

  v_member := class_is_member(v_person, v_day);
  IF p_option = 'free_monthly' THEN
    IF NOT v_member THEN RETURN jsonb_build_object('error', 'not_member'); END IF;
    IF NOT v.eligible_free_monthly THEN RETURN jsonb_build_object('error', 'not_eligible'); END IF;
    IF class_free_used(v_person, v_day) >= v_set.free_classes_per_month THEN RETURN jsonb_build_object('error', 'free_used'); END IF;
    v_tier := 'free_monthly'; v_method := 'none'; v_pstatus := 'not_needed'; v_amount := 0;
  ELSE
    v_tier := CASE WHEN v_member THEN 'member' ELSE 'regular' END;
    v_amount := CASE WHEN v_member THEN v.member_price_cents ELSE v.price_cents END;
    v_pstatus := CASE WHEN v_amount = 0 THEN 'not_needed' ELSE 'pending' END;
    IF p_option = 'at_gym' THEN
      IF NOT v_set.allow_pay_at_gym THEN RETURN jsonb_build_object('error', 'pay_at_gym_disabled'); END IF;
      v_method := 'at_gym';
    ELSIF v_amount = 0 THEN
      v_method := 'none';   -- clase sin costo: no hay anticipo que cobrar
    ELSE
      IF v_set.deposit_cents <= 0 THEN RETURN jsonb_build_object('error', 'deposit_disabled'); END IF;
      v_dep := least(v_set.deposit_cents, v_amount);
      IF p_option = 'online' THEN
        v_method := 'online'; v_status := 'pending_payment'; v_dstatus := 'pending';
        v_hold := now() + make_interval(mins => v_set.deposit_hold_minutes);
      ELSE  -- 'credit'
        SELECT * INTO v_credit FROM class_deposit_credits
        WHERE person_id = v_person AND status = 'available' ORDER BY created_at LIMIT 1 FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_credit'); END IF;
        v_dep := least(v_credit.amount_cents, v_amount);
        v_method := 'online'; v_dstatus := 'credit';
        IF v_amount - v_dep <= 0 THEN v_pstatus := 'paid'; v_paidw := 'credit'; END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO class_bookings (session_id, person_id, status, price_tier, payment_method, payment_status, amount_cents,
                              deposit_cents, deposit_status, deposit_credit_id, hold_expires_at, paid_with, paid_at, created_by)
  VALUES (p_session_id, v_person, v_status, v_tier, v_method, v_pstatus, v_amount,
          v_dep, v_dstatus, v_credit.id, v_hold, v_paidw, CASE WHEN v_paidw IS NOT NULL THEN now() END, auth.uid())
  RETURNING id INTO v_id;

  IF v_credit.id IS NOT NULL THEN
    UPDATE class_deposit_credits SET status = 'used', used_booking_id = v_id, used_at = now() WHERE id = v_credit.id;
  END IF;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'book', 'booking', v_id, class_booking_json(v_id));

  RETURN jsonb_build_object('success', true, 'booking', class_booking_json(v_id), 'needs_payment', v_status = 'pending_payment');
END;
$function$;

-- Saldo a favor del cliente (para ofrecer "usar mi anticipo guardado").
CREATE OR REPLACE FUNCTION public.get_my_class_credit()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object('count', count(*), 'amount_cents', coalesce(sum(amount_cents), 0))
  FROM class_deposit_credits WHERE person_id = class_my_person_id() AND status = 'available';
$function$;

-- 8) Venta del resto en el gym: cobra precio − anticipo (redefine erp.sql).
CREATE OR REPLACE FUNCTION public.erp_booking_sale(p_booking_id UUID, p_paid_with TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_b    class_bookings%ROWTYPE;
  v_name TEXT;
  v_due  INT;
  v_sid  UUID := erp_open_session_id();
BEGIN
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id;
  -- Ojo: admin_mark_booking_paid marca la reserva pagada ANTES de llamarnos, así
  -- que no se usa class_booking_due (daría 0): precio − anticipo cubierto.
  v_due := CASE WHEN v_b.deposit_status IN ('paid','credit') THEN greatest(v_b.amount_cents - v_b.deposit_cents, 0) ELSE v_b.amount_cents END;
  SELECT t.name || ' · ' || to_char(s.starts_at AT TIME ZONE 'America/Mexico_City', 'DD/MM HH24:MI') INTO v_name
  FROM class_sessions s JOIN class_types t ON t.id = s.class_type_id WHERE s.id = v_b.session_id;
  IF v_due <= 0 THEN RETURN jsonb_build_object('success', true, 'skipped', 'nothing_due'); END IF;
  RETURN erp_insert_sale(v_b.person_id, 'class',
    jsonb_build_array(jsonb_build_object('description', 'Clase ' || v_name || CASE v_b.price_tier WHEN 'member' THEN ' (miembro)' ELSE '' END
                                         || CASE WHEN v_b.deposit_status IN ('paid','credit') AND v_b.deposit_cents > 0
                                                 THEN ' · resto (anticipo $' || (v_b.deposit_cents / 100) || ')' ELSE '' END,
                                         'quantity', 1, 'unit_price_cents', v_due)),
    jsonb_build_array(jsonb_build_object('method', p_paid_with, 'amount_cents', v_due)),
    0, NULL, p_booking_id, NULL, v_sid);
END;
$function$;

-- 9) RPCs del cobro con Clip.
-- class_begin_deposit: la llama la Edge Function CON el JWT del cliente
-- (así se valida que la reserva es suya). Las demás solo con service_role.
CREATE OR REPLACE FUNCTION public.class_begin_deposit(p_booking_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_set    class_settings%ROWTYPE;
  v_person UUID := class_my_person_id();
  v_b      class_bookings%ROWTYPE;
  v        class_sessions_v%ROWTYPE;
  v_p      people%ROWTYPE;
  v_pay    class_payments%ROWTYPE;
  v_id     UUID;
BEGIN
  IF auth.uid() IS NULL OR v_person IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id AND person_id = v_person;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM 1 FROM class_sessions WHERE id = v_b.session_id FOR UPDATE;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_b.deposit_status = 'paid' THEN RETURN jsonb_build_object('error', 'already_paid'); END IF;
  IF v_b.status <> 'pending_payment' OR v_b.deposit_status <> 'pending' THEN RETURN jsonb_build_object('error', 'not_payable'); END IF;
  SELECT * INTO v FROM class_sessions_v WHERE id = v_b.session_id;
  IF v.status <> 'scheduled' OR v.starts_at <= now() THEN RETURN jsonb_build_object('error', 'started'); END IF;

  -- Se le acabaron los 30 min: si todavía hay lugar se le renuevan; si no, se cierra.
  IF v_b.hold_expires_at <= now() THEN
    IF class_taken(v_b.session_id) >= v.capacity THEN
      UPDATE class_bookings SET status = 'cancelled', deposit_status = 'none', cancelled_at = now(), updated_at = now() WHERE id = v_b.id;
      RETURN jsonb_build_object('error', 'full');
    END IF;
    UPDATE class_bookings SET hold_expires_at = now() + make_interval(mins => v_set.deposit_hold_minutes), updated_at = now() WHERE id = v_b.id;
  END IF;

  SELECT * INTO v_pay FROM class_payments WHERE booking_id = v_b.id AND status IN ('created','pending') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_pay.provider_payment_id IS NOT NULL AND v_pay.amount_cents = v_b.deposit_cents
       AND (v_pay.expires_at IS NULL OR v_pay.expires_at > now() + INTERVAL '10 minutes') THEN
      RETURN jsonb_build_object('reuse', true, 'payment_id', v_pay.id, 'payment_url', v_pay.payment_url);
    END IF;
    IF v_pay.provider_payment_id IS NULL AND v_pay.created_at > now() - INTERVAL '90 seconds' THEN
      RETURN jsonb_build_object('error', 'busy');
    END IF;
    IF v_pay.provider_payment_id IS NULL THEN UPDATE class_payments SET status = 'failed', updated_at = now() WHERE id = v_pay.id; END IF;
  END IF;

  INSERT INTO class_payments (booking_id, amount_cents) VALUES (v_b.id, v_b.deposit_cents) RETURNING id INTO v_id;
  SELECT * INTO v_p FROM people WHERE id = v_b.person_id;
  RETURN jsonb_build_object('payment_id', v_id, 'booking_id', v_b.id, 'amount_cents', v_b.deposit_cents,
    'class_name', v.name, 'starts_at', v.starts_at, 'full_name', v_p.full_name, 'email', v_p.email, 'phone', v_p.phone);
END;
$function$;

CREATE OR REPLACE FUNCTION public.class_attach_payment(p_payment_id UUID, p_provider_payment_id TEXT, p_payment_url TEXT, p_expires_at TIMESTAMPTZ, p_raw JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE class_payments SET status = 'pending', provider_payment_id = p_provider_payment_id, payment_url = p_payment_url,
    expires_at = p_expires_at, provider_status = p_raw->>'status', updated_at = now()
  WHERE id = p_payment_id AND status = 'created';
  IF NOT FOUND THEN RAISE EXCEPTION 'class_payments: pago % no está en created', p_payment_id; END IF;
  INSERT INTO class_payment_events (payment_id, provider_payment_id, source, kind, payload)
  VALUES (p_payment_id, p_provider_payment_id, 'create', 'create', p_raw);
END;
$function$;

CREATE OR REPLACE FUNCTION public.class_fail_payment(p_payment_id UUID, p_error JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE class_payments SET status = 'failed', updated_at = now() WHERE id = p_payment_id AND status = 'created';
  INSERT INTO class_payment_events (payment_id, source, kind, payload) VALUES (p_payment_id, 'create', 'error', p_error);
END;
$function$;

CREATE OR REPLACE FUNCTION public.class_record_payment_event(p_provider_payment_id TEXT, p_source TEXT, p_kind TEXT, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  INSERT INTO class_payment_events (payment_id, provider_payment_id, source, kind, payload)
  VALUES ((SELECT id FROM class_payments WHERE provider_payment_id = p_provider_payment_id), p_provider_payment_id, p_source, p_kind, p_payload);
END;
$function$;

-- Aplica lo que respondió la API de Clip. Nunca va hacia atrás.
CREATE OR REPLACE FUNCTION public.class_apply_payment_status(p_provider_payment_id TEXT, p_provider_status TEXT, p_amount NUMERIC,
                                                            p_receipt_no TEXT, p_source TEXT, p_raw JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pay    class_payments%ROWTYPE;
  v_b      class_bookings%ROWTYPE;
  v        class_sessions_v%ROWTYPE;
  v_new    TEXT;
  v_review TEXT;
  v_result TEXT;
  v_due    INT;
  v_out    JSONB;
BEGIN
  v_new := CASE upper(coalesce(p_provider_status, ''))
    WHEN 'CHECKOUT_COMPLETED' THEN 'completed' WHEN 'COMPLETED' THEN 'completed'
    WHEN 'CHECKOUT_CANCELLED' THEN 'cancelled' WHEN 'CANCELLED' THEN 'cancelled' WHEN 'CANCELED' THEN 'cancelled'
    WHEN 'CHECKOUT_EXPIRED' THEN 'expired' WHEN 'EXPIRED' THEN 'expired'
    ELSE 'pending' END;

  SELECT * INTO v_pay FROM class_payments WHERE provider_payment_id = p_provider_payment_id;
  IF NOT FOUND THEN
    INSERT INTO class_payment_events (provider_payment_id, source, kind, payload, result)
    VALUES (p_provider_payment_id, p_source, 'status', p_raw, '{"error":"unknown_payment"}');
    RETURN jsonb_build_object('error', 'unknown_payment');
  END IF;
  SELECT * INTO v_b FROM class_bookings WHERE id = v_pay.booking_id;
  PERFORM 1 FROM class_sessions WHERE id = v_b.session_id FOR UPDATE;
  SELECT * INTO v_b FROM class_bookings WHERE id = v_pay.booking_id FOR UPDATE;
  SELECT * INTO v_pay FROM class_payments WHERE id = v_pay.id FOR UPDATE;

  IF v_pay.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'completed', 'noop', true, 'booking_status', v_b.status);
  END IF;

  IF v_new <> 'completed' THEN
    UPDATE class_payments SET status = CASE WHEN v_new = 'pending' THEN status ELSE v_new END,
      provider_status = p_provider_status, updated_at = now() WHERE id = v_pay.id;
    v_out := jsonb_build_object('status', v_new, 'booking_status', v_b.status);
  ELSE
    SELECT * INTO v FROM class_sessions_v WHERE id = v_b.session_id;
    IF round(coalesce(p_amount, 0) * 100) <> v_pay.amount_cents THEN
      v_review := 'amount_mismatch';
    END IF;

    -- El dinero entró: venta en línea (sin caja) por el anticipo.
    PERFORM erp_insert_sale(v_b.person_id, 'online',
      jsonb_build_array(jsonb_build_object('description', 'Anticipo clase ' || v.name || ' · ' ||
                        to_char(v.starts_at AT TIME ZONE 'America/Mexico_City', 'DD/MM HH24:MI'),
                        'quantity', 1, 'unit_price_cents', round(coalesce(p_amount, 0) * 100)::int)),
      jsonb_build_array(jsonb_build_object('method', 'clip', 'amount_cents', round(coalesce(p_amount, 0) * 100)::int,
                        'reference', 'Clip ' || coalesce(p_receipt_no, p_provider_payment_id))),
      0, 'Anticipo en línea (Clip)', NULL, NULL, NULL);

    IF v_b.status = 'pending_payment' AND v_b.deposit_status = 'pending' AND v_review IS NULL THEN
      IF v_b.hold_expires_at > now() OR (v.status = 'scheduled' AND v.starts_at > now()
            AND (SELECT count(*) FROM class_bookings x WHERE x.session_id = v_b.session_id AND x.id <> v_b.id
                 AND (x.status IN ('booked','attended','no_show') OR (x.status = 'pending_payment' AND x.hold_expires_at > now()))) < v.capacity) THEN
        v_due := greatest(v_b.amount_cents - v_b.deposit_cents, 0);
        UPDATE class_bookings SET status = 'booked', deposit_status = 'paid', hold_expires_at = NULL,
          payment_status = CASE WHEN v_due = 0 THEN 'paid' ELSE payment_status END,
          paid_with = CASE WHEN v_due = 0 THEN 'clip' ELSE paid_with END,
          paid_at = CASE WHEN v_due = 0 THEN now() ELSE paid_at END,
          booked_at = now(), updated_at = now()
        WHERE id = v_b.id;
        v_result := 'booked';
      ELSE
        -- Pagó tarde y ya no hay lugar: el anticipo queda como saldo a favor.
        INSERT INTO class_deposit_credits (person_id, amount_cents, source_booking_id, reason)
        VALUES (v_b.person_id, v_b.deposit_cents, v_b.id, 'Pagó el anticipo cuando ya no había lugar')
        ON CONFLICT DO NOTHING;
        UPDATE class_bookings SET deposit_status = 'paid', updated_at = now() WHERE id = v_b.id;
        UPDATE class_bookings SET status = 'cancelled_by_gym', cancelled_at = now(), updated_at = now() WHERE id = v_b.id;
        v_review := 'no_room'; v_result := 'credit';
      END IF;
    ELSE
      -- La reserva ya no esperaba este pago (canceló, expiró o monto distinto): saldo a favor.
      v_review := coalesce(v_review, 'booking_inactive');
      INSERT INTO class_deposit_credits (person_id, amount_cents, source_booking_id, reason)
      SELECT v_b.person_id, round(coalesce(p_amount, 0) * 100)::int,
             CASE WHEN EXISTS (SELECT 1 FROM class_deposit_credits c WHERE c.source_booking_id = v_b.id) THEN NULL ELSE v_b.id END,
             'Pago de anticipo que llegó cuando la reserva ya no estaba activa'
      WHERE round(coalesce(p_amount, 0) * 100) > 0;
      v_result := 'credit';
    END IF;

    UPDATE class_payments SET status = 'completed', provider_status = p_provider_status, receipt_no = p_receipt_no,
      review_reason = v_review, completed_at = now(), updated_at = now() WHERE id = v_pay.id;
    INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
    VALUES (NULL, 'online_deposit', 'booking', v_b.id, jsonb_build_object('result', v_result, 'review', v_review, 'receipt', p_receipt_no));
    v_out := jsonb_build_object('status', 'completed', 'booking_status', (SELECT status FROM class_bookings WHERE id = v_b.id),
                                'result', v_result, 'review_reason', v_review, 'booking_id', v_b.id);
  END IF;

  INSERT INTO class_payment_events (payment_id, provider_payment_id, source, kind, payload, result)
  VALUES (v_pay.id, p_provider_payment_id, p_source, 'status', p_raw, v_out);
  RETURN v_out;
END;
$function$;

-- Links abiertos que vale la pena consultar (de una reserva, o todos).
CREATE OR REPLACE FUNCTION public.class_payments_to_check(p_booking_id UUID DEFAULT NULL)
RETURNS TABLE(provider_payment_id TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT p.provider_payment_id FROM class_payments p
  WHERE p.status IN ('created','pending') AND p.provider_payment_id IS NOT NULL
    AND p.created_at > now() - INTERVAL '15 days'
    AND (p_booking_id IS NULL OR p.booking_id = p_booking_id)
  ORDER BY p.created_at DESC LIMIT 150;
$function$;

-- 10) Permisos
REVOKE ALL ON FUNCTION public.class_booking_due(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_booking_deposit_on_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_payment_events_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_class(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_class(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_class_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_class_credit() TO authenticated;
REVOKE ALL ON FUNCTION public.class_begin_deposit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_begin_deposit(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.class_attach_payment(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_fail_payment(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_record_payment_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_apply_payment_status(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_payments_to_check(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_attach_payment(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_fail_payment(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_record_payment_event(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_apply_payment_status(TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_payments_to_check(UUID) TO service_role;

-- Revisión: debe salir deposit 10000 / 30 min / pago en gym apagado.
SELECT 'anticipo de clases' AS que, deposit_cents AS anticipo_centavos, deposit_hold_minutes AS minutos, allow_pay_at_gym AS pago_en_gym
FROM class_settings WHERE id = 1;
