-- Parche 2026-10-23: Openpay exige device_session_id también al cobrar.
-- Se guarda el del registro de la tarjeta y se reusa en cada cobro.
-- (Ya está incluido en erp.sql; esto es solo para la base que ya lo tenía corrido.)
-- Idempotente. Correr ANTES de desplegar la nueva versión de la función billing.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_device_session TEXT;

CREATE OR REPLACE FUNCTION public.billing_save_device_session(p_subscription_id UUID, p_device_session TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  UPDATE subscriptions SET provider_device_session = NULLIF(p_device_session, ''), updated_at = now() WHERE id = p_subscription_id;
$function$;

REVOKE ALL ON FUNCTION public.billing_save_device_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_save_device_session(uuid, text) TO service_role;
