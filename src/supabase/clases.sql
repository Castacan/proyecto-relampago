-- ============================================================
-- Clases y reservas — Fase 1a (2026-10-23)
-- Plan completo: docs/plan-erp-clases.md (v2).
--
-- Piezas:
--   people            persona (cliente/prospecto); puede existir sin login
--   memberships       "membresía vigente hasta…" (la marca el staff)
--   class_settings    ajustes globales (una fila)
--   class_types       tipo de clase (precios, cupo, profe, reglas)
--   class_schedules   horario semanal (plantilla)
--   class_sessions    una clase en una fecha concreta (se generan solas)
--   class_bookings    reserva de una persona en una sesión
--   class_sales       venta suelta (Introductoria sin sesión)
--   class_audit_log   rastro de cambios (solo inserción)
--
-- Reglas de negocio aquí (no en el navegador). Todas las fechas de
-- negocio en hora de México. RLS sin policies: todo pasa por RPCs
-- SECURITY DEFINER que validan usuario / staff / admin.
-- Herencia: una sesión con capacity/instructor/duración/precio en NULL
-- usa los de su horario y, si no, los del tipo de clase — así, cambiar
-- el cupo de un horario o el precio de una clase aplica de inmediato.
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.people (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,                 -- = auth.users.id / climbers.id cuando tiene login
  full_name    TEXT NOT NULL,
  phone        TEXT,                        -- 10 dígitos
  email        TEXT,                        -- minúsculas
  birth_date   DATE,
  source       TEXT,                        -- 'web' | 'staff' | 'instagram' | …
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email_idx ON public.people (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  plan_name   TEXT,
  valid_from  DATE NOT NULL,
  valid_until DATE NOT NULL,
  note        TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until >= valid_from - 1)
);
CREATE INDEX IF NOT EXISTS memberships_person_idx ON public.memberships (person_id, valid_until);

CREATE TABLE IF NOT EXISTS public.class_settings (
  id                     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  book_ahead_days        INT NOT NULL DEFAULT 7  CHECK (book_ahead_days BETWEEN 1 AND 60),
  cancel_hours           INT NOT NULL DEFAULT 12 CHECK (cancel_hours BETWEEN 0 AND 168),
  free_classes_per_month INT NOT NULL DEFAULT 1  CHECK (free_classes_per_month BETWEEN 0 AND 31),
  overbook_tolerance     INT NOT NULL DEFAULT 1  CHECK (overbook_tolerance BETWEEN 0 AND 20),
  allow_pay_at_gym       BOOLEAN NOT NULL DEFAULT true,
  rules_text             TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_types (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL UNIQUE,
  description           TEXT,
  level                 TEXT,
  default_capacity      INT NOT NULL DEFAULT 6  CHECK (default_capacity BETWEEN 1 AND 200),
  default_duration_min  INT NOT NULL DEFAULT 60 CHECK (default_duration_min BETWEEN 10 AND 600),
  price_cents           INT NOT NULL DEFAULT 0  CHECK (price_cents >= 0),
  member_price_cents    INT CHECK (member_price_cents IS NULL OR member_price_cents >= 0),  -- NULL = igual al normal
  eligible_free_monthly BOOLEAN NOT NULL DEFAULT false,
  booking_mode          TEXT NOT NULL DEFAULT 'online' CHECK (booking_mode IN ('online','staff_only')),
  instructor_name       TEXT,
  color                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id   UUID NOT NULL REFERENCES public.class_types(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0=domingo … 6=sábado
  start_time      TIME NOT NULL,
  duration_min    INT CHECK (duration_min IS NULL OR duration_min BETWEEN 10 AND 600),
  capacity        INT CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 200),
  instructor_name TEXT,
  starts_on       DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date),
  ends_on         DATE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id      UUID NOT NULL REFERENCES public.class_types(id) ON DELETE CASCADE,
  schedule_id        UUID REFERENCES public.class_schedules(id) ON DELETE SET NULL,
  starts_at          TIMESTAMPTZ NOT NULL,
  duration_min       INT,
  capacity           INT,
  instructor_name    TEXT,
  price_cents        INT,
  member_price_cents INT,
  status             TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  cancel_reason      TEXT,
  attendance_taken   BOOLEAN NOT NULL DEFAULT false,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS class_sessions_schedule_start_idx ON public.class_sessions (schedule_id, starts_at);
CREATE INDEX IF NOT EXISTS class_sessions_starts_idx ON public.class_sessions (starts_at);

CREATE TABLE IF NOT EXISTS public.class_bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  person_id             UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('pending_payment','booked','attended','no_show','cancelled','cancelled_late','cancelled_by_gym')),
  price_tier            TEXT NOT NULL CHECK (price_tier IN ('regular','member','free_monthly','courtesy')),
  payment_method        TEXT NOT NULL CHECK (payment_method IN ('online','at_gym','none')),
  payment_status        TEXT NOT NULL CHECK (payment_status IN ('not_needed','pending','paid','refunded')),
  paid_with             TEXT,             -- 'clip' | 'cash' | 'card' | 'transfer' | 'other'
  amount_cents          INT NOT NULL DEFAULT 0,
  is_overbook           BOOLEAN NOT NULL DEFAULT false,
  needs_reschedule      BOOLEAN NOT NULL DEFAULT false,
  hold_expires_at       TIMESTAMPTZ,
  booked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at          TIMESTAMPTZ,
  checked_at            TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  confirmation_email_at TIMESTAMPTZ,
  cancel_email_at       TIMESTAMPTZ,
  created_by            UUID,             -- staff si la hizo staff
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Una reserva activa por persona por sesión (índice parcial).
CREATE UNIQUE INDEX IF NOT EXISTS class_bookings_one_active
  ON public.class_bookings (session_id, person_id)
  WHERE status NOT IN ('cancelled','cancelled_late','cancelled_by_gym');
CREATE INDEX IF NOT EXISTS class_bookings_person_idx ON public.class_bookings (person_id);

