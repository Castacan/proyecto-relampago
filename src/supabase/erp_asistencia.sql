-- ============================================================
-- Asistencia del staff con selfie + WiFi del muro (2026-10-26).
-- Requiere erp_crm.sql (empleados) — córrelo DESPUÉS. Idempotente.
--
--   Cada empleado checa desde SU celular (opción a de Inge): toma una selfie y
--   la base revisa que la petición venga de la IP pública del WiFi del muro
--   (el nombre del WiFi no se puede leer desde el navegador).
--   El empleado se identifica por employees.profile_id = su usuario del panel.
--   Todo usuario con rol staff tiene ficha de empleado: se crea o se liga sola.
--
--   Reglas de Inge: 10 min de tolerancia; desde 25 min tarde es falta;
--   3 retardos en el mes = 1 falta. Todo editable en los ajustes.
--   Antes de su primer registro, cada empleado acepta el aviso de uso de su
--   foto (versión del texto; si el admin lo cambia, se vuelve a pedir).
-- ============================================================

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_settings (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tolerance_min     INT NOT NULL DEFAULT 10 CHECK (tolerance_min >= 0),
  absence_min       INT NOT NULL DEFAULT 25 CHECK (absence_min > 0),
  lates_per_absence INT NOT NULL DEFAULT 3 CHECK (lates_per_absence > 0),
  require_wifi      BOOLEAN NOT NULL DEFAULT true,
  counts_from       DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date),  -- antes de esta fecha no hay faltas
  consent_version   INT NOT NULL DEFAULT 1,
  consent_text      TEXT NOT NULL DEFAULT ''
);
INSERT INTO public.attendance_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
UPDATE public.attendance_settings SET consent_text =
  E'AVISO Y CONSENTIMIENTO PARA EL REGISTRO DE ASISTENCIA CON FOTOGRAFÍA (BORRADOR)\n\n'
  'Para registrar mi entrada y salida en Jaibamuro, la app toma una fotografía de mi cara y guarda la hora y la red (IP) desde la que registro.\n\n'
  '1. Finalidad: comprobar mi asistencia y puntualidad y calcular retardos y faltas. No se usa para nada más ni se comparte con terceros.\n'
  '2. Quién la ve: solo el administrador del gimnasio.\n'
  '3. Conservación: las fotos se guardan mientras dure la relación de trabajo y hasta 1 año después, y luego se borran.\n'
  '4. Mis derechos: puedo pedir acceso, corrección o cancelación de mis datos, u oponerme a su uso, escribiendo al administrador. Si no acepto, puedo pedir otra forma de registrar mi asistencia.\n\n'
  'Al aceptar, confirmo que leí este aviso y doy mi consentimiento expreso para el uso de mi fotografía con esta finalidad.'
WHERE id = 1 AND consent_text = '';

-- Redes del muro (IP pública). IPv4 exacta; IPv6 por su prefijo /64 (cada celular tiene otra dirección).
CREATE TABLE IF NOT EXISTS public.attendance_networks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  net        CIDR NOT NULL UNIQUE,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- Horario por empleado y día de la semana (1 = lunes … 7 = domingo).
CREATE TABLE IF NOT EXISTS public.employee_schedules (
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  dow         INT NOT NULL CHECK (dow BETWEEN 1 AND 7),
  start_time  TIME NOT NULL,
  end_time    TIME,
  PRIMARY KEY (employee_id, dow)
);

CREATE TABLE IF NOT EXISTS public.attendance_consents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  text        TEXT NOT NULL,
  typed_name  TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  UNIQUE (employee_id, version)
);

CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_date    DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('in','out')),
  at          TIMESTAMPTZ NOT NULL,
  photo_path  TEXT,
  ip          TEXT,
  source      TEXT NOT NULL DEFAULT 'phone' CHECK (source IN ('phone','admin')),
  note        TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_punches_emp_day_idx ON public.attendance_punches (employee_id, day_date, at);

-- Día justificado (permiso, incapacidad, día cambiado…): no cuenta retardo ni falta.
CREATE TABLE IF NOT EXISTS public.attendance_excuses (
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_date    DATE NOT NULL,
  note        TEXT NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, day_date)
);

