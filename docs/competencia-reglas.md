# Reglas de puntuación — JAM (7 de noviembre de 2026)

Acordadas con el dueño el 2026-11-04. Reemplazan la idea del armador (10 por top, 5 por zona). Con esa idea, flashear los 5 bloques más fáciles valía lo mismo que los 5 más difíciles.

**Programadas el 2026-11-04** en `src/supabase/competencia_bloques.sql`. Falta el Run en Supabase.

## Logística

- 3 horarios de 2 h, máximo 20 personas por horario, todas las categorías revueltas.
- 24 bloques numerados. Cada quien intenta los que quiera.
- Solo el staff sabe qué tan difícil es cada bloque y a qué categoría pertenece. Los números físicos se reparten revueltos para que nadie adivine el orden.
- La categoría en la que se inscribieron no importa: el staff decide la categoría final según los resultados.

## Puntos

- Los bloques se ordenan por dificultad: el más fácil vale 1 y el más difícil vale 24.
- Top = valor del bloque. Zona = la mitad (zona en el 9 = 4.5).
- Top: controlar la presa final con las dos manos durante 3 segundos. Zona: llegar a la presa de zona, controlarla y progresar desde ella (definiciones del dueño, 2026-11-07).
- Página pública con todo esto explicado fácil: /competencia/reglamento ("¿Cómo se califica?").
- Cada bloque cuenta una sola vez, con lo mejor que sacó.
- Cuentan los **5 bloques que más puntos le den** a cada quien (no "los 5 más difíciles").
- **−0.01 por intento** en esos 5 bloques. Todo intento cuenta: fallido es fallido, también después de la zona.
- **Excepción (2026-11-06):** si el bloque se queda en zona, la **primera zona no resta**. Zona al primer intento en el bloque que vale 1 = 0.5 exacto. Si vuelve a hacer zona, o se cayó antes de la zona, eso sí resta. Si después hace top, se cuentan todos los intentos como antes (zona y luego top en el 1 = 0.99; flash = 1).
- Los intentos en bloques fuera de su top 5 no restan. Así conviene probar bloques duros.
- Se muestra con decimales: "47.83 puntos".

## Top cerrado

- Cuando un participante ya hizo top en un bloque, no puede volver a intentarlo.
- Si el juez trata de anotarle otro intento, el sistema le avisa que ese participante ya lo sacó y no lo registra.

## Categoría final

- Se decide por el bloque más difícil con top:
  - Top en algún bloque avanzado → avanzado.
  - Top en algún bloque intermedio → intermedio.
  - Solo tops de básico → básico.
- Se puede subir y también bajar.
- Femenil y varonil siguen separados (confirmado).
- Sin ningún top (solo zonas o nada) → básico (confirmado).
- El admin puede fijar el nivel de alguien a mano, con motivo.

## Desempate

1. Puntos, con decimales. Si empatan, sacaron lo mismo con los mismos intentos.
2. Bloque más difícil con top.
3. Número de flashes en su top 5.
4. Se agrega su 6º mejor bloque, luego el 7º, y así hasta desempatar.
5. Si se acaban los bloques: comparten el lugar. En podio, el staff decide si hay superfinal.

## Rifa

- **Todas** las zonas cuentan para la rifa, en cualquier bloque y de cualquier categoría. Es 1 boleto por bloque con zona o top.
- Ya programado: en modo bloques la rifa cuenta las zonas de todos los bloques.

## Cómo se usa (programado)

- **Puntos → Bloques** (/staff/competencia/puntos): escribir los números de bloque del más fácil al más difícil, separados por comas, y los cortes de nivel (por defecto básico 1–8 e intermedio hasta 16). El valor de cada bloque es su lugar en la lista.
  - Se puede corregir en cualquier momento, también al final, y el ranking se recalcula solo.
  - "Quitar bloques" regresa al modo anterior (rutas por categoría).
- Mientras no haya bloques guardados, todo funciona como antes.
- **Juez** (/juez):
  - Ve los bloques por número, sin puntos ni nivel, porque el competidor podría ver la pantalla.
  - Los bloques con top salen en verde y bloqueados.
  - Si intenta capturar uno con top, el sistema le avisa y no lo guarda.
  - Tampoco acepta números que no son bloque.
- **Ranking**:
  - Muestra a cada quien en su categoría final (género + nivel) con su bloque más difícil.
  - Hay un cuadro "Compiten en otra categoría".
  - En el detalle se ve el valor de cada bloque; los que no suman salen transparentes.
  - Ahí mismo se puede fijar el nivel a mano.
- **Ajustes**: bloques que cuentan (5), zona = valor × 0.5 y resta por intento (0.01).
- **TV** (hasta el 7-nov): 24 bloques, horarios y "cómo se juega". Ya no muestra rutas por categoría.
- **Cupo**: sin cambios; se va ajustando desde el panel.
- **Pruebas**: PGlite con 31 comprobaciones (puntos, desempates, subir/bajar, juez, rifa, corregir el orden). Las pantallas se probaron con datos falsos.
