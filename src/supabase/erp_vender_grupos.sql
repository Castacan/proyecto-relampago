-- ============================================================
-- Vender por grupos + clases semanales con precio de miembro (2026-10-26).
-- Requiere erp_finanzas.sql y clases.sql. Córrelo AL FINAL (redefine
-- create_sale y class_free_used: si se vuelve a correr erp_finanzas.sql o
-- clases.sql, hay que correr este otra vez). Idempotente.
--
--   Inge:
--   · Vender muestra grupos: SERVICIOS (Pase diario, Clase introductoria,
--     Renta de gatas, Renta de magnesiera, Membresía mensual), Clases
--     semanales, Barritas, Magnesias, Bebidas. Se toca el grupo y salen sus
--     opciones. La Membresía trimestral ya no existe.
--   · Clases semanales (escalada y calistenia): $300; si la persona tiene
--     membresía activa, $100, o su clase gratis del mes (1 al mes).
--     La clase gratis vendida en mostrador cuenta igual que la reservada en línea.
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS for_sale BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS class_tier TEXT CHECK (class_tier IN ('regular','member','free_monthly'));

-- ------------------------------------------------------------
-- Catálogo
-- ------------------------------------------------------------
UPDATE public.products SET is_active = false, updated_at = now() WHERE name = 'Membresía Trimestral';

INSERT INTO public.products (kind, name, price_cents, grants_membership, is_recurring, sort_order, category)
SELECT 'service', v.name, v.price, false, false, v.ord, 'Servicios'
FROM (VALUES ('Renta de gatas', 3000, 3), ('Renta de magnesiera', 2000, 4)) AS v(name, price, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE lower(p.name) = lower(v.name));

-- Precios de las clases semanales (dictados por Inge).
UPDATE public.class_types SET price_cents = 30000, member_price_cents = 10000, eligible_free_monthly = true, updated_at = now()
WHERE name IN ('Escalada Jueves', 'Calistenia');

INSERT INTO public.products (kind, name, price_cents, grants_membership, is_recurring, class_type_id, sort_order, category)
SELECT 'class', v.name, 30000, false, false, t.id, v.ord, 'Clases semanales'
FROM (VALUES ('Clase de escalada', 'Escalada Jueves', 1), ('Clase de calistenia', 'Calistenia', 2)) AS v(name, type_name, ord)
JOIN public.class_types t ON t.name = v.type_name
WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE lower(p.name) = lower(v.name));

UPDATE public.products SET category = 'Servicios', updated_at = now()
WHERE name IN ('Pase Diario', 'Clase Introductoria', 'Membresía Mensual', 'Renta de gatas', 'Renta de magnesiera');
UPDATE public.products SET category = 'Domiciliación', updated_at = now() WHERE is_recurring AND category IS NULL;
UPDATE public.products SET sort_order = CASE name WHEN 'Pase Diario' THEN 1 WHEN 'Membresía Mensual' THEN 2 WHEN 'Clase Introductoria' THEN 5 ELSE sort_order END
WHERE category = 'Servicios';

-- Productos que vinieron de EVO (si ya se dieron de alta).
UPDATE public.products SET category = 'Barritas' WHERE sku LIKE 'EVO-%' AND name LIKE 'Barra Wild%';
UPDATE public.products SET category = 'Magnesias' WHERE sku LIKE 'EVO-%' AND name LIKE 'Magnesia%';
UPDATE public.products SET category = 'Bebidas' WHERE sku IN ('EVO-6378', 'EVO-9320', 'EVO-9321');
UPDATE public.products SET category = NULL WHERE sku = 'EVO-8547';   -- Gomitas: sale suelta

-- ------------------------------------------------------------
-- Clase gratis del mes: también cuenta la vendida en mostrador
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.class_free_used(p_person_id UUID, p_on DATE)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT (SELECT count(*)::int FROM class_bookings b
          JOIN class_sessions s ON s.id = b.session_id
          WHERE b.person_id = p_person_id AND b.price_tier = 'free_monthly'
            AND (b.status IN ('booked','attended','no_show','cancelled_late')
                 OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))
            AND date_trunc('month', class_mx_date(s.starts_at)) = date_trunc('month', p_on))
       + (SELECT coalesce(sum(i.quantity), 0)::int FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE s.person_id = p_person_id AND s.status = 'completed' AND i.class_tier = 'free_monthly'
            AND date_trunc('month', (s.created_at AT TIME ZONE 'America/Mexico_City')::date) = date_trunc('month', p_on));
$function$;

-- Precios de una clase para una persona (para Vender).
CREATE OR REPLACE FUNCTION public.get_class_pricing(p_person_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
  v_member BOOLEAN := p_person_id IS NOT NULL AND class_is_member(p_person_id, v_today);
  v_limit INT := (SELECT free_classes_per_month FROM class_settings WHERE id = 1);
  v_used INT := CASE WHEN p_person_id IS NULL THEN 0 ELSE class_free_used(p_person_id, v_today) END;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'is_member', v_member,
    'free_left', CASE WHEN v_member THEN greatest(coalesce(v_limit, 0) - v_used, 0) ELSE 0 END,
    'products', coalesce((SELECT jsonb_object_agg(p.id, jsonb_build_object(
        'member_price_cents', coalesce(t.member_price_cents, t.price_cents, p.price_cents),
        'eligible_free_monthly', t.eligible_free_monthly))
      FROM products p JOIN class_types t ON t.id = p.class_type_id WHERE p.kind = 'class'), '{}'::jsonb));
