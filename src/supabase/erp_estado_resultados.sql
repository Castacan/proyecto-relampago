-- ============================================================
-- Estado de resultados con el formato de Inge (2026-11-12).
-- Correr DESPUÉS de erp.sql, erp_finanzas.sql y erp_crm.sql.
--
-- get_income_statement(p_year): renglones por concepto y mes.
-- · Ingresos (por mes de la venta, ventas completadas):
--     Servicio = pases, clases y servicios (renta de gatas, magnesia…)
--     Plan     = membresías y domiciliación
--     Producto = productos de la tienda
--   El concepto es el nombre del producto. Si la venta no tiene producto
--   (importada de EVO sin equivalente), se usa la descripción y se adivina el
--   grupo: "membres…" → Plan.
-- · Egresos (por el mes al que corresponden, sin cancelados): por centro de
--   costo. El concepto es el proveedor; lo que se paga a empleados sale como
--   "Nómina". Aquí SÍ entran las compras de productos (como en el formato de
--   Inge, base efectivo), no el costo de lo vendido.
-- Solo admin. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_income_statement(p_year INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_from DATE := make_date(p_year, 1, 1);
  v_to   DATE := make_date(p_year, 12, 31);
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'year', p_year,
    'cost_centers', (SELECT to_jsonb(expense_cost_centers) FROM erp_settings WHERE id = 1),
    'income', coalesce((SELECT jsonb_agg(jsonb_build_object('group', g, 'concept', c, 'month', m, 'cents', t)) FROM (
        SELECT CASE WHEN s.source = 'subscription' OR pr.kind = 'plan' THEN 'Plan'
                    WHEN pr.kind IN ('pass', 'class', 'service') OR s.source = 'class' THEN 'Servicio'
                    WHEN pr.kind = 'product' THEN 'Producto'
                    WHEN i.description ILIKE 'membres%' THEN 'Plan'
                    ELSE 'Otros' END AS g,
               coalesce(pr.name, initcap(btrim(i.description)), 'Sin concepto') AS c,
               extract(month FROM (s.created_at AT TIME ZONE 'America/Mexico_City'))::int AS m,
               sum(i.total_cents)::bigint AS t
        FROM sales s JOIN sale_items i ON i.sale_id = s.id LEFT JOIN products pr ON pr.id = i.product_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3) x), '[]'::jsonb),
    'discounts', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', t)) FROM (
        SELECT extract(month FROM (created_at AT TIME ZONE 'America/Mexico_City'))::int m, sum(discount_cents)::bigint t FROM sales
        WHERE status = 'completed' AND discount_cents > 0 AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1) x), '[]'::jsonb),
    'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object('group', g, 'concept', c, 'month', m, 'cents', t)) FROM (
        SELECT e.cost_center AS g,
               CASE WHEN y.kind = 'employee' THEN 'Nómina' ELSE coalesce(y.name, e.description) END AS c,
               extract(month FROM e.period_month)::int AS m,
               sum(e.amount_cents)::bigint AS t
        FROM expenses e LEFT JOIN expense_payees y ON y.id = e.payee_id
        WHERE e.status <> 'cancelled' AND e.period_month BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3) x), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_income_statement(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_income_statement(INT) TO authenticated;

-- Revisión: ene–mar 2026 deben dar ingresos 14,200 / 9,550 / 19,500 y egresos 15,619.42 / 9,734.39 / 22,463.55.
SELECT to_char(d, 'YYYY-MM') AS mes,
  (SELECT sum(s.total_cents) FROM sales s WHERE s.status = 'completed'
     AND date_trunc('month', s.created_at AT TIME ZONE 'America/Mexico_City') = d) / 100.0 AS ingresos,
  (SELECT sum(e.amount_cents) FROM expenses e WHERE e.status <> 'cancelled' AND e.period_month = d::date) / 100.0 AS egresos
FROM generate_series(DATE '2026-01-01', DATE '2026-03-01', INTERVAL '1 month') d;
