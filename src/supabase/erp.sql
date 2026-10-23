-- ============================================================
-- ERP / CRM de Jaibamuro (2026-10-23). Requiere clases.sql.
-- Plan: docs/plan-erp-clases.md (secciones 3 y 4b).
--
-- Piezas:
--   erp_settings          ajustes generales (una fila)
--   integration_settings  proveedor de cobro recurrente + llaves PÚBLICAS
--                         (las llaves secretas viven en Supabase Secrets)
--   people (+columnas)    ficha de persona: emergencia, tutor, preferencias
--   person_notes          notas / seguimiento (CRM)
--   products              catálogo: planes, pases, clases, productos
--   cash_sessions         caja del día (una abierta a la vez)
--   cash_movements        retiros, gastos y depósitos de efectivo
--   sales / sale_items / sale_payments   ventas (pagos combinables)
--   subscriptions         domiciliaciones (cobro automático mensual)
--   billing_charges       un registro por ciclo cobrado (idempotente)
--   billing_events        bitácora cruda (solo inserción)
--
-- Motor de domiciliación PROPIO (no suscripciones del proveedor): así la
-- promoción "3 meses a $600, luego $800" funciona igual con Openpay y con
-- Stripe. Reglas clave:
--   * Un registro de cobro por (domiciliación, ciclo). Cada intento se
--     aparta con estado 'processing' y una llave de idempotencia única;
--     dos corridas simultáneas nunca cobran dos veces el mismo ciclo.
--   * Un intento que quedó 'processing' (se cayó la función) se reconcilia
--     consultando al proveedor con la MISMA llave antes de reintentar.
--   * Solo un cobro exitoso crea la venta y extiende la membresía.
--   * La promoción se congela al crear la domiciliación: si luego se apaga
--     la promo del producto, quien ya la tenía la conserva.
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- ------------------------------------------------------------
-- Ajustes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_settings (
  id                  INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name       TEXT NOT NULL DEFAULT 'Jaibamuro',
  require_open_cash   BOOLEAN NOT NULL DEFAULT true,     -- no se vende sin caja abierta
  retry_days          INT[] NOT NULL DEFAULT '{1,3,5}',  -- días después del intento fallido para reintentar
  setup_link_days     INT NOT NULL DEFAULT 7 CHECK (setup_link_days BETWEEN 1 AND 60),
  expiring_notice_days INT NOT NULL DEFAULT 7 CHECK (expiring_notice_days BETWEEN 1 AND 60),
  receipt_footer      TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.erp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.integration_settings (
  id                     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  recurring_provider     TEXT CHECK (recurring_provider IN ('openpay','stripe')),
  openpay_merchant_id    TEXT,
  openpay_public_key     TEXT,
  openpay_sandbox        BOOLEAN NOT NULL DEFAULT true,
  stripe_publishable_key TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.integration_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Fecha de negocio (hora de México). En pruebas se puede fijar con
-- set_config('test.today', 'YYYY-MM-DD').
CREATE OR REPLACE FUNCTION public.erp_today()
RETURNS DATE LANGUAGE sql STABLE AS $function$
  SELECT coalesce(nullif(current_setting('test.today', true), '')::date,
                  (now() AT TIME ZONE 'America/Mexico_City')::date);
$function$;

-- ------------------------------------------------------------
-- Personas: más datos + notas
-- ------------------------------------------------------------
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS emergency_name TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS allow_marketing BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.person_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','call','whatsapp','email','visit')),
  body       TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_notes_person_idx ON public.person_notes (person_id, created_at DESC);

-- ------------------------------------------------------------
-- Catálogo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL CHECK (kind IN ('plan','pass','class','product','service')),
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  price_cents       INT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  -- Planes: cuánto dura la membresía que otorgan
  grants_membership BOOLEAN NOT NULL DEFAULT false,
  duration_unit     TEXT CHECK (duration_unit IN ('day','month')),
  duration_value    INT CHECK (duration_value IS NULL OR duration_value BETWEEN 1 AND 60),
  -- Domiciliación: cobro automático cada mes
  is_recurring      BOOLEAN NOT NULL DEFAULT false,
  promo_active      BOOLEAN NOT NULL DEFAULT false,
  promo_cycles      INT CHECK (promo_cycles IS NULL OR promo_cycles BETWEEN 1 AND 24),
  promo_price_cents INT CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  -- Venta de clase suelta ligada a un tipo de clase (ej. Introductoria)
  class_type_id     UUID REFERENCES public.class_types(id),
  -- Inventario opcional
  track_stock       BOOLEAN NOT NULL DEFAULT false,
  stock             INT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT grants_membership OR (duration_unit IS NOT NULL AND duration_value IS NOT NULL)),
  CHECK (NOT is_recurring OR (grants_membership AND duration_unit = 'month' AND duration_value = 1))
);

-- Planes reales de EVO (2026-10-23), dictados/confirmados por el dueño.
-- Parejas se dejó de vender: no se crea. Todo editable desde el panel.
INSERT INTO public.products (kind, name, price_cents, grants_membership, duration_unit, duration_value, is_recurring, promo_active, promo_cycles, promo_price_cents, sort_order)
VALUES
  ('plan', 'Membresía Domiciliación', 80000, true, 'month', 1, true,  true,  3, 60000, 1),
  ('plan', 'Membresía Mensual',      100000, true, 'month', 1, false, false, NULL, NULL, 2),
  ('plan', 'Membresía Trimestral',   280000, true, 'month', 3, false, false, NULL, NULL, 3),
  ('pass', 'Pase Diario',             12000, false, NULL, NULL, false, false, NULL, NULL, 4)
ON CONFLICT (name) DO NOTHING;
INSERT INTO public.products (kind, name, price_cents, class_type_id, sort_order)
SELECT 'class', 'Clase Introductoria', t.price_cents, t.id, 5 FROM public.class_types t WHERE t.name = 'Introductoria'
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id);
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS sale_id UUID;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS subscription_id UUID;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS is_void BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- Caja y ventas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date       DATE NOT NULL,
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by           UUID,
  opening_cash_cents  INT NOT NULL CHECK (opening_cash_cents >= 0),
  closed_at           TIMESTAMPTZ,
  closed_by           UUID,
  expected_cash_cents INT,
  counted_cash_cents  INT,
  difference_cents    INT,
  note                TEXT
);
-- Una sola caja abierta a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open ON public.cash_sessions ((true)) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES public.cash_sessions(id),
  kind         TEXT NOT NULL CHECK (kind IN ('withdrawal','expense','deposit')),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  note         TEXT NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio          BIGINT GENERATED ALWAYS AS IDENTITY,
  person_id      UUID REFERENCES public.people(id),
  session_id     UUID REFERENCES public.cash_sessions(id),
  source         TEXT NOT NULL CHECK (source IN ('pos','class','subscription','online')),
  status         TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  subtotal_cents INT NOT NULL,
  discount_cents INT NOT NULL DEFAULT 0,
  total_cents    INT NOT NULL,
  note           TEXT,
  booking_id     UUID,
  subscription_id UUID,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at      TIMESTAMPTZ,
  voided_by      UUID,
  void_reason    TEXT
);
CREATE INDEX IF NOT EXISTS sales_created_idx ON public.sales (created_at DESC);
CREATE INDEX IF NOT EXISTS sales_person_idx ON public.sales (person_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sales_one_per_booking ON public.sales (booking_id) WHERE booking_id IS NOT NULL AND status = 'completed';

CREATE TABLE IF NOT EXISTS public.sale_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES public.products(id),
  description      TEXT NOT NULL,
  quantity         INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents   INT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents      INT NOT NULL CHECK (total_cents >= 0),
  membership_id    UUID
);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('cash','card','transfer','clip','openpay','stripe','other')),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Domiciliación
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            UUID NOT NULL REFERENCES public.people(id),
  product_id           UUID NOT NULL REFERENCES public.products(id),
  provider             TEXT NOT NULL CHECK (provider IN ('openpay','stripe')),
  status               TEXT NOT NULL DEFAULT 'pending_card'
                       CHECK (status IN ('pending_card','active','past_due','cancelled')),
  price_cents          INT NOT NULL CHECK (price_cents > 0),
  promo_cycles         INT NOT NULL DEFAULT 0,
  promo_price_cents    INT,
  start_on             DATE NOT NULL,
  cycles_paid          INT NOT NULL DEFAULT 0,
  next_charge_on       DATE NOT NULL,
  provider_customer_id TEXT,
  provider_card_id     TEXT,
  card_brand           TEXT,
  card_last4           TEXT,
  card_exp             TEXT,
  setup_token          TEXT UNIQUE,
  setup_expires_at     TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  cancelled_at         TIMESTAMPTZ,
  cancel_reason        TEXT,
  last_error           TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Openpay exige el device_session_id (antifraude) también al cobrar: se guarda
-- el del registro de la tarjeta y se reusa en los cobros mensuales.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_device_session TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live
  ON public.subscriptions (person_id, product_id) WHERE status IN ('pending_card','active','past_due');

CREATE TABLE IF NOT EXISTS public.billing_charges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id    UUID NOT NULL REFERENCES public.subscriptions(id),
  cycle              INT NOT NULL CHECK (cycle >= 1),
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  amount_cents       INT NOT NULL CHECK (amount_cents > 0),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','paid','failed','needs_action','abandoned')),
  attempt            INT NOT NULL DEFAULT 0,
  max_attempts       INT NOT NULL,
  idempotency_key    TEXT,
  processing_since   TIMESTAMPTZ,
  next_attempt_at    TIMESTAMPTZ,
  provider_charge_id TEXT,
  error_code         TEXT,
  error_message      TEXT,
  paid_at            TIMESTAMPTZ,
  sale_id            UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, cycle)
);

CREATE TABLE IF NOT EXISTS public.billing_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider   TEXT,
  kind       TEXT NOT NULL,
  charge_id  UUID,
  subscription_id UUID,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.billing_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'billing_events es de solo inserción';