CREATE TABLE IF NOT EXISTS public.class_sales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id UUID NOT NULL REFERENCES public.class_types(id),
  person_id     UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  sold_on       DATE NOT NULL,
  amount_cents  INT NOT NULL CHECK (amount_cents >= 0),
  paid_with     TEXT NOT NULL CHECK (paid_with IN ('cash','card','transfer','clip','other')),
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  UUID,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.class_audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'class_audit_log es de solo inserción';
END;
$function$;
DROP TRIGGER IF EXISTS class_audit_log_no_change ON public.class_audit_log;
CREATE TRIGGER class_audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.class_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.class_audit_log_immutable();

ALTER TABLE public.people          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_bookings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.people, public.memberships, public.class_settings, public.class_types,
              public.class_schedules, public.class_sessions, public.class_bookings,
              public.class_sales, public.class_audit_log
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- Datos iniciales (dictados por el dueño 2026-10-23; todo editable)
-- ------------------------------------------------------------
INSERT INTO public.class_settings (id, rules_text) VALUES (1,
  'Puedes cancelar sin perder tu clase hasta 12 horas antes. Si cancelas después o no llegas, pierdes la clase (si usaste tu clase gratis del mes, se gasta).')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_types (name, description, price_cents, member_price_cents, eligible_free_monthly, booking_mode, instructor_name, default_capacity, default_duration_min, sort_order, color)
VALUES
  ('Escalada Jueves', NULL, 30000, 10000, true,  'online',     'Emiliano',     6, 60, 1, '#ff4d15'),
  ('Calistenia',      NULL, 30000, 10000, true,  'online',     'Coach externo', 6, 60, 2, '#22c55e'),
  ('Introductoria',   'Primera clase para conocer la escalada.', 20000, NULL, false, 'staff_only', 'Emiliano', 6, 60, 0, '#ffd260')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.class_schedules (class_type_id, weekday, start_time)
SELECT t.id, w.weekday, TIME '17:00'
FROM public.class_types t
JOIN (VALUES ('Escalada Jueves', 4), ('Calistenia', 1), ('Calistenia', 3)) AS w(name, weekday) ON w.name = t.name
WHERE NOT EXISTS (SELECT 1 FROM public.class_schedules s WHERE s.class_type_id = t.id AND s.weekday = w.weekday);

-- ------------------------------------------------------------
-- Helpers internos (no llamables desde la API)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.class_today()
RETURNS DATE LANGUAGE sql STABLE AS $function$
  SELECT (now() AT TIME ZONE 'America/Mexico_City')::date;
$function$;

CREATE OR REPLACE FUNCTION public.class_mx_date(p_ts TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $function$
  SELECT (p_ts AT TIME ZONE 'America/Mexico_City')::date;
$function$;

CREATE OR REPLACE FUNCTION public.class_is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.class_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.class_my_person_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT p.id FROM people p WHERE auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid();
$function$;

-- Valores efectivos de una sesión (herencia sesión → horario → tipo).
CREATE OR REPLACE VIEW public.class_sessions_v AS
SELECT
  s.id, s.class_type_id, s.schedule_id, s.starts_at, s.status, s.cancel_reason, s.attendance_taken,
  t.name, t.description, t.level, t.color, t.booking_mode, t.eligible_free_monthly, t.is_active AS type_active,
  coalesce(s.capacity, sc.capacity, t.default_capacity)                  AS capacity,
  coalesce(s.duration_min, sc.duration_min, t.default_duration_min)      AS duration_min,
  coalesce(s.instructor_name, sc.instructor_name, t.instructor_name)     AS instructor_name,
  coalesce(s.price_cents, t.price_cents)                                 AS price_cents,
  coalesce(s.member_price_cents, t.member_price_cents, s.price_cents, t.price_cents) AS member_price_cents,
  s.starts_at + make_interval(mins => coalesce(s.duration_min, sc.duration_min, t.default_duration_min)) AS ends_at
FROM class_sessions s
JOIN class_types t ON t.id = s.class_type_id
LEFT JOIN class_schedules sc ON sc.id = s.schedule_id;
REVOKE ALL ON public.class_sessions_v FROM anon, authenticated;

-- Lugares ocupados de una sesión.
CREATE OR REPLACE FUNCTION public.class_taken(p_session_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT count(*)::int FROM class_bookings b
  WHERE b.session_id = p_session_id
    AND (b.status IN ('booked','attended','no_show')
         OR (b.status = 'pending_payment' AND b.hold_expires_at > now()));
$function$;

CREATE OR REPLACE FUNCTION public.class_is_member(p_person_id UUID, p_on DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM memberships m
                 WHERE m.person_id = p_person_id AND m.valid_from <= p_on AND m.valid_until >= p_on);
$function$;

-- Clases gratis ya gastadas en el mes calendario de p_on (hora de México).
-- Gastan: reservada, por pagar vigente, asistió, faltó, cancelada tarde.
-- La devuelven: cancelada a tiempo y cancelada por el gym.
CREATE OR REPLACE FUNCTION public.class_free_used(p_person_id UUID, p_on DATE)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT count(*)::int FROM class_bookings b
  JOIN class_sessions s ON s.id = b.session_id
  WHERE b.person_id = p_person_id AND b.price_tier = 'free_monthly'
    AND (b.status IN ('booked','attended','no_show','cancelled_late')
         OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))
    AND date_trunc('month', class_mx_date(s.starts_at)) = date_trunc('month', p_on);
$function$;

-- Genera sesiones desde los horarios activos hasta p_until (incluido).
-- Idempotente (índice único horario+inicio); no revive sesiones
-- canceladas ni duplica.
CREATE OR REPLACE FUNCTION public.class_generate_sessions(p_until DATE)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO class_sessions (class_type_id, schedule_id, starts_at)
  SELECT sc.class_type_id, sc.id,
         ((d.day::date + sc.start_time) AT TIME ZONE 'America/Mexico_City')
  FROM class_schedules sc
  JOIN class_types t ON t.id = sc.class_type_id AND t.is_active
  CROSS JOIN LATERAL generate_series(greatest(sc.starts_on, class_today()),
                                     least(p_until, coalesce(sc.ends_on, p_until)),
                                     INTERVAL '1 day') AS d(day)
  WHERE sc.is_active AND extract(dow FROM d.day) = sc.weekday
  ON CONFLICT (schedule_id, starts_at) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Borra sesiones futuras de un horario que nunca tuvieron reservas (para
-- regenerarlas tras editar el horario). Las que tienen o tuvieron
-- reservas se quedan donde estaban.
CREATE OR REPLACE FUNCTION public.class_prune_empty_sessions(p_schedule_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  DELETE FROM class_sessions s
  WHERE s.schedule_id = p_schedule_id AND s.starts_at > now()
    AND NOT EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = s.id);
$function$;

CREATE OR REPLACE FUNCTION public.class_horizon()
RETURNS DATE LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT class_today() + coalesce((SELECT book_ahead_days FROM class_settings WHERE id = 1), 7) + 14;
$function$;

-- Datos de una reserva + persona + sesión, para listas y correos.
CREATE OR REPLACE FUNCTION public.class_booking_json(p_booking_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'id', b.id, 'session_id', b.session_id, 'person_id', b.person_id, 'status', b.status,
    'price_tier', b.price_tier, 'payment_method', b.payment_method, 'payment_status', b.payment_status,
    'paid_with', b.paid_with, 'amount_cents', b.amount_cents, 'is_overbook', b.is_overbook,
    'needs_reschedule', b.needs_reschedule, 'booked_at', b.booked_at, 'cancelled_at', b.cancelled_at,
    'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
    'is_minor', p.birth_date IS NOT NULL AND p.birth_date > (class_mx_date(v.starts_at) - INTERVAL '18 years')::date,
    'class_name', v.name, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'instructor_name', v.instructor_name
  )
  FROM class_bookings b
  JOIN people p ON p.id = b.person_id
  JOIN class_sessions_v v ON v.id = b.session_id
  WHERE b.id = p_booking_id;
$function$;

CREATE OR REPLACE FUNCTION public.class_settings_json()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'book_ahead_days', s.book_ahead_days, 'cancel_hours', s.cancel_hours,
    'free_classes_per_month', s.free_classes_per_month, 'overbook_tolerance', s.overbook_tolerance,
    'allow_pay_at_gym', s.allow_pay_at_gym, 'rules_text', s.rules_text)
  FROM class_settings s WHERE s.id = 1;