-- Selfies: bucket privado 'asistencia' (el staff sube; solo el admin ve).
CREATE OR REPLACE FUNCTION public.erp_storage_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin');
$function$;

DO $storage$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('asistencia', 'asistencia', false, 10485760)
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS asistencia_admin_select ON storage.objects;
    DROP POLICY IF EXISTS asistencia_staff_insert ON storage.objects;
    CREATE POLICY asistencia_admin_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'asistencia' AND public.erp_storage_is_admin());
    CREATE POLICY asistencia_staff_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'asistencia' AND public.erp_storage_is_staff());
  END IF;
END;
$storage$;

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_now()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $function$
  SELECT coalesce(nullif(current_setting('test.now', true), '')::timestamptz, now());
$function$;

-- IP del celular que hace la petición (PostgREST pasa los headers en request.headers).
CREATE OR REPLACE FUNCTION public.erp_request_ip()
RETURNS INET LANGUAGE plpgsql STABLE AS $function$
DECLARE
  h JSONB;
  v TEXT;
BEGIN
  h := nullif(current_setting('request.headers', true), '')::jsonb;
  v := btrim(coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip', ''));
  IF v = '' THEN RETURN NULL; END IF;
  RETURN v::inet;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_ip_net(p_ip INET)
RETURNS CIDR LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE WHEN p_ip IS NULL THEN NULL
              WHEN family(p_ip) = 4 THEN set_masklen(p_ip, 32)::cidr
              ELSE network(set_masklen(p_ip, 64)) END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_ip_at_gym(p_ip INET)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT p_ip IS NOT NULL AND EXISTS (SELECT 1 FROM attendance_networks n WHERE p_ip <<= n.net);
$function$;

-- Todo el staff (no admin) es empleado: si su usuario no tiene ficha, se liga a una
-- ficha sin usuario con su mismo correo o nombre, o se le crea una.
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

CREATE OR REPLACE FUNCTION public.erp_my_employee()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  v_id := erp_ensure_employee(auth.uid());
  RETURN (SELECT id FROM employees WHERE id = v_id AND status = 'active');
END;
$function$;

-- Staff nuevo (alta desde Acceso al panel) → su ficha de empleado al momento.
CREATE OR REPLACE FUNCTION public.erp_profile_employee_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.role = 'staff' THEN PERFORM erp_ensure_employee(NEW.id); END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS profiles_ensure_employee ON public.profiles;
CREATE TRIGGER profiles_ensure_employee AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.erp_profile_employee_trg();

-- Los que ya son staff hoy.
SELECT public.erp_ensure_employee(id) FROM public.profiles WHERE role = 'staff';

-- Un renglón por día con horario (o con registro) del empleado en el rango.
--   status: ok | late | absent (no llegó) | absent_late (llegó ≥ absence_min tarde)
--           | excused | pending (hoy, aún dentro del margen) | extra (vino sin horario)
CREATE OR REPLACE FUNCTION public.erp_attendance_days(p_employee UUID, p_from DATE, p_to DATE)
RETURNS TABLE (day_date DATE, dow INT, start_time TIME, end_time TIME, first_in TIMESTAMPTZ, last_out TIMESTAMPTZ,
               minutes_late INT, status TEXT, excuse TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  s attendance_settings;
  e employees;
  v_now TIMESTAMPTZ := erp_now();
  v_today DATE := (erp_now() AT TIME ZONE 'America/Mexico_City')::date;
  v_from DATE;
  v_to DATE;
BEGIN
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  SELECT * INTO e FROM employees WHERE id = p_employee;
  IF e.id IS NULL THEN RETURN; END IF;
  v_from := greatest(p_from, s.counts_from, coalesce(e.hire_date, p_from));
  v_to := least(p_to, v_today, coalesce(e.end_date, p_to));
  RETURN QUERY
  WITH days AS (
    SELECT d::date AS d, extract(isodow FROM d)::int AS w FROM generate_series(v_from, v_to, interval '1 day') d
  ), x AS (
    SELECT days.d, days.w, sc.start_time AS st, sc.end_time AS et,
           (SELECT min(p.at) FROM attendance_punches p WHERE p.employee_id = p_employee AND p.day_date = days.d AND p.kind = 'in') AS fin,
           (SELECT max(p.at) FROM attendance_punches p WHERE p.employee_id = p_employee AND p.day_date = days.d AND p.kind = 'out') AS lout,
           (SELECT ex.note FROM attendance_excuses ex WHERE ex.employee_id = p_employee AND ex.day_date = days.d) AS exc,
           ((days.d + sc.start_time) AT TIME ZONE 'America/Mexico_City') AS due
    FROM days LEFT JOIN employee_schedules sc ON sc.employee_id = p_employee AND sc.dow = days.w
  ), y AS (
    SELECT x.*, CASE WHEN x.fin IS NOT NULL AND x.due IS NOT NULL
                     THEN greatest(0, floor(extract(epoch FROM (x.fin - x.due)) / 60))::int END AS late
    FROM x
  )
  SELECT y.d, y.w, y.st, y.et, y.fin, y.lout, y.late,
         CASE WHEN y.exc IS NOT NULL THEN 'excused'
              WHEN y.st IS NULL THEN 'extra'
              WHEN y.fin IS NULL THEN CASE WHEN y.d < v_today OR v_now >= y.due + make_interval(mins => s.absence_min) THEN 'absent' ELSE 'pending' END
              WHEN y.late >= s.absence_min THEN 'absent_late'
              WHEN y.late > s.tolerance_min THEN 'late'
              ELSE 'ok' END,
         y.exc
  FROM y
  WHERE y.st IS NOT NULL OR y.fin IS NOT NULL OR y.exc IS NOT NULL
  ORDER BY y.d;
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_attendance_summary(p_employee UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH d AS (SELECT * FROM erp_attendance_days(p_employee, p_from, p_to)),
       c AS (SELECT count(*) FILTER (WHERE status = 'late')::int AS lates,
                    count(*) FILTER (WHERE status IN ('absent','absent_late'))::int AS absences,
                    count(*) FILTER (WHERE status = 'ok')::int AS on_time,
                    count(*) FILTER (WHERE status = 'excused')::int AS excused
             FROM d),
       s AS (SELECT lates_per_absence AS k FROM attendance_settings WHERE id = 1)
  SELECT jsonb_build_object('lates', c.lates, 'absences', c.absences, 'on_time', c.on_time, 'excused', c.excused,
                            'absences_from_lates', c.lates / s.k, 'total_absences', c.absences + c.lates / s.k)
  FROM c, s;
$function$;

CREATE OR REPLACE FUNCTION public.erp_attendance_settings_json()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object('tolerance_min', tolerance_min, 'absence_min', absence_min, 'lates_per_absence', lates_per_absence,
                            'require_wifi', require_wifi, 'counts_from', counts_from, 'consent_version', consent_version)
  FROM attendance_settings WHERE id = 1;
$function$;

-- ------------------------------------------------------------
-- Empleado (desde su celular)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_attendance()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_emp UUID;
  e employees;
  s attendance_settings;
  v_ip INET := erp_request_ip();
  v_today DATE := (erp_now() AT TIME ZONE 'America/Mexico_City')::date;
  v_month DATE := date_trunc('month', (erp_now() AT TIME ZONE 'America/Mexico_City')::date)::date;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  v_emp := erp_my_employee();
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('employee', NULL, 'ip', host(v_ip), 'at_gym', erp_ip_at_gym(v_ip));
  END IF;
  SELECT * INTO e FROM employees WHERE id = v_emp;
  RETURN jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name),
    'today', v_today,
    'now', erp_now(),
    'ip', host(v_ip),
    'at_gym', erp_ip_at_gym(v_ip),
    'settings', erp_attendance_settings_json(),
    'needs_consent', NOT EXISTS (SELECT 1 FROM attendance_consents c WHERE c.employee_id = v_emp AND c.version = s.consent_version),
    'consent_text', s.consent_text,
    'schedule_today', (SELECT jsonb_build_object('start_time', start_time, 'end_time', end_time) FROM employee_schedules
                       WHERE employee_id = v_emp AND dow = extract(isodow FROM v_today)::int),
    'punches_today', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'at', p.at, 'source', p.source) ORDER BY p.at)
                               FROM attendance_punches p WHERE p.employee_id = v_emp AND p.day_date = v_today), '[]'::jsonb),
    'month', v_month,
    'summary', erp_attendance_summary(v_emp, v_month, v_today),
    'days', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day_date DESC) FROM erp_attendance_days(v_emp, v_month, v_today) d), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_accept_consent(p_typed_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_emp UUID := erp_my_employee();
  s attendance_settings;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('error', 'not_employee'); END IF;
  IF length(btrim(coalesce(p_typed_name, ''))) < 3 THEN RETURN jsonb_build_object('error', 'name_required'); END IF;
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  INSERT INTO attendance_consents (employee_id, version, text, typed_name, ip)
  VALUES (v_emp, s.consent_version, s.consent_text, btrim(p_typed_name), host(erp_request_ip()))
  ON CONFLICT (employee_id, version) DO NOTHING;
  PERFORM erp_audit('attendance_consent', 'employee', v_emp, NULL, jsonb_build_object('version', s.consent_version));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_punch(p_kind TEXT, p_photo_path TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_emp UUID := erp_my_employee();
  s attendance_settings;
  v_ip INET := erp_request_ip();
  v_now TIMESTAMPTZ := erp_now();
  v_day DATE := (erp_now() AT TIME ZONE 'America/Mexico_City')::date;
  v_last TEXT;
  v_id UUID;
  v_row RECORD;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('error', 'not_employee'); END IF;
  IF p_kind NOT IN ('in', 'out') THEN RETURN jsonb_build_object('error', 'bad_request'); END IF;
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  IF NOT EXISTS (SELECT 1 FROM attendance_consents c WHERE c.employee_id = v_emp AND c.version = s.consent_version) THEN
    RETURN jsonb_build_object('error', 'consent_required');
  END IF;
  IF s.require_wifi AND NOT erp_ip_at_gym(v_ip) THEN
    RETURN jsonb_build_object('error', 'not_at_gym', 'ip', host(v_ip));
  END IF;
  IF p_photo_path IS NULL OR p_photo_path NOT LIKE v_day::text || '/' || v_emp::text || '/%' THEN
    RETURN jsonb_build_object('error', 'photo_required');
  END IF;
  SELECT kind INTO v_last FROM attendance_punches WHERE employee_id = v_emp AND day_date = v_day ORDER BY at DESC LIMIT 1;
  IF p_kind = 'in' AND v_last = 'in' THEN RETURN jsonb_build_object('error', 'already_in'); END IF;
  IF p_kind = 'out' AND v_last IS DISTINCT FROM 'in' THEN RETURN jsonb_build_object('error', 'not_in'); END IF;
  INSERT INTO attendance_punches (employee_id, day_date, kind, at, photo_path, ip, source, created_by)
  VALUES (v_emp, v_day, p_kind, v_now, p_photo_path, host(v_ip), 'phone', auth.uid())
  RETURNING id INTO v_id;
  SELECT * INTO v_row FROM erp_attendance_days(v_emp, v_day, v_day);
  RETURN jsonb_build_object('success', true, 'id', v_id, 'at', v_now, 'status', v_row.status, 'minutes_late', v_row.minutes_late);
END;
$function$;

-- ------------------------------------------------------------
-- Admin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_settings()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_ip INET := erp_request_ip();
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN erp_attendance_settings_json() || jsonb_build_object(
    'consent_text', (SELECT consent_text FROM attendance_settings WHERE id = 1),
    'networks', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'net', net::text, 'label', label, 'created_at', created_at) ORDER BY created_at)
                          FROM attendance_networks), '[]'::jsonb),
    'my_ip', host(v_ip),
    'my_ip_at_gym', erp_ip_at_gym(v_ip)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_attendance_settings(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  s attendance_settings;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  IF coalesce((p->>'tolerance_min')::int, s.tolerance_min) >= coalesce((p->>'absence_min')::int, s.absence_min) THEN
    RETURN jsonb_build_object('error', 'bad_minutes');
  END IF;
  UPDATE attendance_settings SET
    tolerance_min = coalesce((p->>'tolerance_min')::int, tolerance_min),
    absence_min = coalesce((p->>'absence_min')::int, absence_min),
    lates_per_absence = coalesce((p->>'lates_per_absence')::int, lates_per_absence),
    require_wifi = coalesce((p->>'require_wifi')::boolean, require_wifi),
    counts_from = coalesce((p->>'counts_from')::date, counts_from),
    consent_version = CASE WHEN p ? 'consent_text' AND btrim(p->>'consent_text') <> consent_text THEN consent_version + 1 ELSE consent_version END,
    consent_text = CASE WHEN p ? 'consent_text' AND btrim(p->>'consent_text') <> '' THEN btrim(p->>'consent_text') ELSE consent_text END
  WHERE id = 1;
  PERFORM erp_audit('attendance_settings', 'attendance', NULL, NULL, p - 'consent_text');
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN invalid_text_representation OR check_violation OR datetime_field_overflow OR invalid_datetime_format THEN
  RETURN jsonb_build_object('error', 'bad_request');
END;
$function$;

-- Registra la red desde la que el admin está conectado AHORA (hay que estar en el WiFi del muro).
CREATE OR REPLACE FUNCTION public.admin_add_current_network(p_label TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_ip INET := erp_request_ip();
  v_net CIDR := erp_ip_net(erp_request_ip());
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_net IS NULL THEN RETURN jsonb_build_object('error', 'no_ip'); END IF;
  INSERT INTO attendance_networks (net, label, created_by) VALUES (v_net, nullif(btrim(coalesce(p_label, '')), ''), auth.uid())
  ON CONFLICT (net) DO NOTHING;
  PERFORM erp_audit('attendance_network_add', 'attendance', NULL, NULL, jsonb_build_object('net', v_net::text));
  RETURN jsonb_build_object('success', true, 'net', v_net::text, 'ip', host(v_ip));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_network(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  DELETE FROM attendance_networks WHERE id = p_id;
  PERFORM erp_audit('attendance_network_remove', 'attendance', p_id, NULL, NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_schedule(p_employee_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('schedule', coalesce((SELECT jsonb_agg(jsonb_build_object('dow', dow, 'start_time', start_time, 'end_time', end_time) ORDER BY dow)
                                                  FROM employee_schedules WHERE employee_id = p_employee_id), '[]'::jsonb));
END;
$function$;

-- p = [{dow, start_time, end_time}] — reemplaza todo el horario.
CREATE OR REPLACE FUNCTION public.admin_save_employee_schedule(p_employee_id UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r JSONB;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  DELETE FROM employee_schedules WHERE employee_id = p_employee_id;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p, '[]'::jsonb)) LOOP
    IF nullif(r->>'start_time', '') IS NULL THEN CONTINUE; END IF;
    IF nullif(r->>'end_time', '') IS NOT NULL AND (r->>'end_time')::time <= (r->>'start_time')::time THEN
      RAISE EXCEPTION 'bad_times';
    END IF;
    INSERT INTO employee_schedules (employee_id, dow, start_time, end_time)
    VALUES (p_employee_id, (r->>'dow')::int, (r->>'start_time')::time, nullif(r->>'end_time', '')::time);
  END LOOP;
  PERFORM erp_audit('employee_schedule', 'employee', p_employee_id, NULL, jsonb_build_object('schedule', p));
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN raise_exception THEN RETURN jsonb_build_object('error', 'bad_times');
  WHEN invalid_text_representation OR check_violation OR unique_violation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error', 'bad_request');
END;
$function$;

-- Reporte del mes: resumen por empleado y sus días (con fotos).
CREATE OR REPLACE FUNCTION public.get_attendance_report(p_month DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to DATE := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  s attendance_settings;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO s FROM attendance_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'month', v_from,
    'today', (erp_now() AT TIME ZONE 'America/Mexico_City')::date,
    'settings', erp_attendance_settings_json(),
    'networks_count', (SELECT count(*) FROM attendance_networks),
    'employees', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'position', e.position, 'status', e.status,
        'has_login', e.profile_id IS NOT NULL,
        'has_schedule', EXISTS (SELECT 1 FROM employee_schedules sc WHERE sc.employee_id = e.id),
        'consented', EXISTS (SELECT 1 FROM attendance_consents c WHERE c.employee_id = e.id AND c.version = s.consent_version),
        'summary', erp_attendance_summary(e.id, v_from, v_to),
        'days', coalesce((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
                   'punches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'at', p.at, 'photo_path', p.photo_path,
                                                                            'source', p.source, 'note', p.note, 'ip', p.ip) ORDER BY p.at)
                                        FROM attendance_punches p WHERE p.employee_id = e.id AND p.day_date = d.day_date), '[]'::jsonb))
                   ORDER BY d.day_date DESC)
                 FROM erp_attendance_days(e.id, v_from, v_to) d), '[]'::jsonb)
      ) ORDER BY e.status, e.full_name)
      FROM employees e
      WHERE e.status = 'active' OR EXISTS (SELECT 1 FROM attendance_punches p WHERE p.employee_id = e.id AND p.day_date BETWEEN v_from AND v_to)
    ), '[]'::jsonb)
  );
