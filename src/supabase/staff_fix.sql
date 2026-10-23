-- ============================================================
-- Corrección de seguridad (2026-10-23): los clientes NO deben ser staff.
-- El trigger on_auth_user_created creaba un perfil de staff a TODA cuenta
-- nueva (incluidos los clientes que entran con código por correo), y el
-- panel /staff y todas las funciones de staff solo revisan que exista ese
-- perfil. Esto:
--   1. Hace que las cuentas nuevas ya NO reciban perfil de staff.
--   2. Agrega funciones para que el admin dé de alta / quite staff por correo.
--   3. (Paso aparte, abajo) Quita el perfil a quien no es staff.
-- Idempotente.
-- ============================================================

-- 1. Cuentas nuevas: sin perfil de staff.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  -- Ya no se crea perfil automáticamente: el staff lo da de alta un admin
  -- (admin_add_staff). Las cuentas de clientes viven en climbers/people.
  RETURN NEW;
END;
$function$;

-- 2. Alta / baja de staff por correo (la persona ya debe haber entrado una vez
--    a la app con ese correo, para que exista su cuenta).
CREATE OR REPLACE FUNCTION public.admin_list_staff()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN jsonb_build_object('staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role,
           'email', u.email, 'last_sign_in_at', u.last_sign_in_at) ORDER BY p.role, p.name)
         FROM profiles p LEFT JOIN auth.users u ON u.id = p.id), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_staff(p_email TEXT, p_name TEXT, p_role TEXT DEFAULT 'staff')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_uid UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(p_role, '') NOT IN ('staff','admin') THEN RETURN jsonb_build_object('error', 'invalid_value'); END IF;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(btrim(p_email));
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'account_not_found'); END IF;
  INSERT INTO profiles (id, name, role) VALUES (v_uid, coalesce(nullif(btrim(p_name), ''), lower(btrim(p_email))), p_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, name = coalesce(nullif(btrim(p_name), ''), profiles.name);
  RETURN jsonb_build_object('success', true, 'id', v_uid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_staff(p_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF p_profile_id = auth.uid() THEN RETURN jsonb_build_object('error', 'cannot_remove_self'); END IF;
  BEGIN
    DELETE FROM profiles WHERE id = p_profile_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('error', 'has_history');   -- armó rutas, etc.: no se borra, se deja como está
  END;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_add_staff(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_remove_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_staff(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_staff(uuid) TO authenticated;

-- 3. Quitar el perfil de staff a quien NO es staff. ANTES de correrlo, poner
--    aquí los correos del staff real (los admin se conservan siempre).
--    Si alguien tiene historial (armó rutas, etc.) no se puede borrar y se
--    reporta en el resultado para revisarlo a mano.
-- DO $cleanup$
-- DECLARE
--   v_keep TEXT[] := ARRAY['esz1996mx@gmail.com' /* , 'correo-staff-1', 'correo-staff-2' */];
--   r RECORD;
-- BEGIN
--   FOR r IN SELECT p.id, u.email FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
--            WHERE p.role <> 'admin' AND lower(coalesce(u.email, '')) <> ALL (SELECT lower(x) FROM unnest(v_keep) x) LOOP
--     BEGIN
--       DELETE FROM profiles WHERE id = r.id;
--     EXCEPTION WHEN foreign_key_violation THEN
--       RAISE NOTICE 'No se pudo quitar (tiene historial): %', r.email;
--     END;
--   END LOOP;
-- END;
-- $cleanup$;
