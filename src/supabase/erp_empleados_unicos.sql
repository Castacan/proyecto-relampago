-- ============================================================
-- Una sola ficha de empleado por persona (2026-10-28). Requiere erp_crm.sql,
-- erp_asistencia.sql y erp_nomina.sql. Idempotente; correr después de ellos
-- (redefine admin_save_employee y erp_ensure_employee).
--
--   Erick salió dos veces en Asistencia: la ficha que Inge dio de alta (con
--   horario y pago de $320 por día) y la que el sistema creó sola al ligar su
--   usuario de staff. Se queda la ficha con horario; de la otra se pasan su
--   usuario, checadas, aviso firmado, justificaciones y archivos, y se borra.
--
--   Para que no vuelva a pasar:
--   · Un usuario del panel solo puede estar en una ficha (índice único).
--   · "Nuevo empleado" con acceso al panel: al crear el usuario el sistema ya
--     le hace su ficha; ahora el formulario guarda en ESA ficha, no en otra.
--   · Si a una ficha se le liga un usuario que ya tenía otra ficha, se unen.
--   · Nuevo empleado con el mismo nombre o correo que una ficha activa: avisa
--     ("ya existe") en lugar de duplicarla.
--   · Staff nuevo: se liga a la ficha que ya exista aunque el nombre del
--     usuario sea más corto ("Erick" ↔ "Erick Heli Jimenez…"), si es la única.
-- ============================================================