END;
$function$;
DROP TRIGGER IF EXISTS billing_events_no_change ON public.billing_events;
CREATE TRIGGER billing_events_no_change BEFORE UPDATE OR DELETE ON public.billing_events
  FOR EACH ROW EXECUTE FUNCTION public.billing_events_immutable();

ALTER TABLE public.erp_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_charges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_settings, public.integration_settings, public.person_notes, public.products,
              public.cash_sessions, public.cash_movements, public.sales, public.sale_items, public.sale_payments,
              public.subscriptions, public.billing_charges, public.billing_events
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.erp_audit(p_action TEXT, p_entity TEXT, p_entity_id UUID, p_before JSONB, p_after JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$function$;

CREATE OR REPLACE FUNCTION public.erp_open_session_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT id FROM cash_sessions WHERE closed_at IS NULL LIMIT 1;
$function$;

-- Último día de vigencia para una duración que empieza en p_start.
CREATE OR REPLACE FUNCTION public.erp_period_end(p_start DATE, p_unit TEXT, p_value INT)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_unit
    WHEN 'day' THEN p_start + (p_value - 1)
    ELSE (p_start + make_interval(months => p_value))::date - 1
  END;
$function$;

-- Crea la membresía que otorga un plan. Si la persona ya tiene una vigente,
-- la nueva empieza al día siguiente de que termine (renovación anticipada).
CREATE OR REPLACE FUNCTION public.erp_grant_membership(p_person_id UUID, p_product_id UUID, p_starts_on DATE,
                                                       p_sale_id UUID, p_subscription_id UUID, p_until DATE DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p     products%ROWTYPE;
  v_start DATE := p_starts_on;
  v_last  DATE;
  v_id    UUID;
BEGIN
  SELECT * INTO v_p FROM products WHERE id = p_product_id;
  IF v_start IS NULL THEN
    SELECT max(valid_until) INTO v_last FROM memberships
    WHERE person_id = p_person_id AND NOT is_void AND valid_until >= erp_today();
    v_start := coalesce(v_last + 1, erp_today());
  END IF;
  INSERT INTO memberships (person_id, plan_name, valid_from, valid_until, product_id, sale_id, subscription_id, created_by)
  VALUES (p_person_id, v_p.name, v_start,
          coalesce(p_until, erp_period_end(v_start, v_p.duration_unit, v_p.duration_value)),
          p_product_id, p_sale_id, p_subscription_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Memberships anuladas no cuentan (redefine el helper de clases.sql).
CREATE OR REPLACE FUNCTION public.class_is_member(p_person_id UUID, p_on DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM memberships m
                 WHERE m.person_id = p_person_id AND NOT m.is_void
                   AND m.valid_from <= p_on AND m.valid_until >= p_on);
$function$;

CREATE OR REPLACE FUNCTION public.erp_membership_until(p_person_id UUID)
RETURNS DATE LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  -- Fin de la cadena de membresías que cubre hoy (incluye renovaciones ya pagadas).
  WITH RECURSIVE chain AS (
    SELECT m.valid_until FROM memberships m
    WHERE m.person_id = p_person_id AND NOT m.is_void AND m.valid_from <= erp_today() AND m.valid_until >= erp_today()
    UNION
    SELECT m.valid_until FROM memberships m JOIN chain c ON m.valid_from <= c.valid_until + 1 AND m.valid_until > c.valid_until
    WHERE m.person_id = p_person_id AND NOT m.is_void
  )
  SELECT max(valid_until) FROM chain;
$function$;

-- Registra una venta ya validada. p_items: [{product_id?, description, quantity,
-- unit_price_cents, discount_cents, starts_on?}], p_payments: [{method, amount_cents, reference?}].
CREATE OR REPLACE FUNCTION public.erp_insert_sale(p_person_id UUID, p_source TEXT, p_items JSONB, p_payments JSONB,
                                                  p_discount_cents INT, p_note TEXT, p_booking_id UUID, p_subscription_id UUID,
                                                  p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sale_id  UUID;
  v_item     JSONB;
  v_pay      JSONB;
  v_subtotal INT := 0;
  v_total    INT;
  v_paid     INT := 0;
  v_line     INT;
  v_prod     products%ROWTYPE;
  v_mid      UUID;
  v_item_id  UUID;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line := (v_item->>'unit_price_cents')::int * coalesce((v_item->>'quantity')::int, 1) - coalesce((v_item->>'discount_cents')::int, 0);
    IF v_line < 0 THEN RAISE EXCEPTION 'erp: descuento mayor que el precio'; END IF;
    v_subtotal := v_subtotal + v_line;
  END LOOP;
  v_total := v_subtotal - coalesce(p_discount_cents, 0);
  IF v_total < 0 THEN RAISE EXCEPTION 'erp: descuento mayor que el total'; END IF;
  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    v_paid := v_paid + (v_pay->>'amount_cents')::int;
  END LOOP;
  IF v_paid <> v_total THEN RAISE EXCEPTION 'erp: pagos (%) no cuadran con el total (%)', v_paid, v_total; END IF;

  INSERT INTO sales (person_id, session_id, source, subtotal_cents, discount_cents, total_cents, note, booking_id, subscription_id, created_by)
  VALUES (p_person_id, p_session_id, p_source, v_subtotal, coalesce(p_discount_cents, 0), v_total,
          nullif(btrim(coalesce(p_note, '')), ''), p_booking_id, p_subscription_id, auth.uid())
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line := (v_item->>'unit_price_cents')::int * coalesce((v_item->>'quantity')::int, 1) - coalesce((v_item->>'discount_cents')::int, 0);
    INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price_cents, discount_cents, total_cents)
    VALUES (v_sale_id, nullif(v_item->>'product_id', '')::uuid, v_item->>'description', coalesce((v_item->>'quantity')::int, 1),
            (v_item->>'unit_price_cents')::int, coalesce((v_item->>'discount_cents')::int, 0), v_line)
    RETURNING id INTO v_item_id;

    IF nullif(v_item->>'product_id', '') IS NOT NULL THEN
      SELECT * INTO v_prod FROM products WHERE id = (v_item->>'product_id')::uuid;
      IF v_prod.grants_membership AND p_person_id IS NOT NULL AND p_subscription_id IS NULL THEN
        FOR i IN 1 .. coalesce((v_item->>'quantity')::int, 1) LOOP
          v_mid := erp_grant_membership(p_person_id, v_prod.id, CASE WHEN i = 1 THEN nullif(v_item->>'starts_on', '')::date END, v_sale_id, NULL);
        END LOOP;
        UPDATE sale_items SET membership_id = v_mid WHERE id = v_item_id;
      END IF;
      IF v_prod.track_stock THEN
        UPDATE products SET stock = coalesce(stock, 0) - coalesce((v_item->>'quantity')::int, 1), updated_at = now() WHERE id = v_prod.id;
      END IF;
    END IF;
  END LOOP;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    IF (v_pay->>'amount_cents')::int > 0 THEN
      INSERT INTO sale_payments (sale_id, method, amount_cents, reference)
      VALUES (v_sale_id, v_pay->>'method', (v_pay->>'amount_cents')::int, nullif(btrim(coalesce(v_pay->>'reference', '')), ''));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'folio', (SELECT folio FROM sales WHERE id = v_sale_id), 'total_cents', v_total);
END;
$function$;

-- ------------------------------------------------------------
-- Ajustes (admin)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_erp_settings()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'is_admin', class_is_admin(),
    'erp', (SELECT to_jsonb(e) FROM erp_settings e WHERE id = 1),
    'integrations', (SELECT to_jsonb(i) FROM integration_settings i WHERE id = 1)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_erp_settings(p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_before erp_settings%ROWTYPE;
  v_days   INT[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_before FROM erp_settings WHERE id = 1 FOR UPDATE;
  BEGIN
    IF p_patch ? 'retry_days' THEN
      SELECT array_agg(x::int ORDER BY ord) INTO v_days FROM jsonb_array_elements_text(p_patch->'retry_days') WITH ORDINALITY AS t(x, ord);
      IF v_days IS NULL OR array_length(v_days, 1) > 6 OR EXISTS (SELECT 1 FROM unnest(v_days) d WHERE d < 1 OR d > 15) THEN
        RETURN jsonb_build_object('error', 'invalid_value');
      END IF;
    END IF;
    UPDATE erp_settings SET
      business_name = coalesce(nullif(btrim(p_patch->>'business_name'), ''), business_name),
      require_open_cash = coalesce((p_patch->>'require_open_cash')::boolean, require_open_cash),
      retry_days = coalesce(v_days, retry_days),
      setup_link_days = coalesce((p_patch->>'setup_link_days')::int, setup_link_days),
      expiring_notice_days = coalesce((p_patch->>'expiring_notice_days')::int, expiring_notice_days),
      receipt_footer = CASE WHEN p_patch ? 'receipt_footer' THEN nullif(btrim(coalesce(p_patch->>'receipt_footer', '')), '') ELSE receipt_footer END,
      updated_at = now()
    WHERE id = 1;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  PERFORM erp_audit('erp_settings', 'settings', NULL, to_jsonb(v_before), p_patch);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_integrations(p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_before integration_settings%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_patch ? 'recurring_provider' AND coalesce(p_patch->>'recurring_provider', '') NOT IN ('', 'openpay', 'stripe') THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF coalesce(p_patch->>'stripe_publishable_key', '') <> '' AND p_patch->>'stripe_publishable_key' !~ '^pk_(test|live)_' THEN
    RETURN jsonb_build_object('error', 'invalid_stripe_key');
  END IF;
  IF coalesce(p_patch->>'openpay_public_key', '') <> '' AND p_patch->>'openpay_public_key' !~ '^pk_' THEN
    RETURN jsonb_build_object('error', 'invalid_openpay_key');
  END IF;
  SELECT * INTO v_before FROM integration_settings WHERE id = 1 FOR UPDATE;
  UPDATE integration_settings SET
    recurring_provider = CASE WHEN p_patch ? 'recurring_provider' THEN nullif(p_patch->>'recurring_provider', '') ELSE recurring_provider END,
    openpay_merchant_id = CASE WHEN p_patch ? 'openpay_merchant_id' THEN nullif(btrim(p_patch->>'openpay_merchant_id'), '') ELSE openpay_merchant_id END,
    openpay_public_key = CASE WHEN p_patch ? 'openpay_public_key' THEN nullif(btrim(p_patch->>'openpay_public_key'), '') ELSE openpay_public_key END,
    openpay_sandbox = coalesce((p_patch->>'openpay_sandbox')::boolean, openpay_sandbox),
    stripe_publishable_key = CASE WHEN p_patch ? 'stripe_publishable_key' THEN nullif(btrim(p_patch->>'stripe_publishable_key'), '') ELSE stripe_publishable_key END,
    updated_at = now()
  WHERE id = 1;
  PERFORM erp_audit('integrations_update', 'settings', NULL, to_jsonb(v_before), p_patch);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Catálogo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_products(p_include_inactive BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('products', coalesce((
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.name) FROM products p WHERE p_include_inactive OR p.is_active
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_product(p_product JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id     UUID := nullif(p_product->>'id', '')::uuid;
  v_name   TEXT := btrim(coalesce(p_product->>'name', ''));
  v_kind   TEXT := p_product->>'kind';
  v_grants BOOLEAN := coalesce((p_product->>'grants_membership')::boolean, false);
  v_rec    BOOLEAN := coalesce((p_product->>'is_recurring')::boolean, false);
  v_before products%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_kind NOT IN ('plan','pass','class','product','service') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF EXISTS (SELECT 1 FROM products p WHERE lower(p.name) = lower(v_name) AND p.id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'name_taken');
  END IF;
  IF v_rec AND (p_product->>'duration_unit' IS DISTINCT FROM 'month' OR (p_product->>'duration_value')::int IS DISTINCT FROM 1) THEN
    RETURN jsonb_build_object('error', 'recurring_must_be_monthly');
  END IF;
  IF coalesce((p_product->>'promo_active')::boolean, false)
     AND (nullif(p_product->>'promo_cycles', '') IS NULL OR nullif(p_product->>'promo_price_cents', '') IS NULL) THEN
    RETURN jsonb_build_object('error', 'promo_incomplete');
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO products (kind, name, description, price_cents, grants_membership, duration_unit, duration_value,
                            is_recurring, promo_active, promo_cycles, promo_price_cents, class_type_id, track_stock, stock, is_active, sort_order)
      VALUES (v_kind, v_name, nullif(btrim(coalesce(p_product->>'description', '')), ''), (p_product->>'price_cents')::int,
              v_grants OR v_rec, CASE WHEN v_grants OR v_rec THEN p_product->>'duration_unit' END,
              CASE WHEN v_grants OR v_rec THEN (p_product->>'duration_value')::int END,
              v_rec, coalesce((p_product->>'promo_active')::boolean, false), nullif(p_product->>'promo_cycles', '')::int,
              nullif(p_product->>'promo_price_cents', '')::int, nullif(p_product->>'class_type_id', '')::uuid,
              coalesce((p_product->>'track_stock')::boolean, false), nullif(p_product->>'stock', '')::int,
              coalesce((p_product->>'is_active')::boolean, true), coalesce((p_product->>'sort_order')::int, 0))
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_before FROM products WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
      -- No se puede cambiar si cobra recurrente un producto que ya tiene domiciliaciones.
      IF v_before.is_recurring <> v_rec AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.product_id = v_id) THEN
        RETURN jsonb_build_object('error', 'has_subscriptions');
      END IF;
      UPDATE products SET kind = v_kind, name = v_name,
        description = nullif(btrim(coalesce(p_product->>'description', '')), ''),
        price_cents = (p_product->>'price_cents')::int,
        grants_membership = v_grants OR v_rec,
        duration_unit = CASE WHEN v_grants OR v_rec THEN p_product->>'duration_unit' END,
        duration_value = CASE WHEN v_grants OR v_rec THEN (p_product->>'duration_value')::int END,
        is_recurring = v_rec,
        promo_active = coalesce((p_product->>'promo_active')::boolean, false),
        promo_cycles = nullif(p_product->>'promo_cycles', '')::int,
        promo_price_cents = nullif(p_product->>'promo_price_cents', '')::int,
        class_type_id = nullif(p_product->>'class_type_id', '')::uuid,
        track_stock = coalesce((p_product->>'track_stock')::boolean, false),
        stock = nullif(p_product->>'stock', '')::int,
        is_active = coalesce((p_product->>'is_active')::boolean, true),
        sort_order = coalesce((p_product->>'sort_order')::int, 0),
        updated_at = now()
      WHERE id = v_id;
    END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  PERFORM erp_audit('product_save', 'product', v_id, to_jsonb(v_before), p_product);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- ------------------------------------------------------------
-- Personas (ficha) — redefine admin_save_person de clases.sql con más campos
-- ------------------------------------------------------------
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
  v_before people%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_phone IS NOT NULL AND length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('error', 'invalid_email'); END IF;
  IF v_birth IS NOT NULL AND (v_birth < DATE '1920-01-01' OR v_birth > erp_today()) THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE lower(p.email) = v_email AND p.id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'email_taken');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO people (full_name, phone, email, birth_date, source, note, gender, emergency_name, emergency_phone,
                        guardian_name, guardian_phone, allow_marketing, created_by)
    VALUES (v_name, v_phone, v_email, v_birth, coalesce(nullif(p_person->>'source', ''), 'staff'),
            nullif(btrim(coalesce(p_person->>'note', '')), ''), nullif(p_person->>'gender', ''),
            nullif(btrim(coalesce(p_person->>'emergency_name', '')), ''), v_eph,
            nullif(btrim(coalesce(p_person->>'guardian_name', '')), ''), v_gph,
            coalesce((p_person->>'allow_marketing')::boolean, true), auth.uid())
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
      is_archived = coalesce((p_person->>'is_archived')::boolean, is_archived),
      updated_at = now()
    WHERE id = v_id;
    PERFORM erp_audit('person_update', 'person', v_id, to_jsonb(v_before), p_person);
  END IF;
  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$function$;

-- Búsqueda (redefine la de clases.sql): incluye estado de membresía y domiciliación.
CREATE OR REPLACE FUNCTION public.admin_search_people(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_q TEXT := lower(btrim(coalesce(p_query, '')));
  v_digits TEXT := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('people', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'full_name') FROM (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'birth_date', p.birth_date,
        'has_login', p.auth_user_id IS NOT NULL, 'source', p.source, 'note', p.note,
        'membership_until', erp_membership_until(p.id),
        'membership_last_until', (SELECT max(m.valid_until) FROM memberships m WHERE m.person_id = p.id AND NOT m.is_void),
        'subscription_status', (SELECT s.status FROM subscriptions s WHERE s.person_id = p.id AND s.status <> 'cancelled' ORDER BY s.created_at DESC LIMIT 1)
      ) AS x
      FROM people p
      WHERE NOT p.is_archived AND (v_q = '' OR lower(p.full_name) LIKE '%' || v_q || '%' OR lower(coalesce(p.email, '')) LIKE '%' || v_q || '%'
         OR (length(v_digits) >= 3 AND coalesce(p.phone, '') LIKE '%' || v_digits || '%'))
      ORDER BY p.updated_at DESC
      LIMIT 50
    ) s
  ), '[]'::jsonb));
END;
$function$;

-- Ficha completa.
CREATE OR REPLACE FUNCTION public.get_person_profile(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p people%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_p FROM people WHERE id = p_person_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object(
    'person', to_jsonb(v_p) || jsonb_build_object('has_login', v_p.auth_user_id IS NOT NULL,
               'is_minor', v_p.birth_date IS NOT NULL AND v_p.birth_date > (erp_today() - INTERVAL '18 years')::date),
    'membership_until', erp_membership_until(p_person_id),
    'memberships', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.valid_from DESC) FROM memberships m WHERE m.person_id = p_person_id), '[]'::jsonb),
    'subscriptions', coalesce((
      SELECT jsonb_agg(to_jsonb(s) - 'setup_token' || jsonb_build_object(
        'product_name', pr.name,
        'has_setup_link', s.setup_token IS NOT NULL AND s.setup_expires_at > now(),
        'charges', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.cycle DESC) FROM billing_charges c WHERE c.subscription_id = s.id), '[]'::jsonb)
      ) ORDER BY s.created_at DESC)
      FROM subscriptions s JOIN products pr ON pr.id = s.product_id WHERE s.person_id = p_person_id), '[]'::jsonb),
    'sales', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'created_at', s.created_at, 'status', s.status,
               'total_cents', s.total_cents, 'source', s.source,
               'items', (SELECT string_agg(i.description || CASE WHEN i.quantity > 1 THEN ' ×' || i.quantity ELSE '' END, ', ') FROM sale_items i WHERE i.sale_id = s.id),
               'methods', (SELECT string_agg(DISTINCT sp.method, ', ') FROM sale_payments sp WHERE sp.sale_id = s.id))
             ORDER BY s.created_at DESC)
      FROM (SELECT * FROM sales WHERE person_id = p_person_id ORDER BY created_at DESC LIMIT 100) s), '[]'::jsonb),
    'bookings', coalesce((
      SELECT jsonb_agg(class_booking_json(b.id) ORDER BY se.starts_at DESC)
      FROM (SELECT b.* FROM class_bookings b JOIN class_sessions se ON se.id = b.session_id
            WHERE b.person_id = p_person_id ORDER BY se.starts_at DESC LIMIT 100) b
      JOIN class_sessions se ON se.id = b.session_id), '[]'::jsonb),
    'free_left_this_month', greatest((SELECT free_classes_per_month FROM class_settings WHERE id = 1) - class_free_used(p_person_id, erp_today()), 0),
    'notes', coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM person_notes n WHERE n.person_id = p_person_id), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_person_note(p_person_id UUID, p_kind TEXT, p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_body, ''))) < 2 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF coalesce(p_kind, 'note') NOT IN ('note','call','whatsapp','email','visit') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  INSERT INTO person_notes (person_id, kind, body, created_by) VALUES (p_person_id, coalesce(p_kind, 'note'), btrim(p_body), auth.uid());
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Anular una membresía (por error de captura). Admin.
CREATE OR REPLACE FUNCTION public.admin_void_membership(p_membership_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_m memberships%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_m FROM memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE memberships SET is_void = true, note = coalesce(note || ' · ', '') || 'Anulada: ' || btrim(p_reason), updated_at = now() WHERE id = p_membership_id;
  PERFORM erp_audit('membership_void', 'membership', p_membership_id, to_jsonb(v_m), jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Caja
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_cash_summary(p_session_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH pay AS (
    SELECT sp.method, sum(sp.amount_cents)::int AS cents
    FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE s.session_id = p_session_id AND s.status = 'completed'
    GROUP BY sp.method
  ), mov AS (
    SELECT kind, sum(amount_cents)::int AS cents FROM cash_movements WHERE session_id = p_session_id GROUP BY kind
  )
  SELECT jsonb_build_object(
    'by_method', coalesce((SELECT jsonb_object_agg(method, cents) FROM pay), '{}'::jsonb),
    'sales_total', coalesce((SELECT sum(cents) FROM pay), 0),
    'sales_count', (SELECT count(*) FROM sales WHERE session_id = p_session_id AND status = 'completed'),
    'withdrawals', coalesce((SELECT cents FROM mov WHERE kind = 'withdrawal'), 0),
    'expenses', coalesce((SELECT cents FROM mov WHERE kind = 'expense'), 0),
    'deposits', coalesce((SELECT cents FROM mov WHERE kind = 'deposit'), 0),
    'expected_cash', (SELECT opening_cash_cents FROM cash_sessions WHERE id = p_session_id)
                     + coalesce((SELECT cents FROM pay WHERE method = 'cash'), 0)
                     + coalesce((SELECT cents FROM mov WHERE kind = 'deposit'), 0)
                     - coalesce((SELECT cents FROM mov WHERE kind = 'withdrawal'), 0)
                     - coalesce((SELECT cents FROM mov WHERE kind = 'expense'), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s cash_sessions%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_s FROM cash_sessions WHERE closed_at IS NULL;
  RETURN jsonb_build_object(
    'require_open_cash', (SELECT require_open_cash FROM erp_settings WHERE id = 1),
    'today', erp_today(),
    'open', CASE WHEN v_s.id IS NULL THEN NULL ELSE to_jsonb(v_s) || jsonb_build_object(
      'summary', erp_cash_summary(v_s.id),
      'opened_by_name', (SELECT name FROM profiles WHERE id = v_s.opened_by),
      'movements', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC) FROM cash_movements m WHERE m.session_id = v_s.id), '[]'::jsonb),
      'sales', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'created_at', s.created_at, 'status', s.status,
                 'total_cents', s.total_cents, 'person_name', p.full_name, 'source', s.source,
                 'items', (SELECT string_agg(i.description, ', ') FROM sale_items i WHERE i.sale_id = s.id),
                 'methods', (SELECT string_agg(DISTINCT sp.method, ', ') FROM sale_payments sp WHERE sp.sale_id = s.id))
               ORDER BY s.created_at DESC)
               FROM sales s LEFT JOIN people p ON p.id = s.person_id WHERE s.session_id = v_s.id), '[]'::jsonb)
    ) END,
    'history', coalesce((SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('summary', erp_cash_summary(h.id)) ORDER BY h.opened_at DESC)
                         FROM (SELECT * FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY opened_at DESC LIMIT 30) h), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_cash(p_opening_cents INT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_opening_cents IS NULL OR p_opening_cents < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF erp_open_session_id() IS NOT NULL THEN RETURN jsonb_build_object('error', 'cash_already_open'); END IF;
  INSERT INTO cash_sessions (business_date, opened_by, opening_cash_cents, note)
  VALUES (erp_today(), auth.uid(), p_opening_cents, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_id;
  PERFORM erp_audit('cash_open', 'cash', v_id, NULL, jsonb_build_object('opening_cents', p_opening_cents));
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'cash_already_open');
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_cash_movement(p_kind TEXT, p_amount_cents INT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sid UUID := erp_open_session_id();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  IF p_kind NOT IN ('withdrawal','expense','deposit') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  INSERT INTO cash_movements (session_id, kind, amount_cents, note, created_by) VALUES (v_sid, p_kind, p_amount_cents, btrim(p_note), auth.uid());
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Cierre: el staff cuenta el efectivo; se guarda lo esperado y la diferencia.
CREATE OR REPLACE FUNCTION public.close_cash(p_counted_cents INT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sid UUID := erp_open_session_id();
  v_expected INT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  IF p_counted_cents IS NULL OR p_counted_cents < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  PERFORM 1 FROM cash_sessions WHERE id = v_sid FOR UPDATE;
  v_expected := (erp_cash_summary(v_sid)->>'expected_cash')::int;
  IF p_counted_cents <> v_expected AND length(btrim(coalesce(p_note, ''))) < 3 THEN
    RETURN jsonb_build_object('error', 'difference_needs_note', 'expected_cash', v_expected);
  END IF;
  UPDATE cash_sessions SET closed_at = now(), closed_by = auth.uid(), expected_cash_cents = v_expected,
    counted_cash_cents = p_counted_cents, difference_cents = p_counted_cents - v_expected,
    note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
  WHERE id = v_sid;
  PERFORM erp_audit('cash_close', 'cash', v_sid, NULL, jsonb_build_object('expected', v_expected, 'counted', p_counted_cents));
  RETURN jsonb_build_object('success', true, 'expected_cash', v_expected, 'difference', p_counted_cents - v_expected);
END;
$function$;

-- ------------------------------------------------------------
-- Ventas (mostrador)
-- ------------------------------------------------------------
-- p_sale: {person_id?, items:[{product_id, quantity?, discount_cents?, starts_on?, unit_price_cents? (solo si el producto vale $0 o admin)}],
--          discount_cents?, payments:[{method, amount_cents, reference?}], note?}
CREATE OR REPLACE FUNCTION public.create_sale(p_sale JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_set     erp_settings%ROWTYPE;
  v_sid     UUID := erp_open_session_id();
  v_person  UUID := nullif(p_sale->>'person_id', '')::uuid;
  v_items   JSONB := '[]'::jsonb;
  v_it      JSONB;
  v_p       products%ROWTYPE;
  v_price   INT;
  v_qty     INT;
  v_pay     JSONB;
  v_result  JSONB;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_set FROM erp_settings WHERE id = 1;
  IF v_set.require_open_cash AND v_sid IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  IF jsonb_typeof(p_sale->'items') <> 'array' OR jsonb_array_length(p_sale->'items') = 0 THEN
    RETURN jsonb_build_object('error', 'empty_sale');
  END IF;
  IF v_person IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = v_person) THEN
    RETURN jsonb_build_object('error', 'person_not_found');
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_sale->'items') LOOP
    SELECT * INTO v_p FROM products WHERE id = nullif(v_it->>'product_id', '')::uuid;
    IF NOT FOUND OR NOT v_p.is_active THEN RETURN jsonb_build_object('error', 'invalid_product'); END IF;
    IF v_p.is_recurring THEN RETURN jsonb_build_object('error', 'use_subscription'); END IF;
    IF v_p.grants_membership AND v_person IS NULL THEN RETURN jsonb_build_object('error', 'person_required'); END IF;
    v_qty := coalesce((v_it->>'quantity')::int, 1);
    IF v_qty < 1 OR v_qty > 100 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
    v_price := v_p.price_cents;
    IF nullif(v_it->>'unit_price_cents', '') IS NOT NULL AND (v_it->>'unit_price_cents')::int <> v_p.price_cents THEN
      IF v_p.price_cents <> 0 AND NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'price_locked'); END IF;
      v_price := (v_it->>'unit_price_cents')::int;
    END IF;
    IF v_p.track_stock AND coalesce(v_p.stock, 0) < v_qty THEN RETURN jsonb_build_object('error', 'out_of_stock', 'product', v_p.name); END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_p.id, 'description', v_p.name, 'quantity', v_qty, 'unit_price_cents', v_price,
      'discount_cents', coalesce((v_it->>'discount_cents')::int, 0), 'starts_on', v_it->>'starts_on'));
  END LOOP;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_sale->'payments', '[]'::jsonb)) LOOP
    IF v_pay->>'method' NOT IN ('cash','card','transfer','clip','other') OR (v_pay->>'amount_cents')::int <= 0 THEN
      RETURN jsonb_build_object('error', 'invalid_payment');
    END IF;
  END LOOP;

  BEGIN
    v_result := erp_insert_sale(v_person, 'pos', v_items, coalesce(p_sale->'payments', '[]'::jsonb),
                                coalesce((p_sale->>'discount_cents')::int, 0), p_sale->>'note', NULL, NULL, v_sid);
  EXCEPTION WHEN raise_exception THEN
    RETURN jsonb_build_object('error', CASE WHEN SQLERRM LIKE '%no cuadran%' THEN 'payments_mismatch' ELSE 'invalid_discount' END);
  END;
  PERFORM erp_audit('sale', 'sale', (v_result->>'sale_id')::uuid, NULL, p_sale);
  RETURN jsonb_build_object('success', true) || v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_sale(p_sale_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s sales%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_s FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_s.status = 'voided' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF v_s.source = 'subscription' THEN RETURN jsonb_build_object('error', 'subscription_sale'); END IF;
  UPDATE sales SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) WHERE id = p_sale_id;
  UPDATE memberships SET is_void = true, updated_at = now() WHERE sale_id = p_sale_id;
  UPDATE products p SET stock = coalesce(p.stock, 0) + i.quantity FROM sale_items i
    WHERE i.sale_id = p_sale_id AND p.id = i.product_id AND p.track_stock;
  IF v_s.booking_id IS NOT NULL THEN
    UPDATE class_bookings SET payment_status = 'pending', paid_with = NULL, paid_at = NULL, updated_at = now()
    WHERE id = v_s.booking_id AND payment_status = 'paid';
  END IF;
  PERFORM erp_audit('sale_void', 'sale', p_sale_id, to_jsonb(v_s), jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('sales', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'created_at', s.created_at, 'status', s.status,
             'total_cents', s.total_cents, 'discount_cents', s.discount_cents, 'source', s.source, 'note', s.note,
             'void_reason', s.void_reason, 'person_id', s.person_id, 'person_name', p.full_name,
             'seller', (SELECT name FROM profiles WHERE id = s.created_by),
             'items', (SELECT jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'total_cents', i.total_cents)) FROM sale_items i WHERE i.sale_id = s.id),
             'payments', (SELECT jsonb_agg(jsonb_build_object('method', sp.method, 'amount_cents', sp.amount_cents, 'reference', sp.reference)) FROM sale_payments sp WHERE sp.sale_id = s.id))
           ORDER BY s.created_at DESC)
    FROM sales s LEFT JOIN people p ON p.id = s.person_id
    WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_from AND p_to
  ), '[]'::jsonb));
