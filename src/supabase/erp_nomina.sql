-- ============================================================
-- Nómina: cómo se calcula vs. cada cuánto se paga (2026-10-28).
-- Requiere erp_crm.sql y erp_asistencia.sql. Idempotente.
--
--   Inge puso a Erick "Quincenal $320", pero los $320 son por día. Ahora:
--   · pay_scheme = cómo se calcula: daily (por día), hourly, per_class, per_job,
--     o sueldo fijo weekly / biweekly / monthly (como antes).
--   · pay_every  = cada cuánto se le paga (semana, quincena, mes).
--   · get_payroll_suggestion: días con horario, días que vino (Mi asistencia),
--     horas, retardos y faltas del periodo, y el monto sugerido.
-- ============================================================

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_pay_scheme_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_pay_scheme_check
  CHECK (pay_scheme IN ('daily','weekly','biweekly','monthly','per_class','hourly','per_job'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pay_every TEXT CHECK (pay_every IN ('weekly','biweekly','monthly'));

-- Sueldo fijo: se paga con la misma frecuencia.
UPDATE public.employees SET pay_every = pay_scheme WHERE pay_every IS NULL AND pay_scheme IN ('weekly','biweekly','monthly');

-- Erick: $320 son por día, pagado cada quincena (dicho por Inge el 2026-10-28).
UPDATE public.employees SET pay_scheme = 'daily', pay_every = 'biweekly', updated_at = now()
WHERE full_name ILIKE 'Erick%' AND pay_scheme = 'biweekly' AND pay_rate_cents = 32000;

CREATE OR REPLACE FUNCTION public.admin_set_employee_pay_every(p_employee_id UUID, p_every TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF nullif(p_every, '') IS NOT NULL AND p_every NOT IN ('weekly','biweekly','monthly') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  UPDATE employees SET pay_every = nullif(p_every, ''), updated_at = now() WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Lo que le toca a un empleado en un periodo. El admin decide el monto final.
CREATE OR REPLACE FUNCTION public.get_payroll_suggestion(p_employee_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  e employees%ROWTYPE;
  v_sched INT;
  v_worked INT;
  v_minutes NUMERIC;
  v_lates INT;
  v_abs INT;
  v_late_abs INT;
  v_excused INT;
  v_has_att BOOLEAN;
  v_basis TEXT;
  v_units NUMERIC;
  v_amount BIGINT;
  v_k INT := coalesce((SELECT lates_per_absence FROM attendance_settings WHERE id = 1), 3);
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p_to < p_from OR p_to - p_from > 62 THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;

  -- Días con horario en el periodo (aunque sean futuros).
  SELECT count(*) INTO v_sched
  FROM generate_series(greatest(p_from, coalesce(e.hire_date, p_from)), least(p_to, coalesce(e.end_date, p_to)), interval '1 day') d
  JOIN employee_schedules s ON s.employee_id = e.id AND s.dow = extract(isodow FROM d)::int;

  SELECT count(*) FILTER (WHERE first_in IS NOT NULL),
         coalesce(sum(extract(epoch FROM (last_out - first_in)) / 60) FILTER (WHERE first_in IS NOT NULL AND last_out > first_in), 0),
         count(*) FILTER (WHERE status = 'late'),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status = 'absent_late'),
         count(*) FILTER (WHERE status = 'excused')
    INTO v_worked, v_minutes, v_lates, v_abs, v_late_abs, v_excused
  FROM erp_attendance_days(e.id, p_from, p_to);
  v_has_att := EXISTS (SELECT 1 FROM attendance_punches WHERE employee_id = e.id AND day_date BETWEEN p_from AND p_to);

  IF e.pay_scheme = 'daily' THEN
    IF v_has_att THEN v_basis := 'asistencia'; v_units := v_worked; ELSE v_basis := 'horario'; v_units := v_sched; END IF;
    v_amount := round(v_units * coalesce(e.pay_rate_cents, 0));
  ELSIF e.pay_scheme = 'hourly' THEN
    v_basis := 'asistencia'; v_units := round(v_minutes / 60.0, 2);
    v_amount := round(v_units * coalesce(e.pay_rate_cents, 0));
  ELSIF e.pay_scheme IN ('weekly','biweekly','monthly') THEN
    v_basis := 'fijo'; v_units := 1; v_amount := coalesce(e.pay_rate_cents, 0);
  ELSE
    v_basis := 'manual'; v_units := NULL; v_amount := NULL;
  END IF;

  RETURN jsonb_build_object(
    'scheme', e.pay_scheme, 'every', e.pay_every, 'rate_cents', e.pay_rate_cents,
    'from', p_from, 'to', p_to,
    'scheduled_days', v_sched, 'worked_days', v_worked, 'hours', round(v_minutes / 60.0, 1),
    'lates', v_lates, 'absences', v_abs + v_late_abs, 'late_absences', v_late_abs, 'excused', v_excused,
    'lates_per_absence', v_k, 'has_attendance', v_has_att,
    'basis', v_basis, 'units', v_units, 'suggested_cents', v_amount
  );
END;
$function$;

DO $grants$
BEGIN
  REVOKE ALL ON FUNCTION public.admin_set_employee_pay_every(uuid, text) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.get_payroll_suggestion(uuid, date, date) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.admin_set_employee_pay_every(uuid, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.get_payroll_suggestion(uuid, date, date) TO authenticated;
END;
$grants$;
