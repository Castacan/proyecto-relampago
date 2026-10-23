-- ============================================================
-- Finanzas de Jaibamuro (2026-10-23): EGRESOS (cuentas a pagar) e INVENTARIO.
-- Requiere clases.sql y erp.sql: córrelo SIEMPRE DESPUÉS de erp.sql.
-- Idempotente: se puede correr más de una vez.
--
-- Tomado como base de EVO (Financiero → Cuentas a pagar, Administración →
-- Productos), simplificado:
--   expense_payees     a quién se le paga (proveedor, empleado, gobierno…)
--   expenses           cada egreso: concepto, centro de costos, monto,
--                      vencimiento, mes al que corresponde, pagado o pendiente
--   expense_recurring  gastos que se repiten (internet, contadora, renta…):
--                      generan solos el egreso pendiente de cada periodo
--   stock_movements    bitácora de inventario: entradas, ventas, anulaciones,
--                      ajustes por conteo y salidas (consumo / merma)
--
-- Reglas clave:
--   * Un egreso pagado "de la caja" crea el movimiento de efectivo en la caja
--     abierta (y un gasto registrado desde Caja crea su egreso).
--   * Vender un producto con inventario lo descuenta; anular la venta lo
--     regresa. Todo cambio de existencia queda en stock_movements.
--   * La existencia solo cambia por movimientos (no se edita a mano).
--
-- Aquí viven las versiones vigentes de: erp_insert_sale, create_sale,
-- admin_void_sale, admin_save_product, add_cash_movement, get_sales_report,
-- get_staff_dashboard (antes estaban en erp.sql).
-- ============================================================

-- ------------------------------------------------------------
-- Ajustes y columnas nuevas
-- ------------------------------------------------------------
ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS expense_cost_centers TEXT[] NOT NULL
  DEFAULT '{"Gastos fijos","Gastos variables","Compra de productos"}';

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_cents INT CHECK (cost_cents IS NULL OR cost_cents >= 0);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_min INT CHECK (stock_min IS NULL OR stock_min >= 0);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku TEXT;

-- ------------------------------------------------------------
-- Egresos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_payees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'supplier' CHECK (kind IN ('supplier','employee','government','other')),
  default_cost_center TEXT,
  default_category    TEXT,
  phone               TEXT,
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_payees_name ON public.expense_payees (lower(name));

