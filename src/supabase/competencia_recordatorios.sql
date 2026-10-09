-- ============================================================
-- Competencia — recordatorio de pago por correo (2026-10-08)
-- A quien se inscribió y no ha pagado se le manda UN correo cuando faltan
-- 6 horas (o menos) para que venza su plazo (hold_expires_at).
-- Requiere competencia.sql, competencia_pagos.sql y competencia_manual.sql.
-- Idempotente.
--
-- Cómo corre: pg_cron llama cada 15 minutos a la Edge Function
-- competition-payments con {action:'remind'}; la función pide aquí a quién
-- le toca, revisa con Clip que de verdad no haya pagado y manda el correo.
-- ============================================================

-- Cuándo se le mandó el recordatorio. Solo uno por inscripción, aunque el
-- plazo se renueve después.
ALTER TABLE public.competition_registrations ADD COLUMN IF NOT EXISTS payment_reminder_at TIMESTAMPTZ;

-- Aparta (marca como enviadas) las inscripciones a las que les toca
-- recordatorio y las devuelve. Marcar y devolver en la misma instrucción
-- evita que dos corridas simultáneas manden el correo dos veces.
-- Incluye las que ya vencieron sin haber recibido recordatorio.
CREATE OR REPLACE FUNCTION public.competition_claim_payment_reminders(p_limit INT DEFAULT 20)
RETURNS TABLE (
  registration_id UUID, folio TEXT, full_name TEXT, email TEXT, category_name TEXT,
  competition_name TEXT, event_date DATE, event_time_text TEXT, price_cents INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM competition_registrations r
    JOIN competitions c ON c.id = r.competition_id
    WHERE r.status = 'pending_payment'
      AND r.payment_reminder_at IS NULL
      AND r.email IS NOT NULL
      AND r.hold_expires_at <= now() + INTERVAL '6 hours'
      AND c.is_open
      AND c.event_date >= (now() AT TIME ZONE 'America/Mexico_City')::date
    ORDER BY r.hold_expires_at
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)
    FOR UPDATE OF r SKIP LOCKED
  ), claimed AS (
    UPDATE competition_registrations r SET payment_reminder_at = now()
    FROM due WHERE r.id = due.id
    RETURNING r.id, r.folio, r.full_name, r.email, r.category_id, r.competition_id
  )
  SELECT k.id, k.folio, k.full_name, k.email, cat.name, c.name, c.event_date, c.event_time_text, c.price_cents
  FROM claimed k
  JOIN competitions c ON c.id = k.competition_id
  LEFT JOIN competition_categories cat ON cat.id = k.category_id;
END;
$function$;

-- Suelta un recordatorio apartado que no se pudo mandar por una falla
-- pasajera (red, Resend caído), para reintentarlo en la siguiente corrida.
CREATE OR REPLACE FUNCTION public.competition_release_payment_reminder(p_registration_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  UPDATE competition_registrations SET payment_reminder_at = NULL
  WHERE id = p_registration_id AND status = 'pending_payment';
END;
$function$;

REVOKE ALL ON FUNCTION public.competition_claim_payment_reminders(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_release_payment_reminder(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_claim_payment_reminders(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.competition_release_payment_reminder(UUID) TO service_role;

-- ---------- Programación: cada 15 minutos ----------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'competencia-recordatorios';
SELECT cron.schedule(
  'competencia-recordatorios',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nptpavtkqskzqurwaysm.supabase.co/functions/v1/competition-payments',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "remind"}'::jsonb
  );
  $cron$
);
