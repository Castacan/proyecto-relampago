-- ============================================================
-- Domiciliados que vienen de EVO (2026-11-11).
-- Correr DESPUÉS de erp.sql y del SQL de membresías de EVO
-- (scripts/evo_membresias_sql.py).
--
-- Lista a quien tuvo "Membresía Domiciliación" importada de EVO en los
-- últimos 60 días: hasta cuándo pagó en EVO, cuándo le cobraría EVO otra vez
-- y si ya tiene domiciliación en Relámpago. La pantalla Domiciliaciones lo
-- usa para la tarjeta "Pasar de EVO".
--
-- Para no cobrar doble: la domiciliación de Relámpago empieza sola el día
-- siguiente a su membresía vigente (admin_create_subscription), y hay que
-- cancelar su cobro en EVO ANTES de ese día.
-- Idempotente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_evo_subscribers()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('people', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'evo_until') FROM (
      SELECT jsonb_build_object(
        'person_id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
        'evo_until', max(m.valid_until),
        'evo_next_charge', max(m.valid_until) + 1,
        'membership_until', erp_membership_until(p.id),
        'subscription_status', (SELECT s.status FROM subscriptions s WHERE s.person_id = p.id AND s.status <> 'cancelled'
                                ORDER BY s.created_at DESC LIMIT 1),
        'subscription_start', (SELECT s.start_on FROM subscriptions s WHERE s.person_id = p.id AND s.status <> 'cancelled'
                               ORDER BY s.created_at DESC LIMIT 1)
      ) AS x
      FROM memberships m JOIN people p ON p.id = m.person_id
      WHERE m.note LIKE 'Importada de EVO%' AND m.plan_name ILIKE '%domiciliaci%' AND NOT m.is_void
      GROUP BY p.id
      HAVING max(m.valid_until) >= erp_today() - 60
    ) q
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_evo_subscribers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_evo_subscribers() TO authenticated;
