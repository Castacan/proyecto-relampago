-- ============================================================
-- Cierre automático de caja (2026-10-26).
-- Córrelo DESPUÉS de erp.sql, erp_finanzas.sql, erp_crm.sql y erp_checklist.sql
-- (redefine open_cash, close_cash, get_cash_status y get_checklist_today).
-- Si algún día se vuelve a correr erp.sql o erp_checklist.sql, corre este otra vez.
-- Idempotente.
--
--   * La caja es de UN día (business_date). Si nadie hace el corte, se cierra
--     sola al pasar la medianoche (cron) o en cuanto alguien abre la app al día
--     siguiente: queda "cerrada sin corte", con el efectivo esperado pero sin contar.
--   * Nadie (ni el admin) puede hacer el corte de una caja de otro día.
--   * El admin recibe aviso: banner en Inicio y Caja hasta que lo marca como
--     enterado, y un correo (Edge Function crm-emails, acción cash_alert).
-- ============================================================

ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS auto_closed      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS alert_ack_at     TIMESTAMPTZ;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS alert_ack_by     UUID;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS alert_emailed_at TIMESTAMPTZ;

-- Cierra las cajas abiertas de días anteriores. Devuelve cuántas cerró.
CREATE OR REPLACE FUNCTION public.erp_autoclose_stale_cash()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r cash_sessions%ROWTYPE;
  v_expected INT;
  v_n INT := 0;
BEGIN
  FOR r IN SELECT * FROM cash_sessions WHERE closed_at IS NULL AND business_date < erp_today() FOR UPDATE LOOP
    v_expected := (erp_cash_summary(r.id)->>'expected_cash')::int;
    UPDATE cash_sessions SET closed_at = now(), closed_by = NULL, expected_cash_cents = v_expected,
           counted_cash_cents = NULL, difference_cents = NULL, auto_closed = true,
           note = concat_ws(' · ', note, 'Cerrada automáticamente: nadie hizo el corte')
    WHERE id = r.id;
    INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
    VALUES (NULL, 'cash_auto_close', 'cash', r.id, NULL, jsonb_build_object('business_date', r.business_date, 'expected', v_expected));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_cash_alerts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'business_date', s.business_date, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
           'opened_by_name', (SELECT name FROM profiles WHERE id = s.opened_by),
           'expected_cash_cents', s.expected_cash_cents,
           'sales_count', (SELECT count(*) FROM sales x WHERE x.session_id = s.id AND x.status = 'completed'),
           'sales_total_cents', coalesce((SELECT sum(total_cents) FROM sales x WHERE x.session_id = s.id AND x.status = 'completed'), 0))
         ORDER BY s.business_date DESC), '[]'::jsonb)
  FROM cash_sessions s WHERE s.auto_closed AND s.alert_ack_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_status()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_s cash_sessions%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_autoclose_stale_cash();
  SELECT * INTO v_s FROM cash_sessions WHERE closed_at IS NULL;
  RETURN jsonb_build_object(
    'require_open_cash', (SELECT require_open_cash FROM erp_settings WHERE id = 1),
    'today', erp_today(),
    'is_admin', class_is_admin(),
    'alerts', CASE WHEN class_is_admin() THEN erp_cash_alerts() ELSE '[]'::jsonb END,
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
  PERFORM erp_autoclose_stale_cash();
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

-- Corte: solo de la caja de HOY. La de un día anterior ya no se puede cortar
-- (se cerró sola y el admin recibió aviso).
CREATE OR REPLACE FUNCTION public.close_cash(p_counted_cents INT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sid UUID;
  v_expected INT;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF erp_autoclose_stale_cash() > 0 THEN RETURN jsonb_build_object('error', 'cash_auto_closed'); END IF;
  v_sid := erp_open_session_id();
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

-- El checklist también dispara el cierre automático al abrir el turno.
CREATE OR REPLACE FUNCTION public.get_checklist_today()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_autoclose_stale_cash();
  PERFORM erp_checklist_generate(v_today);
  PERFORM erp_checklist_sync_cash(v_today);
  RETURN erp_checklist_day_json(v_today) || jsonb_build_object('is_admin', class_is_admin(), 'me', auth.uid());
END;
$function$;

-- Admin: "enterado" del aviso.
CREATE OR REPLACE FUNCTION public.admin_ack_cash_alert(p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE cash_sessions SET alert_ack_at = now(), alert_ack_by = auth.uid() WHERE id = p_session_id AND auto_closed AND alert_ack_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_alerts()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_autoclose_stale_cash();
  RETURN jsonb_build_object('alerts', CASE WHEN class_is_admin() THEN erp_cash_alerts() ELSE '[]'::jsonb END);
END;
$function$;

-- Para el cron / Edge Function (service_role): cierra lo pendiente y entrega
-- los avisos que falta mandar por correo, con los correos de los admins.
CREATE OR REPLACE FUNCTION public.cash_alerts_to_email()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM erp_autoclose_stale_cash();
  RETURN jsonb_build_object(
    'admins', coalesce((SELECT jsonb_agg(u.email) FROM profiles p JOIN auth.users u ON u.id = p.id WHERE p.role = 'admin' AND u.email IS NOT NULL), '[]'::jsonb),
    'alerts', coalesce((SELECT jsonb_agg(a) FROM jsonb_array_elements(erp_cash_alerts()) a
                        WHERE (SELECT alert_emailed_at FROM cash_sessions WHERE id = (a->>'id')::uuid) IS NULL), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cash_alert_mark_emailed(p_ids UUID[])
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  UPDATE cash_sessions SET alert_emailed_at = now() WHERE id = ANY (p_ids) AND alert_emailed_at IS NULL;
$function$;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['erp_autoclose_stale_cash()', 'erp_cash_alerts()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['get_cash_status()', 'open_cash(integer,text)', 'close_cash(integer,text)', 'get_checklist_today()',
                           'admin_ack_cash_alert(uuid)', 'get_cash_alerts()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cash_alerts_to_email()', 'cash_alert_mark_emailed(uuid[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END;
$grants$;

-- Cron: todos los días a las 00:05 de México (06:05 UTC) cierra la caja que
-- quedó abierta y manda el aviso por correo al admin. Usa la misma llave del
-- cron de cobros (no hay que pegarla). Solo corre en Supabase (pg_cron).
DO $cron$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN RETURN; END IF;
  SELECT substring(command FROM '"x-cron-key": "([^"]+)"') INTO v_key FROM cron.job WHERE jobname = 'erp-cobros-domiciliacion';
  IF v_key IS NULL THEN RAISE NOTICE 'Sin llave del cron de cobros: no se programó el aviso por correo'; RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'erp-cierre-caja';
  PERFORM cron.schedule(
    'erp-cierre-caja',
    '5 6 * * *',
    format($cmd$
      SELECT public.erp_autoclose_stale_cash();
      SELECT net.http_post(
        url := 'https://nptpavtkqskzqurwaysm.supabase.co/functions/v1/crm-emails',
        headers := %L::jsonb,
        body := '{"action": "cash_alert"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$, jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key)::text)
  );
END;
$cron$;
