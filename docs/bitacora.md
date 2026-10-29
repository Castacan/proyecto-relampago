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
