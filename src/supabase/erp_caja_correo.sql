-- ============================================================
-- Correo de "caja sin corte": APAGADO por defecto (2026-10-27).
-- Córrelo DESPUÉS de erp_caja_cierre.sql (redefine cash_alerts_to_email).
-- Idempotente.
--
--   Inge todavía no usa la app y ya le llegaban correos. El cierre automático
--   y el aviso dentro de la app siguen igual; solo el correo se controla con
--   erp_settings.cash_alert_email (Configuración → Ajustes generales).
-- ============================================================

ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS cash_alert_email BOOLEAN NOT NULL DEFAULT false;

-- Para el cron: cierra lo pendiente y, solo si el correo está prendido, entrega los avisos.
CREATE OR REPLACE FUNCTION public.cash_alerts_to_email()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM erp_autoclose_stale_cash();
  IF NOT coalesce((SELECT cash_alert_email FROM erp_settings WHERE id = 1), false) THEN
    RETURN jsonb_build_object('admins', '[]'::jsonb, 'alerts', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'admins', coalesce((SELECT jsonb_agg(u.email) FROM profiles p JOIN auth.users u ON u.id = p.id WHERE p.role = 'admin' AND u.email IS NOT NULL), '[]'::jsonb),
    'alerts', coalesce((SELECT jsonb_agg(a) FROM jsonb_array_elements(erp_cash_alerts()) a
                        WHERE (SELECT alert_emailed_at FROM cash_sessions WHERE id = (a->>'id')::uuid) IS NULL), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_alert_email()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('enabled', coalesce((SELECT cash_alert_email FROM erp_settings WHERE id = 1), false));
END;
$function$;

-- Al prenderlo, las cajas sin corte de antes no se mandan (solo las que pasen de ahí en adelante).
CREATE OR REPLACE FUNCTION public.admin_set_cash_alert_email(p_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_enabled AND NOT coalesce((SELECT cash_alert_email FROM erp_settings WHERE id = 1), false) THEN
    UPDATE cash_sessions SET alert_emailed_at = now() WHERE auto_closed AND alert_emailed_at IS NULL;
  END IF;
  UPDATE erp_settings SET cash_alert_email = coalesce(p_enabled, false) WHERE id = 1;
  PERFORM erp_audit('cash_alert_email', 'settings', NULL, NULL, jsonb_build_object('enabled', p_enabled));
  RETURN jsonb_build_object('success', true);
END;
$function$;

DO $grants$
BEGIN
  REVOKE ALL ON FUNCTION public.cash_alerts_to_email() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.cash_alerts_to_email() TO service_role;
  REVOKE ALL ON FUNCTION public.get_cash_alert_email() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.admin_set_cash_alert_email(boolean) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_cash_alert_email() TO authenticated;
  GRANT EXECUTE ON FUNCTION public.admin_set_cash_alert_email(boolean) TO authenticated;
END;
$grants$;
