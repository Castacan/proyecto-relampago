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

## 2026-10-23 — Clases y reservas, Fase 1a (código listo, falta desplegar)
- Datos del dueño: Escalada Jueves 5 pm (la da él), Calistenia lunes y
  miércoles 5 pm (coach externo), cupo 6 ambas, 60 min por defecto;
  Introductoria $200 solo staff. Todo editable desde el panel.
- SQL `src/supabase/clases.sql`: `people` (persona; puede existir sin
  login y se liga a su cuenta por correo), `memberships`, `class_settings`,
  `class_types`, `class_schedules`, `class_sessions` (se generan solas
  desde los horarios al abrir el calendario; herencia sesión → horario →
  tipo para cupo/profe/duración/precio), `class_bookings`, `class_sales`,
  `class_audit_log`. Reglas en SQL: cupo con bloqueo, ventana de 7 días,
  precio miembro, 1 gratis por mes calendario (no acumulable; la gastan
  reservada/asistió/faltó/cancelada tarde), cancelar ≥12 h devuelve,
  sobrecupo solo staff hasta la tolerancia, editar un horario regenera
  solo las sesiones futuras sin reservas.
- Edge Function nueva `class-emails` (reserva confirmada / cancelada /
  clase cancelada por el gym), una sola vez por reserva.
- Pantallas: `/clases` (calendario, reservar con gratis del mes o pagar
  en el gym, mis reservas, cancelar con aviso si es tarde, datos la
  primera vez) y `/staff/clases` (Hoy: asistencia, cobrar, walk-in con
  persona nueva, cancelar reserva o clase; Personas y membresía;
  Introductoria: venta suelta; Configuración solo admin).
- Probado: SQL en PGlite (51 casos) y pantallas en local con un Supabase
  falso (perfil, reservar, panel, walk-in, asistencia, cobro, config).
- Falta: Run del SQL y crear/desplegar la función `class-emails`
  (Verify JWT apagado). Fase 1b pendiente: Clip, recordatorios, reportes.

## 2026-10-23 — ERP completo (ventas, caja, ficha, domiciliación) — código listo, falta desplegar
- El dueño pidió construir todo sin detenerse y revisar al final. Decisiones
  suyas: Domiciliación $800/mes con promo 3 meses a $600 (temporal, debe poder
  apagarse); sin migrar clientes de EVO todavía; sin Membresía Parejas; caja al
  empezar y terminar el día; menú lateral tipo EVO; cobro recurrente con
  Openpay **y** Stripe configurables en un área de Integraciones; poder ver la
  app como cliente.
- SQL `src/supabase/erp.sql` (+ `erp_cron.sql`), Edge Function `billing`,
  menú lateral nuevo (`StaffLayout`), pantallas en `src/pages/staff/erp/*`,
  página pública `/domiciliacion/:token`, portal del cliente en `/mi-cuenta`.
- Pruebas: PGlite (ERP 67 casos, clases 51) y la función `billing` contra
  Openpay/Stripe/Resend simulados (36 casos: promo, rechazos, reintentos,
  timeouts con y sin cargo real, duplicados, corridas simultáneas, webhooks,
  3DS). UI revisada en local con Supabase falso (caja, venta con cambio,
  ficha, domiciliar, link de tarjeta, integraciones, productos).
- Bug arreglado en el camino: el formulario de Openpay fallaba si la página
  cargaba los scripts dos veces (modo desarrollo); ahora cada script se carga
  una vez y todos esperan la misma carga.
- Guía de despliegue y decisiones a revisar: `docs/erp-despliegue.md`.

## 2026-10-23 — ERP desplegado en Supabase (sandbox)

- El dueño corrió `erp.sql` (`clases.sql` ya estaba) y desplegó `class-emails` y `billing`, las dos con Verify JWT apagado.
- Secretos puestos: `OPENPAY_PRIVATE_KEY` (sandbox) y `BILLING_CRON_KEY`.
- Se corrió `erp_cron.sql` (job 3). Revisé que la llave del cron coincide con el secreto comparando el SHA-256 con el digest que muestra Supabase, sin leer la llave.
- Quedó una función de ejemplo `rapid-worker` (Deploy antes de pegar el código); hay que borrarla.
- Pendiente: Integraciones (ID de comercio y llave pública de sandbox), webhook de sandbox, prueba con la tarjeta 4111. Falta confirmar si el comercio de Openpay de EVO es del dueño (dashboard de producción).


### Primer cobro real en sandbox (2026-10-23)

- Conectado a Openpay sandbox (Integraciones OK, webhook verificado).
- Bug real: Openpay exige `device_session_id` también al cobrar (error 1001). El simulador no lo pedía. Arreglo: `subscriptions.provider_device_session` + `billing_save_device_session` (parche `erp_patch_device_session.sql`, ya corrido), y el cobro lo manda. El simulador ahora también lo exige (billing 37 OK).
- Después de registrar la tarjeta otra vez: cobro 1 pagado en el intento 2, venta #1 por $600, membresía del 23 oct al 22 nov, próximo cobro el 23 nov. En Openpay sandbox aparece exactamente 1 transacción Visa de $600.
- La persona de prueba 'Test' usa test@falso.com: el recibo se mandó a un correo falso.


## 2026-10-23 — Egresos (cuentas a pagar) e inventario

- Revisé EVO: Financiero → Cuentas a pagar (destino, beneficiario, centro de costos Gastos fijos / Gastos variables / Compra de productos, vencimiento, mes de competencia, replicar N veces) y Administración → Productos (precio de venta y de compra, cantidad actual y mínima, entradas/salidas, 'permite ventas sin stock'). En EVO hay 15 productos (agua, barras Wild, magnesia, cerveza, refresco, gomitas).
- Nuevo `src/supabase/erp_finanzas.sql` (se corre DESPUÉS de erp.sql). Ahí pasaron erp_insert_sale, create_sale, admin_void_sale, admin_save_product, add_cash_movement, get_sales_report y get_staff_dashboard, que salieron de erp.sql para no tener dos copias.
- Egresos: proveedores, egresos pendientes/pagados/cancelados, recurrentes que generan solos el pendiente una semana antes, centros de costos editables. Pagar 'de la caja' saca el efectivo de la caja abierta; un 'gasto pagado con caja' en Caja crea su egreso. Reporte del mes con egresos por centro y utilidad (solo admin). CSV.
- Inventario: cada cambio queda en `stock_movements`. La venta descuenta, la anulación regresa. Hay entradas (con egreso opcional), conteos físicos y salidas por consumo o merma. Opción de vender sin existencia, mínimo con aviso 'Por surtir' en Inicio, costo y margen.
- Pantallas: /staff/egresos (admin), /staff/inventario, menú 'Finanzas'.
- Pruebas: finanzas 74, ERP 67, billing 37, clases 51. UI revisada en local con el Supabase falso.
- Falta: Run de `erp_finanzas.sql` en producción.


## 2026-10-23 — CRM: responsivas, documentos, acceso, empleados, estados financieros, correos automáticos, bitácora

El dueño pidió una lista de funciones al estilo EVO (guardada en la memoria 'pendientes del ERP'). Nuevo `src/supabase/erp_crm.sql` (después de erp_finanzas.sql):
- **Domiciliación:** en la ficha, 'Cargos próximos' (6 meses con la promo congelada) e historial de cada intento (aprobado / rechazado con código, tarjeta registrada).
- **Bitácora** (/staff/bitacora, admin): todo lo que registra erp_audit, más movimientos de inventario y entradas; ventas por persona del staff; CSV.
- **Responsiva y reglamento electrónicos:** versionados e inmutables. Se firma con el dedo en la tablet (ficha → 'Firmar en esta tablet') o desde la cuenta del cliente (/firmar). Si es menor, pide tutor. Hoja imprimible /staff/firma/:id. Los textos iniciales son BORRADOR. Configuración → Responsiva y reglamento.
- **Archivos en la ficha:** bucket privado 'expedientes' de Supabase Storage (lo crea el SQL), solo staff; INE, papeles, foto.
- **Acceso** (/staff/acceso): check-in por QR (código JM…) o por nombre. La regla de entrada es membresía, pase o clase hoy + documentos firmados + no bloqueado. Se puede 'dejar pasar' con motivo, bloquear y regenerar el código. QR del cliente en Mi cuenta, foto en la ficha. Tabla access_devices + device_check_in para el torniquete (Edge Function futura).
- **Empleados** (/staff/empleados, admin): ficha completa, documentos, pagos de nómina que quedan como egreso (categoría Nómina), ventas del mes si tiene usuario.
- **Estados financieros** (/staff/estados, admin): estado de resultados (ingresos por tipo, costo de lo vendido, gastos por centro, utilidad) y flujo de efectivo por mes, posición actual (inventario, por pagar, caja, socios, MRR). CSV.
- **Correos automáticos** (Configuración → Correos automáticos): bienvenida, cumpleaños, por vencer, vencida, inactivo. TODOS APAGADOS. Vista previa y 'mandarme una prueba' (solo al admin). Edge Function `crm-emails` + `erp_crm_cron.sql` (diario 10:00, reusa la llave del cron de cobros).
- Pruebas: CRM 64 + render de correo 6, sin regresiones (finanzas 74, ERP 67, billing 37, clases 51). UI revisada en local: firma de menor con tutor, hoja imprimible, check-in negado por falta de membresía.
- Pendiente: Run erp_crm.sql, desplegar crm-emails (Verify JWT off), Run erp_crm_cron.sql.


