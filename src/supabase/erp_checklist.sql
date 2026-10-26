-- ============================================================
-- Checklist diario del staff (2026-10-26).
-- Requiere clases.sql, erp.sql, erp_finanzas.sql y erp_crm.sql (córrelo DESPUÉS).
-- Idempotente: se puede correr más de una vez (la semilla solo entra si no hay plantilla).
--
--   Plantilla (la edita el admin): bloques con horario y días de la semana;
--   cada tarea hereda los días de su bloque o tiene los suyos (extras del
--   viernes, tarea del día). "Antes de irte" son bloques de todos los días.
--
--   Ejecución: cada día se genera una COPIA de la plantilla (checklist_day_tasks).
--   Editar la plantilla no cambia días que ya se generaron.
--
--   Caja: "Contar el fondo" abre la Caja de la app y "Corte de caja" la cierra
--   (mismas reglas: si no cuadra, pide explicación). El monto se captura una vez.
--   Desmontaje (sábado): el admin elige rutas de la pared; el staff las retira.
-- ============================================================

-- ------------------------------------------------------------
-- Plantilla
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_settings (
  id    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rules TEXT NOT NULL DEFAULT ''
);
INSERT INTO public.checklist_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.checklist_blocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  start_time TIME,
  end_time   TIME,
  days       INT[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- 1 = lunes … 7 = domingo
  position   INT NOT NULL DEFAULT 0,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS public.checklist_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id        UUID NOT NULL REFERENCES public.checklist_blocks(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  start_time      TIME,
  end_time        TIME,
  days            INT[],                                -- NULL = los días del bloque
  position        INT NOT NULL DEFAULT 0,
  requires_photo  BOOLEAN NOT NULL DEFAULT false,
  requires_amount BOOLEAN NOT NULL DEFAULT false,
  requires_note   BOOLEAN NOT NULL DEFAULT false,
  required        BOOLEAN NOT NULL DEFAULT true,
  kind            TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','cash_open','cash_close','teardown'))
);
CREATE INDEX IF NOT EXISTS checklist_tasks_block_idx ON public.checklist_tasks (block_id, position);

-- ------------------------------------------------------------
-- Días (encargado, desmontaje, bitácora, cierre) y su copia de tareas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_days (
  day_date           DATE PRIMARY KEY,
  lead_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  teardown_note      TEXT,
  teardown_route_ids UUID[] NOT NULL DEFAULT '{}',
  generated_at       TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at          TIMESTAMPTZ,
  closed_by          UUID,
  log                JSONB,                              -- {happened, pending, broken}
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_day_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_date         DATE NOT NULL REFERENCES public.checklist_days(day_date) ON DELETE CASCADE,
  template_task_id UUID,
  block_title      TEXT NOT NULL,
  block_start      TIME,
  block_end        TIME,
  block_note       TEXT,
  block_position   INT NOT NULL,
  text             TEXT NOT NULL,
  start_time       TIME,
  end_time         TIME,
  position         INT NOT NULL,
  requires_photo   BOOLEAN NOT NULL,
  requires_amount  BOOLEAN NOT NULL,
  requires_note    BOOLEAN NOT NULL,
  required         BOOLEAN NOT NULL,
  kind             TEXT NOT NULL,
  done_at          TIMESTAMPTZ,
  done_by          UUID,
  photo_path       TEXT,
  amount_cents     INT,
  note             TEXT,
  skipped_reason   TEXT,
  skipped_by       UUID,
  skipped_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS checklist_day_tasks_day_idx ON public.checklist_day_tasks (day_date, block_position, position);

-- Reportes en el momento ("se rompió", "se acabó") con foto opcional.
CREATE TABLE IF NOT EXISTS public.checklist_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_date   DATE NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  text       TEXT NOT NULL,
  photo_path TEXT
);
CREATE INDEX IF NOT EXISTS checklist_notes_day_idx ON public.checklist_notes (day_date, created_at);

-- Fotos: bucket privado 'checklist' (el staff sube y ve; nadie borra desde la app).
DO $storage$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('checklist', 'checklist', false, 10485760)
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS checklist_staff_select ON storage.objects;
    DROP POLICY IF EXISTS checklist_staff_insert ON storage.objects;
    CREATE POLICY checklist_staff_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'checklist' AND public.erp_storage_is_staff());
    CREATE POLICY checklist_staff_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'checklist' AND public.erp_storage_is_staff());
  END IF;
END;
$storage$;

-- ------------------------------------------------------------
-- Ayudantes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_checklist_dow(p_date DATE)
RETURNS INT LANGUAGE sql IMMUTABLE AS $function$
  SELECT extract(isodow FROM p_date)::int;
$function$;