END;
$function$;

-- Registro a mano (se le olvidó checar, se le acabó la pila…). p_at en hora de México 'YYYY-MM-DD HH:MM'.
CREATE OR REPLACE FUNCTION public.admin_add_punch(p_employee_id UUID, p_kind TEXT, p_at TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_at TIMESTAMPTZ;
  v_id UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_kind NOT IN ('in', 'out') THEN RETURN jsonb_build_object('error', 'bad_request'); END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(btrim(coalesce(p_note, ''))) = 0 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  v_at := (p_at::timestamp) AT TIME ZONE 'America/Mexico_City';
  INSERT INTO attendance_punches (employee_id, day_date, kind, at, source, note, created_by)
  VALUES (p_employee_id, (v_at AT TIME ZONE 'America/Mexico_City')::date, p_kind, v_at, 'admin', btrim(p_note), auth.uid())
  RETURNING id INTO v_id;
  PERFORM erp_audit('attendance_manual_punch', 'employee', p_employee_id, NULL, jsonb_build_object('kind', p_kind, 'at', v_at, 'note', p_note));
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('error', 'bad_request');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_punch(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_old JSONB;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT to_jsonb(p) INTO v_old FROM attendance_punches p WHERE id = p_id;
  IF v_old IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  DELETE FROM attendance_punches WHERE id = p_id;
  PERFORM erp_audit('attendance_delete_punch', 'employee', (v_old->>'employee_id')::uuid, v_old, NULL);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Justificar un día (o quitar la justificación con p_note vacío).
CREATE OR REPLACE FUNCTION public.admin_excuse_day(p_employee_id UUID, p_day DATE, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(btrim(coalesce(p_note, ''))) = 0 THEN
    DELETE FROM attendance_excuses WHERE employee_id = p_employee_id AND day_date = p_day;
  ELSE
    INSERT INTO attendance_excuses (employee_id, day_date, note, created_by) VALUES (p_employee_id, p_day, btrim(p_note), auth.uid())
    ON CONFLICT (employee_id, day_date) DO UPDATE SET note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now();
  END IF;
  PERFORM erp_audit('attendance_excuse', 'employee', p_employee_id, NULL, jsonb_build_object('day', p_day, 'note', p_note));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_punches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_excuses  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_settings, public.attendance_networks, public.employee_schedules,
              public.attendance_consents, public.attendance_punches, public.attendance_excuses FROM anon, authenticated;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'erp_now()', 'erp_request_ip()', 'erp_ip_net(inet)', 'erp_ip_at_gym(inet)', 'erp_my_employee()',
    'erp_ensure_employee(uuid)', 'erp_profile_employee_trg()',
    'erp_attendance_days(uuid,date,date)', 'erp_attendance_summary(uuid,date,date)', 'erp_attendance_settings_json()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.erp_storage_is_admin() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.erp_storage_is_admin() TO authenticated;
  FOREACH f IN ARRAY ARRAY[
    'get_my_attendance()', 'attendance_accept_consent(text)', 'attendance_punch(text,text)',
    'get_attendance_settings()', 'admin_save_attendance_settings(jsonb)', 'admin_add_current_network(text)', 'admin_remove_network(uuid)',
    'get_employee_schedule(uuid)', 'admin_save_employee_schedule(uuid,jsonb)', 'get_attendance_report(date)',
    'admin_add_punch(uuid,text,text,text)', 'admin_delete_punch(uuid)', 'admin_excuse_day(uuid,date,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END;
$grants$;
