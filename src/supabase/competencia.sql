-- ============================================================
-- Competencia — inscripciones (Etapa 1, 2026-10-04)
--
-- Registro en la app + pago por UN link externo, confirmado a mano por
-- staff. El cobro automático con Openpay (webhook + conciliación) es la
-- Etapa 2 y NO está aquí. Diseño: docs/bitacora.md.
--
-- Todas las tablas tienen RLS activado y NINGUNA policy: ni anon ni
-- authenticated pueden leerlas o escribirlas directo. Todo pasa por las
-- funciones SECURITY DEFINER de abajo, que validan en servidor. No
-- reutilizan el patrón `auth.uid() IS NOT NULL` de las tablas viejas.
--
-- Se puede correr completo más de una vez (idempotente).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competitions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL UNIQUE,
  event_date             DATE NOT NULL,
  event_time_text        TEXT,               -- texto libre, ej. "10:00 am"
  place                  TEXT,
  includes_text          TEXT,               -- qué incluye la inscripción
  price_cents            INT  NOT NULL,      -- 50000 = $500.00 MXN
  capacity_total         INT  NOT NULL,
  is_open                BOOLEAN NOT NULL DEFAULT false, -- interruptor manual
  registration_opens_at  TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  hold_hours             INT  NOT NULL DEFAULT 48, -- cuánto se aparta el lugar sin pagar
  payment_link_url       TEXT,
  payment_instructions   TEXT,
  folio_prefix           TEXT NOT NULL DEFAULT 'JM',
  privacy_text           TEXT NOT NULL,
  waiver_text            TEXT,               -- NULL/vacío = no se pide casilla de deslinde
  waiver_version         TEXT NOT NULL DEFAULT 'v1',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competition_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id),
  name           TEXT NOT NULL,
  gender         TEXT,                       -- 'femenil' | 'varonil'
  level          TEXT,
  description    TEXT,                       -- criterio para elegir el nivel
  capacity       INT,                        -- cupo propio opcional
  sort_order     INT NOT NULL DEFAULT 0,
  UNIQUE (competition_id, name)
);

-- Estados: pending_payment (lugar apartado hasta hold_expires_at) | paid |
-- expired | cancelled | refunded | needs_attention (dinero recibido pero
-- algo requiere decisión de staff — nunca se descarta un pago).
-- Un pending_payment con hold_expires_at vencido ya NO ocupa lugar aunque
-- siga con ese status en la tabla: no hay cron en esta etapa, el
-- vencimiento se evalúa al contar cupo. Solo se escribe 'expired' cuando
-- la misma persona se vuelve a inscribir (ver register_for_competition).
-- Nada se borra: cancelar/reembolsar son cambios de estado.
CREATE TABLE IF NOT EXISTS public.competition_registrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      UUID NOT NULL REFERENCES public.competitions(id),
  folio               TEXT NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  birth_date          DATE NOT NULL,
  email               TEXT NOT NULL,          -- normalizado a minúsculas
  phone               TEXT NOT NULL,          -- 10 dígitos
  category_id         UUID NOT NULL REFERENCES public.competition_categories(id),
  shirt_size          TEXT NOT NULL CHECK (shirt_size IN ('S','M','L','XL')),
  status              TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK (status IN ('pending_payment','paid','expired','cancelled','refunded','needs_attention')),
  hold_expires_at     TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  payment_method      TEXT,                   -- 'clip' (en línea) | 'cash' | 'card' (terminal en el gym) | 'transfer' | 'link' | 'other'
  checked_in_at       TIMESTAMPTZ,
  privacy_accepted_at TIMESTAMPTZ NOT NULL,
  waiver_accepted_at  TIMESTAMPTZ,
  waiver_version      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una misma persona (nombre + fecha de nacimiento) no puede tener dos
-- inscripciones activas. Un mismo correo sí puede inscribir a varios.
CREATE UNIQUE INDEX IF NOT EXISTS competition_registrations_active_person_idx
  ON public.competition_registrations (competition_id, lower(full_name), birth_date)
  WHERE status IN ('pending_payment','paid','needs_attention');