-- Copia la plantilla al día (una sola vez).
CREATE OR REPLACE FUNCTION public.erp_checklist_generate(p_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_dow INT := erp_checklist_dow(p_date);
  v_gen TIMESTAMPTZ;
BEGIN
  INSERT INTO checklist_days (day_date) VALUES (p_date) ON CONFLICT DO NOTHING;
  SELECT generated_at INTO v_gen FROM checklist_days WHERE day_date = p_date FOR UPDATE;
  IF v_gen IS NOT NULL THEN RETURN; END IF;
  INSERT INTO checklist_day_tasks (day_date, template_task_id, block_title, block_start, block_end, block_note, block_position,
                                   text, start_time, end_time, position, requires_photo, requires_amount, requires_note, required, kind)
  SELECT p_date, t.id, b.title, b.start_time, b.end_time, b.note, b.position,
         t.text, t.start_time, t.end_time, t.position, t.requires_photo, t.requires_amount, t.requires_note, t.required, t.kind
  FROM checklist_blocks b JOIN checklist_tasks t ON t.block_id = b.id
  WHERE v_dow = ANY (b.days) AND v_dow = ANY (coalesce(t.days, b.days));
  UPDATE checklist_days SET generated_at = now(), updated_at = now() WHERE day_date = p_date;
END;
$function$;

-- Las tareas de caja sin foto se marcan solas cuando la Caja ya se abrió / cerró.
CREATE OR REPLACE FUNCTION public.erp_checklist_sync_cash(p_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_open  cash_sessions%ROWTYPE;
  v_close cash_sessions%ROWTYPE;
BEGIN
  IF (SELECT status FROM checklist_days WHERE day_date = p_date) IS DISTINCT FROM 'open' THEN RETURN; END IF;
  SELECT * INTO v_open FROM cash_sessions WHERE business_date = p_date ORDER BY opened_at LIMIT 1;
  IF v_open.id IS NOT NULL THEN
    UPDATE checklist_day_tasks SET done_at = v_open.opened_at, done_by = v_open.opened_by, amount_cents = v_open.opening_cash_cents,
           skipped_reason = NULL, skipped_by = NULL, skipped_at = NULL
    WHERE day_date = p_date AND kind = 'cash_open' AND done_at IS NULL AND NOT requires_photo;
  END IF;
  SELECT * INTO v_close FROM cash_sessions WHERE business_date = p_date AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1;
  IF v_close.id IS NOT NULL THEN
    UPDATE checklist_day_tasks SET done_at = v_close.closed_at, done_by = v_close.closed_by, amount_cents = v_close.counted_cash_cents,
           skipped_reason = NULL, skipped_by = NULL, skipped_at = NULL
    WHERE day_date = p_date AND kind = 'cash_close' AND done_at IS NULL AND NOT requires_photo;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_checklist_day_json(p_date DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_d checklist_days%ROWTYPE;
  v_prev checklist_days%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM checklist_days WHERE day_date = p_date;
  SELECT * INTO v_prev FROM checklist_days WHERE day_date < p_date AND generated_at IS NOT NULL ORDER BY day_date DESC LIMIT 1;
  RETURN jsonb_build_object(
    'date', p_date,
    'dow', erp_checklist_dow(p_date),
    'today', erp_today(),
    'generated', v_d.generated_at IS NOT NULL,
    'status', coalesce(v_d.status, 'open'),
    'lead_id', v_d.lead_id,
    'lead_name', (SELECT name FROM profiles WHERE id = v_d.lead_id),
    'closed_at', v_d.closed_at,
    'closed_by_name', (SELECT name FROM profiles WHERE id = v_d.closed_by),
    'log', v_d.log,
    'rules', (SELECT rules FROM checklist_settings WHERE id = 1),
    'teardown_note', v_d.teardown_note,
    'teardown_routes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'route_number', r.route_number, 'color', r.color, 'grade', r.grade,
                                   'zone', (SELECT z.name FROM zones z WHERE z.id = r.zone_id), 'status', r.status, 'retired_at', r.retired_at) ORDER BY r.route_number)
                                 FROM routes r WHERE r.id = ANY (coalesce(v_d.teardown_route_ids, '{}'))), '[]'::jsonb),
    'tasks', coalesce((SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object(
                          'done_by_name', (SELECT name FROM profiles WHERE id = t.done_by),
                          'skipped_by_name', (SELECT name FROM profiles WHERE id = t.skipped_by))
                        ORDER BY t.block_position, t.position, t.text)
                       FROM checklist_day_tasks t WHERE t.day_date = p_date), '[]'::jsonb),
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'created_at', n.created_at, 'text', n.text, 'photo_path', n.photo_path,
                          'by', (SELECT name FROM profiles WHERE id = n.created_by)) ORDER BY n.created_at)
                       FROM checklist_notes n WHERE n.day_date = p_date), '[]'::jsonb),
    'cash', (SELECT jsonb_build_object('opened_at', c.opened_at, 'opening_cents', c.opening_cash_cents, 'closed_at', c.closed_at,
                       'expected_cents', c.expected_cash_cents, 'counted_cents', c.counted_cash_cents, 'difference_cents', c.difference_cents, 'note', c.note)
             FROM cash_sessions c WHERE c.business_date = p_date ORDER BY c.opened_at DESC LIMIT 1),
    'cash_open_other_day', EXISTS (SELECT 1 FROM cash_sessions c WHERE c.closed_at IS NULL AND c.business_date <> p_date),
    'prev', CASE WHEN v_prev.day_date IS NULL THEN NULL ELSE jsonb_build_object(
              'date', v_prev.day_date, 'status', v_prev.status, 'log', v_prev.log,
              'lead_name', (SELECT name FROM profiles WHERE id = v_prev.lead_id),
              'notes', coalesce((SELECT jsonb_agg(n.text ORDER BY n.created_at) FROM checklist_notes n WHERE n.day_date = v_prev.day_date), '[]'::jsonb),
              'not_done', coalesce((SELECT jsonb_agg(jsonb_build_object('text', t.text, 'reason', t.skipped_reason) ORDER BY t.block_position, t.position)
                                    FROM checklist_day_tasks t WHERE t.day_date = v_prev.day_date AND t.done_at IS NULL), '[]'::jsonb)) END
  );
END;
$function$;

-- Puede tocar el día: hoy (staff) o cualquier día abierto (admin).
CREATE OR REPLACE FUNCTION public.erp_checklist_can_edit(p_date DATE)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_staff() THEN RETURN 'forbidden'; END IF;
  IF p_date <> erp_today() AND NOT class_is_admin() THEN RETURN 'not_today'; END IF;
  IF (SELECT status FROM checklist_days WHERE day_date = p_date) = 'closed' THEN RETURN 'day_closed'; END IF;
  RETURN NULL;
END;
$function$;

-- ------------------------------------------------------------
-- Staff: el checklist de hoy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_checklist_today()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_checklist_generate(v_today);
  PERFORM erp_checklist_sync_cash(v_today);
  RETURN erp_checklist_day_json(v_today) || jsonb_build_object('is_admin', class_is_admin(), 'me', auth.uid());
