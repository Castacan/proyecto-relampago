-- ============================================================
-- Inventario: mejoras tomando como referencia EVO (2026-10-26).
-- Requiere erp_finanzas.sql (córrelo DESPUÉS). Idempotente.
--
--   · Categoría y "producto para venta / para consumo" (lo de consumo interno
--     —limpieza, papel, magnesia del gym— no aparece en Vender).
--   · Merma separada del ajuste por conteo.
--   · Fecha del movimiento (como en EVO, se puede registrar con otra fecha).
--   · Entrada de varios productos a la vez (un pedido, un solo egreso).
--   · Reporte general de movimientos con totales.
--   · Reajuste de precios en bloque ($ o %), como "Reajuste de valores" de EVO.
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS for_sale BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS occurred_on DATE;
UPDATE public.stock_movements SET occurred_on = (created_at AT TIME ZONE 'America/Mexico_City')::date WHERE occurred_on IS NULL;
ALTER TABLE public.stock_movements ALTER COLUMN occurred_on SET DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date);
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('initial','purchase','sale','sale_void','adjust','consumption','waste'));

CREATE INDEX IF NOT EXISTS stock_movements_date_idx ON public.stock_movements (occurred_on DESC);

-- Fecha opcional de un movimiento manual: no a futuro ni de hace más de 1 año.
CREATE OR REPLACE FUNCTION public.erp_stock_date(p TEXT)
RETURNS DATE LANGUAGE plpgsql STABLE AS $function$
DECLARE
  v DATE := coalesce(nullif(p, '')::date, erp_today());
BEGIN
  IF v > erp_today() OR v < erp_today() - 366 THEN RAISE EXCEPTION 'invalid_date'; END IF;
  RETURN v;
END;
$function$;

