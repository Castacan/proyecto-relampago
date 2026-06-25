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

-- 3. Insertar zonas reales en orden panorámico:
--    Circuito principal (1–7) + caras interiores del túnel (8–9)
INSERT INTO public.zones (name, slug, order_index, map_x, map_y, canvas_x_start, canvas_x_end, image_url) VALUES
  ('Pared Izquierda',        'pared-izquierda',        1,  0.04, 0.50,  0.00, 0.05,  NULL),
  ('Fondo Izquierdo',        'fondo-izquierdo',        2,  0.18, 0.20,  0.05, 0.22,  NULL),
  ('Flanco Túnel Izquierdo', 'flanco-tunel-izquierdo', 3,  0.30, 0.45,  0.22, 0.35,  NULL),
  ('Desplome',               'desplome',               4,  0.36, 0.65,  0.35, 0.45,  NULL),
  ('Flanco Túnel Derecho',   'flanco-tunel-derecho',   5,  0.44, 0.45,  0.45, 0.57,  NULL),
  ('Fondo Derecho',          'fondo-derecho-izq',      6,  0.65, 0.20,  0.57, 0.72,  '/wall/test%20izq.jpeg'),
  ('Fondo Derecho',          'fondo-derecho-der',      7,  0.76, 0.20,  0.72, 0.87,  '/wall/test%20der.jpeg'),
  ('Pared Derecha',          'pared-derecha',          8,  0.90, 0.50,  0.87, 0.92,  NULL),
  ('Túnel Norte',            'tunel-norte',            9,  0.35, 0.25,  0.92, 0.96,  NULL),
  ('Túnel Sur',              'tunel-sur',             10,  0.35, 0.55,  0.96, 1.00,  NULL);