## 2026-10-24 — Arreglo: Mi cuenta en blanco

- /mi-cuenta se quedaba en blanco para cuentas sin ficha de persona (por ejemplo, una cuenta nueva de staff de prueba): MyMembership hacía `.map` sobre listas que get_my_portal no trae cuando person es null. Ahora se protege (commit 0ac7abe), verificado en vivo.
- Seguridad (23-oct, ver staff_fix.sql): ya solo quedan 3 perfiles de staff (admin, Ximena, Adán). Alta de staff en Empleados → Acceso al panel.

## 2026-10-24 — Staff con usuario y contraseña

- Edge Function `staff-admin` (Verify JWT apagado, solo admin): crea la cuenta con contraseña temporal (o usa la existente) y la deja como staff o admin; pone una contraseña nueva si se olvidó. Queda registrado en la bitácora sin la contraseña.
- Empleados → Acceso al panel: alta con correo, nombre, contraseña temporal y rol; botón "Nueva contraseña" por persona.
- Panel: "Cambiar mi contraseña" (supabase.auth.updateUser). /login dice "staff del gym", lleva a /staff/inicio y aclara que el admin da contraseñas nuevas.

## 2026-10-26 — Checklist diario del staff (turnos)

**Pedido:** el brief `BRIEF_checklist_jaibamuro.md`. Cada turno debe tener un
encargado, un checklist con horarios y evidencia, y el admin debe poder
revisarlo en 2 minutos.

**Decisiones del dueño:**
- La Caja de la app es la del checklist. "Contar el fondo" abre la Caja y
  "Corte de caja" la cierra. El monto se captura una sola vez y la
  diferencia sale calculada.
- En los textos de la semilla dice "la app", no "EVO".
- El desmontaje del sábado se elige con las rutas de la pared. El staff las
  marca como desmontadas, quedan retiradas y su QR queda libre.

**Hecho:**
- `src/supabase/erp_checklist.sql`:
  - **Plantilla:** bloques con horario y días. Cada tarea toma los días de
    su bloque o tiene los suyos (tarea del día, extras del viernes).
  - **Copia del día:** se guarda una copia por día, `checklist_day_tasks`,
    así que editar la plantilla no cambia días ya generados.
  - **Encargado y desmontaje por fecha:** `checklist_days`.
  - **Reportes en el momento:** `checklist_notes`.
  - **Fotos:** bucket privado `checklist`.
  - **Reglas al marcar y cerrar:** foto, monto o reporte obligatorios según
    la tarea. "No se hizo" exige motivo. Solo el encargado o el admin cierra
    el turno, y no se puede con obligatorias pendientes ni sin la bitácora de
    3 líneas.
  - **Semilla:** el checklist que Inge revisó.
- **Pantallas:**
  - `/staff/turno` (todos): "Turno de hoy" en el menú, y el login lleva ahí.
  - `/staff/turno/:fecha` (admin).
  - `/staff/turnos` (admin): encargado por fecha, desmontaje del sábado e
    historial por fecha y persona.
  - `/staff/config/checklist` (admin): editor de la plantilla con vista por
    día.
- **Pruebas:** 62 en PGlite (`checklist_test.mjs`). También lo probé en el
  navegador con el servidor falso: marcar, foto, fondo que abre la caja,
  desmontaje y guardar la plantilla.

**Pendiente de decidir (no implementado, editable en la plantilla):**
- La clase de los jueves a las 5 pm.
- La zona 1, que hoy no se cepilla ningún día.
- Quién es el encargado de cada día.
- Erick todavía no tiene cuenta de staff.

## 2026-10-26 — Caja: cierre automático y aviso al admin

**Pedido del dueño:** la caja debe cerrarse sola al terminar el día. Si el
staff no hizo el corte, el admin debe recibir un aviso, y nadie debe poder
cerrar al día siguiente la caja de un día anterior. Además, la caja de las
pruebas del 23-oct seguía abierta y no dejaba abrir la de hoy.

**Hecho:** `src/supabase/erp_caja_cierre.sql`, que se corre al final.
- `erp_autoclose_stale_cash()` cierra toda caja abierta de un día anterior:
  - Se guarda el efectivo esperado; lo contado y la diferencia quedan vacíos
    y la caja queda marcada `auto_closed`.
  - Se registra en la bitácora.
- **Cuándo se ejecuta:**
  - Con el cron `erp-cierre-caja`, a las 00:05 de México.
  - Cada vez que alguien abre Caja, Inicio o el Turno de hoy, o intenta
    abrir caja.
- `close_cash` rechaza el corte de una caja de otro día con el error
  `cash_auto_closed`.
- **Avisos al admin:**
  - Un recuadro "Caja sin corte" en Inicio y en Caja, con el botón
    "Enterado".
  - Un correo a los admins desde `crm-emails`, acción `cash_alert`. Se
    manda una sola vez por caja.
- En el historial de Caja aparece "Sin corte (se cerró sola)".
- **Pruebas:** 73 en `checklist_test.mjs` (11 nuevas de caja).


## 2026-10-26 — Encargado fijo y alta de empleado con acceso al panel

**Respuestas del dueño:** asistencia con la cara con el celular de cada quien
(opción a); sí juntar "Nuevo empleado" con "Dar acceso al panel"; Erick es el
encargado siempre; la migración de EVO todavía no.

**Hecho:**
- `src/supabase/erp_checklist_encargado.sql` (se corre después de
  erp_checklist.sql): `checklist_settings.default_lead_id`, un trigger que pone
  el encargado fijo a todo día nuevo, y `get_checklist_default_lead` /
  `admin_set_checklist_default_lead` (este también llena los días de hoy en
  adelante que siguen abiertos y sin encargado). Un día en particular se sigue
  cambiando a mano y eso manda.
- /staff/turnos: selector "Encargado fijo" arriba de la lista.
- Empleados: el formulario del empleado tiene "Acceso al panel" (sin acceso /
  ya tiene usuario / darle acceso con su correo + contraseña temporal + rol).
  Llama a `staff-admin` y liga el perfil a la ficha. El alta suelta quedó
  plegada en "Dar acceso a alguien que no está en Empleados".
- Pruebas: 82 en `checklist_test.mjs` (9 nuevas) y prueba en el navegador con
  el servidor falso.

**Falta:** que el dueño dé Run a erp_checklist_encargado.sql, dé de alta a
Erick (necesita su correo) y lo elija como encargado fijo.

## 2026-10-26 — Asistencia del staff con selfie y WiFi del muro

**Decisiones del dueño:** cada quien checa con su celular (opción a);
10 min de tolerancia; desde 25 min tarde es falta; 3 retardos al mes = 1 falta.

**Hecho:**
- `src/supabase/erp_asistencia.sql` (después de erp_crm.sql):
  - Ajustes editables (tolerancia, falta desde, retardos = falta, exigir WiFi,
    "contar desde" y el texto del aviso con versión).
  - Redes del muro: la IP pública se lee de `request.headers` (PostgREST).
    IPv4 exacta e IPv6 por prefijo /64. El admin registra "el WiFi en el que
    estoy".
  - Horario por empleado y día, registros con selfie (bucket privado
    `asistencia`: el staff sube y solo el admin ve), aviso aceptado con
    nombre, días justificados, registros a mano con motivo y borrar
    registros. Todo va a la bitácora.
  - `erp_attendance_days` da el estado de cada día: a tiempo, retardo,
    falta, falta por llegar tarde, justificado, aún no llega o sin horario.
- Pantallas:
  - `/staff/asistencia` "Mi asistencia" (todos): aviso, botón grande de
    entrada/salida con la cámara de frente, y cómo va el mes.
  - `/staff/asistencia/reporte` (admin): resumen por empleado, días con
    selfies, justificar, registro a mano, y ajustes y WiFi.
  - Empleados → ficha → "Horario".
- Pruebas: 47 en `asist_test.mjs` (PGlite) y en el navegador con el servidor
  falso: aviso, entrada, falta por llegar tarde y reporte. El servidor falso
  guarda la foto como multipart, así que ahí no se ve la miniatura; en
  Supabase real sí.

**Falta:**
- Que el dueño dé Run a `erp_asistencia.sql`.
- Que registre el WiFi estando en el muro y le ponga horario a cada quien.
- Que revise el texto del aviso (es un BORRADOR).
- Verificar en vivo que la IP que llega sea la del celular.

- Ajuste (mismo día): todo usuario con rol staff es empleado. `erp_ensure_employee`
  liga al usuario con una ficha sin usuario que tenga su correo o su nombre, o le
  crea una. Esto pasa al correr el SQL (para el staff de hoy), con un trigger en
  profiles (altas nuevas) y al abrir Mi asistencia. Los admins no se vuelven
  empleados. Pruebas: 52 en `asist_test.mjs`. Hay que volver a correr
  erp_asistencia.sql completo (es idempotente).

## 2026-10-26 — Recepción con reconocimiento facial

