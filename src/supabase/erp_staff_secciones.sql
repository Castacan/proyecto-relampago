-- ============================================================
-- Secciones del panel activas para el staff (2026-10-28).
-- Requiere erp.sql. Idempotente.
--
--   Inge: mientras no todo está al 100, el staff solo ve Inicio, Turno de hoy,
--   Mi asistencia, Muro, QRs y Spraywall; las demás se activan poco a poco
--   desde Equipo → Empleados → "Secciones que ve el staff". El admin ve todo.
--   Es un filtro del menú y de las pantallas (no cambia permisos de la base).
-- ============================================================

ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS staff_sections TEXT[]
  NOT NULL DEFAULT ARRAY['inicio','turno','asistencia','muro','qr','spraywall'];

CREATE OR REPLACE FUNCTION public.admin_set_staff_sections(p_sections TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_before TEXT[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT staff_sections INTO v_before FROM erp_settings WHERE id = 1;
  UPDATE erp_settings SET staff_sections = (SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') FROM unnest(coalesce(p_sections, '{}')) s
                                            WHERE s ~ '^[a-z_]{2,30}$')
  WHERE id = 1;
  PERFORM erp_audit('staff_sections', 'settings', NULL, jsonb_build_object('sections', v_before), jsonb_build_object('sections', p_sections));
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_staff_sections(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_sections(text[]) TO authenticated;