CREATE OR REPLACE FUNCTION public.erp_merge_employees(p_keep UUID, p_drop UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  d employees%ROWTYPE;
BEGIN
  IF p_keep = p_drop THEN RAISE EXCEPTION 'misma ficha'; END IF;
  SELECT * INTO d FROM employees WHERE id = p_drop;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM employees WHERE id = p_keep) THEN RAISE EXCEPTION 'ficha no encontrada'; END IF;

  UPDATE attendance_punches SET employee_id = p_keep WHERE employee_id = p_drop;
  INSERT INTO attendance_consents (employee_id, version, text, typed_name, ip, accepted_at)
    SELECT p_keep, version, text, typed_name, ip, accepted_at FROM attendance_consents WHERE employee_id = p_drop
    ON CONFLICT (employee_id, version) DO NOTHING;
  INSERT INTO attendance_excuses (employee_id, day_date, note, created_by, created_at)
    SELECT p_keep, day_date, note, created_by, created_at FROM attendance_excuses WHERE employee_id = p_drop
    ON CONFLICT (employee_id, day_date) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM employee_schedules WHERE employee_id = p_keep) THEN
    UPDATE employee_schedules SET employee_id = p_keep WHERE employee_id = p_drop;
  END IF;
  UPDATE person_files SET owner_id = p_keep WHERE owner_kind = 'employee' AND owner_id = p_drop;

  DELETE FROM employees WHERE id = p_drop;
  UPDATE employees k SET
    profile_id = coalesce(k.profile_id, d.profile_id), email = coalesce(k.email, d.email), phone = coalesce(k.phone, d.phone),
    position = coalesce(k.position, d.position), hire_date = least(k.hire_date, d.hire_date),
    pay_scheme = coalesce(k.pay_scheme, d.pay_scheme), pay_rate_cents = coalesce(k.pay_rate_cents, d.pay_rate_cents),
    pay_every = coalesce(k.pay_every, d.pay_every), payee_id = coalesce(k.payee_id, d.payee_id),
    bank_name = coalesce(k.bank_name, d.bank_name), bank_account = coalesce(k.bank_account, d.bank_account),
    emergency_name = coalesce(k.emergency_name, d.emergency_name), emergency_phone = coalesce(k.emergency_phone, d.emergency_phone),
    notes = coalesce(k.notes, d.notes), updated_at = now()
  WHERE k.id = p_keep;
  PERFORM erp_audit('employee_merge', 'employee', p_keep, to_jsonb(d), jsonb_build_object('merged_into', p_keep));
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_merge_employees(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Erick: queda la ficha con horario, se une la que tiene su usuario.
DO $erick$
DECLARE
  v_keep UUID;
  v_drop UUID;
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM employees WHERE full_name ILIKE 'Erick%' AND status = 'active';
  IF v_n < 2 THEN RAISE NOTICE 'Erick ya tiene una sola ficha; no se cambió nada'; RETURN; END IF;
  IF v_n > 2 THEN RAISE EXCEPTION 'Hay % fichas de Erick; revisar a mano', v_n; END IF;

  SELECT id INTO v_keep FROM employees e WHERE full_name ILIKE 'Erick%' AND status = 'active'
    ORDER BY EXISTS (SELECT 1 FROM employee_schedules s WHERE s.employee_id = e.id) DESC, (pay_rate_cents IS NOT NULL) DESC, created_at LIMIT 1;
  SELECT id INTO v_drop FROM employees WHERE full_name ILIKE 'Erick%' AND status = 'active' AND id <> v_keep;
  IF (SELECT profile_id FROM employees WHERE id = v_keep) IS NOT NULL AND (SELECT profile_id FROM employees WHERE id = v_drop) IS NOT NULL THEN
    RAISE EXCEPTION 'Las dos fichas de Erick tienen usuario; revisar a mano';
  END IF;

  PERFORM erp_merge_employees(v_keep, v_drop);
  RAISE NOTICE 'Erick unido en la ficha %', v_keep;
END;
$erick$;

-- Un usuario del panel, una sola ficha.
CREATE UNIQUE INDEX IF NOT EXISTS employees_profile_unique ON public.employees (profile_id) WHERE profile_id IS NOT NULL;

-- Staff nuevo: también se liga si el nombre del usuario es el inicio del nombre de la ficha.
CREATE OR REPLACE FUNCTION public.erp_ensure_employee(p_profile UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_name TEXT;
  v_email TEXT;
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM employees WHERE profile_id = p_profile ORDER BY (status = 'active') DESC, created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT p.name, u.email INTO v_name, v_email
    FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.id = p_profile AND p.role = 'staff';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM employees
   WHERE profile_id IS NULL AND status = 'active'
     AND ((v_email IS NOT NULL AND lower(email) = lower(v_email)) OR lower(btrim(full_name)) = lower(btrim(v_name)))
   ORDER BY (v_email IS NOT NULL AND lower(email) = lower(v_email)) DESC, created_at LIMIT 1;
  -- "Erick" ↔ "Erick Heli Jimenez…": solo si hay una sola ficha que empiece así.
  IF v_id IS NULL AND length(btrim(coalesce(v_name, ''))) >= 3 THEN
    SELECT min(id::text)::uuid INTO v_id FROM employees
     WHERE profile_id IS NULL AND status = 'active'
       AND (lower(btrim(full_name)) LIKE lower(btrim(v_name)) || ' %' OR lower(btrim(v_name)) LIKE lower(btrim(full_name)) || ' %')
    HAVING count(*) = 1;
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE employees SET profile_id = p_profile, email = coalesce(email, v_email), updated_at = now() WHERE id = v_id;
  ELSE
    INSERT INTO employees (full_name, profile_id, email, hire_date)
    VALUES (coalesce(nullif(btrim(v_name), ''), v_email, 'Staff'), p_profile, v_email, (now() AT TIME ZONE 'America/Mexico_City')::date)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$function$;

-- "Nuevo empleado" / editar ficha: una ficha por usuario y sin duplicar nombres.
CREATE OR REPLACE FUNCTION public.admin_save_employee(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id    UUID := nullif(p->>'id', '')::uuid;
  v_name  TEXT := regexp_replace(btrim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_payee UUID;
  v_prof  UUID := nullif(p->>'profile_id', '')::uuid;
  v_email TEXT := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_other UUID;
  t       TEXT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 3 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  -- Una ficha por usuario: si el usuario ya tiene ficha (p. ej. la que se creó
  -- sola al darle acceso al panel), se guarda en ella o se une con esta.
  IF v_prof IS NOT NULL THEN
    SELECT id INTO v_other FROM employees WHERE profile_id = v_prof AND id IS DISTINCT FROM v_id;
    IF v_other IS NOT NULL THEN
      IF v_id IS NULL THEN v_id := v_other; ELSE PERFORM erp_merge_employees(v_id, v_other); END IF;
    END IF;
  END IF;
  -- Nueva ficha sin usuario: si ya hay una activa con ese nombre o correo, avisar.
  IF v_id IS NULL THEN
    SELECT full_name INTO t FROM employees
     WHERE status = 'active' AND (lower(full_name) = lower(v_name) OR (v_email IS NOT NULL AND lower(email) = v_email)) LIMIT 1;
    IF t IS NOT NULL THEN RETURN jsonb_build_object('error', 'employee_exists', 'name', t); END IF;
    t := NULL;
  END IF;
  -- Cada empleado tiene su "a quién se paga" para que la nómina caiga en Egresos.
  SELECT id INTO v_payee FROM expense_payees WHERE lower(name) = lower(v_name);
  IF v_payee IS NULL THEN
    INSERT INTO expense_payees (name, kind, default_category) VALUES (v_name, 'employee', 'Nómina') RETURNING id INTO v_payee;
  ELSE
    UPDATE expense_payees SET kind = 'employee', default_category = coalesce(default_category, 'Nómina') WHERE id = v_payee;
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO employees (full_name, payee_id) VALUES (v_name, v_payee) RETURNING id INTO v_id;
    END IF;
    UPDATE employees SET full_name = v_name, payee_id = v_payee,
      position = nullif(btrim(coalesce(p->>'position', '')), ''), profile_id = v_prof,
      phone = nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), ''), email = v_email,
      birth_date = nullif(p->>'birth_date', '')::date, address = nullif(btrim(coalesce(p->>'address', '')), ''),
      curp = nullif(upper(btrim(coalesce(p->>'curp', ''))), ''), rfc = nullif(upper(btrim(coalesce(p->>'rfc', ''))), ''),
      nss = nullif(btrim(coalesce(p->>'nss', '')), ''), hire_date = nullif(p->>'hire_date', '')::date, end_date = nullif(p->>'end_date', '')::date,
      status = coalesce(nullif(p->>'status', ''), 'active'), pay_scheme = nullif(p->>'pay_scheme', ''),
      pay_rate_cents = nullif(p->>'pay_rate_cents', '')::int, bank_name = nullif(btrim(coalesce(p->>'bank_name', '')), ''),
      bank_account = nullif(btrim(coalesce(p->>'bank_account', '')), ''), emergency_name = nullif(btrim(coalesce(p->>'emergency_name', '')), ''),
      emergency_phone = nullif(regexp_replace(coalesce(p->>'emergency_phone', ''), '\D', '', 'g'), ''), notes = nullif(btrim(coalesce(p->>'notes', '')), ''),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'employee_exists');
  WHEN check_violation OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  PERFORM erp_audit('employee_save', 'employee', v_id, NULL, p - 'bank_account');
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;
