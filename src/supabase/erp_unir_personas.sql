-- ============================================================
-- Unir fichas duplicadas (2026-11-12).
-- Correr DESPUÉS de erp.sql, erp_crm.sql, erp_recepcion.sql y erp_gatas.sql.
--
-- Por qué: las 448 fichas de EVO no tienen correo. Cuando ese cliente se
-- registra en la app se crea OTRA ficha (sin historial ni membresía).
--
-- · erp_duplicate_candidates(p_person_id): posibles duplicados. Sin persona,
--   regresa todos los pares; con persona, solo los de esa ficha.
--   Criterio: mismo correo, mismo celular, mismo nombre (sin acentos ni
--   mayúsculas) o mismas dos primeras palabras del nombre.
-- · admin_merge_people(p_keep, p_remove): SOLO ADMIN. Pasa TODO lo que apunta a
--   la ficha que se quita (ventas, membresías, domiciliaciones, clases, firmas,
--   cara, accesos, notas…) a la que se queda, llena los datos vacíos con los de
--   la otra, junta las notas y borra la ficha sobrante. Queda en la bitácora.
--   Busca las tablas solas (todas las llaves foráneas hacia people), así que
--   sirve aunque después se agreguen tablas nuevas.
--   Si un renglón choca con uno igual de la que se queda (ej. la misma reserva
--   en las dos), se borra el de la que se quita y se cuenta en "descartados".
-- · Las firmas (legal_signatures) son inmutables; solo durante una unión se
--   permite cambiarles la persona (nada más).
-- Idempotente: se puede volver a correr.
-- ============================================================

-- 1) Firmas: permitir SOLO cambiar person_id y SOLO durante una unión.
CREATE OR REPLACE FUNCTION public.legal_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  -- Solo se puede cambiar is_current/sort_order/required de un documento; firmas: nada.
  IF TG_TABLE_NAME = 'legal_documents' AND TG_OP = 'UPDATE' THEN
    IF NEW.body = OLD.body AND NEW.title = OLD.title AND NEW.version = OLD.version AND NEW.doc_key = OLD.doc_key THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Unión de fichas duplicadas: la firma pasa a la ficha que se queda, sin cambiar nada más.
  IF TG_TABLE_NAME = 'legal_signatures' AND TG_OP = 'UPDATE'
     AND coalesce(current_setting('app.merging_people', true), '') = 'on'
     AND (to_jsonb(NEW) - 'person_id') = (to_jsonb(OLD) - 'person_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% no se puede modificar (solo inserción)', TG_TABLE_NAME;
END;
$function$;

-- 2) Nombre normalizado (sin acentos, minúsculas, espacios simples).
CREATE OR REPLACE FUNCTION public.erp_norm_name(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $function$
  SELECT regexp_replace(translate(lower(btrim(coalesce(p, ''))), 'áéíóúüñàèìòù', 'aeiouunaeiou'), '\s+', ' ', 'g');
$function$;

-- 3) Posibles duplicados.
CREATE OR REPLACE FUNCTION public.erp_duplicate_candidates(p_person_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE v JSONB;
BEGIN
  IF NOT class_is_staff() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  WITH base AS (
    SELECT p.id, p.full_name, p.email, p.phone, p.source, p.evo_id, p.created_at, p.auth_user_id,
           erp_norm_name(p.full_name) AS n,
           split_part(erp_norm_name(p.full_name), ' ', 1) AS w1,
           split_part(erp_norm_name(p.full_name), ' ', 2) AS w2
    FROM people p WHERE NOT p.is_archived
  ), pairs AS (
    SELECT a.id AS a_id, b.id AS b_id,
           CASE WHEN a.email IS NOT NULL AND lower(a.email) = lower(b.email) THEN 'email'
                WHEN a.phone IS NOT NULL AND a.phone = b.phone THEN 'phone'
                WHEN a.n = b.n THEN 'same_name'
                ELSE 'similar_name' END AS reason
    FROM base a JOIN base b ON a.id < b.id
    WHERE (p_person_id IS NULL OR p_person_id IN (a.id, b.id))
      AND (   (a.email IS NOT NULL AND lower(a.email) = lower(b.email))
           OR (a.phone IS NOT NULL AND a.phone = b.phone)
           OR (a.n <> '' AND a.n = b.n)
           OR (a.w2 <> '' AND a.w1 = b.w1 AND a.w2 = b.w2))
      -- Dos fichas de EVO distintas son dos clientes distintos para EVO: no se sugieren por nombre parecido.
      AND NOT (a.evo_id IS NOT NULL AND b.evo_id IS NOT NULL AND a.n <> b.n)
      -- Dos cuentas con login no se pueden unir.
      AND NOT (a.auth_user_id IS NOT NULL AND b.auth_user_id IS NOT NULL)
  ), card AS (
    SELECT p.id, jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'source', p.source,
      'has_login', p.auth_user_id IS NOT NULL, 'created_at', p.created_at,
      'sales', (SELECT count(*) FROM sales s WHERE s.person_id = p.id AND s.status = 'completed'),
      'membership_until', erp_membership_until(p.id)) AS j
    FROM people p WHERE p.id IN (SELECT a_id FROM pairs UNION SELECT b_id FROM pairs)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('reason', pr.reason, 'a', ca.j, 'b', cb.j)
                  ORDER BY CASE pr.reason WHEN 'email' THEN 0 WHEN 'phone' THEN 1 WHEN 'same_name' THEN 2 ELSE 3 END,
                           ca.j->>'full_name'), '[]'::jsonb)
  INTO v
  FROM pairs pr JOIN card ca ON ca.id = pr.a_id JOIN card cb ON cb.id = pr.b_id;
  RETURN jsonb_build_object('pairs', v);