$function$;

-- ------------------------------------------------------------
-- Públicas (cliente)
-- ------------------------------------------------------------

-- Calendario. Sin sesión iniciada también funciona (sin datos "míos").
-- Genera de paso las sesiones que falten (por eso no es STABLE).
CREATE OR REPLACE FUNCTION public.get_class_calendar(p_from DATE DEFAULT NULL, p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set    class_settings%ROWTYPE;
  v_from   DATE := coalesce(p_from, class_today());
  v_to     DATE := coalesce(p_from, class_today()) + least(greatest(coalesce(p_days, 14), 1), 31) - 1;
  v_person people%ROWTYPE;
  v_today  DATE := class_today();
BEGIN
  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  PERFORM class_generate_sessions(class_horizon());
  SELECT * INTO v_person FROM people p WHERE auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid();

  RETURN jsonb_build_object(
    'settings', class_settings_json(),
    'today', v_today,
    'me', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'person_id', v_person.id, 'full_name', v_person.full_name, 'phone', v_person.phone,
      'membership_until', (SELECT max(m.valid_until) FROM memberships m
                           WHERE m.person_id = v_person.id AND m.valid_from <= v_today AND m.valid_until >= v_today)
    ) END,
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'class_type_id', v.class_type_id, 'name', v.name, 'description', v.description,
        'level', v.level, 'color', v.color, 'instructor_name', v.instructor_name,
        'starts_at', v.starts_at, 'ends_at', v.ends_at, 'status', v.status,
        'capacity', v.capacity, 'spots_left', greatest(v.capacity - class_taken(v.id), 0),
        'price_cents', v.price_cents, 'member_price_cents', v.member_price_cents,
        'booking_mode', v.booking_mode, 'eligible_free_monthly', v.eligible_free_monthly,
        'bookable', v.status = 'scheduled' AND v.booking_mode = 'online' AND v.starts_at > now()
                    AND class_mx_date(v.starts_at) <= v_today + v_set.book_ahead_days,
        'is_member', v_person.id IS NOT NULL AND class_is_member(v_person.id, class_mx_date(v.starts_at)),
        'free_left', CASE WHEN v_person.id IS NULL THEN 0
                          ELSE greatest(v_set.free_classes_per_month - class_free_used(v_person.id, class_mx_date(v.starts_at)), 0) END,
        'my_booking', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'price_tier', b.price_tier,
                                                 'payment_method', b.payment_method, 'payment_status', b.payment_status,
                                                 'amount_cents', b.amount_cents)
                       FROM class_bookings b
                       WHERE v_person.id IS NOT NULL AND b.session_id = v.id AND b.person_id = v_person.id
                       ORDER BY (b.status IN ('cancelled','cancelled_late','cancelled_by_gym')), b.booked_at DESC
                       LIMIT 1)
      ) ORDER BY v.starts_at)
      FROM class_sessions_v v
      WHERE v.type_active AND class_mx_date(v.starts_at) BETWEEN v_from AND v_to
        AND (v.status = 'scheduled' OR EXISTS (SELECT 1 FROM class_bookings b
                                                WHERE b.session_id = v.id AND b.person_id = v_person.id))
    ), '[]'::jsonb)
  );
END;
$function$;