**Pedido del dueño:** no quiere que el cliente busque su QR cada vez. Va a
comprar una laptop con webcam para recepción.
- Cliente nuevo: escanea un QR, crea su cuenta, llena sus datos y firma
  responsiva, reglamento y aviso de privacidad. Luego se le toma la foto con
  la webcam y se le hace la primera venta.
- Cliente que ya vino: se asoma a la cámara y sale su perfil, con su
  membresía activa o inactiva; si no tiene, se le cobra.
- Vender: una columna con quién ya entró o compró hoy.

**Hecho:**
- `src/supabase/erp_recepcion.sql` (después de erp_crm.sql):
  - Documento `privacidad`, BORRADOR, con consentimiento biométrico.
  - Tabla `person_faces`: descriptor de 128 números; solo el staff lo lee
    por RPC.
  - `get_my_registration` / `save_my_registration`: datos, emergencia y
    tutor si es menor.
  - `staff_save_face`: exige firma del aviso.
  - También: `staff_delete_face`, `get_face_index`, `get_face_status`,
    `get_reception_pending` (nuevos de 3 días sin cara) y
    `get_today_people`.
- `@vladmandic/face-api` corre en el navegador.
  - Los modelos están en `public/models/face` (13 MB) y la librería en un
    chunk aparte.
  - El escaneo usa el detector chico (~40 ms por cuadro). El registro usa
    SSD, promedia 3 cuadros y avisa si la cara se parece a otra ya
    registrada.
  - Umbral: distancia 0.5, con 2 cuadros seguidos.
- Pantallas:
  - `/registro` (público, 3 pasos). Si la compu tiene sesión de staff, no
    deja registrar.
  - Acceso rediseñado: webcam, perfil en vista previa (Dar entrada /
    Cobrar / No es esta persona), "+ Cliente nuevo" con el QR a /registro,
    "Nuevos sin foto" con Tomar foto, y "Registrar su cara" para clientes
    viejos.
  - Vender: "Hoy en el muro" y "Dar entrada" después de cobrar.
- Pruebas: 28 en `recep_test.mjs` y en el navegador con el servidor falso
  (registro completo, pendientes, perfil, cobrar, entrada, lista de hoy, y
  modelos cargando y comparando). La cámara real no se probó: la prueba el
  dueño en la laptop.

**Ojo:** el aviso es obligatorio. Si en Acceso está prendido "Pide
responsiva firmada", a los clientes que no lo han firmado se les niega la
entrada hasta que lo firmen.

## 2026-10-26 — Inventario: revisión y mejoras tomando como referencia EVO

**Revisión:**
- Ya existía y funciona (pruebas de finanzas): la venta descuenta, anular
  regresa, y hay entrada (con egreso), conteo y salida (consumo/merma).
- Los productos se creaban solo en Configuración.

**EVO (visto en vivo, solo lectura):**
- Ficha del producto: precio de venta y compra, cantidad actual y mínima,
  comisión, "para consumo / para venta" y "permite ventas sin stock".
- Entrada/salida por producto con fecha.
- "Reajuste de valores" en bloque ($ o %).
- El reporte de Productos es de EVO Pro, que Jaibamuro no tiene.

**Hecho:**
- `src/supabase/erp_inventario.sql` (después de erp_finanzas.sql):
  - Productos: `category` y `for_sale`. Los de solo consumo no salen en
    Vender.
  - Movimientos: tipo `waste` (merma) aparte del ajuste por conteo, más
    `occurred_on` (fecha del movimiento) y `batch_id`.
  - RPCs: `admin_set_product_extras`, `stock_out_v2`, `stock_entry_batch`
    (varios productos y un solo egreso; valida todo antes de mover),
    `get_stock_report` (rango, tipo y producto, con totales; costo solo
    admin) y `admin_bulk_reprice` (%, $ o fijo, redondeo a peso, bitácora
    con precios anteriores).
  - `get_inventory` y `get_stock_movements` redefinidas.
- Inventario rehecho:
  - Botones: "+ Producto", "+ Entrada de pedido", "Reajustar precios".
  - Búsqueda, filtro por categoría y lista agrupada.
  - Salida con merma o consumo y fecha.
  - Pestaña Movimientos con totales y CSV.
- Configuración → Productos: categoría y "solo consumo interno".
- Vender oculta los productos de solo consumo.
- Pruebas: 34 en `inv_test.mjs`, más las de finanzas, y en el navegador con
  el servidor falso (crear, pedido con egreso, merma, venta, movimientos y
  reajuste).

**No se hizo (platicar):** comisión por producto para el staff (EVO la
tiene; en Jaibamuro está en 0).

## 2026-10-26 — Productos de EVO dados de alta

- El dueño no quiere comisión por producto.
- Se leyeron en vivo de EVO (Administrativo → Productos, en la página
  evo3.w12app.com.br/Administrativo/Produtos/Produtos, solo lectura) los 15
  productos activos: precio, costo, existencia y "vende sin stock".
- `src/supabase/erp_productos_evo.sql`: los crea con sku `EVO-<id>`,
  categoría (Bebidas, Snacks, Magnesia) y la existencia de ese día como
  "Existencia inicial". Es idempotente y funciona antes o después de
  erp_inventario.sql (probado en PGlite).
- Cerveza (−37) y Refresco (−2) estaban en negativo y sin costo en EVO:
  entran en 0, permitiendo vender sin existencia, para que el dueño los
  cuente. Gomitas también vendía sin stock en EVO.

## 2026-10-26 — Vender por grupos, servicios y clases semanales

**Pedido del dueño:**
- La Membresía trimestral ya no existe.
- Vender por subgrupos (Barritas, Magnesias, Bebidas).
- Un grupo SERVICIOS con Pase diario, Clase introductoria, Renta de gatas,
  Renta de magnesia y Membresía mensual.
- Clases semanales de escalada y calistenia a $300; con membresía activa
  $100 o la clase gratis del mes.
- Productos y planes ordenado en productos y servicios, con búsqueda.

**EVO:** Administrativo → Servicios: Renta de gatas $30, Renta de
magnesiera $20 (Pase diario $120, Clase introductoria $200, igual que aquí).

**Hecho:**
- `src/supabase/erp_vender_grupos.sql` se corre AL FINAL: redefine
  `create_sale` y `class_free_used`.
  - Catálogo: desactiva la trimestral; crea las rentas y "Clase de escalada"
    y "Clase de calistenia" (ligadas a los tipos Escalada Jueves y
    Calistenia, $300 y $100 miembro); asigna categorías.
  - `sale_items.class_tier`, más `get_class_pricing(persona)` (si es miembro,
    clases gratis que le quedan y precio de miembro).
  - `create_sale` acepta `class_tier` member o free_monthly. Valida que tenga
    membresía (o que la compre en la misma venta) y que le quede clase
    gratis. La descripción lleva "(precio miembro)" o "(clase gratis del
    mes)".
  - `class_free_used` cuenta también las clases gratis vendidas en mostrador:
    la de mostrador y la reservada en línea comparten el límite de 1 al mes,
    y anular la venta la devuelve.
- Vender:
  - Mosaicos por grupo (Servicios y Clases semanales primero), con "← Todos"
    para regresar; lo que no tiene grupo va suelto.
  - En la cuenta, las clases tienen botones Miembro, Clase gratis del mes y
    Normal.
- Configuración: "Productos y servicios" con pestañas, subgrupos por
  categoría, búsqueda, "Ver inactivos" y campo "Grupo en Vender" para todos
  los tipos.
- `erp_productos_evo.sql` ya usa las categorías Barritas y Magnesias, con
  Gomitas suelta.
- Pruebas: 26 en `grupos_test.mjs` y en el navegador con el servidor falso.

**No se hizo:** la clase vendida en mostrador no aparta lugar en la sesión
de la semana (la reserva sigue en Clases).

## 2026-10-27 — Correo de "caja sin corte" apagado

- El dueño recibió correos de "caja sin corte" sin estar usando la app.
- `src/supabase/erp_caja_correo.sql` (después de erp_caja_cierre.sql):
  - Agrega `erp_settings.cash_alert_email`, por defecto false.
    `cash_alerts_to_email` no entrega avisos si está apagado; la caja se
    sigue cerrando sola.
  - `get_cash_alert_email` / `admin_set_cash_alert_email`: al prenderlo
    marca como enviadas las cajas viejas, para que no lleguen de golpe.
- Ajustes generales tiene la casilla "Mandarme un correo cuando una caja se
  cierre sola sin corte". El aviso dentro de la app no cambia.
- Pruebas: 86 en `caja_correo_test.mjs`.

## 2026-10-28 — Secciones del staff y ajustes del turno

**Pedido del dueño:**
- Mientras no todo está al 100, el staff solo ve Inicio, Turno de hoy, Mi
  asistencia, Muro, QRs y Spraywall; las demás se activan poco a poco.
- En Turno de hoy, la bitácora del turno anterior solo muestra lo escrito,
  no lo que no se hizo.
- Al checar en Mi asistencia se marca el "Llegué".
- Los turnos de lunes a viernes empiezan a las 3:30 pm.
- Barrer todo diario; trapear recepción lunes y jueves, y colchoneta y área
  azul (área de entrenamiento) martes y viernes.

