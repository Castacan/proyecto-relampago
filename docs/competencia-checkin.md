# Check-in con firma — JAM (7 de noviembre de 2026)

Pedido del dueño (2026-11-05): que nadie haga check-in sin estar físicamente en recepción y que todos firmen la responsiva y los documentos.

## Flujo
1. La persona llega a recepción y dice su nombre. El staff la busca en **/staff/competencia/checkin** (por nombre o número) y le dice su **número de participante**. El número solo lo tiene el staff: no sale en la página de inscripción, ni en los correos, ni en la ruleta pública.
2. La persona escanea el QR (botón "Mostrar QR") o entra a **app.jaibamuro.com/competencia/checkin**. Escribe su primer nombre (sin importar acentos ni mayúsculas) y su número.
3. Lee y firma cada documento con el dedo: nombre, casilla "Leí el documento y lo acepto" y firma. Si es menor (según su fecha de nacimiento y la fecha del evento), también pone nombre y parentesco de su madre, padre o tutor.
4. Al firmar el último documento queda hecho el check-in y le sale una pantalla verde con su nombre, número y hora. En el panel aparece **Check-in ✓**. Entonces se le entrega playera y número.

## Detalles
- SQL: `src/supabase/competencia_checkin.sql`.
- Documentos: se editan en el panel ("Documentos"). Cada firma guarda una copia exacta del texto firmado, la hora y el navegador.
- Sin documentos activos nadie puede hacer check-in.
- Freno: 5 fallos con el mismo número, o 30 fallos en total, en 10 min → "Demasiados intentos, pide ayuda al staff".
- La sesión para firmar dura 45 minutos.
- "Ver firmas" muestra e imprime lo que firmó cada quien.
- El botón "Check-in" de Inscripciones sigue funcionando como respaldo (por ejemplo, si alguien firmó en papel).
- Inscripciones ahora también busca por número.
- Probado: PGlite (`checkin_test.mjs`, 19 comprobaciones) y las pantallas con un servidor falso (firma de 2 documentos → pantalla verde → panel con Check-in ✓ y firmas imprimibles).