CREATE INDEX IF NOT EXISTS competition_registrations_comp_status_idx
  ON public.competition_registrations (competition_id, status);

-- Rastro de toda acción de staff. Solo inserción (trigger abajo).
CREATE TABLE IF NOT EXISTS public.competition_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID,
  action          TEXT NOT NULL,
  competition_id  UUID,
  registration_id UUID,
  before          JSONB,
  after           JSONB,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.competition_audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'competition_audit_log es de solo inserción';
END;
$function$;

DROP TRIGGER IF EXISTS competition_audit_log_no_change ON public.competition_audit_log;
CREATE TRIGGER competition_audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.competition_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.competition_audit_log_immutable();

ALTER TABLE public.competitions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_audit_log     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.competitions, public.competition_categories,
              public.competition_registrations, public.competition_audit_log
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- Helpers internos (no llamables desde la API)
-- ------------------------------------------------------------

-- Lugares ocupados: pagados + por atender + pendientes con reserva vigente.
CREATE OR REPLACE FUNCTION public.competition_spots_taken(p_competition_id UUID, p_category_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT count(*)::int
  FROM competition_registrations r
  WHERE r.competition_id = p_competition_id
    AND (p_category_id IS NULL OR r.category_id = p_category_id)
    AND (r.status IN ('paid','needs_attention')
         OR (r.status = 'pending_payment' AND r.hold_expires_at > now()));
$function$;

CREATE OR REPLACE FUNCTION public.competition_is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin');
$function$;

REVOKE ALL ON FUNCTION public.competition_spots_taken(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_audit_log_immutable() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Públicas (anon)
-- ------------------------------------------------------------

-- Info de la competencia para la página pública. state:
-- 'open' | 'not_yet' | 'closed' | 'full'.
CREATE OR REPLACE FUNCTION public.get_competition_public(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp  competitions%ROWTYPE;
  v_taken INT;
  v_state TEXT;
  v_cats  JSONB;
BEGIN
  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  v_taken := competition_spots_taken(v_comp.id);
  v_state := CASE
    WHEN NOT v_comp.is_open THEN 'closed'
    WHEN v_comp.registration_opens_at IS NOT NULL AND now() < v_comp.registration_opens_at THEN 'not_yet'
    WHEN v_comp.registration_closes_at IS NOT NULL AND now() >= v_comp.registration_closes_at THEN 'closed'
    WHEN v_taken >= v_comp.capacity_total THEN 'full'
    ELSE 'open'
  END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', cc.id, 'name', cc.name, 'gender', cc.gender, 'level', cc.level,
           'description', cc.description,
           'is_full', cc.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, cc.id) >= cc.capacity
         ) ORDER BY cc.sort_order, cc.name), '[]'::jsonb)
  INTO v_cats
  FROM competition_categories cc WHERE cc.competition_id = v_comp.id;

  RETURN jsonb_build_object(
    'name', v_comp.name,
    'event_date', v_comp.event_date,
    'event_time_text', v_comp.event_time_text,
    'place', v_comp.place,
    'includes_text', v_comp.includes_text,
    'price_cents', v_comp.price_cents,
    'state', v_state,
    'spots_left', greatest(v_comp.capacity_total - v_taken, 0),
    'registration_opens_at', v_comp.registration_opens_at,
    'registration_closes_at', v_comp.registration_closes_at,
    'hold_hours', v_comp.hold_hours,
    'privacy_text', v_comp.privacy_text,
    'waiver_text', nullif(btrim(coalesce(v_comp.waiver_text, '')), ''),
    'categories', v_cats
  );
END;
$function$;