**Hecho:**
- `src/supabase/erp_staff_secciones.sql`:
  - `erp_settings.staff_sections`, con las 6 secciones por defecto.
  - `admin_set_staff_sections` (limpia duplicados y valores raros; bitácora).
- `src/lib/staffSections.ts`: catálogo de secciones por ruta, `sectionOf`,
  `useStaffSections` (cache compartido) y `useCanSee`. Si la columna no
  existe, usa la lista por defecto.
- StaffLayout:
  - El staff solo ve en el menú las secciones activas.
  - Una ruta de sección apagada (o solo de admin) muestra "Esta sección
    todavía no está activa".
  - `useProfile` ahora devuelve `loaded`, para no mostrar nada mientras
    carga.
- Inicio: los botones a secciones apagadas se ocultan y los renglones se
  muestran sin link.
- Empleados: tarjeta "Secciones que ve el staff" con casillas.
- `src/supabase/erp_turno_ajustes.sql`:
  - Bloques de lunes a viernes de 3:30 a 5:00. Solo cambian los que seguían
    con la hora original, también en los días abiertos ya generados. La
    regla del texto dice "entrada 3:30 pm".
  - Trigger AFTER INSERT en `attendance_punches`: una entrada marca el
    "Llegué" del día, con la nota "Desde Mi asistencia". Nunca bloquea la
    asistencia.
  - Barrido y trapeado por día, como pidió el dueño.
- ChecklistPage: el turno anterior ya no muestra "No se hizo" ni "no se
  cerró", y si no hay nada escrito no sale la tarjeta.
- Pruebas: `secciones_test.mjs` (5), `turno_test.mjs` (14) y
  `checklist_test.mjs` siguen OK. También en el navegador con el servidor
  falso (staff y admin).

**Nota:** es un filtro del panel; las funciones de la base siguen
permitiendo al staff lo de antes.

## 2026-10-28 — Horario fácil de copiar, nómina por día y boulder primero

**Pedido del dueño:**
- En el horario de empleados no se puede copiar y pegar.
- Puso "Quincenal $320" a Erick, pero los $320 son por día.
- En el checklist, el Área de boulder va justo después de la Llegada.

**Hecho:**
- Horario: cada día tiene la casilla "trabaja" y el botón "Copiar a los
  demás" (copia a los días que trabaja; si no hay otro, de lunes a viernes),
  más "Copiar el horario de…" otro empleado.
- `src/supabase/erp_nomina.sql`:
  - `pay_scheme` acepta `daily` y hay columna nueva `pay_every` (semana,
    quincena o mes). El sueldo fijo sigue como weekly/biweekly/monthly.
  - Corrige a Erick: daily y biweekly.
  - `admin_set_employee_pay_every` y `get_payroll_suggestion`: días con
    horario, días que vino (Mi asistencia), horas, retardos y faltas, más el
    monto sugerido (por día: días que vino, o días del horario si aún no
    checa; por hora: horas; fijo: sueldo; por clase o trabajo: manual).
- Ficha del empleado:
  - "Cómo se calcula su pago", la tarifa y "Se le paga". La lista muestra
    "Por día $320 · cada quincena".
  - Registrar pago: periodo según la frecuencia (con flechas), desglose,
    monto y concepto prellenados y editables.
- `erp_turno_ajustes.sql`: Área de boulder en la posición 15:
  - Llegada 3:30, Boulder 3:35, Pisos 3:45, Baños 4:10, Tarea 4:30 y
    Preparar 4:50.
  - Funciona desde el horario original o desde la primera versión de este
    archivo.
- Pruebas: `nomina_test.mjs` (7) y `turno_test.mjs` (17), más el navegador
  con el servidor falso (copiar horario y la sugerencia de $3,520 para el
  16–31 oct).

### 2026-10-28 — La plantilla del checklist actualiza el turno de hoy; Mi cuenta reordenada

- `erp_checklist_sync.sql` (correr después de `erp_checklist.sql`):
  - Nueva `erp_checklist_resync(fecha)`. Al guardar la plantilla
    (`admin_save_checklist_template`, redefinida) se ponen al día los días
    abiertos ya generados, de hoy en adelante.
  - Lo nuevo se agrega y lo editado se actualiza sin perder lo marcado.
  - Lo quitado se borra solo si nadie lo marcó. Los días cerrados no cambian.
- Plantilla: el texto ahora explica que hoy se actualiza solo.
- Mi cuenta (cliente): primero Tu alias, luego Puntos, Últimas rutas y
  Spraywall, y la membresía hasta abajo.
- Pruebas: `sync_test.mjs` (9), y `turno_test` y `checklist_test` siguen OK.

### 2026-10-28 — Un escaneo vale 30 min para cualquier ruta

- `sends_ventana_scan.sql`: `submit_send` acepta un escaneo de cualquier
  ruta en los últimos 30 min. Antes tenía que ser un escaneo de esa misma ruta.
  - Parcha la versión de producción con `pg_get_functiondef` y solo quita
    `route_id = p_route_id`. Se puede correr más de una vez.
  - `schema.sql` quedó actualizado igual.
- SendButton: el aviso explica la ventana de 30 min.
- Prueba: `scan_test.mjs`:
  - Antes del parche, otra ruta daba `no_recent_scan`.
  - Después, otra ruta da `success`.
  - Un escaneo de hace 31 min sigue pidiendo escanear.
- `/q/:qrId` tiene el botón "📷 Escanear otra ruta":
  - Abre `RouteQrScanner`, que lee el QR de cualquier ruta y lleva a su `/q/`.
  - Esa página registra el escaneo como siempre.
  - La página se monta con `key={qrId}` para empezar limpia en cada ruta.
  - Revisado en local con `fake_qr.mjs`: el botón se ve y el escáner abre. La cámara real queda por probar en el celular.

### 2026-10-28 — Erick duplicado; una sola ficha por persona

- Asistencia mostraba dos fichas de Erick:
  - La que Inge dio de alta tenía horario y su pago de $320 por día.
  - La que se creó sola al darle acceso al panel tenía su usuario.
- `erp_empleados_unicos.sql` (correr después de crm/asistencia/nómina):
  - `erp_merge_employees(queda, se_va)` pasa a la ficha que queda las
    checadas, el aviso firmado, las justificaciones, los archivos, el usuario
    y los datos que le falten. Luego borra la otra.
  - El bloque de Erick deja la ficha con horario. Si ya hay una sola, no hace nada.
  - Índice único: un usuario del panel solo puede estar en una ficha.
  - `admin_save_employee`:
    - Si el usuario ya tiene ficha, se guarda en ella. Es el caso de
      "Nuevo empleado" con acceso: el usuario se crea primero y su ficha
      sale sola.
    - Si se liga un usuario que ya estaba en otra ficha, las une.
    - Una ficha nueva con el nombre o correo de una activa da
      `employee_exists`.
  - `erp_ensure_employee`: el usuario "Erick" se liga a la ficha
    "Erick Heli…" si es la única que empieza así.
- Pruebas: `unicos_test.mjs` (10). `asist_test` y `nomina_test` pasan con el
  archivo cargado.
- En producción las dos fichas de Erick tenían el MISMO usuario. El freno pedía
  que solo una tuviera usuario y frenó el Run. Ahora solo frena si son usuarios
  distintos. La prueba reproduce el caso real.

## 2026-10-30 — Conteo de puntos de la competencia (jueces con celular)
- Reglas definidas por el dueño con el armador:
  - Top 10, zona 4, cada intento que no es top resta 0.01, aunque no saque
    nada en la ruta. Los tres valores se cambian en Ajustes.
  - Cada categoría tiene su lista de rutas (pueden encimarse). Se pueden
    juntar categorías (ej. Básico mixto).
  - Bloques por categoría, sin final, premios 1º a 3º.
  - Subir a alguien de categoría lo deja en cero: cada intento guarda la
    categoría que tenía la persona y solo cuentan los de la actual.
  - Desempate: puntos → más tops → más flashes → la ruta más difícil
    encadenada (número más alto) → quien hizo antes su último intento →
    lugar compartido.
- `src/supabase/competencia_jueces.sql` (falta Run en producción):
  - Número de competidor (`bib`), asignado solo al quedar pagado, incluidas
    las inscripciones del mismo día. Los pagados de antes reciben número por
    orden de pago.
  - Jueces con código (`competition_judges`), sin contraseña.
  - `competition_attempts`: un intento por renglón. Los errores se anulan,
    no se borran. `client_id` evita duplicados si se corta la señal.
  - Ranking calculado en `competition_ranking`.
  - `get_competition_ranking_public` deja el ranking listo para la TV.
    Solo responde si se activa "Ranking visible" en Ajustes.
  - Aviso para reubicar, provisional mientras llega la fórmula del armador:
    flash o top en todas las rutas de la categoría, o flash en el 80 %.
- `/juez`: el juez escribe su código y captura número de competidor →
  ruta → Top / Zona / No completó. Avisa si la ruta no es de la categoría o
  si ya tenía top. Puede deshacer lo suyo en los primeros 30 min. Si no hay
  señal, ofrece "Reintentar" sin duplicar.
