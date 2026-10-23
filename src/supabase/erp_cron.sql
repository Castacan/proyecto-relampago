-- ============================================================
-- Cobro automático de domiciliaciones (pg_cron → Edge Function "billing").
-- Requiere erp.sql y la función "billing" desplegada.
--
-- Corre cada hora, de 9:00 a 21:00 hora de México (15:00–03:00 UTC), y
-- cobra lo que toque hoy + los reintentos que ya vencieron. Es seguro
-- correrlo de más: cada ciclo se aparta una sola vez (billing_claim_due).
--
-- ANTES DE CORRER: si definiste el secreto BILLING_CRON_KEY en Supabase,
-- reemplaza PON_AQUI_TU_BILLING_CRON_KEY por ese mismo valor. Si no lo
-- definiste, deja la línea así (la función no la pide).
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'erp-cobros-domiciliacion';
SELECT cron.schedule(
  'erp-cobros-domiciliacion',
  '5 15-23,0-3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nptpavtkqskzqurwaysm.supabase.co/functions/v1/billing',
    headers := '{"Content-Type": "application/json", "x-cron-key": "PON_AQUI_TU_BILLING_CRON_KEY"}'::jsonb,
    body := '{"action": "run_due"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
