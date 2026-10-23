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

## 2026-10-04 (noche) — Inscripción manual (pago en efectivo en el gym)

- Pedido del usuario: poder meter a mano a quien llega y paga en efectivo.
- `src/supabase/competencia_manual.sql`: `email` y `phone` de
  `competition_registrations` ahora aceptan NULL, y nueva RPC solo-admin
  `admin_register_participant` que crea la inscripción YA PAGADA (método
  efectivo por defecto), aunque las inscripciones en línea estén cerradas.
  Respeta cupo y duplicados; deja rastro `manual_register` en la auditoría.
- Panel: botón "+ Inscribir aquí" con formulario (nombre, nacimiento,
  categoría, talla, cómo pagó; celular, correo y nota opcionales). Muestra
  el folio al terminar.
- A las inscripciones manuales NO se les manda correo de confirmación.
- Probado: SQL con 20 casos en PGlite. El formulario NO se probó en
  navegador. Falta que el usuario corra el SQL.

## 2026-10-05 — Método de pago "Tarjeta en sucursal"

- El usuario ya corrió `competencia_manual.sql` (inscripción manual activa).
- Pedido: agregar **tarjeta** a "¿Cómo pagó?", porque en el gym también
  cobran con terminal. Nuevo método `card` ("Tarjeta en sucursal") en
  `admin_register_participant` y en `mark_paid` de
  `admin_update_registration`; el panel lo ofrece en la inscripción manual
  y al marcar pagado (orden: Efectivo, Tarjeta en sucursal, Transferencia,
  Link de pago, Otro; default Efectivo). `clip` sigue siendo solo para el
  pago en línea.
- De paso: `admin_update_competition` en `competencia.sql` quedó igual a la
  versión vigente (con `price_cents`), para que volver a correr ese archivo
  no la regrese a la versión vieja.
- Probado en PGlite partiendo del estado de producción. Falta que el
  usuario corra el SQL (solo las dos funciones que cambian).
- 2026-10-05: el usuario confirmó que corrió el SQL del método `card`
  ("success"). No verificado por Claude en producción (requiere sesión de
  admin y crear una inscripción real).

## 2026-10-08 — Recordatorio de pago por correo

- Pedido del usuario: correo a quien se inscribió y no ha pagado, 6 horas
  antes de que venza su plazo, recordando que falta el pago para completar
  la inscripción.
- `src/supabase/competencia_recordatorios.sql` (nuevo): columna
  `payment_reminder_at`, funciones `competition_claim_payment_reminders`
  y `competition_release_payment_reminder` (solo `service_role`), y un
  trabajo de `pg_cron` cada 15 minutos que llama a la Edge Function con
  `{action:'remind'}` usando `pg_net`.
- Edge Function `competition-payments`: acción `remind`. Antes de mandar
  cada correo consulta en Clip los links abiertos de esa inscripción, por
  si ya pagó. Asunto: "Falta tu pago · <competencia> · Folio <folio>". El
  correo no menciona fecha límite (con cupo ilimitado las pantallas
  tampoco). Envíos y fallos quedan en `competition_payment_events`
  (`reminder_sent` / `reminder_error`).
- Decisiones mías: un solo recordatorio por inscripción; la primera
  corrida también le escribe a quien ya tenía el plazo vencido sin pagar;
  solo mientras la competencia esté abierta y no haya pasado; `remind` no
  pide credencial (no devuelve datos y no puede mandar de más).
- Probado: el SQL en PGlite (a quién le toca, no repite, soltar y
  reintentar, competencia cerrada). La función solo se revisó de sintaxis:
  el envío real no se ha probado.
- Falta que el usuario despliegue la función y corra el SQL.
- Aparte: se confirmó en Resend (resend.com/emails) que el correo de
  confirmación de un participante sí se entregó; ahí se ven todos los
  envíos con su estado.
- Mismo día, más tarde: el usuario desplegó la función y corrió el SQL
  (el trabajo de cron quedó con id 1). Llamada directa a `remind` en
  producción: responde `{"sent":0,"skipped":0,"errors":0}`, o sea función
  y SQL funcionan, pero no había nadie a quien le tocara. El primer envío
  real sigue sin verse: revisar en resend.com/emails cuando haya un
  inscrito sin pagar con más de 42 horas.
- También borró de la base, con SQL que le dejé, sus dos inscripciones de
  prueba (JM-5G36F y JM-6EQTQ) y sus pagos. La auditoría y los eventos de
  esos folios se conservan.

## 2026-10-17 — Cortesías con código
- El usuario pidió una forma de dar cortesías y eligió **códigos**: staff
  crea un código en el panel (botón "Cortesías" en `/staff/competencia`)
  y se lo manda a la persona; ella se inscribe sola en `/competencia`,
  abre "¿Tienes un código de cortesía?", lo escribe y queda inscrita ya
  confirmada, sin pasar por Clip. Recibe el correo "Inscripción
  confirmada" (sin la fila de pago).
- SQL nuevo `src/supabase/competencia_cortesias.sql`: tabla
  `competition_courtesy_codes`, columna `courtesy_code_id` en
  inscripciones, `payment_method = 'courtesy'`. La RPC
  `competition_register_courtesy` (solo service_role) valida el código y
  llama a `register_for_competition` en la misma transacción: si algo
  falla no se crea nada y el código no se gasta. Un uso = inscripción
  activa con ese código; "Quitar cortesía" (el reembolso, renombrado para
  cortesías) libera el uso. Admin: crear (código propio opcional o
  `JMC-XXXXXX` al azar, usos 1–500), revocar (no cancela a quien ya se
  inscribió) y lista con quién lo usó.