- `/staff/competencia/puntos` tiene cinco pestañas:
  - Ranking por categoría con detalle por ruta, cambiar de categoría,
    cambiar número y CSV.
  - Intentos: anular o capturar a mano.
  - Rutas por categoría.
  - Jueces.
  - Ajustes.
- Pruebas locales con PGlite (puntos, desempates, reubicación, juntar
  categorías, duplicados) y en el navegador con un Supabase falso.
- Ajustes del dueño (mismo día, antes del Run):
  - Desempate: puntos → más tops → más flashes → más zonas → quien
    consiguió antes sus últimos puntos (`achieved_at`: primer top de la
    ruta, o primera zona si no hizo top; cuenta el más reciente). Se quitó
    "la ruta más difícil" porque no se sabe con certeza cuál es más difícil.
  - Números: por categoría (en su orden) y luego alfabético, sin que los
    acentos cambien el orden. Botón "Numerar por categoría y nombre" en
    Ranking; se niega si ya hay intentos. Los del mismo día reciben el
    siguiente número.
  - Jueces: el admin les da una palabra (ej. TIBURON) desde antes. No
    importan mayúsculas, espacios ni acentos.

## 2026-11-03 — Competencia: horarios que mezclan categorías
- Cambio del dueño: ya no hay horarios por categoría. Tres bloques de 2 h
  con categorías mezcladas: 10:00–12:00, 12:30–2:30 y 3:00–5:00.
  Clausura y premiación 5:30–6:00.
- Decisiones del dueño:
  - Cupo de 15 por bloque. Cuando los tres se llenan, todos suben 5 solos
    (15 → 20 → 25…). Se cambia en el panel (Horarios → Cupo).
  - Los que ya estaban inscritos reciben un correo con un link para elegir.
  - Ya elegido, solo el staff lo cambia.
- `src/supabase/competencia_horarios.sql`:
  - Tabla `competition_time_slots` con los tres bloques.
  - `time_slot_id` y `slot_invite_sent_at` en las inscripciones.
  - `slot_capacity` y `slot_capacity_step` en la competencia.
  - Las RPC nuevas envuelven a las viejas en la misma transacción y no
    las modifican: `register_for_competition_slot`,
    `competition_register_courtesy_slot`, `competition_choose_slot`,
    `get_registration_slot` y `admin_set_registration_slot` (el staff
    puede pasarse del cupo; queda avisado).
  - Si un bloque está lleno no se crea nada y el código de cortesía no se
    gasta.
- Edge Function `competition-payments`:
  - Acción `slot_invite` (solo admin): correo "Elige tu horario". Cada
    inscripción se marca al enviarse, así un doble clic no repite correos.
  - Las cortesías reciben `time_slot_id`.
  - El correo de confirmación muestra el horario; si no tiene, invita a
    elegirlo.
  - Los links del correo ya llevan folio y correo (`?folio=&email=`).
- Pantallas:
  - /competencia: elegir horario en el formulario (los llenos salen como
    "lleno").
  - /competencia/consulta: tarjeta para elegir horario si no tiene.
  - Panel: bloques con su ocupación, filtro por horario, columna en el CSV,
    botón "Horario" en cada inscripción y en la inscripción manual.
  - Sin el SQL corrido, todo funciona como antes.
- Pruebas: 32 con PGlite (cupo que sube, vencidos liberan lugar, cortesía,
  staff sobre cupo, invitaciones sin repetir). También se probó en el
  navegador con un Supabase falso: inscribir, elegir desde el link y
  asignar en el panel.
- 2026-11-03 (tarde): el dueño corrió el SQL y desplegó la función. Se
  mandaron 31 correos "Elige tu horario" desde el panel, sin errores. El
  contador del panel decía 35 porque contaba pendientes vencidos (a ellos
  no se les manda). Ya está corregido en `competencia_horarios.sql`; solo
  cambia el número que se muestra y entra en el siguiente Run.
- Revisión en producción: de los SQL desde el 23-oct solo faltaba
  `competencia_jueces.sql`. Quedó pegado para Run.

## 2026-11-03 — TV: rutas por categoría para la competencia

- Del 3 al 7 de noviembre (inclusive, hora de México) `/leaderboard/display` ya no muestra el leaderboard ni slides: muestra solo las rutas de cada categoría (Básico / Intermedio / Avanzado × Femenil / Varonil), con los horarios de los bloques arriba.
- Los números están en `src/lib/competitionDisplay.ts`. **Ahora son de ejemplo** (aleatorios 1–30); el viernes el dueño da los reales y se cambian ahí (solo push, sin SQL).
- El 8 de noviembre a las 00:00 la TV regresa sola al leaderboard. Después se puede borrar el archivo y su uso.
- Verificado: `competencia_jueces.sql` ya está corrido en producción (`jueces_corrido = true`, 28 con número).

## 2026-11-04 — Competencia: inscritos por categoría en el panel

- /staff/competencia tiene, debajo de los contadores, un cuadro "Por categoría": una tarjeta por categoría con los inscritos (pagados + pendientes con lugar + por atender) y el desglose.
- Tocar una tarjeta filtra la lista por esa categoría; tocarla otra vez quita el filtro.
- Si la categoría tiene cupo propio, se muestra "N / cupo".
- Solo frontend; sin SQL.

## 2026-11-04 — Competencia: rifa de premios

- Reglas y lista de premios: `docs/competencia-rifa.md`.
- `src/supabase/competencia_rifa.sql`:
  - Tabla `competition_raffle_prizes` (13 premios sembrados) y columna `raffle_excluded`.
  - Funciones: boletos, tómbola, panel, sortear, deshacer, editar premios y excluir.
  - Un premio por persona: índice único sobre el ganador.
- Pantalla `/staff/competencia/rifa` con pantalla completa para anunciar al ganador.
- SQL pegado en el SQL Editor junto con el arreglo del contador `invite_pending` (0990eb4). Falta el Run del dueño.

## 2026-11-04 — Competencia: nuevas reglas de puntuación (acordadas, sin programar)

- La logística cambió: 3 horarios de 20 personas, 24 bloques para todos y la categoría final se decide por resultados.
- Reglas acordadas en `docs/competencia-reglas.md`:
  - Valor del bloque de 1 a 24; zona = mitad.
  - Cuentan los 5 bloques que más puntos den; −0.01 por intento.
  - Top cerrado.
  - Se sube o se baja según el top más difícil.
  - Desempates.
  - Todas las zonas dan boleto para la rifa.
- Pendiente: visto bueno del armador y programarlo.

## 2026-11-04 — Competencia: reglas por bloques programadas

- Archivo `src/supabase/competencia_bloques.sql`, que se corre después de jueces y rifa:
  - Tabla `competition_blocks` y columnas `count_best`, `zone_ratio` y `level_override`.
  - Vuelve a escribir `competition_route_results` y `competition_ranking`; el modo anterior se queda igual si no hay bloques.
  - `judge_record_attempt`: con un bloque que ya tiene top da `already_topped_final`, y un número que no es bloque da `not_a_block`.
  - Funciones nuevas: `admin_set_blocks` y `admin_set_level_override`.
  - La tarjeta del juez ya no muestra puntos.
  - La rifa cuenta todas las zonas.
- Pantallas:
  - Pestaña "Bloques" en Puntos (editor del orden de dificultad).
  - Ranking con categoría final, nivel a mano y desempates nuevos.
  - Ajustes de bloques.
  - El juez ve 24 bloques y los que ya tienen top quedan bloqueados.
- TV: ya no muestra rutas por categoría (son secretas). Ahora muestra 24 bloques, horarios y cómo se juega.
- Probado: PGlite (31 OK, la rifa sigue OK) y las pantallas con un servidor falso.
- El SQL quedó pegado en la misma pestaña del SQL Editor que la rifa. Falta el Run del dueño. Resultado esperado: `premios_rifa = 13` y `bloques_listo = 1`.
- El día de la competencia, el admin escribe el orden de los 24 bloques en Puntos → Bloques.

## 2026-11-05 — Puntos y Rifa: no se podía hacer scroll

- El dueño corrió el SQL de la rifa y de bloques (2026-11-05).
- Bug: en /staff/competencia/puntos (y en /rifa) la rueda del mouse no movía la página.
- Causa: el marco de staff tiene `overflow-hidden`, así que cada página debe traer su propio `h-full overflow-y-auto`. Estas dos no lo tenían.
- Arreglo: se envolvieron las dos en `h-full overflow-y-auto bg-fondo`, igual que las demás páginas de staff.

## 2026-11-05 — Ruleta de la rifa en la TV + boletos extra

- Detalle en `docs/competencia-rifa.md` → "Ruleta en la TV y boletos extra".
- SQL nuevo: `src/supabase/competencia_ruleta.sql` (falta Run del dueño). `competencia_bloques.sql` ya no pisa los boletos extra si se vuelve a correr.
- Pantalla nueva `/competencia/ruleta`; la TV la muestra sola del 5 al 7 de noviembre (el dueño la pidió "desde ya").
- La TV ahora se actualiza sola con cada versión nueva (`useAutoUpdate`). Hay que recargarla una vez para que tome este cambio.
- Corregido: la TV decía "Viernes 7 de noviembre" y la competencia es el sábado 7.
- En el panel de Rifa ya no sale la pantalla completa con los nombres al sortear: el anuncio es en la ruleta. Hay botón "Abrir ruleta".
- (más tarde) Botón "Ruleta neutral" en la Rifa y arreglo de la diferencia de boletos entre el centro y la derecha. `competencia_ruleta.sql` actualizado (hay que volver a correrlo: se puede correr más de una vez).