-- Datos extra del producto (categoría, para venta).
CREATE OR REPLACE FUNCTION public.admin_set_product_extras(p_product_id UUID, p_category TEXT, p_for_sale BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE products SET category = nullif(btrim(coalesce(p_category, '')), ''), for_sale = coalesce(p_for_sale, true), updated_at = now()
  WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Salida sin venta (redefinida): consumo, merma o ajuste, con fecha opcional.
CREATE OR REPLACE FUNCTION public.stock_out_v2(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_p products%ROWTYPE;
  v_qty INT := nullif(p->>'quantity', '')::int;
  v_kind TEXT := p->>'kind';
  v_date DATE;
  v_after INT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_kind NOT IN ('consumption','waste') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF v_qty IS NULL OR v_qty < 1 OR v_qty > 100000 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF length(btrim(coalesce(p->>'note', ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  BEGIN v_date := erp_stock_date(p->>'occurred_on'); EXCEPTION WHEN others THEN RETURN jsonb_build_object('error', 'invalid_date'); END;
  SELECT * INTO v_p FROM products WHERE id = nullif(p->>'product_id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT v_p.track_stock THEN RETURN jsonb_build_object('error', 'not_tracked'); END IF;
  IF NOT v_p.allow_negative_stock AND coalesce(v_p.stock, 0) < v_qty THEN
    RETURN jsonb_build_object('error', 'out_of_stock', 'product', v_p.name, 'stock', coalesce(v_p.stock, 0));
  END IF;
  v_after := erp_stock_move(v_p.id, -v_qty, v_kind, v_p.cost_cents, NULL, NULL, btrim(p->>'note'));
  UPDATE stock_movements SET occurred_on = v_date
   WHERE product_id = v_p.id AND kind = v_kind AND created_at = now();
  RETURN jsonb_build_object('success', true, 'stock', v_after);
END;
$function$;

-- Entrada de un pedido con varios productos.
-- p: {items: [{product_id, quantity, unit_cost_cents?}], note?, occurred_on?,
--     expense?: {payee_name?, paid, method?, paid_from?, due_on?}}  (el egreso solo lo registra un admin)
CREATE OR REPLACE FUNCTION public.stock_entry_batch(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_item JSONB;
  v_p products%ROWTYPE;
  v_qty INT;
  v_cost INT;
  v_total BIGINT := 0;
  v_names TEXT[] := '{}';
  v_batch UUID := gen_random_uuid();
  v_date DATE;
  v_exp JSONB := p->'expense';
  v_res JSONB;
  v_eid UUID;
  v_n INT := 0;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF jsonb_typeof(p->'items') <> 'array' OR jsonb_array_length(p->'items') = 0 THEN RETURN jsonb_build_object('error', 'items_required'); END IF;
  IF v_exp IS NOT NULL AND jsonb_typeof(v_exp) = 'object' AND NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  BEGIN v_date := erp_stock_date(p->>'occurred_on'); EXCEPTION WHEN others THEN RETURN jsonb_build_object('error', 'invalid_date'); END;
  -- Validar todo antes de mover nada.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    SELECT * INTO v_p FROM products WHERE id = nullif(v_item->>'product_id', '')::uuid;
    IF NOT FOUND OR NOT v_p.track_stock THEN RETURN jsonb_build_object('error', 'not_tracked', 'product', v_p.name); END IF;
    v_qty := nullif(v_item->>'quantity', '')::int;
    v_cost := nullif(v_item->>'unit_cost_cents', '')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 100000 OR (v_cost IS NOT NULL AND v_cost < 0) THEN
      RETURN jsonb_build_object('error', 'invalid_amount', 'product', v_p.name);
    END IF;
    v_total := v_total + v_qty::bigint * coalesce(v_cost, v_p.cost_cents, 0);
    v_names := v_names || (v_p.name || ' ×' || v_qty);
  END LOOP;
  IF v_exp IS NOT NULL AND jsonb_typeof(v_exp) = 'object' THEN
    IF v_total <= 0 THEN RETURN jsonb_build_object('error', 'cost_required'); END IF;
    v_res := erp_create_expense(jsonb_build_object(
      'payee_name', v_exp->>'payee_name', 'description', left('Compra: ' || array_to_string(v_names, ', '), 300),
      'cost_center', coalesce((SELECT cc FROM unnest((SELECT expense_cost_centers FROM erp_settings WHERE id = 1)) cc
                               WHERE cc ILIKE '%compra%' LIMIT 1), 'Compra de productos'),
      'category', 'Inventario', 'amount_cents', v_total,
      'due_on', coalesce(nullif(v_exp->>'due_on', ''), v_date::text),
      'pay_now', coalesce((v_exp->>'paid')::boolean, true), 'method', v_exp->>'method', 'paid_from', v_exp->>'paid_from'));
    IF v_res ? 'error' THEN RETURN v_res; END IF;
    v_eid := (v_res->>'id')::uuid;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    SELECT * INTO v_p FROM products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    v_qty := (v_item->>'quantity')::int;
    v_cost := nullif(v_item->>'unit_cost_cents', '')::int;
    PERFORM erp_stock_move(v_p.id, v_qty, 'purchase', coalesce(v_cost, v_p.cost_cents), NULL, v_eid, nullif(btrim(coalesce(p->>'note', '')), ''));
    UPDATE stock_movements SET occurred_on = v_date, batch_id = v_batch
     WHERE product_id = v_p.id AND kind = 'purchase' AND created_at = now() AND batch_id IS NULL;
    IF v_cost IS NOT NULL AND v_cost > 0 THEN UPDATE products SET cost_cents = v_cost WHERE id = v_p.id; END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'items', v_n, 'total_cents', v_total, 'expense_id', v_eid, 'batch_id', v_batch);
END;
$function$;

-- Todos los movimientos en un rango, con totales por tipo. El costo solo lo ve el admin.
CREATE OR REPLACE FUNCTION public.get_stock_report(p_from DATE, p_to DATE, p_kind TEXT DEFAULT NULL, p_product_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_admin BOOLEAN := class_is_admin();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'is_admin', v_admin,
    'movements', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'occurred_on', m.occurred_on, 'created_at', m.created_at, 'kind', m.kind, 'quantity', m.quantity, 'stock_after', m.stock_after,
        'product_id', m.product_id, 'product', pr.name, 'category', pr.category, 'note', m.note,
        'unit_cost_cents', CASE WHEN v_admin THEN m.unit_cost_cents END,
        'by', (SELECT name FROM profiles WHERE id = m.created_by),
        'sale_folio', (SELECT folio FROM sales WHERE id = m.sale_id),
        'expense_folio', (SELECT folio FROM expenses WHERE id = m.expense_id))
        ORDER BY m.occurred_on DESC, m.created_at DESC)
      FROM (SELECT * FROM stock_movements
            WHERE occurred_on BETWEEN p_from AND p_to
              AND (p_kind IS NULL OR kind = p_kind) AND (p_product_id IS NULL OR product_id = p_product_id)
            ORDER BY occurred_on DESC, created_at DESC LIMIT 2000) m
      JOIN products pr ON pr.id = m.product_id), '[]'::jsonb),
    'totals', coalesce((
      SELECT jsonb_object_agg(kind, jsonb_build_object('quantity', q, 'cost_cents', CASE WHEN v_admin THEN c END))
      FROM (SELECT kind, sum(quantity) AS q, sum(abs(quantity) * coalesce(unit_cost_cents, 0)) AS c
            FROM stock_movements
            WHERE occurred_on BETWEEN p_from AND p_to AND (p_product_id IS NULL OR product_id = p_product_id)
            GROUP BY kind) t), '{}'::jsonb)
  );
END;
$function$;

-- Reajuste en bloque. p: {product_ids: [...], field: 'price'|'cost', mode: 'add_amount'|'add_percent'|'set', value}
--   value: centavos (add_amount / set) o porcentaje (add_percent; puede ser negativo). Redondea a peso.
CREATE OR REPLACE FUNCTION public.admin_bulk_reprice(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_ids UUID[];
  v_field TEXT := p->>'field';
  v_mode TEXT := p->>'mode';
  v_val NUMERIC := nullif(p->>'value', '')::numeric;
  v_n INT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_field NOT IN ('price','cost') OR v_mode NOT IN ('add_amount','add_percent','set') OR v_val IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO v_ids FROM jsonb_array_elements_text(p->'product_ids') x;
  IF cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('error', 'items_required'); END IF;
  PERFORM erp_audit('product_reprice', 'product', NULL,
    (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price_cents', price_cents, 'cost_cents', cost_cents)) FROM products WHERE id = ANY (v_ids)), p);
  WITH calc AS (
    SELECT id,
      greatest(0, round((CASE v_mode
        WHEN 'set' THEN v_val
        WHEN 'add_amount' THEN coalesce(CASE v_field WHEN 'price' THEN price_cents ELSE cost_cents END, 0) + v_val
        ELSE coalesce(CASE v_field WHEN 'price' THEN price_cents ELSE cost_cents END, 0) * (1 + v_val / 100) END) / 100) * 100)::int AS v
    FROM products WHERE id = ANY (v_ids)
  )
  UPDATE products pr SET
    price_cents = CASE WHEN v_field = 'price' THEN calc.v ELSE pr.price_cents END,
    cost_cents = CASE WHEN v_field = 'cost' THEN calc.v ELSE pr.cost_cents END,
    updated_at = now()
  FROM calc WHERE calc.id = pr.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'updated', v_n);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('error', 'invalid_value');
END;
$function$;

-- Inventario (redefinido: + categoría y para venta).
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
        'category', p.category, 'for_sale', p.for_sale,
        'cost_cents', CASE WHEN v_admin THEN p.cost_cents END,
        'sold_30d', coalesce((SELECT -sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.kind IN ('sale','sale_void')
                               AND m.created_at > now() - interval '30 days'), 0),
        'last_movement_at', (SELECT max(m.created_at) FROM stock_movements m WHERE m.product_id = p.id))
      ORDER BY p.is_active DESC, p.category NULLS LAST, p.name) FROM products p WHERE p.kind = 'product' OR p.track_stock), '[]'::jsonb),
    'value_cents', CASE WHEN v_admin THEN (SELECT coalesce(sum(greatest(stock, 0) * coalesce(cost_cents, 0)), 0) FROM products WHERE track_stock AND is_active) END,
    'categories', coalesce((SELECT jsonb_agg(DISTINCT category ORDER BY category) FROM products WHERE category IS NOT NULL), '[]'::jsonb)
  );
