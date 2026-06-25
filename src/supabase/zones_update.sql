-- ============================================================
-- Actualización de zonas — ejecutar en Supabase SQL Editor
-- Borra rutas de prueba y zonas viejas, inserta zonas reales.
-- ============================================================

-- 1. Agregar columna image_url a zones (si no existe)
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Borrar datos dependientes en orden (FK chain)
DELETE FROM public.betas;
DELETE FROM public.votes;
DELETE FROM public.qr_codes WHERE route_id IS NOT NULL;
UPDATE public.qr_codes SET route_id = NULL;
DELETE FROM public.routes;

-- 3. Limpiar zonas viejas
DELETE FROM public.zones;

-- 3. Insertar zonas reales (izquierda → derecha en el canvas panorámico)
--    Las coordenadas x son aproximadas, ajustar cuando se tengan fotos de todas las secciones.
INSERT INTO public.zones (name, slug, order_index, map_x, map_y, canvas_x_start, canvas_x_end, image_url) VALUES
  ('Pared Izquierda',        'pared-izquierda',        1,  0.04, 0.50,  0.00, 0.08,  NULL),
  ('Fondo Izquierdo',        'fondo-izquierdo',        2,  0.14, 0.50,  0.08, 0.20,  NULL),
  ('Flanco Túnel Izquierdo', 'flanco-tunel-izquierdo', 3,  0.24, 0.50,  0.20, 0.28,  NULL),
  ('Túnel Norte',            'tunel-norte',            4,  0.32, 0.35,  0.28, 0.36,  NULL),
  ('Túnel Sur',              'tunel-sur',              5,  0.32, 0.65,  0.36, 0.44,  NULL),
  ('Desplome',               'desplome',               6,  0.48, 0.50,  0.44, 0.52,  NULL),
  ('Flanco Túnel Derecho',   'flanco-tunel-derecho',   7,  0.56, 0.50,  0.52, 0.60,  NULL),
  ('Fondo Derecho',          'fondo-derecho-izq',      8,  0.69, 0.50,  0.60, 0.78,  '/wall/test%20izq.jpeg'),
  ('Fondo Derecho',          'fondo-derecho-der',      9,  0.85, 0.50,  0.78, 0.92,  '/wall/test%20der.jpeg'),
  ('Pared Derecha',          'pared-derecha',         10,  0.96, 0.50,  0.92, 1.00,  NULL);
