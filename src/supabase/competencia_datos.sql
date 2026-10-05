-- ============================================================
-- Competencia — datos reales (2026-10-04, dictados por el usuario)
-- Requiere competencia.sql. Se puede correr más de una vez.
-- ============================================================

-- Nombre, hora y lugar. Cupo: el usuario lo quiere ilimitado y sin que se
-- anuncie; se guarda como 100000 (= UNLIMITED_CAPACITY en
-- src/lib/competition.ts) porque capacity_total es NOT NULL.
UPDATE public.competitions SET
  name = 'JAM Jaibas Al Muro',
  event_time_text = 'Inicio 10:00 am (horarios por categoría por definir)',
  place = 'Jaibamuro',
  capacity_total = 100000
WHERE slug = 'competencia-2026';

-- Los criterios de cada categoría siguen sin definirse: en vez de mostrar
-- "POR DEFINIR" bajo cada una en el formulario, no se muestra nada.
UPDATE public.competition_categories SET description = NULL
WHERE description = 'POR DEFINIR'
  AND competition_id = (SELECT c.id FROM public.competitions c WHERE c.slug = 'competencia-2026');
