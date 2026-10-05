# Bitácora — Proyecto Relámpago (Jaibamuro)

Registro de lo que se va haciendo, sesión por sesión. Lo más reciente arriba.

## 2026-10-04 — Competencia: cobro en línea con Clip (Etapa 2)

**Decisión del usuario:** cobrar con **Clip** (no Openpay), solo tarjeta.
Probar primero con un cobro real de $1.

**Por qué Clip por API y no un link a mano:** un link hecho a mano no
lleva nuestro folio. Con la API (`POST api.payclip.com/v2/checkout`) la app
crea un link por inscripción con el folio en `metadata.external_reference`.

**Hecho:**
- `src/supabase/competencia_pagos.sql`: `competition_payments`,
  `competition_payment_events` (solo inserción) y funciones solo para
  `service_role`: `competition_begin_payment` (escribe el pago local antes
  de pedir el link; si la reserva venció y no hay cupo, NO cobra),
  `competition_attach_payment`, `competition_fail_payment`,
  `competition_record_payment_event`, `competition_apply_payment_status`
  (idempotente, nunca retrocede), `competition_payments_to_check`. Admin:
  `get_competition_payments_admin`, `admin_resolve_payment_review`, y
  `admin_update_competition` ahora acepta `price_cents`.
- `supabase/functions/competition-payments/index.ts`: una sola Edge
  Function con `pay`, `check`, `reconcile` (solo admin) y el webhook.
- Frontend: `CompetitionPayButton` en `/competencia` y
  `/competencia/consulta` (al volver de Clip con `?pago=ok` insiste unos
  segundos hasta confirmar); panel con "Pagos en línea (Clip)", botón
  "Revisar pagos con Clip", pagos por revisar, y precio en Ajustes.

**Reglas de seguridad de pagos:**
- El webhook de Clip NO trae firma. Su cuerpo solo se guarda como
  evidencia; el estado se toma SIEMPRE de `GET /v2/checkout/{id}` con
  nuestras credenciales. La URL del webhook lleva una firma HMAC por pago.
- Un pago completado que no se puede aplicar limpio queda con
  `review_reason` (`duplicate`, `amount_mismatch`, `no_room`,
  `registration_inactive`) y sale en el panel; nunca se descarta.
- Si el link manual (`payment_link_url`) está vacío se cobra con Clip; si
  tiene valor, se usa ese link y se confirma a mano.

**Probado en local (sin tocar producción ni Clip):** SQL de pagos con 37
casos en PGlite; la Edge Function real (transpilada) contra un Clip
simulado con 27 casos (webhook falso, webhook que miente, webhook que no
llega, conciliación, monto distinto, Clip caído, rechazo de campos
opcionales, cobro de $1); y el recorrido en navegador inscribir → pagar →
volver confirmado. NO probado: Clip real (formato exacto de sus
respuestas, su webhook real, su sandbox).

**PENDIENTE (lo hace el usuario; Claude no puede desplegar a producción
ni capturar llaves):**
1. Correr `src/supabase/competencia_pagos.sql` en el SQL Editor.
2. Desplegar la función `competition-payments` (Edge Functions → editor)
   y APAGAR "Verify JWT" en sus detalles.
3. Crear credenciales de API en dashboard.clip.mx/applications y guardar
   `CLIP_API_KEY` y `CLIP_API_SECRET` en Edge Functions → Secrets.
4. Prueba real: en `/staff/competencia` → Ajustes poner precio $1, abrir
   inscripciones, inscribirse, pagar, verificar que queda "Pagado" solo.
   Luego regresar el precio a $500 y marcar esa inscripción como reembolso.

**Limitaciones conocidas:**
- "Recaudado" en el panel = pagados × precio actual: la inscripción de
  prueba de $1 contará como $500 hasta marcarla reembolsada.
- No hay revisión automática programada (cron): la red de seguridad es el
  botón "Revisar pagos con Clip" y la consulta que hace cada participante.
- Sin correos de confirmación todavía.

