-- ============================================================
-- Cobro con la terminal física de Clip desde Vender (API de PinPad) — 2026-11-11.
-- Correr DESPUÉS de erp.sql y erp_finanzas.sql.
--
-- Flujo: Vender arma la venta → la Edge Function clip-terminal manda el monto
-- a la terminal (POST /f2f/pinpad/v1/payment) → el cliente pasa su tarjeta →
-- Vender consulta el resultado → si se aprobó, se guarda la venta con método
-- 'card' y se liga el cobro (terminal_payments.sale_id).
--
-- Reglas:
--   * Nada marca un cobro como aprobado desde el navegador: solo la Edge
--     Function, con lo que responde la API de Clip.
--   * Un cobro aprobado que no terminó en venta (se cerró la pestaña, falló la
--     venta) NUNCA se pierde: aparece en "Cobros de terminal sin venta" hasta
--     que alguien lo resuelva con una nota.
-- Idempotente: se puede volver a correr.
-- ============================================================

ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS clip_terminal_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.erp_settings ADD COLUMN IF NOT EXISTS clip_terminal_serial TEXT;

CREATE TABLE IF NOT EXISTS public.terminal_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL DEFAULT 'clip',
  request_id        TEXT UNIQUE,                 -- pinpad-{uuid} que regresa Clip
  serial_number     TEXT NOT NULL,
  amount_cents      INT  NOT NULL CHECK (amount_cents >= 100),
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'creating'
                    CHECK (status IN ('creating','sent','in_process','approved','declined','cancelled','error')),
  error             TEXT,
  amount_paid_cents INT,
  card_brand        TEXT,
  card_last4        TEXT,
  card_issuer       TEXT,
  transaction_id    TEXT,
  sale_id           UUID REFERENCES public.sales(id),
  resolved_note     TEXT,
  resolved_by       UUID,
  resolved_at       TIMESTAMPTZ,
  raw               JSONB,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS terminal_payments_open_idx ON public.terminal_payments (created_at DESC)
  WHERE status = 'approved' AND sale_id IS NULL AND resolved_at IS NULL;

-- Sin políticas: solo la Edge Function (service role) y las RPC de abajo la tocan.
ALTER TABLE public.terminal_payments ENABLE ROW LEVEL SECURITY;

-- Lo que Vender necesita saber: si la terminal está prendida.
CREATE OR REPLACE FUNCTION public.get_clip_terminal_settings()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN (SELECT jsonb_build_object('enabled', s.clip_terminal_enabled AND coalesce(s.clip_terminal_serial, '') <> '',
                                    'serial', s.clip_terminal_serial, 'is_admin', class_is_admin())
          FROM erp_settings s WHERE s.id = 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_clip_terminal(p_enabled BOOLEAN, p_serial TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_serial TEXT := nullif(upper(regexp_replace(coalesce(p_serial, ''), '\s', '', 'g')), '');
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_serial IS NOT NULL AND v_serial !~ '^[A-Z0-9-]{6,40}$' THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF coalesce(p_enabled, false) AND v_serial IS NULL THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  UPDATE erp_settings SET clip_terminal_enabled = coalesce(p_enabled, false), clip_terminal_serial = v_serial, updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Liga un cobro aprobado con la venta que se acaba de guardar (por folio).
CREATE OR REPLACE FUNCTION public.staff_link_terminal_payment(p_id UUID, p_folio BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sale UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT id INTO v_sale FROM sales WHERE folio = p_folio;
  IF v_sale IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  UPDATE terminal_payments SET sale_id = v_sale, updated_at = now()
  WHERE id = p_id AND status = 'approved' AND sale_id IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Cobros aprobados en la terminal que no quedaron en ninguna venta.
CREATE OR REPLACE FUNCTION public.get_unlinked_terminal_payments()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('payments', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'amount_cents', coalesce(t.amount_paid_cents, t.amount_cents),
             'description', t.description, 'card_brand', t.card_brand, 'card_last4', t.card_last4,
             'created_at', t.created_at, 'by', (SELECT name FROM profiles WHERE id = t.created_by)) ORDER BY t.created_at DESC)
    FROM terminal_payments t
    WHERE t.status = 'approved' AND t.sale_id IS NULL AND t.resolved_at IS NULL), '[]'::jsonb));
END;
$function$;

-- "Ya lo resolví" con nota obligatoria (p. ej. "registré la venta #123 a mano").
CREATE OR REPLACE FUNCTION public.staff_resolve_terminal_payment(p_id UUID, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_note, ''))) < 3 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  UPDATE terminal_payments SET resolved_note = btrim(p_note), resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
  WHERE id = p_id AND status = 'approved' AND sale_id IS NULL AND resolved_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_clip_terminal_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_clip_terminal(BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_link_terminal_payment(UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_unlinked_terminal_payments() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_resolve_terminal_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clip_terminal_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_clip_terminal(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_link_terminal_payment(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unlinked_terminal_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_resolve_terminal_payment(UUID, TEXT) TO authenticated;
