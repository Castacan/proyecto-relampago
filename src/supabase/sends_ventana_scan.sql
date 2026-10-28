-- ============================================================
-- Ventana de 30 min por escaneo, no por ruta (2026-10-28). Idempotente.
--
--   Inge: si ya escaneaste un QR, durante media hora puedes mandar cualquier
--   ruta sin volver a escanear (el escaneo prueba que estás en el muro).
--   Antes submit_send pedía un escaneo de ESA ruta en los últimos 30 min.
--
--   Se parcha la versión que está en producción (pg_get_functiondef) quitando
--   solo la condición "route_id = p_route_id" del chequeo de escaneo, para no
--   pisar otros cambios que tenga la función.
-- ============================================================

DO $patch$
DECLARE
  v_def TEXT := pg_get_functiondef('public.submit_send(uuid, text)'::regprocedure);
  v_new TEXT;
BEGIN
  v_new := regexp_replace(v_def,
    'FROM scans\s+WHERE route_id = p_route_id\s+AND \(user_id = v_uid OR device_id = p_device_id\)',
    'FROM scans
      WHERE (user_id = v_uid OR device_id = p_device_id)');
  IF v_new = v_def THEN
    IF v_def ~ 'FROM scans\s+WHERE \(user_id = v_uid OR device_id = p_device_id\)' THEN
      RAISE NOTICE 'submit_send ya tenía la ventana por escaneo';
    ELSE
      RAISE EXCEPTION 'submit_send no tiene el chequeo de escaneo esperado; no se cambió nada';
    END IF;
  ELSE
    EXECUTE v_new;
  END IF;
END;
$patch$;