END;
$function$;

-- ------------------------------------------------------------
-- create_sale (redefinida): items de clase con class_tier
-- p_sale.items[]: {product_id, quantity?, discount_cents?, starts_on?, unit_price_cents?, class_tier?}
--   class_tier: 'member' (precio miembro) | 'free_monthly' (clase gratis del mes, 1 pieza)
-- ------------------------------------------------------------
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
  v_t       class_types%ROWTYPE;
  v_price   INT;
  v_qty     INT;
  v_pay     JSONB;
  v_result  JSONB;
  v_key     TEXT;
  v_tier    TEXT;
  v_desc    TEXT;
  v_free    INT := 0;                     -- clases gratis en esta venta
  v_limit   INT;
  v_new_mem BOOLEAN;                    -- en esta misma venta compra membresía
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

  v_new_mem := EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale->'items') x JOIN products pr ON pr.id = nullif(x->>'product_id', '')::uuid
                       WHERE pr.grants_membership AND pr.is_active AND NOT pr.is_recurring);
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_sale->'items') LOOP
    SELECT * INTO v_p FROM products WHERE id = nullif(v_it->>'product_id', '')::uuid;
    IF NOT FOUND OR NOT v_p.is_active THEN RETURN jsonb_build_object('error', 'invalid_product'); END IF;
    IF v_p.is_recurring THEN RETURN jsonb_build_object('error', 'use_subscription'); END IF;
    IF v_p.grants_membership AND v_person IS NULL THEN RETURN jsonb_build_object('error', 'person_required'); END IF;
    v_qty := coalesce((v_it->>'quantity')::int, 1);
    IF v_qty < 1 OR v_qty > 100 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
    v_price := v_p.price_cents;
    v_desc := v_p.name;
    v_tier := nullif(v_it->>'class_tier', '');
    IF v_tier IS NOT NULL AND v_tier <> 'regular' THEN
      IF v_tier NOT IN ('member','free_monthly') OR v_p.kind <> 'class' OR v_p.class_type_id IS NULL THEN
        RETURN jsonb_build_object('error', 'invalid_value');
      END IF;
      IF v_person IS NULL THEN RETURN jsonb_build_object('error', 'person_required'); END IF;
      IF NOT (v_new_mem OR class_is_member(v_person, erp_today())) THEN RETURN jsonb_build_object('error', 'not_member'); END IF;
      SELECT * INTO v_t FROM class_types WHERE id = v_p.class_type_id;
      IF v_tier = 'member' THEN
        v_price := coalesce(v_t.member_price_cents, v_t.price_cents, v_p.price_cents);
        v_desc := v_p.name || ' (precio miembro)';
      ELSE
        IF NOT v_t.eligible_free_monthly THEN RETURN jsonb_build_object('error', 'not_eligible'); END IF;
        v_limit := (SELECT free_classes_per_month FROM class_settings WHERE id = 1);
        v_free := v_free + v_qty;
        IF class_free_used(v_person, erp_today()) + v_free > coalesce(v_limit, 0) THEN RETURN jsonb_build_object('error', 'free_used'); END IF;
        v_price := 0;
        v_desc := v_p.name || ' (clase gratis del mes)';
      END IF;
    ELSIF nullif(v_it->>'unit_price_cents', '') IS NOT NULL AND (v_it->>'unit_price_cents')::int <> v_p.price_cents THEN
      IF v_p.price_cents <> 0 AND NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'price_locked'); END IF;
      v_price := (v_it->>'unit_price_cents')::int;
    END IF;
    IF v_p.track_stock THEN
      v_need := v_need || jsonb_build_object(v_p.id::text, coalesce((v_need->>v_p.id::text)::int, 0) + v_qty);
    END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_p.id, 'description', v_desc, 'quantity', v_qty, 'unit_price_cents', v_price,
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
  -- Marca de la tarifa de clase (cuenta para la clase gratis del mes).
  UPDATE sale_items i SET class_tier = CASE WHEN i.description LIKE '% (clase gratis del mes)' THEN 'free_monthly'
                                            WHEN i.description LIKE '% (precio miembro)' THEN 'member' ELSE 'regular' END
  FROM products p
  WHERE i.sale_id = (v_result->>'sale_id')::uuid AND p.id = i.product_id AND p.kind = 'class';
  PERFORM erp_audit('sale', 'sale', (v_result->>'sale_id')::uuid, NULL, p_sale);
  RETURN jsonb_build_object('success', true) || v_result;
END;
$function$;

DO $grants$
BEGIN
  REVOKE ALL ON FUNCTION public.class_free_used(UUID, DATE) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.get_class_pricing(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_class_pricing(uuid) TO authenticated;
  REVOKE ALL ON FUNCTION public.create_sale(jsonb) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.create_sale(jsonb) TO authenticated;
END;
$grants$;