## 2026-10-04 — Inscripciones a la competencia (Etapa 1)

**Contexto:** competencia de boulder el 7-nov-2026, 6 categorías, 80–100
personas, $500. Documento fuente: `COMPETENCIA_REGISTRO_Y_PAGOS.md`
(Downloads del usuario). Se acordó la versión reducida, en dos etapas.

**Decisiones del usuario:**
- Métodos finales: tarjeta + SPEI (sin tienda de conveniencia).
- Menores se inscriben igual que un adulto; solo ven un aviso de que deben
  llegar con un mayor de edad a firmar. En el panel salen con etiqueta "Menor".
- Abrir lo antes posible.

**Hecho (código, Etapa 1 = inscripción + pago confirmado a mano):**
- `src/supabase/competencia.sql`: tablas `competitions`,
  `competition_categories`, `competition_registrations`,
  `competition_audit_log` (RLS sin policies; todo por RPC) y RPCs
  `get_competition_public`, `register_for_competition` (cupo atómico con
  FOR UPDATE), `get_registration_status` (folio + correo),
  `get_competition_admin`, `admin_update_registration`,
  `admin_update_competition`. Seed cerrado (`is_open = false`) con slug
  `competencia-2026` y 6 categorías provisionales ("POR DEFINIR").
- `/competencia` (formulario), `/competencia/consulta` (folio + correo),
  `/staff/competencia` (solo admin: contadores, tallas, filtros, acciones
  con motivo obligatorio, CSV con BOM, ajustes de cupo/link/abrir-cerrar).
- "Vencido" no se guarda: es un pendiente con `hold_expires_at` pasado; deja
  de ocupar cupo sin necesidad de cron. Un pago marcado tarde sin cupo queda
  en `needs_attention`, nunca se rechaza.

**Probado:** el SQL completo contra un Postgres en memoria (PGlite) con 51
casos (validaciones, cupo, duplicados, reinscripción tras vencer, pago
tardío, permisos anon/staff/admin, auditoría inmutable), y las 3 pantallas
en local contra ese mismo backend de prueba. NO probado: dos inscripciones
realmente simultáneas por el último lugar (PGlite es de una sola conexión).

**PENDIENTE para que funcione en producción:**
1. Correr `src/supabase/competencia.sql` en el SQL Editor de Supabase
   (Claude no puede ejecutarlo: el clasificador bloquea cambios a producción).
2. Llenar datos reales: nombre, hora, lugar, qué incluye, cupo, las 6
   categorías con su criterio, revisar textos de privacidad y deslinde.
3. Definir cómo se paga en esta etapa (ver hallazgo de Openpay abajo).
4. Encender "Inscripciones abiertas" en `/staff/competencia` → Ajustes.

**Hallazgos en Openpay (revisado en el dashboard productivo, solo lectura):**
- Comercio Jaibamuro activo en producción (Pasarela de pago y Link de pago
  activos; hay 1 cobro real con tarjeta). Sin webhooks configurados.
- El "Link de pago" del dashboard es UNO POR CLIENTE (pide nombre, teléfono
  y correo): no existe un link general reutilizable. Sirve si staff crea un
  link por inscrito, poniendo el folio como concepto.
- API (documents.openpay.mx/docs/api): cargo con tarjeta por redirección
  (`confirm: false` + `redirect_url`, devuelve `payment_method.url`,
  `use_3d_secure` opcional), cargo `bank_account` para SPEI, `order_id`
  único entre todas las transacciones (sirve de idempotencia), webhooks con
  autenticación básica (`user`/`password`) y estado `verified`.

**Etapa 2 (siguiente):** cobro automático por inscripción con Edge
Functions (crear cargo, webhook, conciliación). Requiere que el usuario
ponga la llave privada de Openpay como secreto en Supabase.

## 2026-10-04 — Auto-scroll en el leaderboard de la TV