CREATE TABLE IF NOT EXISTS public.expense_recurring (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_id     UUID REFERENCES public.expense_payees(id),
  description  TEXT NOT NULL,
  cost_center  TEXT NOT NULL,
  category     TEXT,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  method       TEXT CHECK (method IN ('cash','card','transfer','other')),
  every_months INT NOT NULL DEFAULT 1 CHECK (every_months BETWEEN 1 AND 12),
  day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  next_on      DATE NOT NULL,                 -- siguiente vencimiento que falta generar
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            BIGINT GENERATED ALWAYS AS IDENTITY,
  payee_id         UUID REFERENCES public.expense_payees(id),
  description      TEXT NOT NULL,
  cost_center      TEXT NOT NULL,
  category         TEXT,
  amount_cents     INT NOT NULL CHECK (amount_cents > 0),
  due_on           DATE NOT NULL,             -- vencimiento
  period_month     DATE NOT NULL,             -- mes al que corresponde (1er día; "competencia" en EVO)
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_on          DATE,
  method           TEXT CHECK (method IN ('cash','card','transfer','other')),
  paid_from        TEXT CHECK (paid_from IN ('cash_register','bank','other')),
  invoice_ref      TEXT,
  notes            TEXT,
  recurring_id     UUID REFERENCES public.expense_recurring(id) ON DELETE SET NULL,
  cash_movement_id UUID REFERENCES public.cash_movements(id),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  CHECK (period_month = date_trunc('month', period_month)::date),
  CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND method IS NOT NULL AND paid_from IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS expenses_period_idx ON public.expenses (period_month);
CREATE INDEX IF NOT EXISTS expenses_due_idx ON public.expenses (status, due_on);
-- Un gasto recurrente genera un solo egreso por vencimiento (aunque se cancele).
CREATE UNIQUE INDEX IF NOT EXISTS expenses_recurring_once ON public.expenses (recurring_id, due_on) WHERE recurring_id IS NOT NULL;

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS expense_id UUID;

-- ------------------------------------------------------------
-- Inventario
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES public.products(id),
  kind            TEXT NOT NULL CHECK (kind IN ('initial','purchase','sale','sale_void','adjust','consumption')),
  quantity        INT NOT NULL CHECK (quantity <> 0),   -- con signo: + entra, − sale
  stock_after     INT NOT NULL,
  unit_cost_cents INT,
  sale_id         UUID,
  expense_id      UUID,
  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON public.stock_movements (product_id, created_at DESC);

ALTER TABLE public.expense_payees    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_recurring ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_payees, public.expense_recurring, public.expenses, public.stock_movements FROM anon, authenticated;

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_month(p_day DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $function$
  SELECT date_trunc('month', p_day)::date;
$function$;

-- Mueve la existencia de un producto y deja el registro. Devuelve la existencia final.
CREATE OR REPLACE FUNCTION public.erp_stock_move(p_product_id UUID, p_qty INT, p_kind TEXT, p_unit_cost INT,
                                                 p_sale_id UUID, p_expense_id UUID, p_note TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_after INT;
BEGIN
  IF p_qty = 0 THEN RETURN (SELECT stock FROM products WHERE id = p_product_id); END IF;
  UPDATE products SET stock = coalesce(stock, 0) + p_qty, updated_at = now() WHERE id = p_product_id RETURNING stock INTO v_after;
  INSERT INTO stock_movements (product_id, kind, quantity, stock_after, unit_cost_cents, sale_id, expense_id, note, created_by)
  VALUES (p_product_id, p_kind, p_qty, v_after, p_unit_cost, p_sale_id, p_expense_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  RETURN v_after;
END;
$function$;

-- Busca (o crea) a quién se le paga por nombre.
CREATE OR REPLACE FUNCTION public.erp_payee_id(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_id   UUID;
BEGIN
  IF v_name = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM expense_payees WHERE lower(name) = lower(v_name);
  IF v_id IS NULL THEN
    INSERT INTO expense_payees (name) VALUES (left(v_name, 80))
    ON CONFLICT (lower(name)) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN SELECT id INTO v_id FROM expense_payees WHERE lower(name) = lower(v_name); END IF;
  END IF;
  RETURN v_id;
END;
$function$;

-- Registra la salida de efectivo de un egreso pagado de la caja abierta.
CREATE OR REPLACE FUNCTION public.erp_expense_cash_out(p_expense_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_e   expenses%ROWTYPE;
  v_sid UUID := erp_open_session_id();
  v_mid UUID;
BEGIN
  SELECT * INTO v_e FROM expenses WHERE id = p_expense_id;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'erp: cash_closed'; END IF;
  INSERT INTO cash_movements (session_id, kind, amount_cents, note, created_by, expense_id)
  VALUES (v_sid, 'expense', v_e.amount_cents, left('Egreso #' || v_e.folio || ' · ' || v_e.description, 200), auth.uid(), v_e.id)
  RETURNING id INTO v_mid;
  UPDATE expenses SET cash_movement_id = v_mid WHERE id = v_e.id;
  RETURN v_mid;
END;
$function$;

-- Genera los egresos pendientes de los gastos recurrentes que vencen en los
-- próximos 7 días (o ya vencieron). Se llama al abrir Egresos o el Inicio.
CREATE OR REPLACE FUNCTION public.erp_generate_recurring()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_r   expense_recurring%ROWTYPE;
  v_n   INT := 0;
  v_due DATE;
  v_i   INT;
BEGIN
  FOR v_r IN SELECT * FROM expense_recurring WHERE is_active AND next_on <= erp_today() + 7 FOR UPDATE SKIP LOCKED LOOP
    v_due := v_r.next_on;
    v_i := 0;
    WHILE v_due <= erp_today() + 7 AND v_i < 36 LOOP
      INSERT INTO expenses (payee_id, description, cost_center, category, amount_cents, due_on, period_month, method, recurring_id, created_by)
      VALUES (v_r.payee_id, v_r.description, v_r.cost_center, v_r.category, v_r.amount_cents, v_due, erp_month(v_due), v_r.method, v_r.id, v_r.created_by)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
      v_due := make_date(extract(year FROM v_due + make_interval(months => v_r.every_months))::int,
                         extract(month FROM v_due + make_interval(months => v_r.every_months))::int, v_r.day_of_month);
      v_i := v_i + 1;
    END LOOP;
    UPDATE expense_recurring SET next_on = v_due, updated_at = now() WHERE id = v_r.id;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ------------------------------------------------------------
-- Ventas (versiones con inventario)
-- ------------------------------------------------------------
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
        PERFORM erp_stock_move(v_prod.id, -coalesce((v_item->>'quantity')::int, 1), 'sale', v_prod.cost_cents, v_sale_id, NULL, NULL);
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

-- p_sale: {person_id?, items:[{product_id, quantity?, discount_cents?, starts_on?, unit_price_cents? (solo si el producto vale $0 o admin)}],
--          discount_cents?, payments:[{method, amount_cents, reference?}], note?}
CREATE OR REPLACE FUNCTION public.create_sale(p_sale JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_set     erp_settings%ROWTYPE;
  v_sid     UUID := erp_open_session_id();
  v_person  UUID := nullif(p_sale->>'person_id', '')::uuid;
  v_items   JSONB := '[]'::jsonb;
  v_need    JSONB := '{}'::jsonb;       -- unidades pedidas por producto (para revisar existencia)
  v_it      JSONB;
  v_p       products%ROWTYPE;
  v_price   INT;
  v_qty     INT;
  v_pay     JSONB;
  v_result  JSONB;
  v_key     TEXT;
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
    IF v_p.track_stock THEN
      v_need := v_need || jsonb_build_object(v_p.id::text, coalesce((v_need->>v_p.id::text)::int, 0) + v_qty);
    END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_p.id, 'description', v_p.name, 'quantity', v_qty, 'unit_price_cents', v_price,
      'discount_cents', coalesce((v_it->>'discount_cents')::int, 0), 'starts_on', v_it->>'starts_on'));
  END LOOP;

  -- Existencia: se bloquean las filas para que dos ventas al mismo tiempo no vendan lo mismo.
  FOR v_key IN SELECT jsonb_object_keys(v_need) LOOP
    SELECT * INTO v_p FROM products WHERE id = v_key::uuid FOR UPDATE;
    IF NOT v_p.allow_negative_stock AND coalesce(v_p.stock, 0) < (v_need->>v_key)::int THEN
      RETURN jsonb_build_object('error', 'out_of_stock', 'product', v_p.name, 'stock', coalesce(v_p.stock, 0));
    END IF;
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
  v_s  sales%ROWTYPE;
  v_it RECORD;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_s FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_s.status = 'voided' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF v_s.source = 'subscription' THEN RETURN jsonb_build_object('error', 'subscription_sale'); END IF;
  UPDATE sales SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) WHERE id = p_sale_id;
  UPDATE memberships SET is_void = true, updated_at = now() WHERE sale_id = p_sale_id;
  -- Lo vendido regresa al inventario.
  FOR v_it IN SELECT i.product_id, i.quantity, p.cost_cents FROM sale_items i JOIN products p ON p.id = i.product_id
              WHERE i.sale_id = p_sale_id AND p.track_stock LOOP
    PERFORM erp_stock_move(v_it.product_id, v_it.quantity, 'sale_void', v_it.cost_cents, p_sale_id, NULL, 'Venta #' || v_s.folio || ' anulada');
  END LOOP;
  IF v_s.booking_id IS NOT NULL THEN
    UPDATE class_bookings SET payment_status = 'pending', paid_with = NULL, paid_at = NULL, updated_at = now()
    WHERE id = v_s.booking_id AND payment_status = 'paid';
  END IF;
  PERFORM erp_audit('sale_void', 'sale', p_sale_id, to_jsonb(v_s), jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Catálogo (con costo, mínimo e inventario inicial)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_product(p_product JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id     UUID := nullif(p_product->>'id', '')::uuid;
  v_name   TEXT := btrim(coalesce(p_product->>'name', ''));
  v_kind   TEXT := p_product->>'kind';
  v_grants BOOLEAN := coalesce((p_product->>'grants_membership')::boolean, false);
  v_rec    BOOLEAN := coalesce((p_product->>'is_recurring')::boolean, false);
  v_track  BOOLEAN := coalesce((p_product->>'track_stock')::boolean, false);
  v_init   INT;
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
    v_init := coalesce(nullif(p_product->>'stock', '')::int, 0);
    IF v_id IS NULL THEN
      INSERT INTO products (kind, name, description, price_cents, grants_membership, duration_unit, duration_value,
                            is_recurring, promo_active, promo_cycles, promo_price_cents, class_type_id, track_stock, stock,
                            cost_cents, stock_min, allow_negative_stock, sku, is_active, sort_order)
      VALUES (v_kind, v_name, nullif(btrim(coalesce(p_product->>'description', '')), ''), (p_product->>'price_cents')::int,
              v_grants OR v_rec, CASE WHEN v_grants OR v_rec THEN p_product->>'duration_unit' END,
              CASE WHEN v_grants OR v_rec THEN (p_product->>'duration_value')::int END,
              v_rec, coalesce((p_product->>'promo_active')::boolean, false), nullif(p_product->>'promo_cycles', '')::int,
              nullif(p_product->>'promo_price_cents', '')::int, nullif(p_product->>'class_type_id', '')::uuid,
              v_track, CASE WHEN v_track THEN 0 END,
              nullif(p_product->>'cost_cents', '')::int, nullif(p_product->>'stock_min', '')::int,
              coalesce((p_product->>'allow_negative_stock')::boolean, false), nullif(btrim(coalesce(p_product->>'sku', '')), ''),
              coalesce((p_product->>'is_active')::boolean, true), coalesce((p_product->>'sort_order')::int, 0))
      RETURNING id INTO v_id;
      IF v_track AND v_init <> 0 THEN
        PERFORM erp_stock_move(v_id, v_init, 'initial', nullif(p_product->>'cost_cents', '')::int, NULL, NULL, 'Existencia inicial');
      END IF;
    ELSE
      SELECT * INTO v_before FROM products WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
      -- No se puede cambiar si cobra recurrente un producto que ya tiene domiciliaciones.
      IF v_before.is_recurring <> v_rec AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.product_id = v_id) THEN
        RETURN jsonb_build_object('error', 'has_subscriptions');
      END IF;
      -- La existencia NO se edita aquí: solo cambia con entradas, ventas y ajustes (Inventario).
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
        track_stock = v_track,
        stock = CASE WHEN v_track THEN coalesce(stock, 0) ELSE stock END,
        cost_cents = nullif(p_product->>'cost_cents', '')::int,
        stock_min = nullif(p_product->>'stock_min', '')::int,
        allow_negative_stock = coalesce((p_product->>'allow_negative_stock')::boolean, false),
        sku = nullif(btrim(coalesce(p_product->>'sku', '')), ''),
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
-- Inventario
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inventory()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_admin BOOLEAN := class_is_admin();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'is_admin', v_admin,
    'products', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'sku', p.sku, 'price_cents', p.price_cents, 'track_stock', p.track_stock,
        'stock', p.stock, 'stock_min', p.stock_min, 'allow_negative_stock', p.allow_negative_stock, 'is_active', p.is_active,
        'cost_cents', CASE WHEN v_admin THEN p.cost_cents END,
        'sold_30d', coalesce((SELECT -sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.kind IN ('sale','sale_void')
                              AND m.created_at >= now() - INTERVAL '30 days'), 0),
        'last_movement_at', (SELECT max(m.created_at) FROM stock_movements m WHERE m.product_id = p.id))
      ORDER BY p.is_active DESC, p.name) FROM products p WHERE p.kind = 'product' OR p.track_stock), '[]'::jsonb),
    'value_cents', CASE WHEN v_admin THEN (SELECT coalesce(sum(greatest(stock, 0) * coalesce(cost_cents, 0)), 0) FROM products WHERE track_stock AND is_active) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_movements(p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('movements', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'stock_after', m.stock_after, 'note', m.note, 'created_at', m.created_at,
      'unit_cost_cents', CASE WHEN class_is_admin() THEN m.unit_cost_cents END,
      'by', (SELECT name FROM profiles WHERE id = m.created_by),
      'sale_folio', (SELECT folio FROM sales WHERE id = m.sale_id),
      'expense_folio', (SELECT folio FROM expenses WHERE id = m.expense_id))
    ORDER BY m.created_at DESC)
    FROM (SELECT * FROM stock_movements WHERE product_id = p_product_id ORDER BY created_at DESC LIMIT 200) m), '[]'::jsonb));