END;
$function$;

-- Historial de un producto (redefinido: + fecha del movimiento).
CREATE OR REPLACE FUNCTION public.get_stock_movements(p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('movements', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'stock_after', m.stock_after, 'note', m.note, 'created_at', m.created_at,
      'occurred_on', m.occurred_on,
      'unit_cost_cents', CASE WHEN class_is_admin() THEN m.unit_cost_cents END,
      'by', (SELECT name FROM profiles WHERE id = m.created_by),
      'sale_folio', (SELECT folio FROM sales WHERE id = m.sale_id),
      'expense_folio', (SELECT folio FROM expenses WHERE id = m.expense_id))
    ORDER BY m.created_at DESC)
    FROM (SELECT * FROM stock_movements WHERE product_id = p_product_id ORDER BY created_at DESC LIMIT 200) m), '[]'::jsonb));
END;
$function$;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.erp_stock_date(text) FROM PUBLIC, anon, authenticated';
  FOREACH f IN ARRAY ARRAY[
    'admin_set_product_extras(uuid,text,boolean)', 'stock_out_v2(jsonb)', 'stock_entry_batch(jsonb)',
    'get_stock_report(date,date,text,uuid)', 'admin_bulk_reprice(jsonb)', 'get_inventory()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END;
$grants$;