END;
$function$;

-- 4) Unir dos fichas.
CREATE OR REPLACE FUNCTION public.admin_merge_people(p_keep UUID, p_remove UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_keep    people%ROWTYPE;
  v_rem     people%ROWTYPE;
  v_rem_j   JSONB;
  fk        RECORD;
  v_tid     TID;
  v_moved   INT;
  v_moved_t INT := 0;
  v_dropped INT := 0;
  v_tables  JSONB := '{}'::jsonb;
  v_sets    TEXT;
BEGIN
  IF NOT class_is_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_keep IS NULL OR p_remove IS NULL OR p_keep = p_remove THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  SELECT * INTO v_keep FROM people WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO v_rem FROM people WHERE id = p_remove FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_keep.auth_user_id IS NOT NULL AND v_rem.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'both_have_login');
  END IF;
  v_rem_j := to_jsonb(v_rem);

  PERFORM set_config('app.merging_people', 'on', true);

  -- a) Todo lo que apunta a la ficha que se quita → a la que se queda.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.people'::regclass AND cardinality(c.conkey) = 1
      AND c.conrelid <> 'public.people'::regclass
  LOOP
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col) USING p_keep, p_remove;
      GET DIAGNOSTICS v_moved = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      -- Renglón por renglón: el que choca con uno igual de la que se queda se descarta.
      v_moved := 0;
      FOR v_tid IN EXECUTE format('SELECT ctid FROM %s WHERE %I = $1', fk.tbl, fk.col) USING p_remove LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col) USING p_keep, v_tid;
          v_moved := v_moved + 1;
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %s WHERE ctid = $1', fk.tbl) USING v_tid;
          v_dropped := v_dropped + 1;
        END;
      END LOOP;
    END;
    IF v_moved > 0 THEN
      v_tables := v_tables || jsonb_build_object(fk.tbl::text || '.' || fk.col, v_moved);
      v_moved_t := v_moved_t + v_moved;
    END IF;
  END LOOP;

  -- b) Borrar la ficha sobrante (ya no tiene nada colgando).
  DELETE FROM people WHERE id = p_remove;

  -- c) Llenar los datos vacíos de la que se queda con los de la otra.
  SELECT string_agg(format('%1$I = coalesce(%1$I, (jsonb_populate_record(NULL::public.people, $1)).%1$I)', a.attname), ', ')
  INTO v_sets
  FROM pg_attribute a
  WHERE a.attrelid = 'public.people'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'created_at', 'updated_at', 'note', 'full_name', 'source');
  EXECUTE format('UPDATE people SET %s, note = $2, updated_at = now() WHERE id = $3', v_sets)
    USING v_rem_j,
          nullif(concat_ws(E'\n', v_keep.note, v_rem.note), ''),
          p_keep;

  PERFORM erp_audit('person_merge', 'person', p_keep, v_rem_j,
                    jsonb_build_object('kept', p_keep, 'removed', p_remove, 'moved', v_tables, 'dropped', v_dropped));

  RETURN jsonb_build_object('success', true, 'person_id', p_keep, 'moved', v_moved_t, 'dropped', v_dropped, 'tables', v_tables);
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_duplicate_candidates(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_merge_people(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_duplicate_candidates(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_people(UUID, UUID) TO authenticated;

-- Revisión: cuántos pares de posibles duplicados hay hoy.
SELECT 'pares con mismo correo, celular o nombre' AS que, count(*) AS cuantos
FROM people a JOIN people b ON a.id < b.id
WHERE NOT a.is_archived AND NOT b.is_archived
  AND ((a.email IS NOT NULL AND lower(a.email) = lower(b.email))
    OR (a.phone IS NOT NULL AND a.phone = b.phone)
    OR erp_norm_name(a.full_name) = erp_norm_name(b.full_name));
