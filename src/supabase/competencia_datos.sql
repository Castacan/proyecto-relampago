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

-- Categorías: el nivel de entrada se llama "Básico" (antes "Principiante").
-- El WHERE NOT EXISTS evita chocar si ya existe la categoría con el nombre nuevo.
UPDATE public.competition_categories cc
SET name = replace(cc.name, 'Principiante', 'Básico'), level = 'basico'
WHERE cc.name LIKE '%Principiante'
  AND cc.competition_id = (SELECT c.id FROM public.competitions c WHERE c.slug = 'competencia-2026')
  AND NOT EXISTS (
    SELECT 1 FROM public.competition_categories x
    WHERE x.competition_id = cc.competition_id AND x.name = replace(cc.name, 'Principiante', 'Básico'));

-- Reglas: se agrega la regla de reubicación de categoría al texto que cada
-- participante acepta, y se sube la versión (queda guardado qué versión
-- aceptó cada quien). Texto pedido por el usuario 2026-10-04.
UPDATE public.competitions SET
  waiver_text =
    'Categorías: debes inscribirte en la categoría que corresponde a tu nivel real. Para que la competencia sea justa, medimos el desempeño de todos los participantes con un sistema de análisis de resultados y los organizadores podemos mover a una categoría más difícil a quien esté compitiendo por debajo de su nivel. Al inscribirte aceptas esa posible reubicación.'
    || E'\n\n' ||
    'Deslinde: entiendo que la escalada es una actividad con riesgo de lesión y participo de forma voluntaria y bajo mi propia responsabilidad. Me comprometo a seguir las indicaciones del staff y el reglamento de la competencia. Si soy menor de edad, acudiré acompañado de un mayor de edad que firmará mi registro el día del evento.',
  waiver_version = 'v2'
WHERE slug = 'competencia-2026' AND waiver_version = 'v1';
