-- ============================================================
-- Eventos (competencias, etc.) separados de las cuentas del gym (2026-11-12).
-- Correr DESPUÉS de erp_estado_resultados.sql y de las competencias.
--
-- · expenses.event: etiqueta del evento (texto, ej. el nombre de la
--   competencia). Independiente del centro de costo.
-- · other_income: ingresos que no son ventas del mostrador (patrocinios,
--   donativos, reembolsos…), con evento opcional.
-- · get_income_statement(p_year) ahora regresa también:
--     - en income y expenses la llave "event" (NULL = gym);
--     - las inscripciones pagadas de cada competencia como ingreso del evento
--       (Clip: lo cobrado; efectivo/tarjeta: el precio; cortesía: $0), por mes del pago;
--     - other_income por mes en que se recibió.
-- · Se etiquetan solos: los egresos con la nota "Evento: Competencia JAM 2026"
--   y los del proveedor "Jueces de competencia".
-- Solo admin. Idempotente.
-- ============================================================

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS event TEXT;
CREATE INDEX IF NOT EXISTS expenses_event_idx ON public.expenses (event) WHERE event IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.other_income (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_on  DATE NOT NULL,
  payer        TEXT,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Otros ingresos',   -- ej. Patrocinio
  amount_cents INT  NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','card','transfer','other')),
  account      TEXT NOT NULL DEFAULT 'bank' CHECK (account IN ('cash_register','bank','other')),
  event        TEXT,
  notes        TEXT,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.other_income ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo vía RPC

-- Lista de eventos conocidos (competencias + etiquetas ya usadas).
CREATE OR REPLACE FUNCTION public.erp_event_names()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT coalesce(array_agg(DISTINCT n ORDER BY n), '{}') FROM (
    SELECT name AS n FROM competitions
    UNION SELECT event FROM expenses WHERE event IS NOT NULL
    UNION SELECT event FROM other_income WHERE event IS NOT NULL) x;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_expense_event(p_expense_id UUID, p_event TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_before TEXT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT event INTO v_before FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE expenses SET event = nullif(left(btrim(coalesce(p_event, '')), 80), ''), updated_at = now() WHERE id = p_expense_id;
  PERFORM erp_audit('expense_event', 'expense', p_expense_id, jsonb_build_object('event', v_before), jsonb_build_object('event', p_event));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_other_income(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id  UUID := nullif(p->>'id', '')::uuid;
  v_amt INT;
  v_day DATE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  BEGIN
    v_amt := nullif(p->>'amount_cents', '')::int;
    v_day := coalesce(nullif(p->>'received_on', '')::date, erp_today());
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  IF v_id IS NULL THEN
    IF v_amt IS NULL OR v_amt <= 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
    IF length(btrim(coalesce(p->>'description', ''))) < 2 THEN RETURN jsonb_build_object('error', 'description_required'); END IF;
    INSERT INTO other_income (received_on, payer, description, category, amount_cents, method, account, event, notes, created_by)
    VALUES (v_day, nullif(btrim(coalesce(p->>'payer', '')), ''), left(btrim(p->>'description'), 200),
            coalesce(nullif(btrim(coalesce(p->>'category', '')), ''), 'Otros ingresos'), v_amt,
            coalesce(nullif(p->>'method', ''), 'transfer'), coalesce(nullif(p->>'account', ''), 'bank'),
            nullif(left(btrim(coalesce(p->>'event', '')), 80), ''), nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
    RETURNING id INTO v_id;
    PERFORM erp_audit('other_income_create', 'other_income', v_id, NULL, p);
  ELSE
    UPDATE other_income SET
      received_on  = coalesce(nullif(p->>'received_on', '')::date, received_on),
      payer        = CASE WHEN p ? 'payer' THEN nullif(btrim(coalesce(p->>'payer', '')), '') ELSE payer END,
      description  = coalesce(nullif(left(btrim(coalesce(p->>'description', '')), 200), ''), description),
      category     = coalesce(nullif(btrim(coalesce(p->>'category', '')), ''), category),
      amount_cents = coalesce(v_amt, amount_cents),
      method       = coalesce(nullif(p->>'method', ''), method),
      account      = coalesce(nullif(p->>'account', ''), account),
      event        = CASE WHEN p ? 'event' THEN nullif(left(btrim(coalesce(p->>'event', '')), 80), '') ELSE event END,
      notes        = CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE notes END,
      is_cancelled = coalesce((p->>'is_cancelled')::boolean, is_cancelled),
      updated_at   = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    PERFORM erp_audit('other_income_update', 'other_income', v_id, NULL, p);
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'invalid_value');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_other_income(p_year INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'events', to_jsonb(erp_event_names()),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.received_on DESC, o.created_at DESC) FROM other_income o
                       WHERE extract(year FROM o.received_on) = p_year), '[]'::jsonb));
