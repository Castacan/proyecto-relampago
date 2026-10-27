-- ============================================================
-- Alta de los productos que se venden hoy en EVO (leídos de EVO el 2026-10-26).
-- Requiere erp_finanzas.sql (y de preferencia erp_inventario.sql). Idempotente:
-- si ya existe un producto con el mismo nombre, no lo vuelve a crear.
--
--   · Clave (sku) = EVO-<id> para poder ligarlos en la migración.
--   · Existencia inicial = "Cantidad actual" de EVO ese día.
--   · Cerveza y Refresco estaban en negativo en EVO (−37 y −2, nunca se les
--     registraron entradas) y sin costo: entran en 0 y permiten vender sin
--     existencia. Hay que contarlos (Inventario → Contar).
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS for_sale BOOLEAN NOT NULL DEFAULT true;

DO $evo$
DECLARE
  r RECORD;
  v_id UUID;
  v_n INT := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- nombre,                               categoría,  precio, costo, existencia, vende sin existencia, evo_id
    ('Agua Kirkland 500 ml',                 'Bebidas',   1000,   250,   60, false, 6378),
    ('Cerveza',                              'Bebidas',   2500,  NULL,    0, true,  9321),
    ('Refresco',                             'Bebidas',   2000,  NULL,    0, true,  9320),
    ('Barra Wild Caramelo 45 g',             'Snacks',    4000,  3000,    0, false, 6383),
    ('Barra Wild Chocolate 45 g',            'Snacks',    4000,  3000,    0, false, 6382),
    ('Barra Wild Chocolate amargo 45 g',     'Snacks',    4000,  3000,   16, false, 6386),
    ('Barra Wild Chocolate/cacahuate 45 g',  'Snacks',    4000,  3000,   16, false, 6381),
    ('Barra Wild Chocolate/coco 45 g',       'Snacks',    4000,  3000,    2, false, 6380),
    ('Barra Wild Chocolate/moka 45 g',       'Snacks',    4000,  3000,    0, false, 6385),
    ('Barra Wild Chocolate/naranja 45 g',    'Snacks',    4000,  3000,   12, false, 6384),
    ('Barra Wild Limón 45 g',                'Snacks',    4000,  3000,    0, false, 6387),
    ('Gomitas',                              'Snacks',    5000,  3000,    0, true,  8547),
    ('Magnesia Staiker Moonstones',          'Magnesia', 20000, 11200,    3, false, 6370),
    ('Magnesia Staiker polvo 130 g',         'Magnesia', 15000,  7000,    0, false, 6369),
    ('Magnesia Yohua',                       'Magnesia', 24000, 11500,    3, false, 6368)
  ) AS t(name, category, price, cost, qty, neg, evo_id)
  LOOP
    IF EXISTS (SELECT 1 FROM products WHERE lower(name) = lower(r.name) OR sku = 'EVO-' || r.evo_id) THEN CONTINUE; END IF;
    INSERT INTO products (kind, name, price_cents, grants_membership, is_recurring, track_stock, stock, cost_cents,
                          allow_negative_stock, sku, is_active, sort_order, category, for_sale)
    VALUES ('product', r.name, r.price, false, false, true, 0, r.cost, r.neg, 'EVO-' || r.evo_id, true, 0, r.category, true)
    RETURNING id INTO v_id;
    IF r.qty > 0 THEN
      PERFORM erp_stock_move(v_id, r.qty, 'initial', r.cost, NULL, NULL, 'Existencia en EVO al 26-oct-2026');
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Productos creados: %', v_n;
END;
$evo$;

SELECT name AS producto, category AS categoria, price_cents / 100.0 AS precio, cost_cents / 100.0 AS costo, stock AS existencia, sku
FROM public.products WHERE sku LIKE 'EVO-%' ORDER BY category, name;