-- Crea o actualiza la persona del usuario con sesión. Si el staff ya la
-- había creado con el mismo correo (sin login), la liga en vez de duplicar.
CREATE OR REPLACE FUNCTION public.upsert_my_person(p_full_name TEXT, p_phone TEXT, p_birth_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_name  TEXT := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_phone TEXT := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_phone IS NULL OR length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF p_birth_date IS NOT NULL AND (p_birth_date < DATE '1920-01-01' OR p_birth_date > class_today()) THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', (SELECT c.email FROM climbers c WHERE c.id = v_uid)));

  SELECT p.id INTO v_id FROM people p WHERE p.auth_user_id = v_uid;
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT p.id INTO v_id FROM people p WHERE lower(p.email) = v_email AND p.auth_user_id IS NULL FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO people (auth_user_id, full_name, phone, email, birth_date, source, created_by)
    VALUES (v_uid, v_name, v_phone, v_email, p_birth_date, 'web', v_uid) RETURNING id INTO v_id;
  ELSE
    UPDATE people SET auth_user_id = v_uid, full_name = v_name, phone = v_phone,
      email = coalesce(email, v_email), birth_date = coalesce(p_birth_date, birth_date), updated_at = now()
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$function$;

-- Reserva del cliente. p_option: 'free_monthly' (clase gratis del mes) o
-- 'at_gym' (paga en mostrador; precio miembro si su membresía está vigente).
CREATE OR REPLACE FUNCTION public.book_class(p_session_id UUID, p_option TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set     class_settings%ROWTYPE;
  v_person  UUID := class_my_person_id();
  v_sess    class_sessions%ROWTYPE;
  v         class_sessions_v%ROWTYPE;
  v_day     DATE;
  v_member  BOOLEAN;
  v_tier    TEXT;
  v_method  TEXT;
  v_pstatus TEXT;
  v_amount  INT;
  v_id      UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  IF v_person IS NULL THEN RETURN jsonb_build_object('error', 'profile_required'); END IF;
  IF p_option NOT IN ('free_monthly','at_gym') THEN RETURN jsonb_build_object('error', 'invalid_option'); END IF;

  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_sess FROM class_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO v FROM class_sessions_v WHERE id = p_session_id;
  v_day := class_mx_date(v.starts_at);

  IF v.status <> 'scheduled' OR NOT v.type_active THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  IF v.booking_mode <> 'online' THEN RETURN jsonb_build_object('error', 'staff_only'); END IF;
  IF v.starts_at <= now() THEN RETURN jsonb_build_object('error', 'started'); END IF;
  IF v_day > class_today() + v_set.book_ahead_days THEN RETURN jsonb_build_object('error', 'too_early'); END IF;
  IF EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = p_session_id AND b.person_id = v_person
             AND b.status NOT IN ('cancelled','cancelled_late','cancelled_by_gym')) THEN
    RETURN jsonb_build_object('error', 'already_booked');
  END IF;
  IF class_taken(p_session_id) >= v.capacity THEN RETURN jsonb_build_object('error', 'full'); END IF;

  v_member := class_is_member(v_person, v_day);
  IF p_option = 'free_monthly' THEN
    IF NOT v_member THEN RETURN jsonb_build_object('error', 'not_member'); END IF;
    IF NOT v.eligible_free_monthly THEN RETURN jsonb_build_object('error', 'not_eligible'); END IF;
    IF class_free_used(v_person, v_day) >= v_set.free_classes_per_month THEN RETURN jsonb_build_object('error', 'free_used'); END IF;
    v_tier := 'free_monthly'; v_method := 'none'; v_pstatus := 'not_needed'; v_amount := 0;
  ELSE
    IF NOT v_set.allow_pay_at_gym THEN RETURN jsonb_build_object('error', 'pay_at_gym_disabled'); END IF;
    v_tier := CASE WHEN v_member THEN 'member' ELSE 'regular' END;
    v_amount := CASE WHEN v_member THEN v.member_price_cents ELSE v.price_cents END;
    v_method := 'at_gym';
    v_pstatus := CASE WHEN v_amount = 0 THEN 'not_needed' ELSE 'pending' END;
  END IF;

  INSERT INTO class_bookings (session_id, person_id, status, price_tier, payment_method, payment_status, amount_cents, created_by)
  VALUES (p_session_id, v_person, 'booked', v_tier, v_method, v_pstatus, v_amount, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'book', 'booking', v_id, class_booking_json(v_id));

  RETURN jsonb_build_object('success', true, 'booking', class_booking_json(v_id));
END;
$function$;

-- Cancelación del cliente: a tiempo (≥ cancel_hours) devuelve la clase;
-- tarde cuenta como falta.
CREATE OR REPLACE FUNCTION public.cancel_my_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set    class_settings%ROWTYPE;
  v_person UUID := class_my_person_id();
  v_b      class_bookings%ROWTYPE;
  v_start  TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_person IS NULL THEN RETURN jsonb_build_object('error', 'not_logged_in'); END IF;
  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id AND person_id = v_person FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_b.status NOT IN ('booked','pending_payment') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  SELECT s.starts_at INTO v_start FROM class_sessions s WHERE s.id = v_b.session_id;
  IF v_start <= now() THEN RETURN jsonb_build_object('error', 'started'); END IF;

  v_status := CASE WHEN v_start - now() >= make_interval(hours => v_set.cancel_hours) THEN 'cancelled' ELSE 'cancelled_late' END;
  UPDATE class_bookings SET status = v_status, cancelled_at = now(), updated_at = now(),
    needs_reschedule = (v_status = 'cancelled' AND payment_status = 'paid')
  WHERE id = p_booking_id;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'cancel', 'booking', p_booking_id, to_jsonb(v_b), class_booking_json(p_booking_id));

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_class_bookings()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT coalesce(jsonb_agg(class_booking_json(b.id) ORDER BY s.starts_at DESC), '[]'::jsonb)
  FROM class_bookings b JOIN class_sessions s ON s.id = b.session_id
  WHERE b.person_id = class_my_person_id() AND s.starts_at > now() - INTERVAL '60 days';
$function$;