**Pedido:** cuando hay más participantes de los que caben en pantalla, que la
lista baje sola para que el último lugar (ej. el #100) también vea su nombre.

**Hecho** (`src/pages/public/LeaderboardDisplay.tsx`, hook `useAutoScroll`):
- Cada columna (Hoy / Semana / Mes) se desplaza por separado, solo si su
  lista no cabe. Si todos caben, no se mueve nada.
- Ciclo: espera 10 s arriba → baja lento y continuo (40 px/s, sin pausas)
  hasta que se ve la última fila → espera 4 s → regresa al #1 → repite.
- Primera versión fue por páginas (saltaba una pantalla cada 10 s); el
  usuario la vio y pidió movimiento continuo, se reemplazó.
- Constantes para ajustar al gusto, arriba del hook: `SCROLL_HOLD_TOP_MS`,
  `SCROLL_HOLD_BOTTOM_MS`, `SCROLL_SPEED_PX_S`, `SCROLL_RETURN_MS`.
- Probado en local con 100 nombres falsos en Hoy y 23 en Semana: llega al
  #100, velocidad constante medida, regresa al #1.

**SQL en Supabase (corrido por el usuario, 2026-10-04):** los RPC
`get_daily_leaderboard`, `get_weekly_leaderboard` y
`get_monthly_leaderboard` pasaron de `LIMIT 50` a `LIMIT 200`, igual que
`src/supabase/schema.sql`. También aplica a `/leaderboard` (celular).

## 2026-10-04 (noche) — Estado del despliegue de Clip

- Usuario corrió `competencia_pagos.sql` y desplegó `competition-payments`
  con Verify JWT apagado. Verificado con llamadas inofensivas a producción:
  `check` responde `{"checked":0}`, `pay` responde `not_configured` (faltan
  llaves), `reconcile` anónimo responde `forbidden`.
- **Bloqueo:** en `dashboard.developer.clip.mx/credentials` (se llega por
  "Panel de desarrolladores" en el panel de Clip; la URL vieja
  `dashboard.clip.mx/applications` sale en blanco) Clip pide **validar
  identidad** antes de dar credenciales de producción. Las de "Pruebas"
  solo sirven para Checkout Transparente, no para links de pago.
- Arreglo menor en el repo (aún no desplegado): el webhook respondía 500
  en vez de 403 cuando no hay `CLIP_API_SECRET`. Con el secreto puesto no
  ocurre; se sincroniza en el próximo despliegue de la función.

## 2026-10-04 (noche) — Prueba real de $1 con Clip: EXITOSA

- Usuario validó identidad en Clip, creó la credencial de producción
  "JaibamuroCompetencia" (uso: Tienda online, URL https://app.jaibamuro.com)
  y guardó `CLIP_API_KEY` / `CLIP_API_SECRET` en Supabase.
- Prueba en producción: precio a $1, inscripción "Prueba Pago Clip"
  (folio JM-5G36F), link real de Clip (`pago.clip.mx/v3/<id>`), pago con
  tarjeta por el usuario. Resultado: la consulta mostró "Pago confirmado" y
  el panel la muestra PAGADO vía "Clip en línea".
- **El webhook real de Clip SÍ llega y funciona:** en Invocations se ve un
  POST con `?wh=...&s=...` (user agent Go-http-client) respondido 200 a la
  hora del pago. No hizo falta la revisión de respaldo.
- Al terminar: precio regresado a $500 e inscripciones CERRADAS.
- Pendiente: la inscripción de prueba JM-5G36F sigue como pagada (ocupa 1
  lugar y cuenta $500 en "recaudado"); hay que reembolsar el $1 en Clip y
  marcarla "Registrar reembolso" en el panel. Faltan los datos reales de la
  competencia (nombre, hora, lugar, cupo, 6 categorías, textos) antes de abrir.
- Observado una vez, sin diagnosticar: abrir `/staff/competencia` por URL
  directa terminó en `/staff`; entrando por el tab funciona.

## 2026-10-04 (noche) — Datos reales de la competencia

- Dictados por el usuario: nombre **JAM Jaibas Al Muro**, inicio 10:00 am
  (horarios por categoría por definir), lugar Jaibamuro, cupo ilimitado y
  sin anunciarlo. SQL en `src/supabase/competencia_datos.sql` (lo corre el
  usuario). Cupo ilimitado = `capacity_total = 100000`.
- La página pública ya solo menciona lugares disponibles cuando quedan 20
  o menos; el panel dice "sin límite de cupo".
- Aclarado al usuario: "Registrar reembolso" en el panel SOLO registra; el
  reembolso real se hace en el panel de Clip. La app no le pide a Clip
  devolver dinero.
- Siguen pendientes: nombres/criterios definitivos de las 6 categorías,
  qué incluye la inscripción, revisar textos de privacidad y deslinde.

## 2026-10-04 (noche) — Categoría "Básico" y regla de reubicación

- Pedido del usuario: el nivel de entrada se llama **Básico** (no
  Principiante); no se muestra nada en "qué incluye"; y hace falta avisar
  que se puede mover de categoría a quien compita por debajo de su nivel
  (práctica común: gente que se inscribe en una categoría más fácil).
- Hecho: aviso corto junto al selector de categoría (`CATEGORY_NOTICE` en
  `src/lib/competition.ts`) y párrafo "Categorías" al inicio del texto que
  se acepta (ahora "Reglas y deslinde de responsabilidad"), con
  `waiver_version = 'v2'`. Todo en `src/supabase/competencia_datos.sql`
  (lo corre el usuario). El seed de `competencia.sql` ya usa "Básico".
- El texto de la regla es redacción de Claude a partir de lo que dictó el
  usuario; no dice nada sobre reembolsos ni sobre si la decisión es apelable.

## 2026-10-04 (noche) — Correo de confirmación y fin del mensaje de "48 horas"

- **Correo "Pago confirmado"** desde la Edge Function vía Resend
  (`hola@jaibamuro.com`, dominio ya verificado): folio, nombre, categoría,
  talla, fecha/hora/lugar, monto y recibo de Clip, aviso de menor si
  aplica, botón a la consulta. Se manda UNA vez, solo cuando el pago pasa a
  completado y la inscripción queda pagada (no en reprocesos, no si queda
  "por atender"). Si Resend falla, el pago sigue confirmado y el fallo queda
  en `competition_payment_events` (source `email`).
  Requiere el secreto `RESEND_API_KEY` y volver a desplegar la función.
  NO se manda correo cuando staff marca pagado a mano.
- **48 horas:** era la reserva de lugar mientras se paga. Con cupo sin
  límite no tiene sentido, así que con cupo ilimitado las pantallas ya no
  mencionan reserva ni fecha límite ("Tu inscripción queda confirmada en
  cuanto se aprueba tu pago").
- Probado en local con Resend simulado: 11 casos (contenido, escape de
  HTML en el nombre, no reenvío, vía de respaldo, Resend caído, por atender).

## 2026-10-04 (noche) — Correo de confirmación activado

- Usuario desplegó la función con el código del correo y guardó
  `RESEND_API_KEY` en Supabase (verificado: el secreto aparece listado y
  el código desplegado incluye `sendConfirmationEmail`).
- Aún NO se ha enviado un correo real: se probará con el primer pago real.
  Si no llega, revisar `competition_payment_events` con `source = 'email'`
  (kind `email_sent` / `email_error`) y los Logs de la función.

## 2026-10-04 (noche) — Abierta al público y primer inscrito real

- El usuario abrió inscripciones y mandó `https://app.jaibamuro.com/competencia`
  a un amigo: se inscribió, pagó $500 con Clip y recibió el correo de
  confirmación. Confirmado por el usuario ("todo perfecto"). Primera prueba
  real del correo: OK.
- En Ajustes se agregó una nota: con cupo sin límite, "Horas para pagar"
  solo decide cuándo una inscripción sin pagar se ve como "Vencido" en el
  panel (commit `8505a54`).
- Ofrecido, sin respuesta aún: resumen de inscritos por categoría en el
  panel (hoy se ve con el filtro o en el CSV).