END;
$function$;

-- Entrada de mercancía. p: {product_id, quantity>0, unit_cost_cents?, note?,
--   expense?: {payee_name?, paid: bool, method?, paid_from?, due_on?}}  (el egreso solo lo registra un admin)
CREATE OR REPLACE FUNCTION public.stock_entry(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p    products%ROWTYPE;
  v_qty  INT;
  v_cost INT := nullif(p->>'unit_cost_cents', '')::int;
  v_exp  JSONB := p->'expense';
  v_eid  UUID;
  v_res  JSONB;
  v_after INT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_p FROM products WHERE id = nullif(p->>'product_id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT v_p.track_stock THEN RETURN jsonb_build_object('error', 'not_tracked'); END IF;
  v_qty := nullif(p->>'quantity', '')::int;
  IF v_qty IS NULL OR v_qty < 1 OR v_qty > 100000 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF v_cost IS NOT NULL AND v_cost < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF v_exp IS NOT NULL AND jsonb_typeof(v_exp) = 'object' THEN
    IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
    IF coalesce(v_cost, 0) <= 0 THEN RETURN jsonb_build_object('error', 'cost_required'); END IF;
    v_res := erp_create_expense(jsonb_build_object(
      'payee_name', v_exp->>'payee_name', 'description', 'Compra: ' || v_p.name || ' ×' || v_qty,
      'cost_center', coalesce((SELECT cc FROM unnest((SELECT expense_cost_centers FROM erp_settings WHERE id = 1)) cc
                               WHERE cc ILIKE '%compra%' LIMIT 1), 'Compra de productos'),
      'category', 'Inventario', 'amount_cents', v_cost * v_qty,
      'due_on', coalesce(nullif(v_exp->>'due_on', ''), erp_today()::text),
      'pay_now', coalesce((v_exp->>'paid')::boolean, true), 'method', v_exp->>'method', 'paid_from', v_exp->>'paid_from'));
    IF v_res ? 'error' THEN RETURN v_res; END IF;
    v_eid := (v_res->>'id')::uuid;
  END IF;
  v_after := erp_stock_move(v_p.id, v_qty, 'purchase', v_cost, NULL, v_eid, p->>'note');
  IF v_cost IS NOT NULL AND v_cost > 0 THEN UPDATE products SET cost_cents = v_cost WHERE id = v_p.id; END IF;
  RETURN jsonb_build_object('success', true, 'stock', v_after, 'expense_id', v_eid);
END;
$function$;

-- Conteo físico: deja la existencia en lo contado (la diferencia queda registrada).
CREATE OR REPLACE FUNCTION public.stock_count(p_product_id UUID, p_counted INT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p products%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  SELECT * INTO v_p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT v_p.track_stock THEN RETURN jsonb_build_object('error', 'not_tracked'); END IF;
  IF p_counted = coalesce(v_p.stock, 0) THEN RETURN jsonb_build_object('success', true, 'stock', p_counted, 'difference', 0); END IF;
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  PERFORM erp_stock_move(v_p.id, p_counted - coalesce(v_p.stock, 0), 'adjust', v_p.cost_cents, NULL, NULL, p_note);
  RETURN jsonb_build_object('success', true, 'stock', p_counted, 'difference', p_counted - coalesce(v_p.stock, 0));
END;
$function$;

-- Salida sin venta: consumo (staff, cortesía, uso interno) o merma (caducó, se rompió).
CREATE OR REPLACE FUNCTION public.stock_out(p_product_id UUID, p_quantity INT, p_kind TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p products%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_kind NOT IN ('consumption','adjust') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_p FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT v_p.track_stock THEN RETURN jsonb_build_object('error', 'not_tracked'); END IF;
  RETURN jsonb_build_object('success', true,
    'stock', erp_stock_move(v_p.id, -p_quantity, p_kind, v_p.cost_cents, NULL, NULL, p_note));
END;
$function$;

-- ------------------------------------------------------------
-- Egresos
-- ------------------------------------------------------------
-- Crea un egreso (interno: valida y, si se paga de la caja, saca el efectivo).
-- p: {payee_id? | payee_name?, description, cost_center, category?, amount_cents, due_on, period_month?,
--     pay_now?, paid_on?, method?, paid_from?, invoice_ref?, notes?, recurring_id?}
CREATE OR REPLACE FUNCTION public.erp_create_expense(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id    UUID;
  v_payee UUID := coalesce(nullif(p->>'payee_id', '')::uuid, erp_payee_id(p->>'payee_name'));
  v_desc  TEXT := btrim(coalesce(p->>'description', ''));
  v_cc    TEXT := btrim(coalesce(p->>'cost_center', ''));
  v_amt   INT;
  v_due   DATE;
  v_pay   BOOLEAN := coalesce((p->>'pay_now')::boolean, false);
  v_from  TEXT := coalesce(nullif(p->>'paid_from', ''), 'bank');
BEGIN
  BEGIN
    v_amt := nullif(p->>'amount_cents', '')::int;
    v_due := coalesce(nullif(p->>'due_on', '')::date, erp_today());
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  IF length(v_desc) < 2 THEN RETURN jsonb_build_object('error', 'description_required'); END IF;
  IF v_cc = '' THEN RETURN jsonb_build_object('error', 'cost_center_required'); END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF v_pay AND coalesce(p->>'method', '') NOT IN ('cash','card','transfer','other') THEN RETURN jsonb_build_object('error', 'invalid_payment'); END IF;
  IF v_pay AND v_from NOT IN ('cash_register','bank','other') THEN RETURN jsonb_build_object('error', 'invalid_payment'); END IF;
  IF v_pay AND v_from = 'cash_register' AND erp_open_session_id() IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  INSERT INTO expenses (payee_id, description, cost_center, category, amount_cents, due_on, period_month, status, paid_on, method, paid_from,
                        invoice_ref, notes, recurring_id, created_by)
  VALUES (v_payee, left(v_desc, 200), left(v_cc, 60), nullif(left(btrim(coalesce(p->>'category', '')), 60), ''), v_amt, v_due,
          erp_month(coalesce(nullif(p->>'period_month', '')::date, v_due)),
          CASE WHEN v_pay THEN 'paid' ELSE 'pending' END,
          CASE WHEN v_pay THEN coalesce(nullif(p->>'paid_on', '')::date, erp_today()) END,
          CASE WHEN v_pay THEN p->>'method' ELSE nullif(p->>'method', '') END,
          CASE WHEN v_pay THEN v_from END,
          nullif(left(btrim(coalesce(p->>'invoice_ref', '')), 60), ''), nullif(btrim(coalesce(p->>'notes', '')), ''),
          nullif(p->>'recurring_id', '')::uuid, auth.uid())
  RETURNING id INTO v_id;
  IF v_pay AND v_from = 'cash_register' THEN PERFORM erp_expense_cash_out(v_id); END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'folio', (SELECT folio FROM expenses WHERE id = v_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_expenses(p_month DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_m DATE := erp_month(coalesce(p_month, erp_today()));
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_generate_recurring();
  RETURN jsonb_build_object(
    'month', v_m,
    'today', erp_today(),
    'cost_centers', (SELECT to_jsonb(expense_cost_centers) FROM erp_settings WHERE id = 1),
    'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'folio', e.folio, 'payee_id', e.payee_id, 'payee_name', y.name, 'payee_kind', y.kind,
        'description', e.description, 'cost_center', e.cost_center, 'category', e.category, 'amount_cents', e.amount_cents,
        'due_on', e.due_on, 'period_month', e.period_month, 'status', e.status, 'paid_on', e.paid_on, 'method', e.method,
        'paid_from', e.paid_from, 'invoice_ref', e.invoice_ref, 'notes', e.notes, 'recurring_id', e.recurring_id,
        'cancel_reason', e.cancel_reason, 'created_by_name', (SELECT name FROM profiles WHERE id = e.created_by),
        'from_cash', e.cash_movement_id IS NOT NULL,
        'stock', (SELECT jsonb_build_object('product', pr.name, 'quantity', m.quantity) FROM stock_movements m JOIN products pr ON pr.id = m.product_id
                  WHERE m.expense_id = e.id LIMIT 1))
      ORDER BY e.due_on, e.folio)
      FROM expenses e LEFT JOIN expense_payees y ON y.id = e.payee_id
      -- El mes elegido + lo pendiente de meses anteriores (para que no se olvide).
      WHERE e.period_month = v_m OR (e.status = 'pending' AND e.period_month < v_m)), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
        'paid', coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0),
        'pending', coalesce(sum(amount_cents) FILTER (WHERE status = 'pending'), 0),
        'overdue', coalesce(sum(amount_cents) FILTER (WHERE status = 'pending' AND due_on < erp_today()), 0))
      FROM expenses WHERE period_month = v_m),
    'by_cost_center', coalesce((SELECT jsonb_agg(jsonb_build_object('cost_center', cost_center, 'cents', cents) ORDER BY cents DESC) FROM (
        SELECT cost_center, sum(amount_cents)::int AS cents FROM expenses WHERE period_month = v_m AND status <> 'cancelled' GROUP BY 1) x), '[]'::jsonb),
    'sales_cents', coalesce((SELECT sum(total_cents) FROM sales WHERE status = 'completed'
                             AND erp_month((created_at AT TIME ZONE 'America/Mexico_City')::date) = v_m), 0),
    'payees', coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.name) FROM expense_payees y), '[]'::jsonb),
    'categories', coalesce((SELECT jsonb_agg(c ORDER BY c) FROM (SELECT DISTINCT category AS c FROM expenses WHERE category IS NOT NULL) x), '[]'::jsonb),
    'recurring', coalesce((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('payee_name', y.name) ORDER BY r.is_active DESC, r.day_of_month)
                           FROM expense_recurring r LEFT JOIN expense_payees y ON y.id = r.payee_id), '[]'::jsonb)
  );