-- ------------------------------------------------------------
-- Staff (cualquier perfil de staff)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_class_day(p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM class_generate_sessions(greatest(class_horizon(), p_date));
  RETURN jsonb_build_object(
    'settings', class_settings_json(),
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'class_type_id', v.class_type_id, 'name', v.name, 'color', v.color,
        'instructor_name', v.instructor_name, 'starts_at', v.starts_at, 'ends_at', v.ends_at,
        'status', v.status, 'cancel_reason', v.cancel_reason, 'capacity', v.capacity,
        'taken', class_taken(v.id), 'attendance_taken', v.attendance_taken,
        'price_cents', v.price_cents, 'member_price_cents', v.member_price_cents,
        'eligible_free_monthly', v.eligible_free_monthly, 'booking_mode', v.booking_mode,
        'bookings', coalesce((SELECT jsonb_agg(class_booking_json(b.id) ORDER BY b.booked_at)
                              FROM class_bookings b WHERE b.session_id = v.id), '[]'::jsonb)
      ) ORDER BY v.starts_at)
      FROM class_sessions_v v
      WHERE class_mx_date(v.starts_at) = p_date AND v.type_active
    ), '[]'::jsonb),
    'sales', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', sa.id, 'class_name', t.name, 'full_name', p.full_name,
                                          'amount_cents', sa.amount_cents, 'paid_with', sa.paid_with, 'note', sa.note)
                       ORDER BY sa.created_at)
      FROM class_sales sa JOIN class_types t ON t.id = sa.class_type_id JOIN people p ON p.id = sa.person_id
      WHERE sa.sold_on = p_date
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_people(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_q TEXT := lower(btrim(coalesce(p_query, '')));
  v_digits TEXT := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('people', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'full_name') FROM (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'birth_date', p.birth_date,
        'has_login', p.auth_user_id IS NOT NULL, 'source', p.source, 'note', p.note,
        'membership_until', (SELECT max(m.valid_until) FROM memberships m
                             WHERE m.person_id = p.id AND m.valid_from <= class_today() AND m.valid_until >= class_today()),
        'membership_last_until', (SELECT max(m.valid_until) FROM memberships m WHERE m.person_id = p.id)
      ) AS x
      FROM people p
      WHERE v_q = '' OR lower(p.full_name) LIKE '%' || v_q || '%' OR lower(coalesce(p.email, '')) LIKE '%' || v_q || '%'
         OR (length(v_digits) >= 3 AND coalesce(p.phone, '') LIKE '%' || v_digits || '%')
      ORDER BY p.updated_at DESC
      LIMIT 30
    ) s
  ), '[]'::jsonb));
END;
$function$;

