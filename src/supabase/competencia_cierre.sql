-- Competencia terminada: con "Inscripciones abiertas" apagado ya no se genera
-- ni se reusa ningún link de pago de Clip (antes, un folio pendiente podía
-- seguir pagando desde /competencia/consulta). Correr una vez en el SQL Editor.

CREATE OR REPLACE FUNCTION public.competition_begin_payment(p_folio TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_reg  competition_registrations%ROWTYPE;
  v_cat  competition_categories%ROWTYPE;
  v_pay  competition_payments%ROWTYPE;
  v_id   UUID;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c
  WHERE c.id = (SELECT r.competition_id FROM competition_registrations r
                WHERE r.folio = upper(btrim(coalesce(p_folio, ''))) AND r.email = lower(btrim(coalesce(p_email, ''))))
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.folio = upper(btrim(p_folio)) AND r.email = lower(btrim(p_email)) FOR UPDATE;

  IF v_reg.status = 'paid' THEN RETURN jsonb_build_object('error', 'already_paid'); END IF;
  IF v_reg.status <> 'pending_payment' THEN RETURN jsonb_build_object('error', 'not_payable'); END IF;
  -- Con las inscripciones cerradas ya no se cobra (ni se reusa un link viejo).
  IF NOT v_comp.is_open THEN RETURN jsonb_build_object('error', 'closed'); END IF;

  IF v_reg.hold_expires_at <= now() THEN
    SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
    IF competition_spots_taken(v_comp.id) >= v_comp.capacity_total
       OR (v_cat.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, v_cat.id) >= v_cat.capacity) THEN
      RETURN jsonb_build_object('error', 'full');
    END IF;
    UPDATE competition_registrations r
    SET hold_expires_at = now() + make_interval(hours => v_comp.hold_hours), updated_at = now()
    WHERE r.id = v_reg.id;
  END IF;

  -- ¿Ya hay un intento abierto?
  SELECT p.* INTO v_pay FROM competition_payments p
  WHERE p.registration_id = v_reg.id AND p.status IN ('created','pending')
  ORDER BY p.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_pay.provider_payment_id IS NOT NULL
       AND v_pay.amount_cents = v_comp.price_cents
       AND (v_pay.expires_at IS NULL OR v_pay.expires_at > now() + INTERVAL '10 minutes') THEN
      RETURN jsonb_build_object('reuse', true, 'payment_id', v_pay.id,
        'provider_payment_id', v_pay.provider_payment_id, 'payment_url', v_pay.payment_url);
    END IF;
    IF v_pay.provider_payment_id IS NULL THEN
      -- Otro clic está pidiéndole el link a Clip en este momento.
      IF v_pay.created_at > now() - INTERVAL '90 seconds' THEN RETURN jsonb_build_object('error', 'busy'); END IF;
      -- Intento que nunca recibió link: nadie pudo pagarlo.
      UPDATE competition_payments p SET status = 'failed', updated_at = now() WHERE p.id = v_pay.id;
    END IF;
    -- Si tiene link pero está por vencer o cambió el precio, se deja como
    -- está (la revisión contra Clip lo cierra) y se crea uno nuevo.
  END IF;

  INSERT INTO competition_payments (registration_id, amount_cents)
  VALUES (v_reg.id, v_comp.price_cents) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'payment_id', v_id,
    'amount_cents', v_comp.price_cents,
    'competition_name', v_comp.name,
    'folio', v_reg.folio,
    'full_name', v_reg.full_name,
    'email', v_reg.email,
    'phone', v_reg.phone
  );
END;
$function$;
