-- Correos automáticos del CRM: una corrida diaria a las 10:00 (hora de México).
-- Correr DESPUÉS de desplegar la Edge Function crm-emails (Verify JWT apagado)
-- y de erp_cron.sql (de ahí toma la misma llave x-cron-key, no hay que pegarla).
-- Las automatizaciones vienen apagadas: aunque corra, no manda nada hasta que
-- se prendan en el panel (Configuración → Correos automáticos).
DO $cron$
DECLARE
  v_key TEXT;
BEGIN
  SELECT substring(command FROM '"x-cron-key": "([^"]+)"') INTO v_key FROM cron.job WHERE jobname = 'erp-cobros-domiciliacion';
  IF v_key IS NULL OR v_key = 'PON_AQUI_TU_BILLING_CRON_KEY' THEN
    RAISE EXCEPTION 'Primero corre erp_cron.sql con tu BILLING_CRON_KEY';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-correos-automaticos';
  PERFORM cron.schedule(
    'crm-correos-automaticos',
    '0 16 * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://nptpavtkqskzqurwaysm.supabase.co/functions/v1/crm-emails',
        headers := %L::jsonb,
        body := '{"action": "run"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cmd$, jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key)::text)
  );
END;
$cron$;