-- Crea la inscripción y aparta el lugar. Toda la validación se repite
-- aquí (el frontend no es de fiar). El cupo es atómico: FOR UPDATE sobre
-- la fila de la competencia serializa las inscripciones simultáneas, así
-- dos personas no pueden tomar el último lugar a la vez.
-- Menores de edad: se inscriben igual que un adulto (decisión 2026-10-04);
-- solo se devuelve is_minor para mostrar el aviso de que deben llegar con
-- un mayor de edad a firmar.
CREATE OR REPLACE FUNCTION public.register_for_competition(
  p_slug           TEXT,
  p_full_name      TEXT,
  p_birth_date     DATE,
  p_email          TEXT,
  p_phone          TEXT,
  p_category_id    UUID,
  p_shirt_size     TEXT,
  p_accept_privacy BOOLEAN,
  p_accept_waiver  BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp       competitions%ROWTYPE;
  v_cat        competition_categories%ROWTYPE;
  v_existing   competition_registrations%ROWTYPE;
  v_name       TEXT := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_email      TEXT := lower(btrim(coalesce(p_email, '')));
  v_phone      TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_today      DATE := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_has_waiver BOOLEAN;
  v_alphabet   CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I
  v_folio      TEXT;
  v_hold       TIMESTAMPTZ;
  v_tries      INT := 0;
BEGIN
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
  IF p_birth_date IS NULL OR p_birth_date < DATE '1920-01-01' OR p_birth_date > v_today THEN
    RETURN jsonb_build_object('error', 'invalid_birth_date');
  END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('error', 'invalid_email'); END IF;
  IF length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
  IF p_shirt_size IS NULL OR p_shirt_size NOT IN ('S','M','L','XL') THEN RETURN jsonb_build_object('error', 'invalid_shirt_size'); END IF;
  IF p_accept_privacy IS NOT TRUE THEN RETURN jsonb_build_object('error', 'privacy_required'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  v_has_waiver := nullif(btrim(coalesce(v_comp.waiver_text, '')), '') IS NOT NULL;
  IF v_has_waiver AND p_accept_waiver IS NOT TRUE THEN RETURN jsonb_build_object('error', 'waiver_required'); END IF;

  IF NOT v_comp.is_open
     OR (v_comp.registration_opens_at IS NOT NULL AND now() < v_comp.registration_opens_at)
     OR (v_comp.registration_closes_at IS NOT NULL AND now() >= v_comp.registration_closes_at) THEN
    RETURN jsonb_build_object('error', 'closed');
  END IF;

  SELECT cc.* INTO v_cat FROM competition_categories cc
  WHERE cc.id = p_category_id AND cc.competition_id = v_comp.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_category'); END IF;

  -- Misma persona ya inscrita y activa → se le manda a consultar su folio.
  -- Si lo que tiene es un pendiente ya vencido, se marca 'expired' para
  -- que pueda inscribirse de nuevo (el registro viejo no se borra).
  SELECT r.* INTO v_existing FROM competition_registrations r
  WHERE r.competition_id = v_comp.id AND lower(r.full_name) = lower(v_name)
    AND r.birth_date = p_birth_date
    AND r.status IN ('pending_payment','paid','needs_attention');
  IF FOUND THEN
    IF v_existing.status = 'pending_payment' AND v_existing.hold_expires_at <= now() THEN
      UPDATE competition_registrations r SET status = 'expired', updated_at = now() WHERE r.id = v_existing.id;
    ELSE
      RETURN jsonb_build_object('error', 'duplicate');
    END IF;
  END IF;

  -- Freno simple contra acaparar cupo con reservas sin pagar.
  IF (SELECT count(*) FROM competition_registrations r
      WHERE r.competition_id = v_comp.id AND r.email = v_email
        AND r.status = 'pending_payment' AND r.hold_expires_at > now()) >= 5 THEN
    RETURN jsonb_build_object('error', 'too_many_pending');
  END IF;

  IF competition_spots_taken(v_comp.id) >= v_comp.capacity_total THEN RETURN jsonb_build_object('error', 'full'); END IF;
  IF v_cat.capacity IS NOT NULL AND competition_spots_taken(v_comp.id, v_cat.id) >= v_cat.capacity THEN
    RETURN jsonb_build_object('error', 'category_full');
  END IF;

  LOOP
    v_folio := v_comp.folio_prefix || '-' || (
      SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      FROM generate_series(1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM competition_registrations r WHERE r.folio = v_folio);
    v_tries := v_tries + 1;
    IF v_tries > 20 THEN RETURN jsonb_build_object('error', 'folio_failed'); END IF;
  END LOOP;

  v_hold := now() + make_interval(hours => v_comp.hold_hours);

  INSERT INTO competition_registrations (
    competition_id, folio, full_name, birth_date, email, phone, category_id, shirt_size,
    status, hold_expires_at, privacy_accepted_at, waiver_accepted_at, waiver_version
  ) VALUES (
    v_comp.id, v_folio, v_name, p_birth_date, v_email, v_phone, v_cat.id, p_shirt_size,
    'pending_payment', v_hold, now(),
    CASE WHEN v_has_waiver THEN now() END,
    CASE WHEN v_has_waiver THEN v_comp.waiver_version END
  );

  RETURN jsonb_build_object(
    'success', true,
    'folio', v_folio,
    'full_name', v_name,
    'category_name', v_cat.name,
    'shirt_size', p_shirt_size,
    'hold_expires_at', v_hold,
    'price_cents', v_comp.price_cents,
    'payment_link_url', v_comp.payment_link_url,
    'payment_instructions', v_comp.payment_instructions,
    'is_minor', p_birth_date > (v_comp.event_date - INTERVAL '18 years')::date
  );
END;
$function$;

-- Consulta pública: exige folio Y correo a la vez.
CREATE OR REPLACE FUNCTION public.get_registration_status(p_folio TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_reg     competition_registrations%ROWTYPE;
  v_comp    competitions%ROWTYPE;
  v_cat     TEXT;
  v_pending BOOLEAN;
BEGIN
  SELECT r.* INTO v_reg FROM competition_registrations r
  WHERE r.folio = upper(btrim(coalesce(p_folio, ''))) AND r.email = lower(btrim(coalesce(p_email, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.id = v_reg.competition_id;
  SELECT cc.name INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
  v_pending := v_reg.status = 'pending_payment';

  RETURN jsonb_build_object(
    'folio', v_reg.folio,
    'full_name', v_reg.full_name,
    'category_name', v_cat,
    'shirt_size', v_reg.shirt_size,
    'status', v_reg.status,
    'hold_expires_at', v_reg.hold_expires_at,
    'hold_expired', v_pending AND v_reg.hold_expires_at <= now(),
    'paid_at', v_reg.paid_at,
    'price_cents', v_comp.price_cents,
    'payment_link_url', CASE WHEN v_pending THEN v_comp.payment_link_url END,
    'payment_instructions', CASE WHEN v_pending THEN v_comp.payment_instructions END,
    'is_minor', v_reg.birth_date > (v_comp.event_date - INTERVAL '18 years')::date,
    'competition_name', v_comp.name,
    'event_date', v_comp.event_date,
    'event_time_text', v_comp.event_time_text,
    'place', v_comp.place
  );
END;
$function$;

-- ------------------------------------------------------------
-- Admin
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_competition_admin(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'competition', to_jsonb(v_comp),
    'categories', (
      SELECT coalesce(jsonb_agg(to_jsonb(cc) ORDER BY cc.sort_order, cc.name), '[]'::jsonb)
      FROM competition_categories cc WHERE cc.competition_id = v_comp.id),
    'registrations', (
      SELECT coalesce(jsonb_agg(
               to_jsonb(r) || jsonb_build_object(
                 'hold_expired', r.status = 'pending_payment' AND r.hold_expires_at <= now(),
                 'is_minor', r.birth_date > (v_comp.event_date - INTERVAL '18 years')::date)
               ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM competition_registrations r WHERE r.competition_id = v_comp.id)
  );
END;
$function$;

-- Acciones de staff sobre una inscripción. Todas dejan rastro en
-- competition_audit_log; el motivo es obligatorio salvo en check-in.
--   mark_paid         payload {method: 'cash'|'card'|'transfer'|'link'|'other'} ('card' = terminal en el gym)
--   resolve_attention needs_attention → paid (staff decide admitirlo)
--   cancel            solo si NO hay dinero recibido
--   mark_refunded     paid/needs_attention → refunded
--   edit              payload {category_id?, shirt_size?, full_name?, email?, phone?}
--   check_in / undo_check_in
--   extend_hold       payload {hours?} — re-aparta el lugar a un pendiente
-- Regla rectora: un pago nunca se rechaza. Si se marca pagado a alguien
-- cuya reserva venció y ya no hay cupo, queda 'needs_attention' con el
-- pago registrado, para que staff decida (admitir o reembolsar).
CREATE OR REPLACE FUNCTION public.admin_update_registration(
  p_id      UUID,
  p_action  TEXT,
  p_reason  TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp      competitions%ROWTYPE;
  v_reg       competition_registrations%ROWTYPE;
  v_new       competition_registrations%ROWTYPE;
  v_cat       competition_categories%ROWTYPE;
  v_reason    TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload   JSONB := coalesce(p_payload, '{}'::jsonb);
  v_holds     BOOLEAN;  -- ¿esta inscripción ya ocupa un lugar ahora mismo?
  v_has_room  BOOLEAN;
  v_method    TEXT;
  v_name      TEXT;
  v_email     TEXT;
  v_phone     TEXT;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF v_reason IS NULL AND p_action NOT IN ('check_in', 'undo_check_in') THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;

  -- Mismo orden de bloqueo que register_for_competition (competencia
  -- primero) para no cruzarse con una inscripción simultánea.
  SELECT c.* INTO v_comp FROM competitions c
  WHERE c.id = (SELECT r.competition_id FROM competition_registrations r WHERE r.id = p_id)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT r.* INTO v_reg FROM competition_registrations r WHERE r.id = p_id FOR UPDATE;
  v_new := v_reg;

  v_holds := v_reg.status IN ('paid','needs_attention')
             OR (v_reg.status = 'pending_payment' AND v_reg.hold_expires_at > now());
  SELECT cc.* INTO v_cat FROM competition_categories cc WHERE cc.id = v_reg.category_id;
  v_has_room := competition_spots_taken(v_comp.id) < v_comp.capacity_total
                AND (v_cat.capacity IS NULL OR competition_spots_taken(v_comp.id, v_cat.id) < v_cat.capacity);

  IF p_action = 'mark_paid' THEN
    IF v_reg.status NOT IN ('pending_payment','expired') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    v_method := v_payload->>'method';
    IF v_method IS NULL OR v_method NOT IN ('cash','card','transfer','link','other') THEN
      RETURN jsonb_build_object('error', 'invalid_method');
    END IF;
    -- Otra inscripción activa de la misma persona (se reinscribió tras
    -- vencer): no se puede reactivar esta sin chocar con el índice único.
    IF v_reg.status = 'expired' AND EXISTS (
      SELECT 1 FROM competition_registrations r
      WHERE r.competition_id = v_reg.competition_id AND r.id <> v_reg.id
        AND lower(r.full_name) = lower(v_reg.full_name) AND r.birth_date = v_reg.birth_date
        AND r.status IN ('pending_payment','paid','needs_attention')) THEN
      RETURN jsonb_build_object('error', 'has_other_active');
    END IF;
    v_new.status := CASE WHEN v_holds OR v_has_room THEN 'paid' ELSE 'needs_attention' END;
    v_new.paid_at := now();
    v_new.payment_method := v_method;

  ELSIF p_action = 'resolve_attention' THEN
    IF v_reg.status <> 'needs_attention' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    v_new.status := 'paid';

  ELSIF p_action = 'cancel' THEN
    IF v_reg.status NOT IN ('pending_payment','expired') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    v_new.status := 'cancelled';

  ELSIF p_action = 'mark_refunded' THEN
    IF v_reg.status NOT IN ('paid','needs_attention') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    v_new.status := 'refunded';
    v_new.checked_in_at := NULL;

  ELSIF p_action = 'check_in' THEN
    IF v_reg.status <> 'paid' THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    v_new.checked_in_at := now();

  ELSIF p_action = 'undo_check_in' THEN
    v_new.checked_in_at := NULL;

  ELSIF p_action = 'extend_hold' THEN
    IF v_reg.status NOT IN ('pending_payment','expired') THEN RETURN jsonb_build_object('error', 'invalid_state'); END IF;
    IF NOT v_holds AND NOT v_has_room THEN RETURN jsonb_build_object('error', 'full'); END IF;
    IF v_reg.status = 'expired' AND EXISTS (
      SELECT 1 FROM competition_registrations r
      WHERE r.competition_id = v_reg.competition_id AND r.id <> v_reg.id
        AND lower(r.full_name) = lower(v_reg.full_name) AND r.birth_date = v_reg.birth_date
        AND r.status IN ('pending_payment','paid','needs_attention')) THEN
      RETURN jsonb_build_object('error', 'has_other_active');
    END IF;
    v_new.status := 'pending_payment';
    v_new.hold_expires_at := now() + make_interval(hours =>
      least(greatest(coalesce((v_payload->>'hours')::int, v_comp.hold_hours), 1), 720));

  ELSIF p_action = 'edit' THEN
    IF v_payload ? 'category_id' THEN
      SELECT cc.* INTO v_cat FROM competition_categories cc
      WHERE cc.id = (v_payload->>'category_id')::uuid AND cc.competition_id = v_comp.id;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_category'); END IF;
      v_new.category_id := v_cat.id;
    END IF;
    IF v_payload ? 'shirt_size' THEN
      IF v_payload->>'shirt_size' NOT IN ('S','M','L','XL') THEN RETURN jsonb_build_object('error', 'invalid_shirt_size'); END IF;
      v_new.shirt_size := v_payload->>'shirt_size';
    END IF;
    IF v_payload ? 'full_name' THEN
      v_name := regexp_replace(btrim(v_payload->>'full_name'), '\s+', ' ', 'g');
      IF length(v_name) < 3 OR length(v_name) > 120 THEN RETURN jsonb_build_object('error', 'invalid_name'); END IF;
      v_new.full_name := v_name;
    END IF;
    IF v_payload ? 'email' THEN
      v_email := lower(btrim(v_payload->>'email'));
      IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN jsonb_build_object('error', 'invalid_email'); END IF;
      v_new.email := v_email;
    END IF;
    IF v_payload ? 'phone' THEN
      v_phone := regexp_replace(v_payload->>'phone', '\D', '', 'g');
      IF length(v_phone) <> 10 THEN RETURN jsonb_build_object('error', 'invalid_phone'); END IF;
      v_new.phone := v_phone;
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'invalid_action');
  END IF;

  v_new.updated_at := now();

  BEGIN
    UPDATE competition_registrations r SET
      full_name = v_new.full_name, email = v_new.email, phone = v_new.phone,
      category_id = v_new.category_id, shirt_size = v_new.shirt_size,
      status = v_new.status, hold_expires_at = v_new.hold_expires_at,
      paid_at = v_new.paid_at, payment_method = v_new.payment_method,
      checked_in_at = v_new.checked_in_at, updated_at = v_new.updated_at
    WHERE r.id = v_reg.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'has_other_active');
  END;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, registration_id, before, after, reason)
  VALUES (auth.uid(), p_action, v_comp.id, v_reg.id, to_jsonb(v_reg), to_jsonb(v_new), v_reason);

  RETURN jsonb_build_object('success', true, 'status', v_new.status);
END;
$function$;

-- Ajustes operativos de la competencia desde el panel. Solo estas llaves:
-- is_open, capacity_total, hold_hours, price_cents, payment_link_url, payment_instructions.
-- (Nombre, fechas, textos y categorías se editan por SQL / Table Editor.)
CREATE OR REPLACE FUNCTION public.admin_update_competition(p_slug TEXT, p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_comp competitions%ROWTYPE;
  v_new  competitions%ROWTYPE;
BEGIN
  IF NOT competition_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  SELECT c.* INTO v_comp FROM competitions c WHERE c.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_new := v_comp;

  IF p_patch ? 'is_open' THEN v_new.is_open := (p_patch->>'is_open')::boolean; END IF;
  IF p_patch ? 'capacity_total' THEN v_new.capacity_total := (p_patch->>'capacity_total')::int; END IF;
  IF p_patch ? 'hold_hours' THEN v_new.hold_hours := (p_patch->>'hold_hours')::int; END IF;
  IF p_patch ? 'price_cents' THEN v_new.price_cents := (p_patch->>'price_cents')::int; END IF;
  IF p_patch ? 'payment_link_url' THEN v_new.payment_link_url := nullif(btrim(p_patch->>'payment_link_url'), ''); END IF;
  IF p_patch ? 'payment_instructions' THEN v_new.payment_instructions := nullif(btrim(p_patch->>'payment_instructions'), ''); END IF;

  IF v_new.capacity_total < 0 OR v_new.hold_hours < 1 OR v_new.hold_hours > 720
     OR v_new.price_cents IS NULL OR v_new.price_cents < 100 THEN
    RETURN jsonb_build_object('error', 'invalid_value');
  END IF;
  IF v_new.payment_link_url IS NOT NULL AND v_new.payment_link_url !~* '^https://' THEN
    RETURN jsonb_build_object('error', 'invalid_link');
  END IF;

  UPDATE competitions c SET
    is_open = v_new.is_open, capacity_total = v_new.capacity_total, hold_hours = v_new.hold_hours,
    price_cents = v_new.price_cents,
    payment_link_url = v_new.payment_link_url, payment_instructions = v_new.payment_instructions
  WHERE c.id = v_comp.id;

  INSERT INTO competition_audit_log (actor_id, action, competition_id, before, after)
  VALUES (auth.uid(), 'update_competition', v_comp.id, to_jsonb(v_comp), to_jsonb(v_new));

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_competition_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_for_competition(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_registration_status(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_competition_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_registration(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_competition(TEXT, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_competition_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_competition(TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_registration_status(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_registration(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_competition(TEXT, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- Datos iniciales — PROVISIONALES, cerrada (is_open = false).
-- Los datos reales se aplican con competencia_datos.sql. El slug
-- 'competencia-2026' es el que usa el frontend (src/lib/competition.ts).
-- ------------------------------------------------------------
INSERT INTO public.competitions (
  name, slug, event_date, event_time_text, place, includes_text,
  price_cents, capacity_total, is_open, hold_hours, folio_prefix,
  payment_instructions, privacy_text, waiver_text, waiver_version
) VALUES (
  'Competencia Jaibamuro', 'competencia-2026', DATE '2026-11-07', NULL, 'Jaibamuro', NULL,
  50000, 100, false, 48, 'JM',
  'Al pagar, escribe tu folio en el concepto o referencia del pago. Tu lugar se confirma cuando verificamos el pago; puedes revisar el estado en "Consulta tu inscripción".',
  'Jaibamuro usa tus datos (nombre, fecha de nacimiento, correo, celular, categoría y talla) únicamente para organizar esta competencia: confirmar tu inscripción y tu pago, asignarte categoría, preparar tu playera y contactarte sobre el evento. La fecha de nacimiento se usa para validar tu edad y categoría. No compartimos tus datos con terceros.',
  'Entiendo que la escalada es una actividad con riesgo de lesión y participo de forma voluntaria y bajo mi propia responsabilidad. Me comprometo a seguir las indicaciones del staff y el reglamento de la competencia. Si soy menor de edad, acudiré acompañado de un mayor de edad que firmará mi registro el día del evento.',
  'v1'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.competition_categories (competition_id, name, gender, level, description, sort_order)
SELECT c.id, v.name, v.gender, v.level, v.description, v.sort_order
FROM public.competitions c
CROSS JOIN (VALUES
  ('Femenil Básico',       'femenil', 'basico',       NULL, 1),
  ('Femenil Intermedio',   'femenil', 'intermedio',   NULL, 2),
  ('Femenil Avanzado',     'femenil', 'avanzado',     NULL, 3),
  ('Varonil Básico',       'varonil', 'basico',       NULL, 4),
  ('Varonil Intermedio',   'varonil', 'intermedio',   NULL, 5),
  ('Varonil Avanzado',     'varonil', 'avanzado',     NULL, 6)
) AS v(name, gender, level, description, sort_order)
WHERE c.slug = 'competencia-2026'
ON CONFLICT (competition_id, name) DO NOTHING;