-- Crea (sin id) o edita una persona. Campos: full_name, phone, email,
-- birth_date, source, note.
CREATE OR REPLACE FUNCTION public.admin_save_person(p_person JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id    UUID := nullif(p_person->>'id', '')::uuid;
  v_name  TEXT := regexp_replace(btrim(coalesce(p_person->>'full_name', '')), '\s+', ' ', 'g');
  v_phone TEXT := nullif(regexp_replace(coalesce(p_person->>'phone', ''), '\D', '', 'g'), '');
  v_email TEXT := nullif(lower(btrim(coalesce(p_person->>'email', ''))), '');
  v_birth DATE := nullif(p_person->>'birth_date', '')::date;
  v_before people%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF v_phone IS NOT NULL AND length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('error', 'invalid_email'); END IF;
  IF v_birth IS NOT NULL AND (v_birth < DATE '1920-01-01' OR v_birth > class_today()) THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE lower(p.email) = v_email AND p.id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'email_taken');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO people (full_name, phone, email, birth_date, source, note, created_by)
    VALUES (v_name, v_phone, v_email, v_birth, coalesce(nullif(p_person->>'source', ''), 'staff'),
            nullif(btrim(coalesce(p_person->>'note', '')), ''), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
    VALUES (auth.uid(), 'person_create', 'person', v_id, p_person);
  ELSE
    SELECT * INTO v_before FROM people WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    UPDATE people SET full_name = v_name, phone = v_phone,
      -- El correo de quien ya tiene login es el de su cuenta: no se cambia aquí.
      email = CASE WHEN auth_user_id IS NULL THEN v_email ELSE email END,
      birth_date = v_birth, source = coalesce(nullif(p_person->>'source', ''), source),
      note = nullif(btrim(coalesce(p_person->>'note', '')), ''), updated_at = now()
    WHERE id = v_id;
    INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
    VALUES (auth.uid(), 'person_update', 'person', v_id, to_jsonb(v_before), p_person);
  END IF;
  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$function$;

-- Membresía vigente hasta p_until. Si ya tiene una vigente, la extiende o
-- la acorta; si no, crea una desde hoy. p_until NULL = terminarla hoy.
CREATE OR REPLACE FUNCTION public.admin_set_membership(p_person_id UUID, p_until DATE, p_plan_name TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_m     memberships%ROWTYPE;
  v_today DATE := class_today();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p_until IS NOT NULL AND p_until < v_today THEN RETURN jsonb_build_object('error', 'invalid_date'); END IF;

  SELECT * INTO v_m FROM memberships m
  WHERE m.person_id = p_person_id AND m.valid_from <= v_today AND m.valid_until >= v_today
  ORDER BY m.valid_until DESC LIMIT 1 FOR UPDATE;

  IF p_until IS NULL THEN
    IF v_m.id IS NOT NULL THEN
      UPDATE memberships SET valid_until = v_today - 1, updated_at = now() WHERE id = v_m.id;
    END IF;
  ELSIF v_m.id IS NOT NULL THEN
    UPDATE memberships SET valid_until = p_until, plan_name = coalesce(nullif(btrim(coalesce(p_plan_name, '')), ''), plan_name),
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note), updated_at = now()
    WHERE id = v_m.id;
  ELSE
    INSERT INTO memberships (person_id, plan_name, valid_from, valid_until, note, created_by)
    VALUES (p_person_id, nullif(btrim(coalesce(p_plan_name, '')), ''), v_today, p_until,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  END IF;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'membership_set', 'person', p_person_id, to_jsonb(v_m),
          jsonb_build_object('valid_until', p_until, 'plan_name', p_plan_name));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Reserva hecha por staff (walk-in o por teléfono). Ignora la ventana de
-- reserva y el modo "solo staff"; permite sobrecupo hasta la tolerancia.
-- p_tier: regular | member | free_monthly | courtesy.
-- p_paid_with: si ya pagó en mostrador (cash/card/transfer/other); NULL = por cobrar.
CREATE OR REPLACE FUNCTION public.admin_book_person(p_session_id UUID, p_person_id UUID, p_tier TEXT, p_paid_with TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_set    class_settings%ROWTYPE;
  v_sess   class_sessions%ROWTYPE;
  v        class_sessions_v%ROWTYPE;
  v_day    DATE;
  v_taken  INT;
  v_amount INT;
  v_id     UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_tier NOT IN ('regular','member','free_monthly','courtesy') THEN RETURN jsonb_build_object('error', 'invalid_tier'); END IF;
  IF p_paid_with IS NOT NULL AND p_paid_with NOT IN ('cash','card','transfer','other') THEN
    RETURN jsonb_build_object('error', 'invalid_method');
  END IF;
  SELECT * INTO v_set FROM class_settings WHERE id = 1;
  SELECT * INTO v_sess FROM class_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  SELECT * INTO v FROM class_sessions_v WHERE id = p_session_id;
  v_day := class_mx_date(v.starts_at);
  IF v.status <> 'scheduled' THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  IF EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = p_session_id AND b.person_id = p_person_id
             AND b.status NOT IN ('cancelled','cancelled_late','cancelled_by_gym')) THEN
    RETURN jsonb_build_object('error', 'already_booked');
  END IF;
  v_taken := class_taken(p_session_id);
  IF v_taken >= v.capacity + v_set.overbook_tolerance THEN RETURN jsonb_build_object('error', 'full'); END IF;

  IF p_tier IN ('member','free_monthly') AND NOT class_is_member(p_person_id, v_day) THEN
    RETURN jsonb_build_object('error', 'not_member');
  END IF;
  IF p_tier = 'free_monthly' THEN
    IF NOT v.eligible_free_monthly THEN RETURN jsonb_build_object('error', 'not_eligible'); END IF;
    IF class_free_used(p_person_id, v_day) >= v_set.free_classes_per_month THEN RETURN jsonb_build_object('error', 'free_used'); END IF;
  END IF;

  v_amount := CASE p_tier WHEN 'regular' THEN v.price_cents WHEN 'member' THEN v.member_price_cents ELSE 0 END;

  INSERT INTO class_bookings (session_id, person_id, status, price_tier, payment_method, payment_status,
                              paid_with, paid_at, amount_cents, is_overbook, created_by)
  VALUES (p_session_id, p_person_id, 'booked', p_tier,
          CASE WHEN v_amount = 0 THEN 'none' ELSE 'at_gym' END,
          CASE WHEN v_amount = 0 THEN 'not_needed' WHEN p_paid_with IS NOT NULL THEN 'paid' ELSE 'pending' END,
          CASE WHEN v_amount > 0 THEN p_paid_with END,
          CASE WHEN v_amount > 0 AND p_paid_with IS NOT NULL THEN now() END,
          v_amount, v_taken >= v.capacity, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'staff_book', 'booking', v_id, class_booking_json(v_id));
  RETURN jsonb_build_object('success', true, 'booking', class_booking_json(v_id));
END;
$function$;

-- Asistencia: 'attended' | 'no_show' | 'booked' (deshacer). Marca la
-- sesión como "lista pasada".
CREATE OR REPLACE FUNCTION public.admin_mark_attendance(p_booking_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_b class_bookings%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_status NOT IN ('attended','no_show','booked') THEN RETURN jsonb_build_object('error', 'invalid_status'); END IF;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_b.status NOT IN ('booked','attended','no_show') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  UPDATE class_bookings SET status = p_status,
    checked_at = CASE WHEN p_status = 'booked' THEN NULL ELSE now() END, updated_at = now()
  WHERE id = p_booking_id;
  IF p_status <> 'booked' THEN
    UPDATE class_sessions SET attendance_taken = true, updated_at = now() WHERE id = v_b.session_id;
  END IF;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'attendance', 'booking', p_booking_id, to_jsonb(v_b), jsonb_build_object('status', p_status));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_booking_paid(p_booking_id UUID, p_paid_with TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_b class_bookings%ROWTYPE;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_paid_with NOT IN ('cash','card','transfer','other') THEN RETURN jsonb_build_object('error', 'invalid_method'); END IF;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_b.payment_status <> 'pending' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  UPDATE class_bookings SET payment_status = 'paid', paid_with = p_paid_with, paid_at = now(), updated_at = now()
  WHERE id = p_booking_id;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'mark_paid', 'booking', p_booking_id, to_jsonb(v_b), jsonb_build_object('paid_with', p_paid_with));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Cancelación hecha por staff. p_late = true la cuenta como cancelación
-- tarde (gasta la gratis); false la cancela a tiempo (la devuelve).
CREATE OR REPLACE FUNCTION public.admin_cancel_booking(p_booking_id UUID, p_late BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_b class_bookings%ROWTYPE;
  v_status TEXT := CASE WHEN p_late THEN 'cancelled_late' ELSE 'cancelled' END;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_b FROM class_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_b.status NOT IN ('booked','pending_payment','no_show','attended') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
  UPDATE class_bookings SET status = v_status, cancelled_at = now(), updated_at = now(),
    needs_reschedule = (NOT p_late AND payment_status = 'paid')
  WHERE id = p_booking_id;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'staff_cancel', 'booking', p_booking_id, to_jsonb(v_b), jsonb_build_object('status', v_status));
  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$function$;

-- Venta suelta (Introductoria cuando no hay sesión).
CREATE OR REPLACE FUNCTION public.admin_register_sale(p_class_type_id UUID, p_person_id UUID, p_sold_on DATE,
                                                      p_amount_cents INT, p_paid_with TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM class_types WHERE id = p_class_type_id) THEN RETURN jsonb_build_object('error', 'invalid_class'); END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = p_person_id) THEN RETURN jsonb_build_object('error', 'person_not_found'); END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF p_paid_with NOT IN ('cash','card','transfer','clip','other') THEN RETURN jsonb_build_object('error', 'invalid_method'); END IF;
  INSERT INTO class_sales (class_type_id, person_id, sold_on, amount_cents, paid_with, note, created_by)
  VALUES (p_class_type_id, p_person_id, coalesce(p_sold_on, class_today()), p_amount_cents, p_paid_with,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'sale', 'sale', v_id, jsonb_build_object('class_type_id', p_class_type_id, 'person_id', p_person_id,
          'amount_cents', p_amount_cents, 'paid_with', p_paid_with));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- ------------------------------------------------------------
