# Reglas de puntuación — JAM (7 de noviembre de 2026)

Acordadas con el dueño el 2026-11-04. Reemplazan la idea del armador (10 por top, 5 por zona). Con esa idea, flashear los 5 bloques más fáciles valía lo mismo que los 5 más difíciles. **Todavía no están programadas.**

## Logística

- 3 horarios de 2 h, máximo 20 personas por horario, todas las categorías revueltas.
- 24 bloques numerados. Cada quien intenta los que quiera.
- Solo el staff sabe qué tan difícil es cada bloque y a qué categoría pertenece. Supuesto: 1–8 básico, 9–16 intermedio, 17–24 avanzado (por confirmar).
- La categoría en la que se inscribieron no importa: el staff decide la categoría final según los resultados.

## Puntos

- Los bloques se ordenan por dificultad: el más fácil vale 1 y el más difícil vale 24.
- Top = valor del bloque. Zona = la mitad (zona en el 9 = 4.5).
- Cada bloque cuenta una sola vez, con lo mejor que sacó.
- Cuentan los **5 bloques que más puntos le den** a cada quien (no "los 5 más difíciles").
- **−0.01 por intento** en esos 5 bloques. Todo intento cuenta: fallido es fallido, también después de la zona.
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
- Femenil y varonil siguen separados (supuesto, por confirmar).
- Por definir: categoría de quien no hizo ningún top (solo zonas o nada).

## Desempate

1. Puntos, con decimales. Si empatan, sacaron lo mismo con los mismos intentos.
2. Bloque más difícil con top.
3. Número de flashes en su top 5.
4. Se agrega su 6º mejor bloque, luego el 7º, y así hasta desempatar.
5. Si se acaban los bloques: comparten el lugar. En podio, el staff decide si hay superfinal.

## Rifa

- **Todas** las zonas cuentan para la rifa, en cualquier bloque y de cualquier categoría. Es 1 boleto por bloque con zona o top.
- Hoy el SQL de la rifa solo cuenta los bloques de su categoría, así que hay que cambiarlo.

## Qué hay que cambiar en el sistema (cuando se programe)

- `judge_record_attempt`:
  - Aceptar cualquier bloque del 1 al 24 (hoy rechaza los que no son de su categoría).
  - Rechazar intentos en un bloque que ya tiene top (`already_topped`), con aviso en la pantalla del juez.
- Asignar dificultad y nivel a cada bloque (1–24), solo visible para el staff.
- Ranking nuevo con las reglas de arriba y la categoría final calculada.
- Rifa: contar zonas de todos los bloques.
- TV (`src/lib/competitionDisplay.ts`): ya no puede mostrar los bloques por categoría porque es secreto. Falta decidir qué muestra.
- Cupo: 20 fijos por horario (hoy es 15 y sube de 5 en 5).
