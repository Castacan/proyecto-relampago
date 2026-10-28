-- ============================================================
-- Ajustes del turno (2026-10-28). Requiere erp_checklist.sql y erp_asistencia.sql.
-- Idempotente.
--
--   Inge:
--   · Los turnos de lunes a viernes empiezan a las 3:30 pm (antes 3:00). La
--     preparación se acomoda en la hora y media antes de abrir a las 5:00.
--     Solo cambia bloques que sigan con la hora original (si el admin ya los
--     editó, se respetan). También los días ya generados que siguen abiertos.
--   · Al checar entrada en "Mi asistencia" se marca solo el "Llegué" del
--     turno de hoy.
--   · Barrer todo todos los días; trapear por zonas: recepción lunes y jueves;
--     colchoneta y área azul (área de entrenamiento) martes y viernes.
--     Aplica a los días que se generen de aquí en adelante.
-- ============================================================

-- ------------------------------------------------------------
-- Turno de lunes a viernes desde las 3:30 pm
-- ------------------------------------------------------------
UPDATE public.checklist_blocks b SET start_time = h.s1, end_time = h.e1
FROM (VALUES
  ('Llegada',             '15:00'::time, '15:10'::time, '15:30'::time, '15:35'::time),
  ('Pisos y área social', '15:10', '15:40', '15:35', '16:00'),
  ('Baños',               '15:40', '16:05', '16:00', '16:20'),
  ('Área de boulder',     '16:05', '16:20', '16:20', '16:30'),
  ('Tarea del día',       '16:20', '16:50', '16:30', '16:50')) AS h(title, s0, e0, s1, e1)
WHERE b.title = h.title AND b.start_time = h.s0 AND b.end_time = h.e0;

UPDATE public.checklist_day_tasks t SET block_start = h.s1, block_end = h.e1
FROM (VALUES
  ('Llegada',             '15:00'::time, '15:10'::time, '15:30'::time, '15:35'::time),
  ('Pisos y área social', '15:10', '15:40', '15:35', '16:00'),
  ('Baños',               '15:40', '16:05', '16:00', '16:20'),
  ('Área de boulder',     '16:05', '16:20', '16:20', '16:30'),
  ('Tarea del día',       '16:20', '16:50', '16:30', '16:50')) AS h(title, s0, e0, s1, e1), public.checklist_days d
WHERE t.block_title = h.title AND t.block_start = h.s0 AND t.block_end = h.e0
  AND d.day_date = t.day_date AND d.status = 'open' AND t.day_date >= erp_today();

UPDATE public.checklist_settings
SET rules = replace(rules, 'Lunes a viernes: entrada 3:00 pm', 'Lunes a viernes: entrada 3:30 pm')
WHERE id = 1;

-- ------------------------------------------------------------
-- Barrer diario, trapear por zonas
-- ------------------------------------------------------------
UPDATE public.checklist_tasks SET text = 'Barrer recepción y área social' WHERE text = 'Barrer recepción';
UPDATE public.checklist_tasks SET days = '{1,4}' WHERE text = 'Trapear recepción';
UPDATE public.checklist_tasks SET days = '{2,5}' WHERE text = 'Trapear colchoneta';

INSERT INTO public.checklist_tasks (block_id, text, days, position)
SELECT b.id, v.text, v.days, v.pos
FROM public.checklist_blocks b
CROSS JOIN (VALUES ('Barrer área azul (área de entrenamiento)', NULL::int[], 15),
                   ('Trapear área azul (área de entrenamiento)', '{2,5}'::int[], 25)) AS v(text, days, pos)
WHERE b.title = 'Área de boulder'
  AND NOT EXISTS (SELECT 1 FROM public.checklist_tasks t WHERE t.text = v.text);

-- ------------------------------------------------------------
-- "Mi asistencia" marca el "Llegué" del turno de hoy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_attendance_marks_arrival()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.kind <> 'in' THEN RETURN NEW; END IF;
  BEGIN
    PERFORM erp_checklist_generate(NEW.day_date);
    UPDATE checklist_day_tasks SET done_at = NEW.at, done_by = NEW.created_by,
           note = coalesce(note, 'Desde Mi asistencia')
    WHERE id = (SELECT t.id FROM checklist_day_tasks t JOIN checklist_days d ON d.day_date = t.day_date
                WHERE t.day_date = NEW.day_date AND d.status = 'open' AND t.text LIKE 'Llegué%'
                  AND t.done_at IS NULL AND t.skipped_reason IS NULL
                ORDER BY t.block_position, t.position LIMIT 1);
  EXCEPTION WHEN others THEN
    NULL;  -- el checklist nunca debe impedir que se registre la asistencia
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS attendance_marks_arrival ON public.attendance_punches;
CREATE TRIGGER attendance_marks_arrival AFTER INSERT ON public.attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.erp_attendance_marks_arrival();

REVOKE ALL ON FUNCTION public.erp_attendance_marks_arrival() FROM PUBLIC, anon, authenticated;
