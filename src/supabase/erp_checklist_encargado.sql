-- ============================================================
-- Encargado fijo del checklist (2026-10-26).
-- Requiere erp_checklist.sql (córrelo DESPUÉS). Idempotente.
--
--   Inge: "Erick es encargado siempre". El admin elige un encargado fijo y
--   todo día nuevo lo toma solo. Un día en particular se puede cambiar en
--   /staff/turnos (eso manda sobre el fijo).
-- ============================================================

ALTER TABLE public.checklist_settings
  ADD COLUMN IF NOT EXISTS default_lead_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Todo día que se crea sin encargado toma el fijo.
CREATE OR REPLACE FUNCTION public.erp_checklist_default_lead_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.lead_id IS NULL THEN
    NEW.lead_id := (SELECT default_lead_id FROM checklist_settings WHERE id = 1);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS checklist_days_default_lead ON public.checklist_days;
CREATE TRIGGER checklist_days_default_lead BEFORE INSERT ON public.checklist_days
  FOR EACH ROW EXECUTE FUNCTION public.erp_checklist_default_lead_trg();

CREATE OR REPLACE FUNCTION public.get_checklist_default_lead()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT default_lead_id INTO v_id FROM checklist_settings WHERE id = 1;
  RETURN jsonb_build_object('lead_id', v_id, 'lead_name', (SELECT name FROM profiles WHERE id = v_id));
END;
$function$;

-- Guarda el fijo y se lo pone a los días de hoy en adelante que siguen abiertos y sin encargado.
CREATE OR REPLACE FUNCTION public.admin_set_checklist_default_lead(p_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_n INT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  UPDATE checklist_settings SET default_lead_id = p_profile_id WHERE id = 1;
  UPDATE checklist_days SET lead_id = p_profile_id, updated_at = now()
   WHERE p_profile_id IS NOT NULL AND lead_id IS NULL AND status = 'open' AND day_date >= erp_today();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM erp_audit('checklist_default_lead', 'checklist', NULL, NULL, jsonb_build_object('lead_id', p_profile_id));
  RETURN jsonb_build_object('success', true, 'days_updated', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_checklist_default_lead_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_checklist_default_lead() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_checklist_default_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checklist_default_lead() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_checklist_default_lead(uuid) TO authenticated;
