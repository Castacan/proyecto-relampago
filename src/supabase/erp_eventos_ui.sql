-- ============================================================
-- Eventos en la pantalla de Egresos (2026-11-12).
-- Correr DESPUÉS de erp_eventos.sql.
-- get_expenses: igual que en erp_finanzas.sql, más "event" en cada egreso y
-- la lista "events" (eventos conocidos) para el selector. Idempotente.
-- ============================================================

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
    'events', to_jsonb(erp_event_names()),
    'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'folio', e.folio, 'payee_id', e.payee_id, 'payee_name', y.name, 'payee_kind', y.kind,
        'description', e.description, 'cost_center', e.cost_center, 'category', e.category, 'amount_cents', e.amount_cents,
        'due_on', e.due_on, 'period_month', e.period_month, 'status', e.status, 'paid_on', e.paid_on, 'method', e.method,
        'paid_from', e.paid_from, 'invoice_ref', e.invoice_ref, 'notes', e.notes, 'recurring_id', e.recurring_id,
        'cancel_reason', e.cancel_reason, 'created_by_name', (SELECT name FROM profiles WHERE id = e.created_by),
        'from_cash', e.cash_movement_id IS NOT NULL, 'event', e.event,
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

SELECT 'get_expenses con eventos' AS que, 'ok' AS valor;
