# Rifa de la competencia JAM (7 de noviembre de 2026)

Pedido del dueño (2026-11-04):

- Al final de la competencia se rifan premios.
- Cada **zona** que complete un participante le da **un boleto**.
- Cada persona gana **máximo 1 premio**: quien gana sale de las rifas siguientes.

## Premios (al 2026-11-04)

| # | Premio | Patrocinador |
|---|---|---|
| 1 | Magnesia (1 de 3) | Yohua |
| 2 | Magnesia (2 de 3) | Yohua |
| 3 | Magnesia (3 de 3) | Yohua |
| 4 | Hangboard | Eskalametra |
| 5 | Par de pullups | Eskalametra |
| 6 | Tapete de yoga | Casa Luma |
| 7 | Clase gratis (1 de 2) | Casa Luma |
| 8 | Clase gratis (2 de 2) | Casa Luma |
| 9 | Magnesiera chica | Acopa |
| 10 | Magnesiera grande | Acopa |
| 11 | Cortesía | Complemento |
| 12 | Sudadera (1 de 2) | Yohua |
| 13 | Sudadera (2 de 2) | Yohua |

Total: 13 premios. Cada magnesia, clase y sudadera se rifa por separado.

## Decisiones del dueño (2026-11-04)

- El top cuenta como zona: 1 boleto por cada ruta en la que llegó a zona o a top.
- El hangboard va al final. El resto lo ordené de menor a mayor; se puede cambiar en "Editar premios".
- No hay que estar presente para ganar.
- El staff no participa: se saca con "Sacar de la rifa".

## Cómo funciona (programado)

- Pantalla: /staff/competencia/rifa (solo admin). También hay botón "Rifa" en Inscripciones y link en Puntos.
- Base de datos: `src/supabase/competencia_rifa.sql`.
- Boletos: 1 por bloque con zona o top. Con las reglas por bloques (2026-11-04) cuentan las zonas de **todos** los bloques, de cualquier nivel.
- Participan solo los pagados, incluidas las cortesías.
- "Sortear": el servidor elige al azar entre todos los boletos (cada boleto pesa igual). Quien gana sale de la tómbola.
- Se abre una pantalla completa para anunciar: los nombres pasan rápido y se detienen en el ganador. Se puede proyectar.
- "Deshacer" regresa a la persona a la tómbola, pide un motivo y queda en la bitácora.
- "Editar premios": agregar, renombrar, cambiar el orden y quitar los que no se han sorteado.
- Probado con PGlite (22 comprobaciones; también el peso por boletos con 400 sorteos) y la pantalla con datos falsos.

## Ruleta en la TV y boletos extra (2026-11-05)

Pedido del dueño:
- Durante la competencia, la TV muestra una **ruleta** que se va llenando en tiempo real con los nombres de quienes ganan boletos. El tamaño de cada rebanada es proporcional a sus boletos.
- La ruleta **empieza con ~10 nombres**: personas que completaron una dinámica previa y tienen boletos extra.
- En la rifa, el admin pica "Sortear" desde su computadora (/staff/competencia/rifa). En la TV se quitan los nombres del ganador anterior, la ruleta gira sola, cae en el ganador y lo anuncia en grande.

Cómo funciona:
- SQL: `src/supabase/competencia_ruleta.sql` (después de rifa y bloques). Columna `raffle_bonus` (0–20), `admin_raffle_set_bonus` y la pública `get_competition_raffle_wheel`. Boletos = zonas + extra.
- Boletos extra: en la página de Rifa, columna "Extra" con − / + por persona.
- Pantalla: `/competencia/ruleta` (proyector o cualquier navegador) y la TV (`/leaderboard/display`) sola del 5 al 7 de noviembre (pedido "desde ya"). Para verla antes en la TV: `/leaderboard/display?ruleta=1`.
- La pantalla pide datos cada 2.5 s. El ganador lo elige el servidor; la ruleta solo lo muestra. Si se pica "Sortear" dos veces seguidas, los sorteos se muestran uno tras otro.
- "Deshacer" en el panel: la pantalla quita el anuncio.
- La lista de ganadores de la derecha no muestra al ganador hasta que la ruleta termina de girar.
- La TV se actualiza sola: cada 5 min revisa si hay versión nueva y recarga (nunca a media ruleta). La primera vez después de este cambio sí hay que recargarla o reiniciar la Pi una vez, porque la versión que tiene ahora no sabe recargarse.
- Probado: PGlite (`ruleta_test.mjs`, 14 comprobaciones) y la pantalla con un servidor falso: nombres entrando, giro, anuncio y que el ganador anterior sale.