## 2026-11-05 — Check-in con firma de documentos

- Detalle en `docs/competencia-checkin.md`. El competidor firma en su celular con su primer nombre y el número que le da recepción.
- SQL nuevo: `src/supabase/competencia_checkin.sql` (falta Run). También quita los números de la ruleta pública (`competencia_ruleta.sql` actualizado igual).
- Faltan los textos de los documentos: el dueño los va a pasar y se cargan en /staff/competencia/checkin → Documentos.

## 2026-11-06 — Limpieza final antes de la competencia

- SQL del check-in corrido en producción (`competition_checkin_start` responde).
- Anulados los 27 intentos de prueba de los jueces (motivo "Limpieza de pruebas antes de la competencia"). Ranking en 0, ruleta vacía, sin sorteos, sin boletos extra, sin check-ins.
- Leaderboard 21–31 oct (dinámica de boletos extra), sacado con `get_leaderboard_for_range` igual que la TV: Agustin Sanchez 71, adan 70, Adrián Méndez 62, Heli canet 45, Matias Santos 38, Jose Carlos 34, Luis Fco 31, Gris R 23, Julien (El rey) 19, Jeringas 7. Solo 10 personas sumaron en ese rango. Julien y Jeringas no compiten. Se dio +1 boleto extra a los otros 8, ya ligados a su inscripción: #12 Agustin, #29 Adán, #14 Edgar Adrian, #34 Erick (Heli canet), #19 Matias, #18 Jose Carlos, #10 Luis Francisco, #3 Grisel.
- Puntos → Intentos: los anulados se esconden (botón "Ver anulados (n)"). No cuentan para nada; se guardan como respaldo.
- Jueces sin puntos: la tarjeta del juez (`competition_competitor_card` en `competencia_bloques.sql`) ya no regresa puntos nunca, y /juez ya no los pinta. Siguen viendo TOP / ZONA / intentos por ruta (lo necesitan para capturar). Requiere Run de esa función.
- El dueño pidió BORRAR (no esconder) los intentos de prueba: `DELETE` de todos los intentos de competencia-2026 incluido en el SQL que se le pegó.
- Primera zona sin castigo: si el bloque se queda en zona, la primera zona no resta 0.01 (zona en el bloque 1 = 0.5). Zonas repetidas y caídas sí restan; con top se castiga todo como antes. Cambio en `competition_route_results` (`competencia_bloques.sql`). Probado en PGlite (bloques_test, TODO OK con 4 casos nuevos). Reglas en `docs/competencia-reglas.md`.
- Documentos del check-in cargados en producción, en este orden: (1) Reglamento General de Uso, (2) Reglas y condiciones de la competencia JAM 2026 (nuevo, redactado por Claude: número, horario, formato, jueces, categoría final, conducta, salud, rifa, imagen, menores) y (3) Carta Responsiva. El 1 y el 3 vienen tal cual de EVO. Se editan en /staff/competencia/checkin → Documentos.
- El dueño corrió el SQL: se borraron los intentos, aplica la regla de la primera zona y el juez ya no ve puntos.
- Números #52–#61 asignados a mano (admin_set_bib) a los 10 "pendiente de pago" con reserva vigente, que pagan en efectivo el día del evento. Al marcarlos pagados conservan su número (el trigger solo numera si bib es NULL). OJO: el check-in y el juez solo aceptan inscripciones pagadas, así que primero se marcan pagados en recepción. Sin número: jeronimo mancilla y Diego Ponce (su reserva ya venció) y 3 expirados.
- Prueba de check-in de Frida (#2): sus 3 firmas y su check-in quedaron borrados (Run hecho y verificado).
- Página pública `/competencia/reglamento` ("¿Cómo se gana?", `CompetitionRulesPage.tsx`): puntuación explicada fácil con ejemplos, categoría final, desempates, jueces y rifa. No revela el orden de los bloques. Ligada desde /competencia ("Cómo se gana") y desde la pantalla verde del check-in (en pestaña nueva, para no perder la pantalla). Si cambian las reglas, actualizar esta página también.
- Pendientes de pago CON número cuentan como inscritos: `competencia_pendientes.sql` (nuevo, requiere Run) agrega `competition_in_event(status, bib)` y redefine check-in, juez, captura del admin, ranking, bolsa de la rifa y paneles con ese único cambio. El dueño los marca pagados después, cuando quiera (solo él sabe hacerlo). En el panel de check-in salen con la etiqueta "Paga en efectivo". Probado en PGlite (pendientes_test, 12 OK), y siguen OK checkin, bloques y ruleta. OJO: si alguien con número nunca paga, sigue contando; quitarle el número (admin_set_bib NULL) lo saca.
- Simulación de empates y zonas difíciles (PGlite, `sim.mjs` + `sim1.json`/`sim2.json` en el scratchpad de pg). Dos bugs arreglados (requieren Run): (1) un bloque de puras caídas restaba puntos si la persona tenía menos de 5 bloques con puntos; ahora vale 0; (2) en el desempate por 6º bloque, un bloque de puras caídas ganaba contra no intentarlo; ahora solo cuentan bloques con puntos. Pendiente de decisión del dueño: las zonas en bloques de nivel más alto no cambian la categoría, así que en básico una zona avanzada (zona en 24 = 12) gana fácil (básico perfecto = 30; puras zonas avanzadas = 55). DECIDIDO por el dueño: las zonas solo suman si el bloque es de su nivel o de uno más fácil (en `competition_ranking` y en `get_competition_scoring_admin`; regenerado `competencia_pendientes.sql`). Simulación (sim3.json): el básico perfecto vuelve a ganar básico. Página de reglas actualizada.
- `/staff/competencia/imprimir` (`CompetitionPrintPage.tsx`, nuevo): se marca qué imprimir. Opciones: carteles con QR (check-in, "¿Cómo se califica?", jueces), lista de recepción A–Z con casillas de check-in y playera, lista por horario, hojas de respaldo para jueces y números para el pecho (2 por hoja). Usa los datos al momento. Ligada desde Inscripciones y Check-in.
- Arreglo de impresión: `index.css` escondía `#root` en TODA impresión (por la hoja de QRs de rutas), así que imprimir desde cualquier otra página salía en blanco, incluido "Ver firmas". Ahora solo se esconde si existe `#qr-print-sheet` o `#comp-print-sheet` (`body:has`).
- Faltan los textos de los documentos del check-in.

## 2026-11-08 — Página de resultados de la competencia
- Nueva página pública `/competencia/resultados` (`CompetitionResultsPage.tsx`): ranking final por categoría (lugar, nombre, número, tops, zonas, puntos) con buscador. Solo LEE `get_competition_ranking_public` (mismo cálculo que Puntos); no cambia datos ni hay SQL nuevo.
- Se publica sola cuando el admin prende "Ranking visible sin sesión" en Puntos → Ajustes y da Guardar. Mientras esté apagado, el público ve "se publican muy pronto" y el admin con sesión ve una vista previa con aviso.
- Verificado antes del push: las 64 personas, lugares y puntos coinciden con el ranking del staff; sin sesión responde `hidden`.
- Quien no escaló (0 puntos, sin tops ni zonas) no aparece en resultados (Lilia, Rafa, Vicente).
- Correcciones del día: Regina Valle #62 (número a mano, pendiente de pago), top equivocado de Adán en el bloque 3 anulado (SQL corrido por el dueño).

### 2026-11-10 — Cerrar inscripciones de la competencia (ya pasó)

- Inge: desactivar la inscripción para que nadie pague por error.
- Hueco encontrado: `competition_begin_payment` no revisaba `is_open`, así que un folio pendiente podía seguir sacando (o reusando) un link de Clip desde /competencia/consulta aunque la página dijera "Inscripciones cerradas".
- Arreglo: si la competencia está cerrada, regresa `closed` antes de crear o reusar el link (`src/supabase/competencia_cierre.sql`, también en `competencia_pagos.sql`); mensaje nuevo en `PAYMENT_ERRORS`.
- Cierre: interruptor "Inscripciones abiertas" del panel /staff/competencia → apagado. Eso también detiene los recordatorios de pago (el cron filtra `c.is_open`).
- Un link de Clip que alguien ya tuviera abierto sigue siendo pagable en Clip hasta que venza; si entra un pago así, sale en el panel y se reembolsa.
- 2026-11-10: Inge corrió `competencia_cierre.sql` en producción (Success).

### 2026-11-10 — Migración de EVO, paso 1: ventas históricas

- Inge: migrar de EVO empezando por las ventas (desde la primera) y luego los gastos.
- Fuente: EVO → Gestión/Reportes → Ventas → Ventas detalladas → Exportar, del 01/01/2024 a hoy. Tipo = Plan, Plan adicional fijo, Producto y Servicio (con "adicional opcional" o "secundario" sale vacío). Ventas manuales, en línea, cobro recurrente y cambio de plan. El reporte vive en un iframe de evo3 que no se puede leer: se exporta en el Chrome de la laptop y Inge sube el Excel al chat.
- Contenido (al 9-nov-2026): 2,101 renglones, 1,182 ventas, 27-oct-2025 → 9-nov-2026, $201,046 (igual al "Total general" de EVO), 450 personas de EVO.
- `scripts/evo_ventas_sql.py <Vendas.xlsx> <salida.sql>` genera el SQL. **La salida trae nombres de clientes: se genera fuera del repo y no se sube a git.**
  - Agrega `people.evo_id` y `sales.evo_sale_id` (únicos) y `source = 'evo'` en sales. Idempotente: se puede volver a correr con un Excel más nuevo.
  - Personas: por `evo_id`; si no, por nombre igual (sin acentos ni mayúsculas) cuando hay exactamente una; si no, ficha nueva (`source = 'evo'`). "VENTAS GENERAL PRODUCTOS" queda sin persona.
  - Productos: mapa de nombres de EVO → los 15 de `erp_productos_evo.sql` + servicios; Membresía Parejas y Prueba Domiciliación quedan sin producto.
  - Pagos: Efectivo → cash; crédito/débito/en línea → card (referencia dice cuál); mixto → other con nota; "Ninguno"/"Saldo deudor" → venta sin pago (7 ventas, $2,400).
  - Sin caja, sin inventario, sin membresías.
- Probado en PGlite con las tablas reales: totales por mes idénticos a EVO, segunda corrida no duplica, liga por nombre y no liga si el nombre es ambiguo.
- UI: etiqueta "Importada de EVO" en ventas y "Venía de EVO" en la ficha.
- 2026-11-10: Inge corrió el SQL en producción. Revisado en Supabase: 1,182 ventas, $201,046, igual a EVO mes por mes.

### 2026-11-11 — Fase "dejar EVO": tres frentes

Inge pidió atacar en paralelo la migración, la recepción con cámara y el cobro con la terminal Clip; si uno se atora porque él no está, pasar al siguiente.

**1. Migración EVO: detenida.** La sesión de EVO caducó en el Chrome conectado y hay que iniciarla (no capturo contraseñas). En producción hay 450 personas y solo 2 tienen correo o teléfono. Faltan: contactos (CRM 2.0 → Segmentación), membresías vigentes (las ventas importadas no crean membresías: sin esto Acceso diría "sin membresía" a quien sí pagó), los 4 domiciliados (deben volver a registrar su tarjeta) y gastos (Cuentas a pagar).

**2. Recepción con cámara: talla de gatas** (commit ada3d07).
- Revisado en producción: `person_faces` y `get_face_index` existen, 0 caras registradas.
- `src/supabase/erp_gatas.sql` (después de erp_crm.sql): `people.shoe_size` (texto ≤ 12), en `admin_save_person` (solo si viene en el JSON) y en `erp_access_decision` (`person.shoe_size`).
- Se captura en la ficha (PersonForm), sale en el Contacto de la ficha, en la tarjeta de Acceso al reconocer al cliente y en Vender al elegir a la persona.
- Pruebas PGlite: crear, editar sin el campo (no se borra), cambiar, demasiado larga, vaciar, y que Acceso la regresa. El front funciona igual sin el SQL corrido.
- **Falta Run** de `erp_gatas.sql`. Sigue pendiente probar la webcam real y revisar el aviso de privacidad (BORRADOR).

**3. Cobro con la terminal física de Clip (API de PinPad).**
- Documentación revisada en developer.clip.mx (Tarjeta Presente → API de Punto de Venta). Base `https://api.payclip.io/f2f/pinpad/v1/payment` (POST crea; GET `?pinpadRequestId=` consulta con `Pinpad-Include-Detail: true`; DELETE `/{id}` cancela si la terminal no lo ha tomado). Estados PENDING / IN_PROCESS / COMPLETED; el resultado real está en `detail.results[].status` (approved / declined / cancelled). Webhook `PINPAD_INTENT_STATUS_CHANGED` trae solo el id. No hay sandbox. Terminales: Clip PinPad, Ultra, Total 3, Stand 2, con la app PinPad instalada por Clip (correo a sdk@payclip.com con el número de serie).
- Auth: la doc pide `x-api-key` para crear y `Authorization: Basic` para consultar; la función manda ambas con base64(CLIP_API_KEY:CLIP_API_SECRET), o `CLIP_PINPAD_TOKEN` si Clip da otra llave. **Confirmar en la primera prueba real.**
- `src/supabase/erp_clip_terminal.sql`: `erp_settings.clip_terminal_enabled/serial`, tabla `terminal_payments` (RLS sin políticas), RPC `get_clip_terminal_settings`, `admin_set_clip_terminal`, `staff_link_terminal_payment`, `get_unlinked_terminal_payments`, `staff_resolve_terminal_payment`. 14 pruebas PGlite (`scratchpad/pgt/terminal.mjs`).
- Edge Function `clip-terminal` (Verify JWT apagado): devices / charge / check / cancel + webhook `?wh=<id>` que solo dispara la consulta. El renglón se escribe antes de mandar el cobro; el estado sale siempre de la API de Clip.
- Vender: forma de pago "Terminal Clip (automático)" (solo si está prendida). Al cobrar manda el monto, muestra "pide al cliente que pase su tarjeta", consulta cada 2 s (hasta 5 min) y, si se aprueba, guarda la venta como `card` con referencia "Terminal Clip · Visa ····1234" y la liga. Si la venta falla después de cobrar, o el monto no coincide, el cobro queda en "Cobros de terminal sin venta" arriba de Vender hasta resolverlo con nota.
- Config → Integraciones: número de serie, interruptor y "Probar conexión con Clip".
- **Falta:** modelo de terminal de Inge; pedir a Clip la app PinPad; Run de `erp_clip_terminal.sql`; Deploy de `clip-terminal`; primera prueba con un cobro real chico.

**Membresías de EVO (2026-11-11, misma tarde).** `scripts/evo_membresias_sql.py` toma el mismo Excel de ventas y crea un periodo en `memberships` por cada venta de membresía: desde "Inicio en" hasta +1 o +3 meses − 1 día, ligado a la persona por `evo_id`, a la venta por `evo_sale_id` y al producto por nombre. Es idempotente. Da 38 periodos y **4 personas vigentes hoy**, todas de domiciliación; una con "Saldo deudor" el 7-nov. Probado en PGlite, con una segunda corrida que no duplica. El SQL (sin nombres) quedó pegado en otra pestaña del SQL Editor; **falta Run**. Inge dice que su terminal es una "Clip Stand": la API solo lista **Stand 2**, así que hay que confirmar el modelo. La lista de pendientes del dueño está en `docs/pendientes-inge.md`.

### 2026-11-11 (noche): auditoría, clases, aviso, laptop, domiciliados de EVO y TV

- **Auditoría** (`docs/auditoria-2026-11-11.md`): capturas reales más 3 revisores con papeles distintos (recepcionista nuevo, clienta de 47 años, QA de clases). Bloqueantes para el lunes:
  - las sesiones del 11 y 12 de noviembre ya se pueden reservar;
  - hoja de inicio de sesión del leaderboard al reservar;
  - casi nadie figura como miembro;
  - duplicados por correo;
  - la reserva no pide responsiva.
- **Arreglado:**
  - `ClimberAuthSheet` tiene `purpose="classes"`: "Aparta tu lugar · Mandar código", sin alias ni TV, y abre la clase que se quería.
  - `CLASS_ERRORS.cash_closed`.
- **TV:** se quitó el código temporal (`specialPeriod.ts`, `competitionDisplay.ts`, `CompetitionRoutesDisplay`). /competencia/ruleta sigue.
- **Aviso de privacidad v2** propuesto en `docs/aviso-privacidad-propuesta.md`. Falta el nombre o razón social del responsable. Nota: hoy firmar el aviso = autorizar la cámara; convendría una casilla aparte.
- **Laptop de recepción:** `docs/recepcion-laptop.md` (perfil de Chrome, `--app`, inicio automático, energía, cámara).
- **Domiciliados de EVO:** `src/supabase/erp_evo_domiciliados.sql` (`get_evo_subscribers`) y la tarjeta "Pasar de EVO" en Domiciliaciones. Probado en PGlite con los datos reales de membresías: 5 personas en 60 días, 4 vigentes. Quedó pegado en la pestaña 2 del SQL Editor, antes de las membresías. Falta Run.

**2026-11-11 (cierre): arreglos de la auditoría que no necesitan decisión**
- Aviso de privacidad v2 con responsable **Regina Valle Gutiérrez** (persona física), en `src/supabase/erp_privacidad_v2.sql`. Apaga la v1 e inserta la v2; es idempotente y está probado en PGlite con el trigger de inmutabilidad. NO está pegado todavía: falta que Inge confirme que hola@jaibamuro.com recibe correo.
- Caja: el corte pide confirmar ("¿Cerrar la caja con $X…?") y la explicación es obligatoria si no cuadra.
- Firma: debajo del botón dice qué falta (nombre, casilla, firma).
- /registro: "Te damos la bienvenida" y la salida "¿No puedes abrir tu correo…? te registramos en recepción".
- Personas: los de EVO sin membresía dicen "Cliente de EVO", no "Prospecto". "Nuevos sin foto" (3 días) y "Personas nuevas" (7 días) se limpian solos el 13 y el 17 de noviembre; no se tocó SQL.
- Clases: "por cobrar" ya no cuenta a los que faltaron.
- Link de domiciliación: si el banco rechaza, dice "No se pudo cobrar" en rojo, no "¡Listo!", y la garantía de Openpay va arriba del formulario.

**2026-11-11 (fin de sesión):** Inge corrió los dos Run (pestaña 1: talla de gatas + terminal Clip; pestaña 2: `get_evo_subscribers` + membresías de EVO). No se verificó el resultado 0/38/4 desde aquí. Siguiente sesión, en orden:
1. Verificar en producción (solo lectura) las membresías de EVO (0/38/4), `people.shoe_size` y `terminal_payments`.
2. Login de EVO → exportar contactos y gastos.
3. Login de Namecheap → reenvío hola@ → correo de prueba. Luego Inge hace Resend + Gmail "Enviar como" y yo pego `erp_privacidad_v2.sql`.
4. Clases (arrancan el lunes 16): cancelar sesiones del 11 y 12, apagar "Pide responsiva firmada", 3 reglas, prueba de 10 pasos.
5. Terminal Clip: confirmar Stand 2 y pedir PinPad; después, Deploy de `clip-terminal`.

### 2026-11-12 — Unir duplicados, responsiva al reservar y script de contactos de EVO (sin Chrome)

Chrome no estaba conectado, así que se avanzó en lo que no lo necesita:
- **Unir fichas duplicadas** (`src/supabase/erp_unir_personas.sql`, `Duplicates.tsx`):
  - Personas → "Posibles duplicados": pares con el mismo correo o celular, el mismo nombre, o las mismas dos primeras palabras del nombre.
  - En la ficha sale "¿Es la misma persona?" si hay otra parecida.
  - Solo un admin puede unir. La unión pasa a la ficha que se queda TODO lo que apunta a la otra (busca las llaves foráneas sola), llena sus datos vacíos, junta las notas, borra la sobrante y deja registro en la bitácora.
  - Las firmas siguen inmutables; solo se les permite cambiar de persona durante una unión.
  - Probado en PGlite. **Falta Run.** Sin el Run la pantalla no truena, solo no muestra nada.
- **Clases: responsiva al reservar.** Si al cliente le falta firmar algo obligatorio, la hoja de reserva le muestra la firma ahí mismo y luego sigue con la reserva. Cierra el punto A5 de la auditoría. Es solo pantalla: Acceso sigue revisando.
- **`scripts/evo_contactos_sql.py`**: convierte la exportación de clientes y prospectos de EVO (.xlsx o .csv) en SQL.
  - Reconoce las columnas por el encabezado.
  - Liga cada contacto por número de EVO o por nombre único y SOLO llena lo vacío.
  - No repite correos: los que ya usa otra ficha salen en la revisión como posibles duplicados.
  - Crea a los prospectos que no tienen ficha. Es idempotente.
  - Probado en PGlite con un CSV inventado.
  - Aclaración: en EVO los contactos sí están completos. Lo que faltaba es Relámpago, porque las 450 fichas salieron del reporte de ventas, que solo trae el nombre.

**2026-11-12 (tarde), con Chrome: migración de EVO casi completa**
- Nómina de Erick, 1ª quincena de noviembre: egreso folio 4, $3,840 en efectivo, pagada por Emiliano de su bolsillo.
- Asistencia: apagado "Exigir el WiFi del muro" (`require_wifi` = false). La selfie se sigue pidiendo.
- Verificado en producción: `shoe_size` y `terminal_payments` existen; `get_evo_subscribers` muestra 4 vigentes (el primer cobro de EVO es el 24-nov).
- `erp_unir_personas.sql`: Run hecho. 0 pares de duplicados.
- **Contactos de EVO:** exportados de Segmentación (22 clientes y 525 prospectos), agregando antes las columnas de correo, celular y nacimiento, porque el export solo trae lo que se ve en pantalla.
  - IdProspect es el mismo número que `people.evo_id` de las ventas.
  - Run hecho: 427 ligados por número de EVO y 98 fichas nuevas. **548 de 548 personas con correo o celular** (antes eran 2).
- **Gastos de EVO** (`scripts/evo_gastos_sql.py`): 181 gastos, $208,698.98 (igual que EVO), 31 proveedores, nómina ligada a Adán, Ximena y Erick. Run hecho.
  - Método, cuenta y mes reales salieron de la pantalla vieja de Cuentas a pagar (ver docstring del script), en un UPDATE aparte. Run hecho:
    - débito / Santander: 65, $59,630.27
    - efectivo / Santander: 1, $1,422.00
    - efectivo / Caja Interno: 111, $142,809.00
    - transferencia / Santander: 4, $4,837.71
  - EVO no tiene gastos después del 1-oct-2026.
- Los archivos de EVO y los SQL con datos personales quedaron solo en el scratchpad, no en git.

**2026-11-12 (noche): Estado de resultados con el formato de Inge**
- Inge pasó su estado de ene–mar 2026. Coincide al centavo con Relámpago (ingresos 14,200 / 9,550 / 19,500; egresos 15,619.42 / 9,734.39 / 22,463.55). Solo cambiaba cómo se agrupa.
- Centros de costo nuevos **Inversión** e **Impuestos**. Inge decide qué es inversión: se cambia el centro de costo del gasto en Egresos.
- Ya movidos según la tabla de Inge:
  - A Inversión: soporte de TV (Steren, ene), taladros (feb), tornillos y agarres de Spartan (mar).
  - A Impuestos: SAT (mar).
- `erp_estado_resultados.sql` (`get_income_statement`): ingresos por Servicio, Plan y Producto con su concepto; egresos por centro de costo con su proveedor (empleados = Nómina). Run hecho.
- Pantalla Estados financieros (pestaña principal):
  - contraer o expandir cada título;
  - elegir meses (tocar un mes con "Todos" activo elige solo ese);
  - utilidad con o sin inversión;
  - renglones alternados;
  - 3 gráficas SVG (`StatementCharts.tsx`): ingresos contra egresos, utilidad por mes y en qué se va el gasto.
- Colores de las gráficas validados contra la superficie #015169: amarillo #c98500 y violeta #9085e9. Contraste < 3:1, compensado con la cifra escrita en cada barra.
- Verificado en vivo: ene–mar da los mismos totales que la tabla de Inge, y "sin inversión" en enero da −$920.41.

**2026-11-12 (noche, 2): estado de cuenta de octubre, eventos e inventario**
- Estado de cuenta Santander oct-2026 (PDF escaneado: lo leí como imágenes; no se guarda en el repo).
  - Los 16 retiros quedaron como egresos (folios 187–200 + compra de Yohua). Egresos de oct = $32,231.80 = retiros del banco.
  - Clip depositó $17,067.73 (ventas del gym con tarjeta + 23 inscripciones por Clip, sin comisión y con días de retraso). Para cuadrarlo hace falta el reporte de depósitos del portal de Clip.
- `erp_eventos.sql` (Run hecho):
  - `expenses.event`;
  - tabla `other_income`;
  - inscripciones de competencias como ingreso del evento;
  - selector "Solo gym / Gym + eventos" en Estados financieros.
- Datos capturados:
  - JAM Jaibas Al Muro: 5 egresos etiquetados ($19,900).
  - Patrocinios: Alexia $1,740, Camila $4,000 y Víctor $3,480.
- Inventario: conteo de Inge del 11-nov aplicado. El agua bajó de 60 a 14 (−46).
- Productos nuevos: Playera Jaibamuro ($300, 20 pzs) y Bolsa Jaibamuro ($0, 8 pzs, regalo con las primeras 8 playeras).

**2026-11-12 (noche, 3): ajustes de Emiliano, Test borrado, Egresos con eventos y Gasto rápido**
- Datos capturados:
  - Armadores de la competencia: folios 203 y 204 ($9,600 + $7,600, 11-nov), pagados por Emiliano.
  - Patrocinio en efectivo de las gomitas: $1,500 el 25-oct, que recibió Emiliano.
  - Ferreleo = ferretería. Barra de coco en 0. Limpieza del 10-nov ($350, folio 202), pagada por Emiliano.
- **Sin cobros automáticos** (regla de Emiliano). A "Test":
  - se le canceló la domiciliación (queda 0 activas);
  - se archivó la persona;
  - su venta de $600 se anula con un SQL pegado en Supabase (falta Run).
- `erp_eventos_ui.sql` (falta Run): `get_expenses` regresa `event` y la lista de eventos.
- Egresos:
  - selector de evento en cada egreso;
  - pestaña "Otros ingresos";
  - botón **⚡ Gasto rápido**: escribir o dictar, Claude propone y el admin guarda.
- Edge Function `gasto-rapido`: modelo claude-opus-5-5 con effort low, salida con esquema y respaldo si Claude se niega. Falta que Emiliano ponga el secreto `ANTHROPIC_API_KEY` y despliegue la función (Verify JWT ENCENDIDO).
- Checador: no hay nada pendiente de correr.