END;
$function$;

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
    'events', to_jsonb(erp_event_names()),
    'income', coalesce((SELECT jsonb_agg(jsonb_build_object('group', g, 'concept', c, 'month', m, 'cents', t, 'event', ev)) FROM (
        -- Ventas del gym
        SELECT CASE WHEN s.source = 'subscription' OR pr.kind = 'plan' THEN 'Plan'
                    WHEN pr.kind IN ('pass', 'class', 'service') OR s.source = 'class' THEN 'Servicio'
                    WHEN pr.kind = 'product' THEN 'Producto'
                    WHEN i.description ILIKE 'membres%' THEN 'Plan'
                    ELSE 'Otros' END AS g,
               coalesce(pr.name, initcap(btrim(i.description)), 'Sin concepto') AS c,
               extract(month FROM (s.created_at AT TIME ZONE 'America/Mexico_City'))::int AS m,
               sum(i.total_cents)::bigint AS t, NULL::text AS ev
        FROM sales s JOIN sale_items i ON i.sale_id = s.id LEFT JOIN products pr ON pr.id = i.product_id
        WHERE s.status = 'completed' AND (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3
        UNION ALL
        -- Inscripciones de competencias
        SELECT 'Inscripciones',
               'Inscripción · ' || CASE r.payment_method WHEN 'clip' THEN 'Clip en línea' WHEN 'cash' THEN 'Efectivo'
                                    WHEN 'card' THEN 'Tarjeta' WHEN 'courtesy' THEN 'Cortesía' ELSE coalesce(r.payment_method, 'otro') END,
               extract(month FROM (r.paid_at AT TIME ZONE 'America/Mexico_City'))::int,
               sum(CASE WHEN r.payment_method = 'courtesy' THEN 0
                        WHEN r.payment_method = 'clip' THEN coalesce((SELECT max(cp.amount_cents) FROM competition_payments cp
                                                                     WHERE cp.registration_id = r.id AND cp.status = 'completed'), co.price_cents)
                        ELSE co.price_cents END)::bigint,
               co.name
        FROM competition_registrations r JOIN competitions co ON co.id = r.competition_id
        WHERE r.status = 'paid' AND r.paid_at IS NOT NULL
          AND (r.paid_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3, 5
        UNION ALL
        -- Otros ingresos (patrocinios, etc.)
        SELECT o.category, coalesce(o.payer, o.description), extract(month FROM o.received_on)::int, sum(o.amount_cents)::bigint, o.event
        FROM other_income o
        WHERE NOT o.is_cancelled AND o.received_on BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3, 5) x WHERE t <> 0 OR g = 'Inscripciones'), '[]'::jsonb),
    'discounts', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', t)) FROM (
        SELECT extract(month FROM (created_at AT TIME ZONE 'America/Mexico_City'))::int m, sum(discount_cents)::bigint t FROM sales
        WHERE status = 'completed' AND discount_cents > 0 AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
        GROUP BY 1) x), '[]'::jsonb),
    'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object('group', g, 'concept', c, 'month', m, 'cents', t, 'event', ev)) FROM (
        SELECT e.cost_center AS g,
               CASE WHEN y.kind = 'employee' THEN 'Nómina' ELSE coalesce(y.name, e.description) END AS c,
               extract(month FROM e.period_month)::int AS m,
               sum(e.amount_cents)::bigint AS t, e.event AS ev
        FROM expenses e LEFT JOIN expense_payees y ON y.id = e.payee_id
        WHERE e.status <> 'cancelled' AND e.period_month BETWEEN v_from AND v_to
        GROUP BY 1, 2, 3, 5) x), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_event_names() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_expense_event(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_other_income(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_other_income(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_expense_event(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_other_income(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_other_income(INT) TO authenticated;

-- Etiquetar lo que ya se sabe que es de la competencia.
UPDATE expenses e SET event = (SELECT name FROM competitions WHERE slug = 'competencia-2026'), updated_at = now()
WHERE e.event IS NULL
  AND (e.notes LIKE '%Evento: Competencia JAM 2026%'
       OR e.payee_id IN (SELECT id FROM expense_payees WHERE name = 'Jueces de competencia'));

-- Revisión
SELECT 'nombre del evento' AS que, (SELECT name FROM competitions WHERE slug = 'competencia-2026') AS valor
UNION ALL SELECT 'egresos etiquetados', count(*)::text || ' · $' || to_char(sum(amount_cents) / 100.0, 'FM999,990.00') FROM expenses WHERE event IS NOT NULL
UNION ALL SELECT 'inscripciones pagadas', count(*)::text FROM competition_registrations WHERE status = 'paid';
