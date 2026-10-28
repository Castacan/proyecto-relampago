-- ============================================================
-- Cambios a la plantilla del checklist llegan al turno de hoy (2026-10-28).
-- Requiere erp_checklist.sql. Idempotente. Correr DESPUÉS de erp_checklist.sql
-- (redefine admin_save_checklist_template).
--
--   Antes, editar la plantilla solo aplicaba al siguiente día. Ahora, al guardar,
--   los días abiertos de hoy en adelante que ya se generaron se ponen al día:
--   · tareas nuevas que tocan ese día se agregan;
--   · las que cambiaron (texto, horario, orden, foto/monto…) se actualizan,
--     sin perder lo que ya se marcó;
--   · las que se quitaron (o ya no tocan ese día) se borran si nadie las
--     marcó; si ya estaban hechas o con motivo, se quedan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.erp_checklist_resync(p_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_dow INT := erp_checklist_dow(p_date);
BEGIN
  IF (SELECT status FROM checklist_days WHERE day_date = p_date AND generated_at IS NOT NULL) IS DISTINCT FROM 'open' THEN RETURN; END IF;

  -- Las que siguen en la plantilla para ese día: se actualizan.
  UPDATE checklist_day_tasks dt SET
    block_title = b.title, block_start = b.start_time, block_end = b.end_time, block_note = b.note, block_position = b.position,
    text = t.text, start_time = t.start_time, end_time = t.end_time, position = t.position,
    requires_photo = t.requires_photo, requires_amount = t.requires_amount, requires_note = t.requires_note,
    required = t.required, kind = t.kind
  FROM checklist_tasks t JOIN checklist_blocks b ON b.id = t.block_id
  WHERE dt.day_date = p_date AND dt.template_task_id = t.id
    AND v_dow = ANY (b.days) AND v_dow = ANY (coalesce(t.days, b.days));

  -- Las que ya no están (o ya no tocan ese día) y nadie marcó: se quitan.
  DELETE FROM checklist_day_tasks dt
  WHERE dt.day_date = p_date AND dt.done_at IS NULL AND dt.skipped_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM checklist_tasks t JOIN checklist_blocks b ON b.id = t.block_id
                    WHERE t.id = dt.template_task_id AND v_dow = ANY (b.days) AND v_dow = ANY (coalesce(t.days, b.days)));

  -- Las nuevas: se agregan.
  INSERT INTO checklist_day_tasks (day_date, template_task_id, block_title, block_start, block_end, block_note, block_position,
                                   text, start_time, end_time, position, requires_photo, requires_amount, requires_note, required, kind)
  SELECT p_date, t.id, b.title, b.start_time, b.end_time, b.note, b.position,
         t.text, t.start_time, t.end_time, t.position, t.requires_photo, t.requires_amount, t.requires_note, t.required, t.kind
  FROM checklist_blocks b JOIN checklist_tasks t ON t.block_id = b.id
  WHERE v_dow = ANY (b.days) AND v_dow = ANY (coalesce(t.days, b.days))
    AND NOT EXISTS (SELECT 1 FROM checklist_day_tasks dt WHERE dt.day_date = p_date AND dt.template_task_id = t.id);

  UPDATE checklist_days SET updated_at = now() WHERE day_date = p_date;
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_checklist_resync(date) FROM PUBLIC, anon, authenticated;

-- Guarda la plantilla completa (el orden del arreglo es el orden en pantalla).
-- Lo que no venga se borra. Los días abiertos de hoy en adelante se actualizan
-- (erp_checklist_resync).
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
  PERFORM erp_checklist_resync(d.day_date) FROM checklist_days d
  WHERE d.day_date >= erp_today() AND d.status = 'open' AND d.generated_at IS NOT NULL;
  RETURN jsonb_build_object('success', true);
END;
$function$;