-- Admin (configuración)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_class_admin()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'is_admin', class_is_admin(),
    'settings', class_settings_json(),
    'types', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order, t.name) FROM class_types t), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.weekday, s.start_time) FROM class_schedules s), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_class_type(p_type JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id     UUID := nullif(p_type->>'id', '')::uuid;
  v_name   TEXT := btrim(coalesce(p_type->>'name', ''));
  v_before class_types%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF EXISTS (SELECT 1 FROM class_types t WHERE lower(t.name) = lower(v_name) AND t.id IS DISTINCT FROM v_id) THEN
    RETURN jsonb_build_object('error', 'name_taken');
  END IF;
  IF coalesce(p_type->>'booking_mode', 'online') NOT IN ('online','staff_only') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO class_types (name, description, level, default_capacity, default_duration_min, price_cents,
                               member_price_cents, eligible_free_monthly, booking_mode, instructor_name, color, is_active, sort_order)
      VALUES (v_name, nullif(btrim(coalesce(p_type->>'description', '')), ''), nullif(btrim(coalesce(p_type->>'level', '')), ''),
              coalesce((p_type->>'default_capacity')::int, 6), coalesce((p_type->>'default_duration_min')::int, 60),
              coalesce((p_type->>'price_cents')::int, 0), nullif(p_type->>'member_price_cents', '')::int,
              coalesce((p_type->>'eligible_free_monthly')::boolean, false), coalesce(p_type->>'booking_mode', 'online'),
              nullif(btrim(coalesce(p_type->>'instructor_name', '')), ''), nullif(p_type->>'color', ''),
              coalesce((p_type->>'is_active')::boolean, true), coalesce((p_type->>'sort_order')::int, 0))
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_before FROM class_types WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
      UPDATE class_types SET
        name = v_name,
        description = nullif(btrim(coalesce(p_type->>'description', '')), ''),
        level = nullif(btrim(coalesce(p_type->>'level', '')), ''),
        default_capacity = coalesce((p_type->>'default_capacity')::int, default_capacity),
        default_duration_min = coalesce((p_type->>'default_duration_min')::int, default_duration_min),
        price_cents = coalesce((p_type->>'price_cents')::int, price_cents),
        member_price_cents = nullif(p_type->>'member_price_cents', '')::int,
        eligible_free_monthly = coalesce((p_type->>'eligible_free_monthly')::boolean, eligible_free_monthly),
        booking_mode = coalesce(p_type->>'booking_mode', booking_mode),
        instructor_name = nullif(btrim(coalesce(p_type->>'instructor_name', '')), ''),
        color = coalesce(nullif(p_type->>'color', ''), color),
        is_active = coalesce((p_type->>'is_active')::boolean, is_active),
        sort_order = coalesce((p_type->>'sort_order')::int, sort_order),
        updated_at = now()
      WHERE id = v_id;
    END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'type_save', 'class_type', v_id, to_jsonb(v_before), p_type);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Crea o edita un horario semanal. Las sesiones futuras de ese horario
