-- ============================================================
-- Historial de ventas del staff y cancelaciones con aprobación (2026-11-12).
-- Correr DESPUÉS de erp.sql y erp_finanzas.sql.
--
-- · get_sales: el staff (no admin) SOLO ve las ventas de HOY, aunque pida
--   otras fechas. El admin ve lo que pida. Cada venta trae su solicitud de
--   cancelación (si hay).
-- · staff_request_void(p_sale_id, p_reason): el staff pide anular una venta de
--   hoy con motivo. NO anula: queda pendiente para el admin.
-- · get_void_requests(): (admin) solicitudes pendientes, para el aviso.
-- · admin_decide_void(p_request_id, p_approve, p_note): el admin aprueba
--   (se anula la venta con admin_void_sale) o rechaza.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sale_void_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL REFERENCES public.sales(id),
  reason        TEXT NOT NULL,
  requested_by  UUID,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sale_void_requests_one_pending ON public.sale_void_requests (sale_id) WHERE status = 'pending';
ALTER TABLE public.sale_void_requests ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo vía RPC

CREATE OR REPLACE FUNCTION public.get_sales(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_admin BOOLEAN := class_is_admin();
  v_from  DATE := p_from;
  v_to    DATE := p_to;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT v_admin THEN v_from := erp_today(); v_to := erp_today(); END IF;   -- staff: solo hoy
  RETURN jsonb_build_object('only_today', NOT v_admin, 'is_admin', v_admin, 'sales', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'created_at', s.created_at, 'status', s.status,
             'total_cents', s.total_cents, 'discount_cents', s.discount_cents, 'source', s.source, 'note', s.note,
             'void_reason', s.void_reason, 'person_id', s.person_id, 'person_name', p.full_name,
             'seller', (SELECT name FROM profiles WHERE id = s.created_by),
             'items', (SELECT jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'total_cents', i.total_cents)) FROM sale_items i WHERE i.sale_id = s.id),
             'payments', (SELECT jsonb_agg(jsonb_build_object('method', sp.method, 'amount_cents', sp.amount_cents, 'reference', sp.reference)) FROM sale_payments sp WHERE sp.sale_id = s.id),
             'void_request', (SELECT jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'decision_note', r.decision_note,
                                       'requested_by', (SELECT name FROM profiles WHERE id = r.requested_by), 'created_at', r.created_at)
                              FROM sale_void_requests r WHERE r.sale_id = s.id ORDER BY r.created_at DESC LIMIT 1))
           ORDER BY s.created_at DESC)
    FROM sales s LEFT JOIN people p ON p.id = s.person_id
    WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN v_from AND v_to
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_request_void(p_sale_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s  sales%ROWTYPE;
  v_id UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_s FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_s.status <> 'completed' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF v_s.source = 'subscription' THEN RETURN jsonb_build_object('error', 'subscription_sale'); END IF;
  IF NOT class_is_admin() AND (v_s.created_at AT TIME ZONE 'America/Mexico_City')::date <> erp_today() THEN
    RETURN jsonb_build_object('error', 'only_today');
  END IF;
  IF EXISTS (SELECT 1 FROM sale_void_requests WHERE sale_id = p_sale_id AND status = 'pending') THEN
    RETURN jsonb_build_object('error', 'already_requested');
  END IF;
  INSERT INTO sale_void_requests (sale_id, reason, requested_by) VALUES (p_sale_id, left(btrim(p_reason), 300), auth.uid())
  RETURNING id INTO v_id;
  PERFORM erp_audit('sale_void_request', 'sale', p_sale_id, NULL, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_void_requests()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('requests', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('requests', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'sale_id', s.id, 'folio', s.folio, 'total_cents', s.total_cents,
             'sale_at', s.created_at, 'reason', r.reason, 'created_at', r.created_at,
             'requested_by', (SELECT name FROM profiles WHERE id = r.requested_by),
             'person_name', (SELECT full_name FROM people WHERE id = s.person_id),
             'items', (SELECT string_agg(i.description || CASE WHEN i.quantity > 1 THEN ' ×' || i.quantity ELSE '' END, ', ') FROM sale_items i WHERE i.sale_id = s.id),
             'methods', (SELECT string_agg(DISTINCT sp.method, ', ') FROM sale_payments sp WHERE sp.sale_id = s.id))
           ORDER BY r.created_at)
    FROM sale_void_requests r JOIN sales s ON s.id = r.sale_id
    WHERE r.status = 'pending'), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decide_void(p_request_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_r sale_void_requests%ROWTYPE;
  v_res JSONB;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_r FROM sale_void_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_r.status <> 'pending' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  IF p_approve THEN
    v_res := admin_void_sale(v_r.sale_id, 'Aprobado por el admin. Motivo del staff: ' || v_r.reason
                                          || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
    IF v_res ? 'error' THEN RETURN v_res; END IF;
  END IF;
  UPDATE sale_void_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE id = p_request_id;
  PERFORM erp_audit(CASE WHEN p_approve THEN 'sale_void_approved' ELSE 'sale_void_rejected' END, 'sale', v_r.sale_id, NULL,
                    jsonb_build_object('request', p_request_id, 'note', p_note));
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_request_void(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_void_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_decide_void(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_request_void(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_void_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_void(UUID, BOOLEAN, TEXT) TO authenticated;

SELECT 'cancelaciones con aprobación' AS que, 'ok' AS valor;