END;
$function$;

-- Admin: cualquier día (los días futuros no se generan, solo se ven planeados).
CREATE OR REPLACE FUNCTION public.get_checklist_day(p_date DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF p_date = erp_today() THEN RETURN get_checklist_today(); END IF;
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  PERFORM erp_checklist_sync_cash(p_date);
  RETURN erp_checklist_day_json(p_date) || jsonb_build_object('is_admin', true, 'me', auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.checklist_complete_task(p_task_id UUID, p JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_t checklist_day_tasks%ROWTYPE;
  v_err TEXT;
  v_photo TEXT := nullif(btrim(coalesce(p->>'photo_path', '')), '');
  v_note TEXT := nullif(btrim(coalesce(p->>'note', '')), '');
  v_amount INT := nullif(p->>'amount_cents', '')::int;
  v_sess cash_sessions%ROWTYPE;
  v_r JSONB;
BEGIN
  SELECT * INTO v_t FROM checklist_day_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', CASE WHEN class_is_staff() THEN 'not_found' ELSE 'forbidden' END); END IF;
  v_err := erp_checklist_can_edit(v_t.day_date);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;
  IF v_t.done_at IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'already', true); END IF;
  IF v_photo IS NOT NULL AND v_photo NOT LIKE v_t.day_date::text || '/%' THEN RETURN jsonb_build_object('error', 'invalid_photo'); END IF;
  IF v_t.requires_photo AND v_photo IS NULL THEN RETURN jsonb_build_object('error', 'photo_required'); END IF;
  IF v_t.requires_note AND length(coalesce(v_note, '')) < 2 THEN RETURN jsonb_build_object('error', 'note_required'); END IF;
  IF v_amount IS NOT NULL AND v_amount < 0 THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;

  IF v_t.kind = 'cash_open' THEN
    -- Si la Caja de hoy ya se abrió se usa ese fondo; si no, se abre aquí.
    SELECT * INTO v_sess FROM cash_sessions WHERE business_date = v_t.day_date ORDER BY opened_at LIMIT 1;
    IF v_sess.id IS NULL THEN
      IF v_t.day_date <> erp_today() THEN RETURN jsonb_build_object('error', 'cash_not_open'); END IF;
      IF v_amount IS NULL THEN RETURN jsonb_build_object('error', 'amount_required'); END IF;
      v_r := open_cash(v_amount, 'Desde el checklist');
      IF v_r ? 'error' THEN RETURN v_r; END IF;
      SELECT * INTO v_sess FROM cash_sessions WHERE id = (v_r->>'id')::uuid;
    END IF;
    v_amount := v_sess.opening_cash_cents;
  ELSIF v_t.kind = 'cash_close' THEN
    -- Corte: cierra la Caja abierta (pide explicación si no cuadra) o usa el corte ya hecho hoy.
    SELECT * INTO v_sess FROM cash_sessions WHERE business_date = v_t.day_date AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1;
    IF v_sess.id IS NULL OR EXISTS (SELECT 1 FROM cash_sessions WHERE closed_at IS NULL) THEN
      IF NOT EXISTS (SELECT 1 FROM cash_sessions WHERE closed_at IS NULL) THEN RETURN jsonb_build_object('error', 'cash_not_open'); END IF;
      IF v_amount IS NULL THEN RETURN jsonb_build_object('error', 'amount_required'); END IF;
      v_r := close_cash(v_amount, v_note);
      IF v_r ? 'error' THEN RETURN v_r; END IF;
      SELECT * INTO v_sess FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1;
    END IF;
    v_amount := v_sess.counted_cash_cents;
  ELSIF v_t.requires_amount AND v_amount IS NULL THEN
    RETURN jsonb_build_object('error', 'amount_required');
  END IF;

  UPDATE checklist_day_tasks SET done_at = now(), done_by = auth.uid(), photo_path = v_photo, amount_cents = v_amount, note = v_note,
         skipped_reason = NULL, skipped_by = NULL, skipped_at = NULL
  WHERE id = p_task_id;
  UPDATE checklist_days SET updated_at = now() WHERE day_date = v_t.day_date;
  RETURN jsonb_build_object('success', true, 'amount_cents', v_amount);
END;
$function$;

-- Desmarcar (quien la marcó o el admin). No deshace la Caja.
CREATE OR REPLACE FUNCTION public.checklist_undo_task(p_task_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_t checklist_day_tasks%ROWTYPE;
  v_err TEXT;
BEGIN
  SELECT * INTO v_t FROM checklist_day_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', CASE WHEN class_is_staff() THEN 'not_found' ELSE 'forbidden' END); END IF;
  v_err := erp_checklist_can_edit(v_t.day_date);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;
  IF NOT class_is_admin() AND coalesce(v_t.done_by, v_t.skipped_by) IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('error', 'not_yours');
  END IF;
  UPDATE checklist_day_tasks SET done_at = NULL, done_by = NULL, photo_path = NULL, amount_cents = NULL, note = NULL,
         skipped_reason = NULL, skipped_by = NULL, skipped_at = NULL
  WHERE id = p_task_id;
  UPDATE checklist_days SET updated_at = now() WHERE day_date = v_t.day_date;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- "No se hizo": queda pendiente pero con motivo (permite cerrar el turno).
CREATE OR REPLACE FUNCTION public.checklist_skip_task(p_task_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_t checklist_day_tasks%ROWTYPE;
  v_err TEXT;
BEGIN
  SELECT * INTO v_t FROM checklist_day_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', CASE WHEN class_is_staff() THEN 'not_found' ELSE 'forbidden' END); END IF;
  v_err := erp_checklist_can_edit(v_t.day_date);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  IF v_t.done_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_done'); END IF;
  UPDATE checklist_day_tasks SET skipped_reason = btrim(p_reason), skipped_by = auth.uid(), skipped_at = now() WHERE id = p_task_id;
  UPDATE checklist_days SET updated_at = now() WHERE day_date = v_t.day_date;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.checklist_add_note(p_text TEXT, p_photo_path TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
  v_photo TEXT := nullif(btrim(coalesce(p_photo_path, '')), '');
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF length(btrim(coalesce(p_text, ''))) < 3 THEN RETURN jsonb_build_object('error', 'text_required'); END IF;
  IF v_photo IS NOT NULL AND v_photo NOT LIKE v_today::text || '/%' THEN RETURN jsonb_build_object('error', 'invalid_photo'); END IF;
  INSERT INTO checklist_days (day_date) VALUES (v_today) ON CONFLICT DO NOTHING;
  INSERT INTO checklist_notes (day_date, created_by, text, photo_path) VALUES (v_today, auth.uid(), btrim(p_text), v_photo);
  UPDATE checklist_days SET updated_at = now() WHERE day_date = v_today;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Retirar una ruta del desmontaje del sábado (y liberar su QR, igual que en la pared).
CREATE OR REPLACE FUNCTION public.checklist_retire_route(p_route_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := erp_today();
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM checklist_days WHERE day_date = v_today AND p_route_id = ANY (teardown_route_ids)) THEN
    RETURN jsonb_build_object('error', 'not_in_teardown');
  END IF;
  UPDATE routes SET status = 'retired', retired_at = coalesce(retired_at, now()) WHERE id = p_route_id AND status = 'active';
  UPDATE qr_codes SET status = 'available', route_id = NULL WHERE route_id = p_route_id;
  PERFORM erp_audit('route_retire', 'route', p_route_id, NULL, jsonb_build_object('from', 'checklist'));
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.checklist_close_day(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_date DATE := coalesce(nullif(p->>'date', '')::date, erp_today());
  v_d checklist_days%ROWTYPE;
  v_err TEXT;
  v_log JSONB;
  v_pending JSONB;
BEGIN
  v_err := erp_checklist_can_edit(v_date);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;
  SELECT * INTO v_d FROM checklist_days WHERE day_date = v_date FOR UPDATE;
  IF v_d.generated_at IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_d.lead_id IS NOT NULL AND v_d.lead_id <> auth.uid() AND NOT class_is_admin() THEN
    RETURN jsonb_build_object('error', 'not_lead', 'lead_name', (SELECT name FROM profiles WHERE id = v_d.lead_id));
  END IF;
  SELECT jsonb_agg(t.text ORDER BY t.block_position, t.position) INTO v_pending
  FROM checklist_day_tasks t WHERE t.day_date = v_date AND t.required AND t.done_at IS NULL AND t.skipped_reason IS NULL;
  IF v_pending IS NOT NULL THEN RETURN jsonb_build_object('error', 'tasks_pending', 'pending', v_pending); END IF;
  v_log := jsonb_build_object('happened', btrim(coalesce(p->>'happened', '')), 'pending', btrim(coalesce(p->>'pending', '')),
                              'broken', btrim(coalesce(p->>'broken', '')));
  IF length(v_log->>'happened') < 2 OR length(v_log->>'pending') < 2 OR length(v_log->>'broken') < 2 THEN
    RETURN jsonb_build_object('error', 'log_required');
  END IF;
  UPDATE checklist_days SET status = 'closed', closed_at = now(), closed_by = auth.uid(), log = v_log, updated_at = now() WHERE day_date = v_date;
  PERFORM erp_audit('checklist_close', 'checklist', NULL, NULL, jsonb_build_object('date', v_date));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Admin: reabrir / regenerar un día
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reopen_checklist_day(p_date DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  UPDATE checklist_days SET status = 'open', closed_at = NULL, closed_by = NULL, updated_at = now() WHERE day_date = p_date AND status = 'closed';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM erp_audit('checklist_reopen', 'checklist', NULL, NULL, jsonb_build_object('date', p_date));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Volver a copiar la plantilla (solo si nadie ha marcado nada ese día).
CREATE OR REPLACE FUNCTION public.admin_regenerate_checklist_day(p_date DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF (SELECT status FROM checklist_days WHERE day_date = p_date) = 'closed' THEN RETURN jsonb_build_object('error', 'day_closed'); END IF;
  IF EXISTS (SELECT 1 FROM checklist_day_tasks WHERE day_date = p_date AND (done_at IS NOT NULL OR skipped_reason IS NOT NULL)) THEN
    RETURN jsonb_build_object('error', 'already_started');
  END IF;
  DELETE FROM checklist_day_tasks WHERE day_date = p_date;
  UPDATE checklist_days SET generated_at = NULL WHERE day_date = p_date;
  PERFORM erp_checklist_generate(p_date);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Admin: plan (encargado por fecha, desmontaje) e historial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_checklist_plan(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'today', erp_today(),
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) ORDER BY name) FROM profiles), '[]'::jsonb),
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'route_number', r.route_number, 'color', r.color, 'grade', r.grade,
                          'zone', (SELECT z.name FROM zones z WHERE z.id = r.zone_id)) ORDER BY (SELECT z.name FROM zones z WHERE z.id = r.zone_id), r.route_number)
                        FROM routes r WHERE r.status = 'active'), '[]'::jsonb),
    'days', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d::date, 'dow', erp_checklist_dow(d::date),
                        'lead_id', c.lead_id, 'teardown_note', c.teardown_note, 'teardown_route_ids', coalesce(c.teardown_route_ids, '{}'),
                        'status', c.status, 'generated', c.generated_at IS NOT NULL,
                        'has_template', EXISTS (SELECT 1 FROM checklist_blocks b WHERE erp_checklist_dow(d::date) = ANY (b.days))) ORDER BY d)
                      FROM generate_series(p_from, p_to, interval '1 day') d LEFT JOIN checklist_days c ON c.day_date = d::date), '[]'::jsonb)
  );