-- que nunca tuvieron reservas se regeneran con los datos nuevos; las que
-- ya tienen gente se quedan como estaban (se mueven a mano, con aviso).
CREATE OR REPLACE FUNCTION public.admin_save_schedule(p_schedule JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id     UUID := nullif(p_schedule->>'id', '')::uuid;
  v_before class_schedules%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM class_types WHERE id = nullif(p_schedule->>'class_type_id', '')::uuid) THEN
    RETURN jsonb_build_object('error', 'invalid_class');
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO class_schedules (class_type_id, weekday, start_time, duration_min, capacity, instructor_name, starts_on, ends_on, is_active)
      VALUES ((p_schedule->>'class_type_id')::uuid, (p_schedule->>'weekday')::smallint, (p_schedule->>'start_time')::time,
              nullif(p_schedule->>'duration_min', '')::int, nullif(p_schedule->>'capacity', '')::int,
              nullif(btrim(coalesce(p_schedule->>'instructor_name', '')), ''),
              coalesce(nullif(p_schedule->>'starts_on', '')::date, class_today()), nullif(p_schedule->>'ends_on', '')::date,
              coalesce((p_schedule->>'is_active')::boolean, true))
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_before FROM class_schedules WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
      UPDATE class_schedules SET
        weekday = (p_schedule->>'weekday')::smallint,
        start_time = (p_schedule->>'start_time')::time,
        duration_min = nullif(p_schedule->>'duration_min', '')::int,
        capacity = nullif(p_schedule->>'capacity', '')::int,
        instructor_name = nullif(btrim(coalesce(p_schedule->>'instructor_name', '')), ''),
        starts_on = coalesce(nullif(p_schedule->>'starts_on', '')::date, starts_on),
        ends_on = nullif(p_schedule->>'ends_on', '')::date,
        is_active = coalesce((p_schedule->>'is_active')::boolean, is_active),
        updated_at = now()
      WHERE id = v_id;
    END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR not_null_violation THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;

  PERFORM class_prune_empty_sessions(v_id);
  PERFORM class_generate_sessions(class_horizon());

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'schedule_save', 'schedule', v_id, to_jsonb(v_before), p_schedule);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_class_settings(p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_before class_settings%ROWTYPE;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_before FROM class_settings WHERE id = 1 FOR UPDATE;
  BEGIN
    UPDATE class_settings SET
      book_ahead_days = coalesce((p_patch->>'book_ahead_days')::int, book_ahead_days),
      cancel_hours = coalesce((p_patch->>'cancel_hours')::int, cancel_hours),
      free_classes_per_month = coalesce((p_patch->>'free_classes_per_month')::int, free_classes_per_month),
      overbook_tolerance = coalesce((p_patch->>'overbook_tolerance')::int, overbook_tolerance),
      allow_pay_at_gym = coalesce((p_patch->>'allow_pay_at_gym')::boolean, allow_pay_at_gym),
      rules_text = CASE WHEN p_patch ? 'rules_text' THEN nullif(btrim(coalesce(p_patch->>'rules_text', '')), '') ELSE rules_text END,
      updated_at = now()
    WHERE id = 1;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END;
  INSERT INTO class_audit_log (actor_id, action, entity, before, after)
  VALUES (auth.uid(), 'settings_update', 'settings', to_jsonb(v_before), p_patch);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Sesión suelta (fuera de horario, p. ej. una Introductoria a demanda).
CREATE OR REPLACE FUNCTION public.admin_create_session(p_class_type_id UUID, p_starts_at TIMESTAMPTZ,
                                                       p_duration_min INT DEFAULT NULL, p_capacity INT DEFAULT NULL,
                                                       p_instructor_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM class_types WHERE id = p_class_type_id) THEN RETURN jsonb_build_object('error', 'invalid_class'); END IF;
  IF p_starts_at IS NULL OR p_starts_at < now() - INTERVAL '1 day' THEN RETURN jsonb_build_object('error', 'invalid_date'); END IF;
  IF p_capacity IS NOT NULL AND (p_capacity < 1 OR p_capacity > 200) THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  IF p_duration_min IS NOT NULL AND (p_duration_min < 10 OR p_duration_min > 600) THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  INSERT INTO class_sessions (class_type_id, starts_at, duration_min, capacity, instructor_name, created_by)
  VALUES (p_class_type_id, p_starts_at, p_duration_min, p_capacity, nullif(btrim(coalesce(p_instructor_name, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'session_create', 'session', v_id, jsonb_build_object('class_type_id', p_class_type_id, 'starts_at', p_starts_at));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- Cancela una sesión: todas sus reservas activas pasan a
-- 'cancelled_by_gym' (devuelve la gratis; si pagó, queda para reagendar).
-- Devuelve las reservas afectadas para avisarles por correo.
CREATE OR REPLACE FUNCTION public.admin_cancel_session(p_session_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_s   class_sessions%ROWTYPE;
  v_ids UUID[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  SELECT * INTO v_s FROM class_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_s.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;

  UPDATE class_sessions SET status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() WHERE id = p_session_id;
  WITH u AS (
    UPDATE class_bookings SET status = 'cancelled_by_gym', cancelled_at = now(), updated_at = now(),
      needs_reschedule = (payment_status = 'paid')
    WHERE session_id = p_session_id AND status IN ('booked','pending_payment')
    RETURNING id
  ) SELECT array_agg(id) INTO v_ids FROM u;

  INSERT INTO class_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'session_cancel', 'session', p_session_id, to_jsonb(v_s),
          jsonb_build_object('reason', p_reason, 'bookings', to_jsonb(coalesce(v_ids, '{}'))));
  RETURN jsonb_build_object('success', true, 'booking_ids', to_jsonb(coalesce(v_ids, '{}')));
END;
$function$;

-- ------------------------------------------------------------
-- Correos (Edge Function class-emails, service_role)
-- ------------------------------------------------------------

-- Aparta el envío de un correo de una reserva para que salga una sola vez.
-- p_kind: 'confirmation' (reserva activa) | 'cancel' (cancelada por
-- cualquiera de las tres vías). Devuelve los datos o NULL si no toca.
CREATE OR REPLACE FUNCTION public.class_claim_email(p_booking_id UUID, p_kind TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF p_kind = 'confirmation' THEN
    UPDATE class_bookings b SET confirmation_email_at = now()
    WHERE b.id = p_booking_id AND b.confirmation_email_at IS NULL AND b.status = 'booked'
      AND EXISTS (SELECT 1 FROM people p WHERE p.id = b.person_id AND p.email IS NOT NULL)
    RETURNING b.id INTO v_id;
  ELSIF p_kind = 'cancel' THEN
    UPDATE class_bookings b SET cancel_email_at = now()
    WHERE b.id = p_booking_id AND b.cancel_email_at IS NULL
      AND b.status IN ('cancelled','cancelled_late','cancelled_by_gym')
      AND EXISTS (SELECT 1 FROM people p WHERE p.id = b.person_id AND p.email IS NOT NULL)
    RETURNING b.id INTO v_id;
  END IF;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN class_booking_json(v_id)
    || jsonb_build_object('cancel_reason', (SELECT s.cancel_reason FROM class_sessions s JOIN class_bookings b ON b.session_id = s.id WHERE b.id = v_id),
                          'settings', class_settings_json());
END;
$function$;

-- Si Resend falla por algo temporal, se suelta para reintentar.
CREATE OR REPLACE FUNCTION public.class_release_email(p_booking_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  UPDATE class_bookings SET
    confirmation_email_at = CASE WHEN p_kind = 'confirmation' THEN NULL ELSE confirmation_email_at END,
    cancel_email_at = CASE WHEN p_kind = 'cancel' THEN NULL ELSE cancel_email_at END
  WHERE id = p_booking_id;
$function$;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.class_today() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_mx_date(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_is_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_my_person_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_taken(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_is_member(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_free_used(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_generate_sessions(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_prune_empty_sessions(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_horizon() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_booking_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_settings_json() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_audit_log_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_claim_email(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_release_email(UUID, TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_class_calendar(DATE, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_my_person(TEXT, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_class(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_my_booking(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_class_bookings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_class_day(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_people(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_person(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_membership(UUID, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_book_person(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_attendance(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_booking_paid(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_booking(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_register_sale(UUID, UUID, DATE, INT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_class_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_class_type(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_schedule(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_class_settings(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_session(UUID, TIMESTAMPTZ, INT, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_session(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_class_calendar(DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_person(TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_class(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_booking(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_class_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_day(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_people(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_person(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_membership(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_book_person(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_attendance(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_booking_paid(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_sale(UUID, UUID, DATE, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_class_type(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_schedule(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_class_settings(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_session(UUID, TIMESTAMPTZ, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_session(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.class_claim_email(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_release_email(UUID, TEXT) TO service_role;