END;
$function$;

-- Reporte del mes (para la contadora): totales por forma de pago, por producto y por día.
CREATE OR REPLACE FUNCTION public.get_sales_report(p_month DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + INTERVAL '1 month - 1 day')::date;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total_cents', coalesce((SELECT sum(total_cents) FROM sales WHERE status = 'completed'
                    AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to), 0),
    'count', (SELECT count(*) FROM sales WHERE status = 'completed' AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to),
    'by_method', coalesce((SELECT jsonb_object_agg(method, cents) FROM (
        SELECT sp.method, sum(sp.amount_cents)::int AS cents FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY sp.method) x), '{}'::jsonb),
    'by_product', coalesce((SELECT jsonb_agg(jsonb_build_object('description', description, 'quantity', qty, 'total_cents', cents) ORDER BY cents DESC) FROM (
        SELECT i.description, sum(i.quantity)::int AS qty, sum(i.total_cents)::int AS cents FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY i.description) x), '[]'::jsonb),
    'by_day', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d, 'total_cents', cents, 'count', n) ORDER BY d) FROM (
        SELECT (created_at AT TIME ZONE 'America/Mexico_City')::date AS d, sum(total_cents)::int AS cents, count(*)::int AS n FROM sales
        WHERE status = 'completed' AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1) x), '[]'::jsonb),
    'cash_sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('business_date', business_date, 'opening', opening_cash_cents,
        'expected', expected_cash_cents, 'counted', counted_cash_cents, 'difference', difference_cents) ORDER BY opened_at)
        FROM cash_sessions WHERE business_date BETWEEN v_from AND v_to), '[]'::jsonb)
  );