END;
$function$;

-- Solo cambia las llaves que vengan: lead_id, teardown_note, teardown_route_ids.
CREATE OR REPLACE FUNCTION public.admin_set_checklist_day(p_date DATE, p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_lead UUID;
  v_routes UUID[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p ? 'lead_id' THEN
    v_lead := nullif(p->>'lead_id', '')::uuid;
    IF v_lead IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_lead) THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  END IF;
  IF p ? 'teardown_route_ids' THEN
    SELECT coalesce(array_agg(x::uuid), '{}') INTO v_routes FROM jsonb_array_elements_text(p->'teardown_route_ids') x;
  END IF;
  INSERT INTO checklist_days (day_date) VALUES (p_date) ON CONFLICT DO NOTHING;
  UPDATE checklist_days SET
    lead_id = CASE WHEN p ? 'lead_id' THEN v_lead ELSE lead_id END,
    teardown_note = CASE WHEN p ? 'teardown_note' THEN nullif(btrim(coalesce(p->>'teardown_note', '')), '') ELSE teardown_note END,
    teardown_route_ids = CASE WHEN p ? 'teardown_route_ids' THEN v_routes ELSE teardown_route_ids END,
    updated_at = now()
  WHERE day_date = p_date;
  PERFORM erp_audit('checklist_plan', 'checklist', NULL, NULL, jsonb_build_object('date', p_date) || p);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_checklist_history(p_from DATE, p_to DATE, p_person UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM profiles), '[]'::jsonb),
    'days', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
      SELECT jsonb_build_object(
        'date', c.day_date, 'dow', erp_checklist_dow(c.day_date), 'status', c.status, 'closed_at', c.closed_at,
        'lead_name', (SELECT name FROM profiles WHERE id = c.lead_id),
        'closed_by_name', (SELECT name FROM profiles WHERE id = c.closed_by),
        'total', (SELECT count(*) FROM checklist_day_tasks t WHERE t.day_date = c.day_date),
        'done', (SELECT count(*) FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND t.done_at IS NOT NULL),
        'skipped', (SELECT count(*) FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND t.done_at IS NULL AND t.skipped_reason IS NOT NULL),
        'missing', (SELECT count(*) FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND t.required AND t.done_at IS NULL AND t.skipped_reason IS NULL),
        'photos', (SELECT count(*) FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND t.photo_path IS NOT NULL),
        'notes', (SELECT count(*) FROM checklist_notes n WHERE n.day_date = c.day_date),
        'cash_difference_cents', (SELECT s.difference_cents FROM cash_sessions s WHERE s.business_date = c.day_date AND s.closed_at IS NOT NULL ORDER BY s.closed_at DESC LIMIT 1),
        'by_person', coalesce((SELECT jsonb_agg(jsonb_build_object('name', (SELECT name FROM profiles WHERE id = q.done_by), 'n', q.n) ORDER BY q.n DESC)
                               FROM (SELECT done_by, count(*) n FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND t.done_by IS NOT NULL GROUP BY done_by) q), '[]'::jsonb)
      ) x
      FROM checklist_days c
      WHERE c.day_date BETWEEN p_from AND p_to AND c.generated_at IS NOT NULL
        AND (p_person IS NULL OR c.lead_id = p_person
             OR EXISTS (SELECT 1 FROM checklist_day_tasks t WHERE t.day_date = c.day_date AND (t.done_by = p_person OR t.skipped_by = p_person))
             OR EXISTS (SELECT 1 FROM checklist_notes n WHERE n.day_date = c.day_date AND n.created_by = p_person))
    ) s), '[]'::jsonb)
  );