- Edge Function: acción `courtesy`; `sendConfirmationEmail` sirve para
  los dos casos. El correo queda en `competition_payment_events` con
  `source = 'courtesy'` y el folio en `payload`.
- Panel: "Pagados" ya no suma las cortesías al dinero y dice cuántas hay.
- Probado: SQL en PGlite (23 casos: permisos, agotado, revocado,
  duplicado/cerrada no gastan el código, quitar libera el uso, correr el
  archivo dos veces) y la función transpilada con Resend falso (8 casos).
  Las pantallas no se probaron en el navegador.
- Pendiente menor: en `/competencia/consulta` una cortesía sale como "Pago
  confirmado".
- Mismo día: el usuario corrió el SQL y desplegó la función. Prueba en
  producción: creé el código JMC-K5HCSW ("PRUEBA Claude (borrar)") y me
  inscribí con él (folio JM-K5DUJ, correo del usuario). Quedó Pagado
  (Cortesía) y salió la pantalla de confirmación. Después le di "Quitar
  cortesía": quedó Reembolsado, los contadores regresaron a 13 / $6,500 y
  el código volvió a 0/1 usados; luego lo revoqué. El correo no lo pude
  ver (no hay sesión de Resend en su Chrome): falta que el usuario
  confirme que le llegó. JM-K5DUJ sigue en la lista como Reembolsado.
- Arreglado: con código, el texto bajo el botón ya no habla de pago.

## 2026-10-18 — Aplicar cortesía desde el panel
- Pedido del usuario: poder darle la cortesía a alguien que ya se inscribió
  y no vio dónde poner el código. Botón "Aplicar cortesía" en las
  inscripciones Pendientes y Vencidas del panel (junto a "Editar datos";
  no dentro, porque Editar no existe para vencidas). Pide el código.
- SQL: `admin_apply_courtesy(p_id, p_code)` en `competencia_cortesias.sql`
  (solo admin). Valida código (existe, no revocado, con usos), y si la
  reserva ya venció exige cupo y que no tenga otra inscripción activa.
  Queda paid/courtesy; auditoría `courtesy_apply` con antes/después.
- Edge Function: acción `courtesy_apply`, llama la RPC con la sesión del
  admin y manda el correo "Inscripción confirmada" si tiene correo.
- Si esa persona tenía un link de Clip abierto y paga después, el pago cae
  en "duplicado" para revisión (la red de seguridad que ya existía).
- Probado: PGlite (14 casos nuevos) y función con arnés falso (5 casos).
- Mismo día: en la lista del panel, las cortesías muestran a qué código
  pertenecen: "(Cortesía · JMC-XXXXXX · para quién)". También en el CSV,
  columna "Método de pago". Sale de `get_competition_courtesy_codes_admin`
  (sin SQL nuevo).
- Mismo día: en `/competencia` el enlace ahora es un botón grande
  (borde punteado) "¿Tienes un código promocional?", y todo lo que ve el
  público dice "código promocional" en vez de "cortesía". En el panel y en
  el correo ("Inscripción: Cortesía") sigue diciendo cortesía.

## 2026-10-21 — TV: columna temporal 21–31 de octubre
- Pedido del usuario, **temporal**: en `/leaderboard/display` las columnas
  HOY y SEMANA se reemplazan por una sola, "21 AL 31 OCT" (miércoles 21 a
  sábado 31), con el acumulado de ese rango. MES (Octubre) sigue igual.
- Regresa sola: `src/lib/specialPeriod.ts` revisa la fecha de México en
  cada minuto; desde el 1 de noviembre 00:00 la TV vuelve a HOY / SEMANA
  / MES sin desplegar nada. Después se puede borrar ese archivo y su uso
  en `useLeaderboard` y `LeaderboardDisplay`.
- Cálculo: `get_leaderboard_for_range` (ya existía) con el mismo criterio
  que Semana (cada ruta cuenta una vez por persona en el rango). Diferencia:
  esa función oculta a quien esté excluido solo de Ganadores; el
  2026-10-21 no afectaba a nadie (mes con y sin filtro = mismas 12
  personas). Sin patrocinador propio: pie "Jaibamuro".
- La página del celular (`/leaderboard`) no cambia.
- Probado en local contra producción (solo lectura).

## 2026-10-23 — Plan: ERP/CRM propio (empezando por clases y reservas)
- El usuario quiere ir dejando EVO (79 USD/mes) por partes y tener lo clave
  en Relámpago. Prioridad: clases y reservas (va a empezar a dar clases).
- Se revisó el módulo de clases de EVO (sin guardar nada) y se le preguntó
  a EVA (su IA). Decisiones: pago por clase suelta en línea, incluida en
  membresía o en el gym; falta = pierde la clase; cancelar hasta 12 h antes;
  sin lista de espera. Sin facturación automática (la hace la contadora).
- Todo el plan, con detalle para retomarlo o pasárselo a otro asistente:
  `docs/plan-erp-clases.md`. Nada programado todavía.
- Mismo día: el usuario afinó el plan con Claude en el chat (v2) y se
  reemplazó `docs/plan-erp-clases.md`. Cambios clave: 3 clases iniciales
  (Introductoria $200 solo staff; Escalada Jueves y Calistenia $300 / $100
  miembro); la membresía da precio miembro + 1 clase gratis al mes (mes
  calendario, no acumulable), no clases ilimitadas; cancelar tarde gasta la
  gratis; reembolso = reagendar; sobrecupo tolerado con regla; toda persona
  con cuenta (tabla `people`, puede existir sin login); acompañantes por
  diseñar; Fase 1 dividida en 1a (arrancar) y 1b (Clip, recordatorios,
  reportes).