END;
$function$;

-- ------------------------------------------------------------
-- Cobros de clases → ventas (redefine funciones de clases.sql para que el
-- dinero de las clases también entre a la caja y a los reportes)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_booking_sale(p_booking_id UUID, p_paid_with TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_b   class_bookings%ROWTYPE;
  v_name TEXT;
  v_sid UUID := erp_open_session_id();
BEGIN
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id;
  SELECT t.name || ' · ' || to_char(s.starts_at AT TIME ZONE 'America/Mexico_City', 'DD/MM HH24:MI') INTO v_name
  FROM class_sessions s JOIN class_types t ON t.id = s.class_type_id WHERE s.id = v_b.session_id;
  RETURN erp_insert_sale(v_b.person_id, 'class',
    jsonb_build_array(jsonb_build_object('description', 'Clase ' || v_name || CASE v_b.price_tier WHEN 'member' THEN ' (miembro)' ELSE '' END,
                                         'quantity', 1, 'unit_price_cents', v_b.amount_cents)),
    jsonb_build_array(jsonb_build_object('method', p_paid_with, 'amount_cents', v_b.amount_cents)),
    0, NULL, p_booking_id, NULL, v_sid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_booking_paid(p_booking_id UUID, p_paid_with TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_b class_bookings%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_paid_with NOT IN ('cash','card','transfer','other') THEN RETURN jsonb_build_object('error', 'invalid_method'); END IF;
  IF (SELECT require_open_cash FROM erp_settings WHERE id = 1) AND erp_open_session_id() IS NULL THEN
    RETURN jsonb_build_object('error', 'cash_closed');
  END IF;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_b.payment_status <> 'pending' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  UPDATE class_bookings SET payment_status = 'paid', paid_with = p_paid_with, paid_at = now(), updated_at = now()
  WHERE id = p_booking_id;
  PERFORM erp_booking_sale(p_booking_id, p_paid_with);
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'mark_paid', 'booking', p_booking_id, to_jsonb(v_b), jsonb_build_object('paid_with', p_paid_with));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Reserva de staff pagada al momento: también genera la venta.
CREATE OR REPLACE FUNCTION public.admin_book_person(p_session_id UUID, p_person_id UUID, p_tier TEXT, p_paid_with TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set    class_settings%ROWTYPE;
  v_sess   class_sessions%ROWTYPE;
  v        class_sessions_v%ROWTYPE;
  v_day    DATE;
  v_taken  INT;
  v_amount INT;
  v_id     UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_tier NOT IN ('regular','member','free_monthly','courtesy') THEN RETURN jsonb_build_object('error', 'invalid_tier'); END IF;
  IF p_paid_with IS NOT NULL AND p_paid_with NOT IN ('cash','card','transfer','other') THEN
    RETURN jsonb_build_object('error', 'invalid_method');
  END IF;
  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_sess FROM class_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  SELECT * INTO v FROM class_sessions_v WHERE id = p_session_id;
  v_day := class_mx_date(v.starts_at);
  IF v.status <> 'scheduled' THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  IF EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = p_session_id AND b.person_id = p_person_id
             AND b.status NOT IN ('cancelled','cancelled_late','cancelled_by_gym')) THEN
    RETURN jsonb_build_object('error', 'already_booked');
  END IF;
  v_taken := class_taken(p_session_id);
  IF v_taken >= v.capacity + v_set.overbook_tolerance THEN RETURN jsonb_build_object('error', 'full'); END IF;
  IF p_tier IN ('member','free_monthly') AND NOT class_is_member(p_person_id, v_day) THEN
    RETURN jsonb_build_object('error', 'not_member');
  END IF;
  IF p_tier = 'free_monthly' THEN
    IF NOT v.eligible_free_monthly THEN RETURN jsonb_build_object('error', 'not_eligible'); END IF;
    IF class_free_used(p_person_id, v_day) >= v_set.free_classes_per_month THEN RETURN jsonb_build_object('error', 'free_used'); END IF;
  END IF;
  v_amount := CASE p_tier WHEN 'regular' THEN v.price_cents WHEN 'member' THEN v.member_price_cents ELSE 0 END;
  IF v_amount > 0 AND p_paid_with IS NOT NULL AND (SELECT require_open_cash FROM erp_settings WHERE id = 1) AND erp_open_session_id() IS NULL THEN
    RETURN jsonb_build_object('error', 'cash_closed');
  END IF;

  INSERT INTO class_bookings (session_id, person_id, status, price_tier, payment_method, payment_status,
                              paid_with, paid_at, amount_cents, is_overbook, created_by)
  VALUES (p_session_id, p_person_id, 'booked', p_tier,
          CASE WHEN v_amount = 0 THEN 'none' ELSE 'at_gym' END,
          CASE WHEN v_amount = 0 THEN 'not_needed' WHEN p_paid_with IS NOT NULL THEN 'paid' ELSE 'pending' END,
          CASE WHEN v_amount > 0 THEN p_paid_with END,
          CASE WHEN v_amount > 0 AND p_paid_with IS NOT NULL THEN now() END,
          v_amount, v_taken >= v.capacity, auth.uid())
  RETURNING id INTO v_id;
  IF v_amount > 0 AND p_paid_with IS NOT NULL THEN PERFORM erp_booking_sale(v_id, p_paid_with); END IF;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'staff_book', 'booking', v_id, class_booking_json(v_id));
  RETURN jsonb_build_object('success', true, 'booking', class_booking_json(v_id));
END;
$function$;

-- Venta suelta de clase (Introductoria): además de class_sales, entra como venta.
CREATE OR REPLACE FUNCTION public.admin_register_sale(p_class_type_id UUID, p_person_id UUID, p_sold_on DATE,
                                                      p_amount_cents INT, p_paid_with TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id   UUID;
  v_name TEXT;
  v_prod UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT name INTO v_name FROM class_types WHERE id = p_class_type_id;
  IF v_name IS NULL THEN RETURN jsonb_build_object('error', 'invalid_class'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF p_paid_with NOT IN ('cash','card','transfer','clip','other') THEN RETURN jsonb_build_object('error', 'invalid_method'); END IF;
  IF p_amount_cents > 0 AND (SELECT require_open_cash FROM erp_settings WHERE id = 1) AND erp_open_session_id() IS NULL THEN
    RETURN jsonb_build_object('error', 'cash_closed');
  END IF;
  INSERT INTO class_sales (class_type_id, person_id, sold_on, amount_cents, paid_with, note, created_by)
  VALUES (p_class_type_id, p_person_id, coalesce(p_sold_on, class_today()), p_amount_cents, p_paid_with,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  IF p_amount_cents > 0 THEN
    SELECT id INTO v_prod FROM products WHERE class_type_id = p_class_type_id LIMIT 1;
    PERFORM erp_insert_sale(p_person_id, 'class',
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description', 'Clase ' || v_name, 'quantity', 1, 'unit_price_cents', p_amount_cents)),
      jsonb_build_array(jsonb_build_object('method', p_paid_with, 'amount_cents', p_amount_cents)),
      0, p_note, NULL, NULL, erp_open_session_id());
  END IF;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'sale', 'sale', v_id, jsonb_build_object('class_type_id', p_class_type_id, 'person_id', p_person_id,
          'amount_cents', p_amount_cents, 'paid_with', p_paid_with));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- ------------------------------------------------------------
-- Domiciliación (staff)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_cycle_amount(p_sub subscriptions, p_cycle INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE WHEN p_cycle <= p_sub.promo_cycles AND p_sub.promo_price_cents IS NOT NULL
              THEN p_sub.promo_price_cents ELSE p_sub.price_cents END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_new_token()
RETURNS TEXT LANGUAGE sql VOLATILE AS $function$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', 1 + floor(random() * 57)::int, 1), '')
  FROM generate_series(1, 32);
$function$;

-- Crea la domiciliación (queda esperando tarjeta) y devuelve el link para
-- que la persona registre su tarjeta.
CREATE OR REPLACE FUNCTION public.admin_create_subscription(p_person_id UUID, p_product_id UUID, p_start_on DATE DEFAULT NULL, p_apply_promo BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p        products%ROWTYPE;
  v_provider TEXT := (SELECT recurring_provider FROM integration_settings WHERE id = 1);
  v_start    DATE;
  v_token    TEXT := erp_new_token();
  v_id       UUID;
  v_last     DATE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_provider IS NULL THEN RETURN jsonb_build_object('error', 'no_provider'); END IF;
  SELECT * INTO v_p FROM products WHERE id = p_product_id;
  IF NOT FOUND OR NOT v_p.is_recurring OR NOT v_p.is_active THEN RETURN jsonb_build_object('error', 'invalid_product'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM subscriptions WHERE person_id = p_person_id AND product_id = p_product_id
             AND status IN ('pending_card','active','past_due')) THEN
    RETURN jsonb_build_object('error', 'already_subscribed');
  END IF;
  -- Por defecto empieza hoy, o al día siguiente de su membresía vigente.
  IF p_start_on IS NOT NULL THEN
    IF p_start_on < erp_today() THEN RETURN jsonb_build_object('error', 'invalid_date'); END IF;
    v_start := p_start_on;
  ELSE
    v_last := erp_membership_until(p_person_id);
    v_start := coalesce(v_last + 1, erp_today());
  END IF;

  INSERT INTO subscriptions (person_id, product_id, provider, price_cents, promo_cycles, promo_price_cents, start_on,
                             next_charge_on, setup_token, setup_expires_at, created_by)
  VALUES (p_person_id, p_product_id, v_provider, v_p.price_cents,
          CASE WHEN p_apply_promo AND v_p.promo_active THEN coalesce(v_p.promo_cycles, 0) ELSE 0 END,
          CASE WHEN p_apply_promo AND v_p.promo_active THEN v_p.promo_price_cents END,
          v_start, v_start, v_token,
          now() + make_interval(days => (SELECT setup_link_days FROM erp_settings WHERE id = 1)), auth.uid())
  RETURNING id INTO v_id;
  PERFORM erp_audit('subscription_create', 'subscription', v_id, NULL,
                    jsonb_build_object('person_id', p_person_id, 'product_id', p_product_id, 'start_on', v_start, 'promo', p_apply_promo));
  RETURN jsonb_build_object('success', true, 'id', v_id, 'token', v_token, 'start_on', v_start);
END;
$function$;

-- Nuevo link (para cambiar tarjeta o si el anterior venció).
CREATE OR REPLACE FUNCTION public.admin_subscription_link(p_subscription_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_token TEXT := erp_new_token();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE subscriptions SET setup_token = v_token,
    setup_expires_at = now() + make_interval(days => (SELECT setup_link_days FROM erp_settings WHERE id = 1)), updated_at = now()
  WHERE id = p_subscription_id AND status IN ('pending_card','active','past_due');
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true, 'token', v_token);
END;
$function$;

-- Cancelar: al final del periodo pagado (por defecto) o de inmediato.
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(p_subscription_id UUID, p_immediately BOOLEAN, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s subscriptions%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_s FROM subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_s.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF EXISTS (SELECT 1 FROM billing_charges WHERE subscription_id = p_subscription_id AND status = 'processing') THEN
    RETURN jsonb_build_object('error', 'charge_in_progress');
  END IF;
  IF p_immediately OR v_s.status = 'pending_card' THEN
    UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason),
      setup_token = NULL, updated_at = now() WHERE id = p_subscription_id;
    UPDATE billing_charges SET status = 'abandoned', next_attempt_at = NULL, updated_at = now()
    WHERE subscription_id = p_subscription_id AND status IN ('pending','failed','needs_action');
  ELSE
    UPDATE subscriptions SET cancel_at_period_end = true, cancel_reason = btrim(p_reason), updated_at = now() WHERE id = p_subscription_id;
  END IF;
  PERFORM erp_audit('subscription_cancel', 'subscription', p_subscription_id, to_jsonb(v_s),
                    jsonb_build_object('immediately', p_immediately, 'reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resume_subscription(p_subscription_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE subscriptions SET cancel_at_period_end = false, cancel_reason = NULL, updated_at = now()
  WHERE id = p_subscription_id AND status IN ('active','past_due') AND cancel_at_period_end;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscriptions_admin()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('subscriptions', coalesce((
    SELECT jsonb_agg(to_jsonb(s) - 'setup_token' || jsonb_build_object(
      'person_name', p.full_name, 'person_phone', p.phone, 'person_email', p.email, 'product_name', pr.name,
      'next_amount_cents', erp_cycle_amount(s, s.cycles_paid + 1),
      'open_charge', (SELECT to_jsonb(c) FROM billing_charges c WHERE c.subscription_id = s.id AND c.status <> 'paid'
                      ORDER BY c.cycle DESC LIMIT 1)
    ) ORDER BY (s.status = 'cancelled'), s.next_charge_on)
    FROM subscriptions s JOIN people p ON p.id = s.person_id JOIN products pr ON pr.id = s.product_id
  ), '[]'::jsonb), 'today', erp_today());
END;
$function$;

-- Página pública del link: solo lo necesario para mostrar y registrar la tarjeta.
CREATE OR REPLACE FUNCTION public.get_subscription_setup(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s subscriptions%ROWTYPE;
  v_i integration_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM subscriptions WHERE setup_token = p_token AND length(coalesce(p_token, '')) >= 20;
  IF NOT FOUND OR v_s.setup_expires_at < now() OR v_s.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_link'); END IF;
  SELECT * INTO v_i FROM integration_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'status', v_s.status, 'provider', v_s.provider,
    'first_name', split_part((SELECT full_name FROM people WHERE id = v_s.person_id), ' ', 1),
    'product_name', (SELECT name FROM products WHERE id = v_s.product_id),
    'price_cents', v_s.price_cents, 'promo_cycles', v_s.promo_cycles, 'promo_price_cents', v_s.promo_price_cents,
    'start_on', v_s.start_on, 'next_charge_on', v_s.next_charge_on, 'cycles_paid', v_s.cycles_paid,
    'next_amount_cents', erp_cycle_amount(v_s, v_s.cycles_paid + 1),
    'card_brand', v_s.card_brand, 'card_last4', v_s.card_last4,
    'today', erp_today(),
    'openpay', CASE WHEN v_s.provider = 'openpay' THEN jsonb_build_object('merchant_id', v_i.openpay_merchant_id,
                  'public_key', v_i.openpay_public_key, 'sandbox', v_i.openpay_sandbox) END,
    'stripe', CASE WHEN v_s.provider = 'stripe' THEN jsonb_build_object('publishable_key', v_i.stripe_publishable_key) END
  );
END;
$function$;

-- ------------------------------------------------------------
-- Domiciliación (motor; solo service_role / Edge Function "billing")
-- ------------------------------------------------------------

-- Datos para la Edge Function a partir del token del link.
CREATE OR REPLACE FUNCTION public.billing_context_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM subscriptions WHERE setup_token = p_token AND length(coalesce(p_token, '')) >= 20;
  IF NOT FOUND OR v_s.setup_expires_at < now() OR v_s.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_link'); END IF;
  RETURN to_jsonb(v_s) || jsonb_build_object(
    'person', (SELECT jsonb_build_object('full_name', full_name, 'email', email, 'phone', phone) FROM people WHERE id = v_s.person_id),
    'product_name', (SELECT name FROM products WHERE id = v_s.product_id),
    'integrations', (SELECT to_jsonb(i) FROM integration_settings i WHERE id = 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_save_customer(p_subscription_id UUID, p_customer_id TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  UPDATE subscriptions SET provider_customer_id = p_customer_id, updated_at = now()
  WHERE id = p_subscription_id AND provider_customer_id IS NULL;
$function$;

-- Tarjeta registrada: activa la domiciliación (si estaba esperando tarjeta)
-- y consume el token del link.
CREATE OR REPLACE FUNCTION public.billing_attach_card(p_subscription_id UUID, p_card_id TEXT, p_brand TEXT, p_last4 TEXT, p_exp TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_s.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  UPDATE subscriptions SET provider_card_id = p_card_id, card_brand = p_brand, card_last4 = p_last4, card_exp = p_exp,
    status = CASE WHEN status = 'pending_card' THEN 'active' ELSE status END,
    setup_token = NULL, setup_expires_at = NULL, updated_at = now()
  WHERE id = p_subscription_id;
  -- Si había un cobro fallido esperando, se puede reintentar ya.
  UPDATE billing_charges SET next_attempt_at = now(), updated_at = now()
  WHERE subscription_id = p_subscription_id AND status IN ('failed','needs_action');
  INSERT INTO billing_events (provider, kind, subscription_id, payload)
  VALUES (v_s.provider, 'card_attached', p_subscription_id, jsonb_build_object('brand', p_brand, 'last4', p_last4, 'exp', p_exp));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_save_device_session(p_subscription_id UUID, p_device_session TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  UPDATE subscriptions SET provider_device_session = NULLIF(p_device_session, ''), updated_at = now() WHERE id = p_subscription_id;
$function$;

-- Asegura el registro del siguiente ciclo y lo aparta para cobrar.
-- p_subscription_id NULL = todas las que tocan hoy; con id = "cobrar ahora"
-- (ignora la espera entre reintentos, nunca la de un cobro en curso).
-- Un intento 'processing' de más de 15 min se devuelve como reconcile=true
-- (hay que consultar al proveedor con la misma llave antes de reintentar).
CREATE OR REPLACE FUNCTION public.billing_claim_due(p_limit INT DEFAULT 25, p_subscription_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s      subscriptions%ROWTYPE;
  v_c      billing_charges%ROWTYPE;
  v_cycle  INT;
  v_max    INT := coalesce(array_length((SELECT retry_days FROM erp_settings WHERE id = 1), 1), 0) + 1;
  v_out    JSONB := '[]'::jsonb;
  v_n      INT := 0;
BEGIN
  FOR v_s IN
    SELECT * FROM subscriptions
    WHERE status IN ('active','past_due') AND provider_card_id IS NOT NULL
      AND next_charge_on <= erp_today() AND (p_subscription_id IS NULL OR id = p_subscription_id)
    ORDER BY next_charge_on
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= p_limit;
    v_cycle := v_s.cycles_paid + 1;

    -- Cancelación programada: al llegar la fecha ya no se cobra.
    IF v_s.cancel_at_period_end AND v_s.next_charge_on <= erp_today() THEN
      UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_s.id;
      UPDATE billing_charges SET status = 'abandoned', next_attempt_at = NULL, updated_at = now()
      WHERE subscription_id = v_s.id AND status IN ('pending','failed','needs_action');
      INSERT INTO billing_events (provider, kind, subscription_id, payload) VALUES (v_s.provider, 'cancelled_at_period_end', v_s.id, NULL);
      CONTINUE;
    END IF;

    INSERT INTO billing_charges (subscription_id, cycle, period_start, period_end, amount_cents, max_attempts)
    VALUES (v_s.id, v_cycle,
            (v_s.start_on + make_interval(months => v_cycle - 1))::date,
            (v_s.start_on + make_interval(months => v_cycle))::date - 1,
            erp_cycle_amount(v_s, v_cycle), v_max)
    ON CONFLICT (subscription_id, cycle) DO NOTHING;

    SELECT * INTO v_c FROM billing_charges WHERE subscription_id = v_s.id AND cycle = v_cycle FOR UPDATE;

    IF v_c.status = 'processing' AND v_c.processing_since < now() - INTERVAL '15 minutes' THEN
      -- Intento colgado: reconciliar con la misma llave.
      UPDATE billing_charges SET processing_since = now(), updated_at = now() WHERE id = v_c.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('reconcile', true, 'charge', to_jsonb(v_c), 'subscription', to_jsonb(v_s)));
      v_n := v_n + 1;
    ELSIF v_c.status IN ('pending','failed','needs_action')
          AND (p_subscription_id IS NOT NULL OR v_c.next_attempt_at IS NULL OR v_c.next_attempt_at <= now())
          AND (p_subscription_id IS NOT NULL OR v_c.attempt < v_c.max_attempts) THEN
      UPDATE billing_charges SET status = 'processing', attempt = attempt + 1, processing_since = now(),
        idempotency_key = id::text || '-' || (attempt + 1), updated_at = now()
      WHERE id = v_c.id RETURNING * INTO v_c;
      v_out := v_out || jsonb_build_array(jsonb_build_object('reconcile', false, 'charge', to_jsonb(v_c), 'subscription', to_jsonb(v_s),
                 'person', (SELECT jsonb_build_object('full_name', full_name, 'email', email) FROM people WHERE id = v_s.person_id),
                 'product_name', (SELECT name FROM products WHERE id = v_s.product_id)));
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- Resultado de un intento. 'paid' → venta + membresía + siguiente ciclo.
-- 'failed' → programa el reintento (o se detiene si ya no quedan).
-- 'needs_action' → el banco pide autenticar (Stripe 3DS): se manda link.
-- Idempotente: si el cargo ya estaba pagado, no hace nada.
CREATE OR REPLACE FUNCTION public.billing_record_result(p_charge_id UUID, p_idempotency_key TEXT, p_outcome TEXT,
                                                        p_provider_charge_id TEXT, p_error_code TEXT, p_error_message TEXT, p_raw JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_c     billing_charges%ROWTYPE;
  v_s     subscriptions%ROWTYPE;
  v_sale  JSONB;
  v_mid   UUID;
  v_days  INT[] := (SELECT retry_days FROM erp_settings WHERE id = 1);
  v_pname TEXT;
BEGIN
  IF p_outcome NOT IN ('paid','failed','needs_action') THEN RAISE EXCEPTION 'billing: outcome inválido'; END IF;
  SELECT * INTO v_c FROM billing_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO v_s FROM subscriptions WHERE id = v_c.subscription_id FOR UPDATE;

  INSERT INTO billing_events (provider, kind, charge_id, subscription_id, payload)
  VALUES (v_s.provider, 'attempt_' || p_outcome, v_c.id, v_s.id,
          jsonb_build_object('key', p_idempotency_key, 'provider_charge_id', p_provider_charge_id,
                             'error_code', p_error_code, 'error_message', p_error_message, 'raw', p_raw));

  IF v_c.status = 'paid' THEN RETURN jsonb_build_object('noop', true, 'status', 'paid'); END IF;
  -- Un resultado de un intento viejo no pisa a uno más nuevo (salvo que sea un pago: el dinero manda).
  IF p_idempotency_key IS DISTINCT FROM v_c.idempotency_key AND p_outcome <> 'paid' THEN
    RETURN jsonb_build_object('noop', true, 'status', v_c.status);
  END IF;

  IF p_outcome = 'paid' THEN
    SELECT name INTO v_pname FROM products WHERE id = v_s.product_id;
    v_sale := erp_insert_sale(v_s.person_id, 'subscription',
      jsonb_build_array(jsonb_build_object('product_id', v_s.product_id,
        'description', v_pname || ' · ' || to_char(v_c.period_start, 'DD/MM/YY') || ' al ' || to_char(v_c.period_end, 'DD/MM/YY'),
        'quantity', 1, 'unit_price_cents', v_c.amount_cents)),
      jsonb_build_array(jsonb_build_object('method', v_s.provider, 'amount_cents', v_c.amount_cents, 'reference', p_provider_charge_id)),
      0, NULL, NULL, v_s.id, NULL);
    v_mid := erp_grant_membership(v_s.person_id, v_s.product_id, v_c.period_start, (v_sale->>'sale_id')::uuid, v_s.id, v_c.period_end);
    UPDATE billing_charges SET status = 'paid', paid_at = now(), provider_charge_id = p_provider_charge_id,
      sale_id = (v_sale->>'sale_id')::uuid, error_code = NULL, error_message = NULL, next_attempt_at = NULL,
      processing_since = NULL, updated_at = now()
    WHERE id = v_c.id;
    UPDATE subscriptions SET cycles_paid = greatest(cycles_paid, v_c.cycle),
      next_charge_on = (start_on + make_interval(months => greatest(cycles_paid, v_c.cycle)))::date,
      status = CASE WHEN status = 'cancelled' THEN status ELSE 'active' END, last_error = NULL, updated_at = now()
    WHERE id = v_s.id;
    RETURN jsonb_build_object('status', 'paid', 'sale_id', v_sale->>'sale_id', 'folio', v_sale->>'folio', 'notify', 'receipt');
  END IF;

  IF p_outcome = 'needs_action' THEN
    UPDATE billing_charges SET status = 'needs_action', provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
      error_code = p_error_code, error_message = p_error_message, processing_since = NULL, next_attempt_at = NULL, updated_at = now()
    WHERE id = v_c.id;
    UPDATE subscriptions SET status = 'past_due', last_error = coalesce(p_error_message, 'El banco pidió autenticación'), updated_at = now() WHERE id = v_s.id;
    RETURN jsonb_build_object('status', 'needs_action', 'notify', 'action');
  END IF;

  -- failed
  UPDATE billing_charges SET status = 'failed', provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
    error_code = p_error_code, error_message = p_error_message, processing_since = NULL,
    next_attempt_at = CASE WHEN v_c.attempt < v_c.max_attempts AND v_c.attempt <= coalesce(array_length(v_days, 1), 0)
                           THEN now() + make_interval(days => v_days[v_c.attempt]) END,
    updated_at = now()
  WHERE id = v_c.id RETURNING * INTO v_c;
  UPDATE subscriptions SET status = 'past_due', last_error = coalesce(p_error_message, p_error_code, 'Cobro rechazado'), updated_at = now() WHERE id = v_s.id;
  RETURN jsonb_build_object('status', 'failed', 'final', v_c.next_attempt_at IS NULL, 'next_attempt_at', v_c.next_attempt_at,
                            'notify', CASE WHEN v_c.attempt = 1 OR v_c.next_attempt_at IS NULL THEN 'failed' END);
END;
$function$;

-- Un intento que se cayó sin respuesta del proveedor y que al reconciliar
-- resultó NO existir allá: se regresa a 'failed' sin gastar un intento.
CREATE OR REPLACE FUNCTION public.billing_release_attempt(p_charge_id UUID, p_idempotency_key TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE billing_charges SET status = CASE WHEN attempt <= 1 THEN 'pending' ELSE 'failed' END,
    attempt = greatest(attempt - 1, 0), processing_since = NULL, next_attempt_at = now(), updated_at = now()
  WHERE id = p_charge_id AND status = 'processing' AND idempotency_key = p_idempotency_key;
  INSERT INTO billing_events (kind, charge_id, payload) VALUES ('attempt_released', p_charge_id, jsonb_build_object('key', p_idempotency_key, 'note', p_note));
END;
$function$;

-- Link para que la persona actualice su tarjeta (lo usa el correo de cobro rechazado).
CREATE OR REPLACE FUNCTION public.billing_issue_link(p_subscription_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_token TEXT;
BEGIN
  SELECT setup_token INTO v_token FROM subscriptions
  WHERE id = p_subscription_id AND setup_token IS NOT NULL AND setup_expires_at > now() + INTERVAL '2 days';
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;
  v_token := erp_new_token();
  UPDATE subscriptions SET setup_token = v_token,
    setup_expires_at = now() + make_interval(days => (SELECT setup_link_days FROM erp_settings WHERE id = 1)), updated_at = now()
  WHERE id = p_subscription_id AND status IN ('pending_card','active','past_due');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_log(p_provider TEXT, p_kind TEXT, p_payload JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  INSERT INTO billing_events (provider, kind, payload) VALUES (p_provider, p_kind, p_payload);
$function$;

CREATE OR REPLACE FUNCTION public.billing_charge_by_id(p_charge_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object('charge', to_jsonb(c), 'subscription', to_jsonb(s),
    'person', (SELECT jsonb_build_object('full_name', full_name, 'email', email) FROM people WHERE id = s.person_id),
    'product_name', (SELECT name FROM products WHERE id = s.product_id))
  FROM billing_charges c JOIN subscriptions s ON s.id = c.subscription_id
  WHERE c.id = p_charge_id;
$function$;

-- Para webhooks: ubicar un cobro por el id del proveedor.
CREATE OR REPLACE FUNCTION public.billing_charge_by_provider_id(p_provider_charge_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object('charge', to_jsonb(c), 'subscription', to_jsonb(s))
  FROM billing_charges c JOIN subscriptions s ON s.id = c.subscription_id
  WHERE c.provider_charge_id = p_provider_charge_id;
$function$;

-- ------------------------------------------------------------
-- Portal del cliente (Mi cuenta)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_portal()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pid UUID := class_my_person_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_pid IS NULL THEN RETURN jsonb_build_object('person', NULL); END IF;
  RETURN jsonb_build_object(
    'person', (SELECT jsonb_build_object('full_name', full_name, 'phone', phone, 'email', email) FROM people WHERE id = v_pid),
    'membership_until', erp_membership_until(v_pid),
    'free_left_this_month', greatest((SELECT free_classes_per_month FROM class_settings WHERE id = 1) - class_free_used(v_pid, erp_today()), 0),
    'subscriptions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'product_name', pr.name, 'price_cents', s.price_cents,
        'promo_cycles', s.promo_cycles, 'promo_price_cents', s.promo_price_cents, 'cycles_paid', s.cycles_paid,
        'next_charge_on', s.next_charge_on, 'next_amount_cents', erp_cycle_amount(s, s.cycles_paid + 1),
        'card_brand', s.card_brand, 'card_last4', s.card_last4, 'cancel_at_period_end', s.cancel_at_period_end,
        'last_error', CASE WHEN s.status = 'past_due' THEN s.last_error END) ORDER BY s.created_at DESC)
      FROM subscriptions s JOIN products pr ON pr.id = s.product_id WHERE s.person_id = v_pid AND s.status <> 'cancelled'), '[]'::jsonb),
    'sales', coalesce((
      SELECT jsonb_agg(jsonb_build_object('folio', s.folio, 'created_at', s.created_at, 'total_cents', s.total_cents,
        'items', (SELECT string_agg(i.description, ', ') FROM sale_items i WHERE i.sale_id = s.id)) ORDER BY s.created_at DESC)
      FROM (SELECT * FROM sales WHERE person_id = v_pid AND status = 'completed' ORDER BY created_at DESC LIMIT 20) s), '[]'::jsonb)
  );
END;
$function$;

-- El cliente pide su propio link para cambiar la tarjeta.
CREATE OR REPLACE FUNCTION public.my_subscription_link(p_subscription_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_token TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE id = p_subscription_id AND person_id = class_my_person_id()
                 AND status IN ('pending_card','active','past_due')) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  v_token := billing_issue_link(p_subscription_id);
  RETURN jsonb_build_object('success', true, 'token', v_token);
END;
$function$;

-- ------------------------------------------------------------
-- Inicio (tablero del staff)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_staff_dashboard()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
  v_days  INT := (SELECT expiring_notice_days FROM erp_settings WHERE id = 1);
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM class_generate_sessions(class_horizon());
  RETURN jsonb_build_object(
    'today', v_today,
    'is_admin', class_is_admin(),
    'cash', (SELECT jsonb_build_object('id', id, 'opened_at', opened_at, 'summary', erp_cash_summary(id)) FROM cash_sessions WHERE closed_at IS NULL),
    'require_open_cash', (SELECT require_open_cash FROM erp_settings WHERE id = 1),
    'sales_today', jsonb_build_object(
      'total_cents', coalesce((SELECT sum(total_cents) FROM sales WHERE status = 'completed' AND (created_at AT TIME ZONE 'America/Mexico_City')::date = v_today), 0),
      'count', (SELECT count(*) FROM sales WHERE status = 'completed' AND (created_at AT TIME ZONE 'America/Mexico_City')::date = v_today)),
    'classes_today', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'starts_at', v.starts_at, 'capacity', v.capacity,
                               'taken', class_taken(v.id), 'status', v.status, 'color', v.color) ORDER BY v.starts_at)
                               FROM class_sessions_v v WHERE class_mx_date(v.starts_at) = v_today AND v.type_active), '[]'::jsonb),
    'failed_charges', coalesce((SELECT jsonb_agg(jsonb_build_object('subscription_id', s.id, 'person_id', p.id, 'person_name', p.full_name,
                               'amount_cents', c.amount_cents, 'status', c.status, 'error', coalesce(c.error_message, c.error_code),
                               'next_attempt_at', c.next_attempt_at, 'attempt', c.attempt, 'max_attempts', c.max_attempts))
                               FROM billing_charges c JOIN subscriptions s ON s.id = c.subscription_id JOIN people p ON p.id = s.person_id
                               WHERE c.status IN ('failed','needs_action') AND s.status <> 'cancelled'), '[]'::jsonb),
    'pending_cards', coalesce((SELECT jsonb_agg(jsonb_build_object('subscription_id', s.id, 'person_id', p.id, 'person_name', p.full_name, 'created_at', s.created_at))
                               FROM subscriptions s JOIN people p ON p.id = s.person_id WHERE s.status = 'pending_card'), '[]'::jsonb),
    'expiring', coalesce((SELECT jsonb_agg(x ORDER BY x->>'until') FROM (
                  SELECT jsonb_build_object('person_id', p.id, 'person_name', p.full_name, 'phone', p.phone, 'until', u.until) AS x
                  FROM people p CROSS JOIN LATERAL (SELECT erp_membership_until(p.id) AS until) u
                  WHERE u.until BETWEEN v_today AND v_today + v_days
                    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.person_id = p.id AND s.status IN ('active','past_due') AND NOT s.cancel_at_period_end)
                ) e), '[]'::jsonb),
    'birthdays', coalesce((SELECT jsonb_agg(jsonb_build_object('person_id', id, 'person_name', full_name))
                  FROM people WHERE birth_date IS NOT NULL AND NOT is_archived
                    AND extract(month FROM birth_date) = extract(month FROM v_today) AND extract(day FROM birth_date) = extract(day FROM v_today)), '[]'::jsonb),
    'new_people_week', (SELECT count(*) FROM people WHERE created_at >= now() - INTERVAL '7 days')
  );
END;
$function$;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
DO $grants$
DECLARE
  f TEXT;
BEGIN
  -- Internas: nadie desde la API.
  FOREACH f IN ARRAY ARRAY[
    'erp_today()', 'erp_audit(text,text,uuid,jsonb,jsonb)', 'erp_open_session_id()', 'erp_period_end(date,text,integer)',
    'erp_grant_membership(uuid,uuid,date,uuid,uuid,date)', 'erp_membership_until(uuid)',
    'erp_insert_sale(uuid,text,jsonb,jsonb,integer,text,uuid,uuid,uuid)', 'erp_cash_summary(uuid)', 'erp_booking_sale(uuid,text)',
    'erp_cycle_amount(subscriptions,integer)', 'erp_new_token()', 'billing_events_immutable()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Staff / admin (validan rol por dentro).
  FOREACH f IN ARRAY ARRAY[
    'get_erp_settings()', 'admin_update_erp_settings(jsonb)', 'admin_update_integrations(jsonb)',
    'get_products(boolean)', 'admin_save_product(jsonb)', 'admin_save_person(jsonb)', 'admin_search_people(text)',
    'get_person_profile(uuid)', 'admin_add_person_note(uuid,text,text)', 'admin_void_membership(uuid,text)',
    'get_cash_status()', 'open_cash(integer,text)', 'add_cash_movement(text,integer,text)', 'close_cash(integer,text)',
    'create_sale(jsonb)', 'admin_void_sale(uuid,text)', 'get_sales(date,date)', 'get_sales_report(date)',
    'admin_mark_booking_paid(uuid,text)', 'admin_book_person(uuid,uuid,text,text)',
    'admin_register_sale(uuid,uuid,date,integer,text,text)',
    'admin_create_subscription(uuid,uuid,date,boolean)', 'admin_subscription_link(uuid)',
    'admin_cancel_subscription(uuid,boolean,text)', 'admin_resume_subscription(uuid)', 'get_subscriptions_admin()',
    'get_staff_dashboard()', 'get_my_portal()', 'my_subscription_link(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- Página pública del link.
  REVOKE ALL ON FUNCTION public.get_subscription_setup(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_subscription_setup(text) TO anon, authenticated;
  -- Motor (Edge Function con service_role).
  FOREACH f IN ARRAY ARRAY[
    'billing_context_by_token(text)', 'billing_save_customer(uuid,text)', 'billing_attach_card(uuid,text,text,text,text)',
    'billing_claim_due(integer,uuid)', 'billing_record_result(uuid,text,text,text,text,text,jsonb)',
    'billing_release_attempt(uuid,text,text)', 'billing_log(text,text,jsonb)', 'billing_charge_by_provider_id(text)',
    'billing_issue_link(uuid)', 'billing_charge_by_id(uuid)', 'billing_save_device_session(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END;
$grants$;