END;
$function$;

-- ------------------------------------------------------------
-- Admin: plantilla
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_checklist_template()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'rules', (SELECT rules FROM checklist_settings WHERE id = 1),
    'blocks', coalesce((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('tasks', coalesce((
                SELECT jsonb_agg(to_jsonb(t) - 'block_id' ORDER BY t.position) FROM checklist_tasks t WHERE t.block_id = b.id), '[]'::jsonb))
              ORDER BY b.position) FROM checklist_blocks b), '[]'::jsonb)
  );
END;
$function$;

-- Guarda la plantilla completa (el orden del arreglo es el orden en pantalla).
-- Lo que no venga se borra. No toca días ya generados.
CREATE OR REPLACE FUNCTION public.admin_save_checklist_template(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_b JSONB;
  v_t JSONB;
  v_bi INT := 0;
  v_ti INT;
  v_bid UUID;
  v_tid UUID;
  v_keep_b UUID[] := '{}';
  v_keep_t UUID[] := '{}';
  v_days INT[];
  v_tdays INT[];
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF jsonb_typeof(p->'blocks') <> 'array' THEN RETURN jsonb_build_object('error', 'bad_request'); END IF;
  FOR v_b IN SELECT * FROM jsonb_array_elements(p->'blocks') LOOP
    v_bi := v_bi + 1;
    IF length(btrim(coalesce(v_b->>'title', ''))) = 0 THEN RETURN jsonb_build_object('error', 'title_required', 'block', v_bi); END IF;
    SELECT coalesce(array_agg(DISTINCT x::int ORDER BY x::int), '{}') INTO v_days FROM jsonb_array_elements_text(coalesce(v_b->'days', '[]')) x;
    IF cardinality(v_days) = 0 OR NOT v_days <@ ARRAY[1,2,3,4,5,6,7] THEN RETURN jsonb_build_object('error', 'days_required', 'block', v_bi); END IF;
    v_bid := nullif(v_b->>'id', '')::uuid;
    IF v_bid IS NOT NULL AND EXISTS (SELECT 1 FROM checklist_blocks WHERE id = v_bid) THEN
      UPDATE checklist_blocks SET title = btrim(v_b->>'title'), start_time = nullif(v_b->>'start_time', '')::time, end_time = nullif(v_b->>'end_time', '')::time,
             days = v_days, position = v_bi * 10, note = nullif(btrim(coalesce(v_b->>'note', '')), '')
      WHERE id = v_bid;
    ELSE
      INSERT INTO checklist_blocks (title, start_time, end_time, days, position, note)
      VALUES (btrim(v_b->>'title'), nullif(v_b->>'start_time', '')::time, nullif(v_b->>'end_time', '')::time, v_days, v_bi * 10,
              nullif(btrim(coalesce(v_b->>'note', '')), ''))
      RETURNING id INTO v_bid;
    END IF;
    v_keep_b := v_keep_b || v_bid;
    v_ti := 0;
    FOR v_t IN SELECT * FROM jsonb_array_elements(coalesce(v_b->'tasks', '[]')) LOOP
      v_ti := v_ti + 1;
      IF length(btrim(coalesce(v_t->>'text', ''))) = 0 THEN RETURN jsonb_build_object('error', 'text_required', 'block', v_bi, 'task', v_ti); END IF;
      IF coalesce(v_t->>'kind', 'normal') NOT IN ('normal','cash_open','cash_close','teardown') THEN RETURN jsonb_build_object('error', 'bad_request'); END IF;
      IF v_t->'days' IS NULL OR jsonb_typeof(v_t->'days') = 'null' THEN
        v_tdays := NULL;
      ELSE
        SELECT coalesce(array_agg(DISTINCT x::int ORDER BY x::int), '{}') INTO v_tdays FROM jsonb_array_elements_text(v_t->'days') x;
        IF cardinality(v_tdays) = 0 OR NOT v_tdays <@ v_days THEN RETURN jsonb_build_object('error', 'task_days', 'block', v_bi, 'task', v_ti); END IF;
        IF v_tdays = v_days THEN v_tdays := NULL; END IF;
      END IF;
      v_tid := nullif(v_t->>'id', '')::uuid;
      IF v_tid IS NOT NULL AND EXISTS (SELECT 1 FROM checklist_tasks WHERE id = v_tid) THEN
        UPDATE checklist_tasks SET block_id = v_bid, text = btrim(v_t->>'text'),
               start_time = nullif(v_t->>'start_time', '')::time, end_time = nullif(v_t->>'end_time', '')::time, days = v_tdays, position = v_ti * 10,
               requires_photo = coalesce((v_t->>'requires_photo')::boolean, false), requires_amount = coalesce((v_t->>'requires_amount')::boolean, false),
               requires_note = coalesce((v_t->>'requires_note')::boolean, false), required = coalesce((v_t->>'required')::boolean, true),
               kind = coalesce(v_t->>'kind', 'normal')
        WHERE id = v_tid;
      ELSE
        INSERT INTO checklist_tasks (block_id, text, start_time, end_time, days, position, requires_photo, requires_amount, requires_note, required, kind)
        VALUES (v_bid, btrim(v_t->>'text'), nullif(v_t->>'start_time', '')::time, nullif(v_t->>'end_time', '')::time, v_tdays, v_ti * 10,
                coalesce((v_t->>'requires_photo')::boolean, false), coalesce((v_t->>'requires_amount')::boolean, false),
                coalesce((v_t->>'requires_note')::boolean, false), coalesce((v_t->>'required')::boolean, true), coalesce(v_t->>'kind', 'normal'))
        RETURNING id INTO v_tid;
      END IF;
      v_keep_t := v_keep_t || v_tid;
    END LOOP;
  END LOOP;
  DELETE FROM checklist_tasks WHERE NOT (id = ANY (v_keep_t));
  DELETE FROM checklist_blocks WHERE NOT (id = ANY (v_keep_b));
  IF p ? 'rules' THEN UPDATE checklist_settings SET rules = coalesce(p->>'rules', '') WHERE id = 1; END IF;
  PERFORM erp_audit('checklist_template', 'checklist', NULL, NULL, jsonb_build_object('blocks', v_bi));
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ------------------------------------------------------------
-- Semilla: el checklist que Inge revisó (solo si la plantilla está vacía)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_checklist_seed_block(p_title TEXT, p_start TIME, p_end TIME, p_days INT[], p_pos INT, p_note TEXT, p_tasks JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_bid UUID;
  v_t JSONB;
  v_i INT := 0;
BEGIN
  INSERT INTO checklist_blocks (title, start_time, end_time, days, position, note) VALUES (p_title, p_start, p_end, p_days, p_pos, p_note) RETURNING id INTO v_bid;
  FOR v_t IN SELECT * FROM jsonb_array_elements(p_tasks) LOOP
    v_i := v_i + 1;
    INSERT INTO checklist_tasks (block_id, text, start_time, end_time, days, position, requires_photo, requires_amount, requires_note, required, kind)
    VALUES (v_bid, v_t->>'t', nullif(v_t->>'at', '')::time, nullif(v_t->>'to', '')::time,
            CASE WHEN v_t ? 'days' THEN ARRAY(SELECT x::int FROM jsonb_array_elements_text(v_t->'days') x) END,
            v_i * 10, coalesce((v_t->>'photo')::boolean, false), coalesce((v_t->>'amount')::boolean, false),
            coalesce((v_t->>'note')::boolean, false), coalesce((v_t->>'req')::boolean, true), coalesce(v_t->>'kind', 'normal'));
  END LOOP;
END;
$function$;

DO $seed$
DECLARE
  lv INT[] := '{1,2,3,4,5}';
  sa INT[] := '{6}';
  todos INT[] := '{1,2,3,4,5,6}';
BEGIN
  IF EXISTS (SELECT 1 FROM checklist_blocks) THEN RETURN; END IF;

  UPDATE checklist_settings SET rules = E'Cada día hay un encargado de turno que responde por todo el checklist, aunque otros ayuden.\n'
    || E'Los horarios son fijos: si una tarea no termina en su bloque, se avisa antes de pasar a la siguiente.\n'
    || E'Sin reporte o foto, la tarea no cuenta como hecha.\n'
    || E'Si algo se rompe, falta o se acaba, se reporta en el momento (botón "Reportar algo"), no al final.\n'
    || E'Lunes a viernes: entrada 3:00 pm, apertura 5:00 pm, cierre al público 10:00 pm, salida 10:30 pm.\n'
    || E'Sábado: entrada y apertura 9:00 am, cierre 2:00 pm, y después desmontaje y lavado hasta terminar.'
  WHERE id = 1;

  -- Lunes a viernes
  PERFORM erp_checklist_seed_block('Llegada', '15:00', '15:10', lv, 10, NULL, '[
    {"t":"Llegué (registra tu hora de llegada)"},
    {"t":"Contar el fondo de caja y abrir la caja","photo":true,"amount":true,"kind":"cash_open"},
    {"t":"Encender luces y ventiladores"},
    {"t":"Leer la bitácora del turno anterior y resolver lo urgente"}]');
  PERFORM erp_checklist_seed_block('Pisos y área social', '15:10', '15:40', lv, 20, NULL, '[
    {"t":"Barrer recepción"}, {"t":"Trapear recepción"}, {"t":"Bajar las sillas del área social"},
    {"t":"Limpiar mesas, barra y mostrador de recepción"}]');
  PERFORM erp_checklist_seed_block('Baños', '15:40', '16:05', lv, 30, 'Cada baño.', '[
    {"t":"Taza: tallar por dentro con cepillo; limpiar asiento, tapa y base por fuera"},
    {"t":"Lavabo y llave: tallar y secar"},
    {"t":"Espejo: limpiar sin dejar marcas"},
    {"t":"Piso: barrer y trapear, incluyendo detrás de la taza"},
    {"t":"Botes: checar si es necesario vaciar y poner bolsa nueva"},
    {"t":"Checar si es necesario reponer papel de baño y jabón de manos"},
    {"t":"Si algo no funciona, reportarlo","req":false}]');
  PERFORM erp_checklist_seed_block('Área de boulder', '16:05', '16:20', lv, 40, NULL, '[
    {"t":"Barrer o aspirar colchonetas y quitar la magnesia acumulada"},
    {"t":"Trapear colchoneta"},
    {"t":"Asegurarse de que no haya ningún tornillo ni pija fuera de lugar"},
    {"t":"Recoger objetos olvidados y llevarlos a recepción"}]');
  PERFORM erp_checklist_seed_block('Tarea del día', '16:20', '16:50', lv, 50, NULL, '[
    {"t":"Aspirar la orilla entre colchoneta y pared","days":[1]},
    {"t":"Aspirar costuras y uniones de todas las colchonetas y trapearlas completas","days":[1]},
    {"t":"Revisar que flechas y QRs estén en su lugar y bien puestos","days":[1]},
    {"t":"Acomodar las presas que sobraron del armado por color y tamaño","days":[1]},
    {"t":"Separar tornillos y pijas por medida en sus cajas","days":[1]},
    {"t":"Guardar herramientas y poner baterías a cargar","days":[1]},
    {"t":"Foto de la zona terminada","photo":true,"days":[1]},
    {"t":"Sacar todo el refrigerador, limpiar charolas y paredes por dentro y secar","days":[2]},
    {"t":"Limpiar la barra completa, incluyendo debajo y detrás","days":[2]},
    {"t":"Contar bebidas por tipo y reportar el conteo","note":true,"days":[2]},
    {"t":"Desechar lo caducado o dañado y reportarlo","note":true,"days":[2]},
    {"t":"Cepillar todas las presas de la zona 2, de arriba hacia abajo","days":[3]},
    {"t":"Barrer la magnesia que cayó","days":[3]},
    {"t":"Foto de la zona terminada","photo":true,"days":[3]},
    {"t":"Tallar azulejos y paredes de los baños","days":[4]},
    {"t":"Limpiar puertas, manijas, apagadores y coladera","days":[4]},
    {"t":"Lavar los botes de basura por dentro y por fuera","days":[4]},
    {"t":"Contar papel de baño, jabón, toallas de papel, bolsas de basura, magnesia y productos de limpieza","note":true,"days":[4]},
    {"t":"Reportar lo que falta o está por acabarse","note":true,"days":[4]},
    {"t":"Cepillar todas las presas de la zona 3, de arriba hacia abajo","days":[5]},
    {"t":"Barrer la magnesia que cayó","days":[5]},
    {"t":"Foto de la zona terminada","photo":true,"days":[5]}]');
  PERFORM erp_checklist_seed_block('Preparar apertura', '16:50', '17:00', lv, 60, NULL, '[
    {"t":"Llenar el refrigerador de bebidas"},
    {"t":"Dejar reserva fría de bebidas para la noche","days":[5]},
    {"t":"Gatas de renta ordenadas por talla y magnesia de renta lista"},
    {"t":"App abierta en recepción y terminal de cobro encendida"},
    {"t":"Listo para abrir","photo":true}]');
  PERFORM erp_checklist_seed_block('Operación', '17:00', '22:00', lv, 70, NULL, '[
    {"t":"Registrar en la app cada ingreso (Acceso) y cada cobro (Vender)"},
    {"t":"Ronda 6:00: área social ordenada, basura, gatas fuera de zona","at":"18:00"},
    {"t":"Ronda 7:00: área social ordenada, basura, gatas fuera de zona","at":"19:00"},
    {"t":"Revisión de baños: papel, jabón, toallas, botes y piso seco","at":"19:30"},
    {"t":"Ronda 8:00: área social ordenada, basura, gatas fuera de zona","at":"20:00"},
    {"t":"Segunda revisión de baños si hay mucha gente","at":"20:30","req":false,"days":[5]},
    {"t":"Ronda 9:00: área social ordenada, basura, gatas fuera de zona","at":"21:00"},
    {"t":"Avisar a los clientes que se cierra a las 10:00","at":"21:45"}]');
  PERFORM erp_checklist_seed_block('Viernes: dejar listo el sábado', '22:00', '22:30', '{5}', 80, 'El sábado se abre a las 9:00 sin barrer ni trapear.', '[
    {"t":"Recepción barrida y trapeada"},
    {"t":"Baños completos con papel y jabón"},
    {"t":"Colchonetas barridas y trapeadas, sin tornillos ni pijas"},
    {"t":"Refrigerador lleno"}]');

  -- Sábado
  PERFORM erp_checklist_seed_block('Llegada y apertura', '09:00', '09:00', sa, 110, 'Se abre de inmediato; el viernes dejó todo limpio.', '[
    {"t":"Llegué (registra tu hora de llegada)"},
    {"t":"Contar el fondo de caja y abrir la caja","photo":true,"amount":true,"kind":"cash_open"},
    {"t":"Encender luces y ventiladores"},
    {"t":"Leer la bitácora del viernes"},
    {"t":"Bajar sillas"},
    {"t":"Llenar refrigerador"},
    {"t":"Gatas por talla, magnesia, app y terminal listos"},
    {"t":"Listo para abrir","photo":true}]');
  PERFORM erp_checklist_seed_block('Operación', '09:00', '14:00', sa, 120, NULL, '[
    {"t":"Registrar en la app cada ingreso (Acceso) y cada cobro (Vender)"},
    {"t":"Ronda 10:00","at":"10:00"},
    {"t":"Ronda 11:00","at":"11:00"},
    {"t":"Tarea del sábado: polvo en repisas y muebles, vidrios y puerta de entrada, telarañas en techos y rincones","at":"11:00","to":"11:30"},
    {"t":"Revisión de baños","at":"11:30"},
    {"t":"Ronda 12:00","at":"12:00"},
    {"t":"Ronda 1:00","at":"13:00"},
    {"t":"Avisar que se cierra a las 2:00","at":"13:45"}]');
  PERFORM erp_checklist_seed_block('Desmontaje y lavado', '14:00', NULL, sa, 130, 'Hasta terminar.', '[
    {"t":"Revisar qué rutas y volúmenes pidió Inge desmontar","kind":"teardown"},
    {"t":"Desmontar solo esas rutas y volúmenes (márcalas como desmontadas en la lista)","kind":"teardown"},
    {"t":"Separar tornillos y pijas por medida en sus cajas"},
    {"t":"Lavar presas en la lavadora ultrasónica con Simple Green, enjuagar y dejar secar"},
    {"t":"Limpiar los volúmenes desmontados"},
    {"t":"Barrer y aspirar el área de colchoneta: que no quede ningún tornillo ni pija"},
    {"t":"Dejar presas, volúmenes y herramientas listos para el lunes temprano"},
    {"t":"Foto del muro desmontado y de las presas lavadas","photo":true}]');

  -- Antes de irte (todos los días)
  PERFORM erp_checklist_seed_block('Antes de irte · Caja', NULL, NULL, todos, 200, 'Nadie sale hasta que todo esté marcado y con sus fotos.', '[
    {"t":"Contar el efectivo y hacer el corte de caja (si no cuadra, explica la diferencia)","photo":true,"amount":true,"kind":"cash_close"},
    {"t":"Dejar el fondo de caja completo para el siguiente turno"}]');
  PERFORM erp_checklist_seed_block('Antes de irte · Área social y recepción', NULL, NULL, todos, 210, NULL, '[
    {"t":"Mesas limpias y sillas arriba de las mesas"},
    {"t":"Barra y mostrador limpios y sin objetos encima"},
    {"t":"Botes de basura revisados: nunca se quedan con comida"}]');
  PERFORM erp_checklist_seed_block('Antes de irte · Área de boulder', NULL, NULL, todos, 220, NULL, '[
    {"t":"Gatas de renta desinfectadas, secas y en su lugar por talla"},
    {"t":"Magnesia de renta tapada y guardada"},
    {"t":"Colchonetas sin objetos encima"},
    {"t":"Objetos olvidados guardados en recepción (anótalos en la bitácora)"}]');
  PERFORM erp_checklist_seed_block('Antes de irte · Baños y basura', NULL, NULL, todos, 230, NULL, '[
    {"t":"Baños con papel, jabón y toallas para el siguiente turno"},
    {"t":"Todos los botes vaciados y la basura sacada al contenedor"}]');
  PERFORM erp_checklist_seed_block('Antes de irte · Apagado y cierre', NULL, NULL, todos, 240, NULL, '[
    {"t":"Música, ventiladores o aire y computadora apagados"},
    {"t":"Terminal de cobro cargando"},
    {"t":"Luces apagadas"},
    {"t":"Puertas y ventanas cerradas con llave"},
    {"t":"Foto del muro cerrado","photo":true}]');
END;
$seed$;

-- ------------------------------------------------------------
-- Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.checklist_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_blocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_days      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_day_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_notes     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checklist_settings, public.checklist_blocks, public.checklist_tasks, public.checklist_days,
              public.checklist_day_tasks, public.checklist_notes FROM anon, authenticated;

DO $grants$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'erp_checklist_generate(date)', 'erp_checklist_sync_cash(date)', 'erp_checklist_day_json(date)', 'erp_checklist_can_edit(date)',
    'erp_checklist_seed_block(text,time,time,integer[],integer,text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'get_checklist_today()', 'get_checklist_day(date)', 'checklist_complete_task(uuid,jsonb)', 'checklist_undo_task(uuid)',
    'checklist_skip_task(uuid,text)', 'checklist_add_note(text,text)', 'checklist_retire_route(uuid)', 'checklist_close_day(jsonb)',
    'admin_reopen_checklist_day(date)', 'admin_regenerate_checklist_day(date)', 'get_checklist_plan(date,date)',
    'admin_set_checklist_day(date,jsonb)', 'get_checklist_history(date,date,uuid)', 'get_checklist_template()',
    'admin_save_checklist_template(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END;
$grants$;