END;
$function$;

-- Crear o editar. Al crear con repeat: {every_months, day_of_month} queda también como gasto recurrente.
CREATE OR REPLACE FUNCTION public.admin_save_expense(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id     UUID := nullif(p->>'id', '')::uuid;
  v_e      expenses%ROWTYPE;
  v_res    JSONB;
  v_rid    UUID;
  v_every  INT;
  v_day    INT;
  v_due    DATE;
  v_amt    INT;
  v_payee  UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_id IS NULL THEN
    v_res := erp_create_expense(p);
    IF v_res ? 'error' THEN RETURN v_res; END IF;
    v_id := (v_res->>'id')::uuid;
    IF p->'repeat' IS NOT NULL AND jsonb_typeof(p->'repeat') = 'object' THEN
      SELECT * INTO v_e FROM expenses WHERE id = v_id;
      v_every := coalesce(nullif(p->'repeat'->>'every_months', '')::int, 1);
      v_day := least(28, coalesce(nullif(p->'repeat'->>'day_of_month', '')::int, extract(day FROM v_e.due_on)::int));
      IF v_every NOT BETWEEN 1 AND 12 OR v_day NOT BETWEEN 1 AND 28 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
      v_due := v_e.due_on + make_interval(months => v_every);
      INSERT INTO expense_recurring (payee_id, description, cost_center, category, amount_cents, method, every_months, day_of_month, next_on, created_by)
      VALUES (v_e.payee_id, v_e.description, v_e.cost_center, v_e.category, v_e.amount_cents, v_e.method, v_every, v_day,
              make_date(extract(year FROM v_due)::int, extract(month FROM v_due)::int, v_day), auth.uid())
      RETURNING id INTO v_rid;
      UPDATE expenses SET recurring_id = v_rid WHERE id = v_id;
    END IF;
    PERFORM erp_audit('expense_create', 'expense', v_id, NULL, p);
    RETURN v_res || jsonb_build_object('recurring_id', v_rid);
  END IF;

  SELECT * INTO v_e FROM expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_e.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  BEGIN
    v_amt := coalesce(nullif(p->>'amount_cents', '')::int, v_e.amount_cents);
  EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('error', 'invalid_value');
  END;
  IF v_amt <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  -- El efectivo ya salió de la caja: el monto no se cambia (cancela y captura de nuevo).
  IF v_e.cash_movement_id IS NOT NULL AND v_amt <> v_e.amount_cents THEN RETURN jsonb_build_object('error', 'paid_from_cash_locked'); END IF;
  IF length(btrim(coalesce(p->>'description', v_e.description))) < 2 THEN RETURN jsonb_build_object('error', 'description_required'); END IF;
  IF btrim(coalesce(p->>'cost_center', v_e.cost_center)) = '' THEN RETURN jsonb_build_object('error', 'cost_center_required'); END IF;
  v_payee := CASE WHEN p ? 'payee_name' THEN erp_payee_id(p->>'payee_name') WHEN p ? 'payee_id' THEN nullif(p->>'payee_id', '')::uuid ELSE v_e.payee_id END;
  BEGIN
    UPDATE expenses SET
      payee_id = v_payee,
      description = left(btrim(coalesce(p->>'description', description)), 200),
      cost_center = left(btrim(coalesce(p->>'cost_center', cost_center)), 60),
      category = CASE WHEN p ? 'category' THEN nullif(left(btrim(coalesce(p->>'category', '')), 60), '') ELSE category END,
      amount_cents = v_amt,
      due_on = coalesce(nullif(p->>'due_on', '')::date, due_on),
      period_month = erp_month(coalesce(nullif(p->>'period_month', '')::date, period_month)),
      paid_on = CASE WHEN status = 'paid' THEN coalesce(nullif(p->>'paid_on', '')::date, paid_on) END,
      invoice_ref = CASE WHEN p ? 'invoice_ref' THEN nullif(left(btrim(coalesce(p->>'invoice_ref', '')), 60), '') ELSE invoice_ref END,
      notes = CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE notes END,
      updated_at = now()
    WHERE id = v_id;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  PERFORM erp_audit('expense_update', 'expense', v_id, to_jsonb(v_e), p);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pay_expense(p_expense_id UUID, p_paid_on DATE, p_method TEXT, p_paid_from TEXT, p_invoice_ref TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_e expenses%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(p_method, '') NOT IN ('cash','card','transfer','other') OR coalesce(p_paid_from, '') NOT IN ('cash_register','bank','other') THEN
    RETURN jsonb_build_object('error', 'invalid_payment');
  END IF;
  SELECT * INTO v_e FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_e.status <> 'pending' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF p_paid_from = 'cash_register' AND erp_open_session_id() IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  UPDATE expenses SET status = 'paid', paid_on = coalesce(p_paid_on, erp_today()), method = p_method, paid_from = p_paid_from,
    invoice_ref = coalesce(nullif(btrim(coalesce(p_invoice_ref, '')), ''), invoice_ref), updated_at = now()
  WHERE id = p_expense_id;
  IF p_paid_from = 'cash_register' THEN PERFORM erp_expense_cash_out(p_expense_id); END IF;
  PERFORM erp_audit('expense_pay', 'expense', p_expense_id, NULL, jsonb_build_object('method', p_method, 'paid_from', p_paid_from));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Cancelar: un pendiente (ej. "este mes no se paga") o uno capturado por error.
-- Si salió de la caja y esa caja sigue abierta, el efectivo regresa a la caja.
CREATE OR REPLACE FUNCTION public.admin_cancel_expense(p_expense_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_e   expenses%ROWTYPE;
  v_sid UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_e FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_e.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF v_e.cash_movement_id IS NOT NULL THEN
    SELECT m.session_id INTO v_sid FROM cash_movements m JOIN cash_sessions s ON s.id = m.session_id
    WHERE m.id = v_e.cash_movement_id AND s.closed_at IS NULL;
    IF v_sid IS NULL THEN RETURN jsonb_build_object('error', 'cash_session_closed'); END IF;
    UPDATE expenses SET cash_movement_id = NULL WHERE id = p_expense_id;
    DELETE FROM cash_movements WHERE id = v_e.cash_movement_id;
  END IF;
  UPDATE expenses SET status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() WHERE id = p_expense_id;
  PERFORM erp_audit('expense_cancel', 'expense', p_expense_id, to_jsonb(v_e), jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Gasto recurrente: editar, pausar (is_active=false) o crear. p: {id?, payee_name?, description, cost_center,
-- category?, amount_cents, method?, every_months, day_of_month, next_on?, is_active?}
CREATE OR REPLACE FUNCTION public.admin_save_recurring(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id    UUID := nullif(p->>'id', '')::uuid;
  v_day   INT;
  v_every INT;
  v_next  DATE;
  v_t     DATE := erp_today();
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  BEGIN
    v_day := nullif(p->>'day_of_month', '')::int;
    v_every := coalesce(nullif(p->>'every_months', '')::int, 1);
    v_next := nullif(p->>'next_on', '')::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN jsonb_build_object('error', 'invalid_value');
  END;
  IF v_day IS NULL OR v_day NOT BETWEEN 1 AND 28 OR v_every NOT BETWEEN 1 AND 12 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF length(btrim(coalesce(p->>'description', ''))) < 2 THEN RETURN jsonb_build_object('error', 'description_required'); END IF;
  IF btrim(coalesce(p->>'cost_center', '')) = '' THEN RETURN jsonb_build_object('error', 'cost_center_required'); END IF;
  IF coalesce(nullif(p->>'amount_cents', '')::int, 0) <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  -- Próximo vencimiento por defecto: ese día de este mes, o del siguiente si ya pasó.
  IF v_next IS NULL THEN
    v_next := make_date(extract(year FROM v_t)::int, extract(month FROM v_t)::int, v_day);
    IF v_next < v_t THEN v_next := (v_next + INTERVAL '1 month')::date; END IF;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO expense_recurring (payee_id, description, cost_center, category, amount_cents, method, every_months, day_of_month, next_on, is_active, created_by)
    VALUES (erp_payee_id(p->>'payee_name'), left(btrim(p->>'description'), 200), left(btrim(p->>'cost_center'), 60),
            nullif(left(btrim(coalesce(p->>'category', '')), 60), ''), (p->>'amount_cents')::int,
            nullif(p->>'method', ''), v_every, v_day, v_next, coalesce((p->>'is_active')::boolean, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE expense_recurring SET payee_id = erp_payee_id(p->>'payee_name'), description = left(btrim(p->>'description'), 200),
      cost_center = left(btrim(p->>'cost_center'), 60), category = nullif(left(btrim(coalesce(p->>'category', '')), 60), ''),
      amount_cents = (p->>'amount_cents')::int, method = nullif(p->>'method', ''), every_months = v_every, day_of_month = v_day,
      next_on = CASE WHEN p ? 'next_on' AND nullif(p->>'next_on', '') IS NOT NULL THEN v_next
                     ELSE make_date(extract(year FROM next_on)::int, extract(month FROM next_on)::int, v_day) END,
      is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  END IF;
  PERFORM erp_audit('expense_recurring_save', 'expense_recurring', v_id, NULL, p);
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RETURN jsonb_build_object('error', 'invalid_value');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_payee(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id   UUID := nullif(p->>'id', '')::uuid;
  v_name TEXT := btrim(coalesce(p->>'name', ''));
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF coalesce(p->>'kind', 'supplier') NOT IN ('supplier','employee','government','other') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF EXISTS (SELECT 1 FROM expense_payees WHERE lower(name) = lower(v_name) AND id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'name_taken');
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO expense_payees (name, kind, default_cost_center, default_category, phone, notes)
    VALUES (v_name, coalesce(p->>'kind', 'supplier'), nullif(btrim(coalesce(p->>'default_cost_center', '')), ''),
            nullif(btrim(coalesce(p->>'default_category', '')), ''), nullif(btrim(coalesce(p->>'phone', '')), ''), nullif(btrim(coalesce(p->>'notes', '')), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE expense_payees SET name = v_name, kind = coalesce(p->>'kind', kind),
      default_cost_center = nullif(btrim(coalesce(p->>'default_cost_center', '')), ''),
      default_category = nullif(btrim(coalesce(p->>'default_category', '')), ''),
      phone = nullif(btrim(coalesce(p->>'phone', '')), ''), notes = nullif(btrim(coalesce(p->>'notes', '')), ''),
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_cost_centers(p_centers TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_clean TEXT[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT array_agg(DISTINCT left(btrim(c), 60)) INTO v_clean FROM unnest(p_centers) c WHERE btrim(coalesce(c, '')) <> '';
  IF v_clean IS NULL OR array_length(v_clean, 1) > 20 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  UPDATE erp_settings SET expense_cost_centers = v_clean, updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Caja: un gasto pagado con la caja también queda en Egresos.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.add_cash_movement(text, integer, text);
CREATE OR REPLACE FUNCTION public.add_cash_movement(p_kind TEXT, p_amount_cents INT, p_note TEXT, p_cost_center TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sid UUID := erp_open_session_id();
  v_mid UUID;
  v_eid UUID;
  v_cc  TEXT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_sid IS NULL THEN RETURN jsonb_build_object('error', 'cash_closed'); END IF;
  IF p_kind NOT IN ('withdrawal','expense','deposit') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  INSERT INTO cash_movements (session_id, kind, amount_cents, note, created_by) VALUES (v_sid, p_kind, p_amount_cents, btrim(p_note), auth.uid())
  RETURNING id INTO v_mid;
  IF p_kind = 'expense' THEN
    SELECT coalesce(nullif(btrim(coalesce(p_cost_center, '')), ''),
                    (SELECT cc FROM unnest(expense_cost_centers) cc WHERE cc ILIKE '%variable%' LIMIT 1),
                    expense_cost_centers[1], 'Gastos variables')
      INTO v_cc FROM erp_settings WHERE id = 1;
    INSERT INTO expenses (description, cost_center, amount_cents, due_on, period_month, status, paid_on, method, paid_from, cash_movement_id, created_by)
    VALUES (left(btrim(p_note), 200), v_cc, p_amount_cents, erp_today(), erp_month(erp_today()), 'paid', erp_today(), 'cash', 'cash_register', v_mid, auth.uid())
    RETURNING id INTO v_eid;
    UPDATE cash_movements SET expense_id = v_eid WHERE id = v_mid;
  END IF;
  RETURN jsonb_build_object('success', true, 'expense_id', v_eid);
END;
$function$;

-- ------------------------------------------------------------
-- Reporte del mes: ventas + egresos + utilidad
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_report(p_month DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_from  DATE := date_trunc('month', p_month)::date;
  v_to    DATE := (date_trunc('month', p_month) + INTERVAL '1 month - 1 day')::date;
  v_total INT;
  v_exp   INT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  v_total := coalesce((SELECT sum(total_cents) FROM sales WHERE status = 'completed'
                       AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to), 0);
  v_exp := coalesce((SELECT sum(amount_cents) FROM expenses WHERE period_month = v_from AND status <> 'cancelled'), 0);
  RETURN jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total_cents', v_total,
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
        FROM cash_sessions WHERE business_date BETWEEN v_from AND v_to), '[]'::jsonb),
    -- Egresos y utilidad: solo admin.
    'expenses', CASE WHEN class_is_admin() THEN jsonb_build_object(
        'total_cents', v_exp,
        'paid_cents', coalesce((SELECT sum(amount_cents) FROM expenses WHERE period_month = v_from AND status = 'paid'), 0),
        'pending_cents', coalesce((SELECT sum(amount_cents) FROM expenses WHERE period_month = v_from AND status = 'pending'), 0),
        'by_cost_center', coalesce((SELECT jsonb_agg(jsonb_build_object('cost_center', cost_center, 'cents', cents) ORDER BY cents DESC) FROM (
            SELECT cost_center, sum(amount_cents)::int AS cents FROM expenses WHERE period_month = v_from AND status <> 'cancelled' GROUP BY 1) x), '[]'::jsonb),
        'items', coalesce((SELECT jsonb_agg(jsonb_build_object('folio', e.folio, 'due_on', e.due_on, 'paid_on', e.paid_on, 'payee', y.name,
            'description', e.description, 'cost_center', e.cost_center, 'category', e.category, 'amount_cents', e.amount_cents,
            'status', e.status, 'method', e.method, 'invoice_ref', e.invoice_ref) ORDER BY e.due_on, e.folio)
            FROM expenses e LEFT JOIN expense_payees y ON y.id = e.payee_id WHERE e.period_month = v_from AND e.status <> 'cancelled'), '[]'::jsonb),
        'profit_cents', v_total - v_exp) END
  );
END;
$function$;

-- ------------------------------------------------------------
-- Inicio (redefinido: + poco inventario y pagos por vencer)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_staff_dashboard()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
  v_days  INT := (SELECT expiring_notice_days FROM erp_settings WHERE id = 1);
  v_admin BOOLEAN := class_is_admin();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM class_generate_sessions(class_horizon());
  IF v_admin THEN PERFORM erp_generate_recurring(); END IF;
  RETURN jsonb_build_object(
    'today', v_today,
    'is_admin', v_admin,
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
    'new_people_week', (SELECT count(*) FROM people WHERE created_at >= now() - INTERVAL '7 days'),
    'low_stock', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', coalesce(stock, 0), 'stock_min', stock_min) ORDER BY coalesce(stock, 0), name)
                  FROM products WHERE track_stock AND is_active AND coalesce(stock, 0) <= coalesce(stock_min, 0)), '[]'::jsonb),
    'expenses_due', CASE WHEN v_admin THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'description', e.description, 'payee', y.name,
                  'amount_cents', e.amount_cents, 'due_on', e.due_on) ORDER BY e.due_on)
                  FROM expenses e LEFT JOIN expense_payees y ON y.id = e.payee_id
                  WHERE e.status = 'pending' AND e.due_on <= v_today + 3), '[]'::jsonb) END
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
    'erp_month(date)', 'erp_stock_move(uuid,integer,text,integer,uuid,uuid,text)', 'erp_payee_id(text)',
    'erp_expense_cash_out(uuid)', 'erp_generate_recurring()', 'erp_create_expense(jsonb)',
    'erp_insert_sale(uuid,text,jsonb,jsonb,integer,text,uuid,uuid,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Staff / admin (validan rol por dentro).
  FOREACH f IN ARRAY ARRAY[
    'create_sale(jsonb)', 'admin_void_sale(uuid,text)', 'admin_save_product(jsonb)',
    'add_cash_movement(text,integer,text,text)', 'get_sales_report(date)', 'get_staff_dashboard()',
    'get_inventory()', 'get_stock_movements(uuid)', 'stock_entry(jsonb)', 'stock_count(uuid,integer,text)',
    'stock_out(uuid,integer,text,text)', 'get_expenses(date)', 'admin_save_expense(jsonb)',
    'admin_pay_expense(uuid,date,text,text,text)', 'admin_cancel_expense(uuid,text)', 'admin_save_recurring(jsonb)',
    'admin_save_payee(jsonb)', 'admin_set_cost_centers(text[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END;
$grants$;
