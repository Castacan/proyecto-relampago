# Plan: ERP/CRM propio en Relámpago (empezando por Clases y Reservas)

> Documento vivo. Creado el 2026-10-23 a partir de una conversación entre el dueño de Jaibamuro y Claude (Claude Code).
> Sirve para dos cosas: retomar el trabajo si se corta la sesión, y dárselo a otro asistente (por ejemplo Claude en el chat) para seguir afinando ideas.
> **Nada de esto está programado todavía.** Lo único hecho es la investigación y las decisiones de abajo.

---

## 0. Resumen en 30 segundos

- Jaibamuro (gym de escalada en Veracruz) usa **EVO** (sistema brasileño para gimnasios, 79 USD/mes) para clientes, prospectos, planes, cobros y correos.
- El dueño quiere ir **dejando EVO por partes** y tener esas funciones dentro de **Relámpago**, su app propia (`app.jaibamuro.com`). El motivo principal no es el dinero: es **control y claridad** (EVO es confuso, no sabe si las cosas están bien, cambiarlas es difícil).
- **Primera prioridad: Clases y Reservas**, porque va a empezar a dar clases grupales y necesita que la gente reserve.
- EVO se queda funcionando mientras tanto. Cada parte se apaga en EVO solo cuando la versión de Relámpago esté probada.

---

## 1. Contexto

### 1.1 El negocio
- **Jaibamuro**: muro de escalada/boulder. Marca pública "JAIBAMURO".
- Pocos clientes con plan hoy: en EVO aparecen **22 clientes** (activos e inactivos) y **500 prospectos** (gente que vino, preguntó o dejó datos desde oct-2025).
- Solo **~4 clientes pagan con domiciliación** (cobro automático mensual con tarjeta).
- **Facturas (CFDI)**: casi nadie las pide. Cuando alguien la pide, la hace la contadora. **No se va a automatizar la facturación.**
- Tiene staff (por ejemplo Erick y Ximena aparecen como vendedores en EVO).

### 1.2 Qué es Relámpago hoy (ya en producción)
App web propia, hecha con Claude Code. Repositorio `proyecto-relampago`.

- **Stack**: React 19 + Vite + TypeScript + Tailwind 4 en el frontend (desplegado en **Vercel**, se publica solo con cada `git push`). Backend en **Supabase** (Postgres + Auth + Realtime + Edge Functions).
- **Dominios**: `app.jaibamuro.com` (la app) y `jaibamuro.com` (landing, repo aparte `jaibamuro-landing`).
- **Cuentas de clientes**: login por correo con código (OTP). Tabla `climbers` (id = usuario de Supabase Auth, `email`, `display_name`, `visible_in_leaderboard`, etc.).
- **Staff**: tabla `profiles` con `role` (`admin` / staff). Panel en `/staff/...` (Muro, QRs, Spraywall, Stats, Envíos, Insights, Admin, Display, Competencia).
- **Funciones que ya existen y sirven de base**:
  - Rutas del muro con QR, registro de "sends" (envíos), leaderboard en TV (`/leaderboard/display`) con columnas Hoy/Semana/Mes y patrocinadores.
  - **Competencia "JAM Jaibas Al Muro"** (7-nov-2026): inscripción en `/competencia`, **cobro en línea con Clip** (link por inscripción + webhook + conciliación), **correos con Resend** (confirmación, recordatorio de pago programado con `pg_cron`), inscripción manual en mostrador (efectivo / tarjeta en sucursal), **códigos promocionales/cortesías**, auditoría de cambios, exportar CSV.
  - Todo esto es justo el "esqueleto" que necesita un sistema de clases: cuentas, cobro con Clip, correos, panel de staff con permisos, auditoría.
- **Reglas de trabajo del proyecto** (importantes para quien programe):
  - Siempre `npx tsc -b` antes de pushear (Vercel falla si hay errores de tipos).
  - Commit limpio + push después de cada cambio relevante.
  - Mantener `docs/bitacora.md` actualizado en cada sesión.
  - Claude **no puede correr SQL ni desplegar Edge Functions en Supabase de producción**: deja el SQL pegado en el SQL Editor (o el código en Edge Functions → Code) y **el dueño da Run / Deploy**.
  - Los archivos SQL viven en `src/supabase/*.sql`, son idempotentes (se pueden correr más de una vez). Las funciones de Edge viven en `supabase/functions/<nombre>/index.ts`.
  - Se prueba en local con **PGlite** (Postgres en Node) cargando los `.sql` con stubs de `auth.uid()` y roles, y con Clip/Resend falsos.
  - La pantalla de TV corre en una **Raspberry Pi 4 con Chromium en modo kiosco** (los emojis en nombres no se ven ahí).

### 1.3 Qué le molesta de EVO (palabras del dueño, resumidas)
- "No saber hacer bien las cosas": muchas funciones confusas, difícil saber si están bien configuradas.
- Cambiar cosas es un rollo.
- **Correos automáticos** y **manejo de clientes** poco claros.
- El **torniquete** (control de acceso físico) lo cobran aparte.
- Quiere **más control** y poder cambiar cosas clave con ayuda de Claude.

Detalles técnicos que vimos de EVO al usarlo (21-oct-2026, envío masivo de la invitación a la competencia):
- No acepta **emojis** en plantillas ni asuntos (los guarda como `??`).
- La segmentación de prospectos muestra máximo lo que hay (500 hoy); no es obvio si hay tope.
- Las plantillas de correo se arman en CRM 2.0 → Templates; el envío masivo en CRM 2.0 → Segmentación → seleccionar → "Enviar mensaje". Funciona, pero hay que saber dónde está cada cosa.

---

## 2. Cómo modela EVO las clases (investigado el 2026-10-23)

En EVO no había ninguna clase ni actividad configurada todavía (no hay nada que migrar). La información salió de recorrer las pantallas (sin guardar nada) y de preguntarle a **EVA**, el asistente de IA de EVO.

### 2.1 Las piezas (están repartidas en 5+ pantallas, de ahí lo confuso)
1. **Actividad** (Administración → Actividades - Horarios → "Nueva actividad"). Campos:
   - Cómo se definen los horarios: **Previamente** (horario fijo semanal) o **Bajo demanda**.
   - Imagen (400×225) y color.
   - Nombre, **Grupo de actividades**, **Grupo de nivel**, **Público**.
   - **Capacidad estándar** (cupo) y **Duración estándar** (HH:MM).
   - TAGs, código, metas por cargo (para reportes de desempeño de empleados).
   - Agenda en línea: categoría, **grado de dificultad** (1 a 5), descripción (hasta 1000 caracteres).
   - **¿Qué clientes pueden participar?** Todos (actividad gratuita) o solo quien compró un plan/servicio del grupo de la actividad.
   - **¿Permitir que el cliente reserve?** Sí/No.
   - Limitar cupos para "agregadores" (plataformas tipo Gympass/TotalPass).
   - Hasta cuánto tiempo antes del inicio se puede salir de la actividad.
   - Permitir elegir número de lugar en la clase.
   - Mostrar en la app del cliente (Fiti), en el autoservicio/sitio web, en "WOD TV".
   - Finalizar la actividad automáticamente después del horario.
   - Desactivar lista de notificación (lista de espera).
2. **Horario semanal** (Actividades → Más opciones → Horarios): día de la semana, hora, duración, capacidad, profesor. Genera las clases que aparecen para reservar.
3. **Clases** (Administración → Clases): otra vista ("turmas"), con nombre y lista de horarios; columnas: cantidad de programación, plazas disponibles, lista de espera, status.
4. **Plan** (Administración → Planes → Actividades): si el plan permite clases, cuántas, **máximo por semana**.
5. **Pantalla "Horarios"** (menú principal): calendario semanal con filtros Mañana/Tarde/Noche, vista día/semana.
6. **Reserva** desde la app del cliente (Fiti) → Agenda: elige actividad, fecha y hora, confirma.

### 2.2 Reglas que maneja EVO
- **Ventanas de reserva**: "inicia reserva X tiempo antes", "finaliza reserva X tiempo antes", "cancela reserva X tiempo antes" (hasta cuándo cancelar sin perder). También se pueden definir por plan.
- **Lista de espera**: si se llena, los clientes entran a lista de espera; si alguien cancela, pasa automático o se les notifica.
- **Asistencia (check-in)**: manual (profe o recepción marca presente/ausente) o automática con torniquete. Estados: **reservado**, **presente**, **ausente**.
- **Penalización por falta**: opcional.
- **Clase suelta sin membresía**: se crea la actividad como "libre" (no requiere plan).

Resumen del flujo EVO: **Actividad (cupo, quién puede) → Horario semanal → Plan con límite de clases → Reserva en app → Check-in → asistencia + penalizaciones.**

---

## 3. Visión general del ERP/CRM en Relámpago (fases)

Principio: **cada fase es útil por sí sola** y no rompe nada de lo anterior. EVO sigue mientras tanto.

| Fase | Qué | Por qué en este orden | Dificultad |
|---|---|---|---|
| **1** | **Clases y Reservas** (este documento lo detalla) | Las clases empiezan pronto | Media |
| 2 | **CRM**: ficha de cliente y prospecto, notas, quién lo atiende, de dónde llegó, seguimiento | Lo que más le estorba de EVO | Baja |
| 3 | **Correos automáticos claros**: bienvenida, "tu plan vence en X días", "te extrañamos", cumpleaños, cada uno con su texto visible y un interruptor | Dolor de EVO; Resend ya funciona | Baja-media |
| 4 | **Planes, venta en mostrador, corte de caja** y **reporte mensual para la contadora** | Necesario para dejar EVO de verdad | Media |
| 5 | **Check-in con QR** y asistencia general (no solo clases) | Barato; los QR ya existen en la app | Media |
| 6 | Después, si hace falta: **cobro recurrente** (domiciliación) y **torniquete** | Solo 4 domiciliados; el torniquete depende del aparato | Alta |

Fuera de alcance por ahora: **facturación CFDI automática** (la hace la contadora), app nativa (todo es web móvil), multi-sucursal.

Puntos difíciles conocidos para fases futuras:
- **Cobro recurrente**: guardar tarjeta con el procesador, cobrar cada mes, reintentos, cancelación. Clip quizá no lo soporte; Openpay o Stripe sí. Con 4 clientes se puede cobrar a mano con link de Clip mientras tanto.
- **Migración desde EVO**: exportar clientes/prospectos/planes, limpiar duplicados (hay registros repetidos y uno genérico "VENTAS GENERAL PRODUCTOS"), operar un mes en paralelo.
- **Correo masivo**: cuidar entregabilidad (no caer en spam) y dar opción de "darse de baja".

---

## 4. Fase 1 — Clases y Reservas (detalle)

### 4.1 Decisiones ya tomadas por el dueño (2026-10-23)

| Tema | Decisión |
|---|---|
| **Cómo se paga una clase** | Tres formas: **clase suelta en línea** (Clip, al reservar), **incluida en la membresía** (reserva sin pagar aparte), **pago en el gym** (reserva en línea y paga en mostrador; staff lo marca pagado). **No** paquetes de clases por ahora. |
| **Si reserva y no llega** | **Pierde la clase.** Si era suelta pagada, no se reembolsa. Si era por membresía, cuenta como usada (si hay límite semanal). |
| **Cancelación** | Se puede cancelar **hasta 12 horas antes** sin perder la clase. |
| **Lista de espera** | **No hay.** Si está llena, está llena. |

### 4.2 Decisiones propuestas por Claude (pendientes de confirmar)

| Tema | Propuesta | Por qué |
|---|---|---|
| ¿Cómo sabe Relámpago quién tiene membresía? | El staff marca a mano en el panel: "Membresía vigente hasta el DD/MM" por cliente. | Hoy solo EVO lo sabe; con 22 clientes es rápido. Es el primer paso de la Fase 4 (Planes). |
| ¿La membresía da clases ilimitadas? | Un número en Ajustes: "máximo de clases por semana con membresía". Vacío = ilimitado. | Flexible sin complicar. |
| ¿Desde cuándo se puede reservar? | Ajuste global, propuesta: **7 días antes**. | Evita que alguien aparte todo el mes. |
| ¿Hasta cuándo se puede reservar? | Hasta el inicio de la clase (o X minutos antes, ajuste). | |
| "Pago en el gym": ¿cuánto tiempo se aparta el lugar? | Se aparta hasta la clase; si no llega, pierde (misma regla de faltas). Staff puede cancelarla. | Simple. Riesgo: gente que aparta y no viene → se verá en el reporte de faltas. |
| ¿Quién marca asistencia? | El profe o recepción en una pantalla "Clase de hoy". | Igual que EVO manual. |
| ¿Cuenta obligatoria para reservar? | Sí: login con correo (el mismo de la app). | Ya existe; sirve para "mis reservas" y correos. |
| ¿Datos extra del cliente? | Nombre completo y celular al primer uso (la tabla `climbers` hoy solo tiene `email` y `display_name`). Fecha de nacimiento opcional (menores). | Para lista del profe y contacto. |
| ¿Menores? | Pueden reservar; se marca "Menor" en la lista (igual que en la competencia). | Consistente. |
| Precio de la clase suelta | Por clase (cada clase tiene su precio). | Puede haber clases de distinto costo. |

### 4.3 Conceptos (modelo mental, más simple que EVO)
- **Clase (tipo)**: "Iniciación a la escalada", "Técnica intermedia"… Tiene nombre, descripción, nivel, profe por defecto, cupo por defecto, duración, precio suelto, color/imagen, y si está activa.
- **Horario semanal**: "cada martes 19:00, 60 min, cupo 8, profe X". Una clase puede tener varios horarios.
- **Sesión**: una clase en una fecha concreta ("martes 4-nov 19:00"). Se generan a partir de los horarios (por ejemplo, las próximas 4 semanas) y se pueden editar o cancelar una por una (feriado, profe enfermo).
- **Reserva**: una persona en una sesión. Tiene estado y forma de pago.

### 4.4 Estados de una reserva

```
reservada ──(llega, profe marca)──> asistió
    │
    ├──(no llega, profe marca o automático al terminar)──> faltó   (pierde la clase)
    │
    ├──(cancela ≥12 h antes)──> cancelada   (si pagó en línea: queda saldo/reembolso, ver 4.9)
    │
    ├──(cancela <12 h antes)──> cancelada_tarde (cuenta como falta)
    │
    └──(staff cancela la sesión)──> cancelada_por_gym (reembolso/saldo obligatorio)

pendiente_pago (solo clase suelta en línea, mientras paga en Clip; aparta el lugar unos minutos)
```

Forma de pago de la reserva: `membresia` | `clip` (en línea) | `en_gym` (pagará en mostrador) | `cortesia`.
Estado de pago (para `en_gym`): `por_cobrar` → `cobrado` (staff marca, con método efectivo/tarjeta).

### 4.5 Pantallas

**Públicas (cliente, celular primero):**
1. **`/clases`**: calendario de la semana (y siguiente). Cada sesión muestra: clase, hora, profe, nivel, lugares libres ("3 lugares" / "Llena"), precio o "Incluida en tu membresía".
2. **Detalle de sesión → Reservar**: si no hay sesión iniciada, pide correo (OTP). Luego elige cómo pagar (según aplique): "Incluida en mi membresía" / "Pagar en línea" / "Pago en el gym". Aceptar reglas (cancelación 12 h, falta = pierde).
3. **`/mi-cuenta/clases`** (o dentro de Mi cuenta): mis próximas reservas, botón Cancelar (con aviso si ya es tarde), historial (asistí/falté).
4. Página de resultado del pago (como `/competencia/consulta`): "Reserva confirmada" o "Falta tu pago".

**Staff (`/staff/clases`):**
1. **Clases**: lista de tipos de clase; crear/editar; horarios semanales dentro de la misma pantalla (no repartido como en EVO).
2. **Calendario de sesiones**: ver/generar sesiones de las próximas semanas, cancelar una sesión (avisa por correo a los inscritos), cambiar profe/cupo de una sesión.
3. **Clase de hoy** (pantalla para el profe, sirve en celular/tablet): lista de inscritos con nombre, "Menor", cómo pagó, si debe pago; botones **Asistió / Faltó**; agregar a alguien que llegó sin reservar (walk-in) si hay cupo; **cobrar** a los de "pago en el gym".
4. **Membresías (mínimo)**: buscar cliente → "Membresía vigente hasta…" (fecha), nota. (Semilla de la Fase 4.)
5. **Ajustes de clases**: días de anticipación para reservar, horas para cancelar (12), máximo de clases por semana con membresía, si "pago en el gym" está permitido, textos de reglas.
6. **Reporte**: asistencia por clase, faltas por persona, ingresos de clases sueltas (en línea vs gym) por mes → exportar CSV (sirve a la contadora).

### 4.6 Correos (Resend, remitente `hola@jaibamuro.com`)
- **Reserva confirmada** (con fecha, hora, profe, reglas de cancelación, botón "Ver mis reservas").
- **Recordatorio** X horas antes (propuesta: 24 h antes o la mañana del día). Usar `pg_cron` como el recordatorio de la competencia.
- **Cancelación** (confirmación de que canceló; si fue tarde, aviso de que se pierde).
- **Sesión cancelada por el gym** (con disculpa y qué pasa con su pago).
- Sin emojis raros en asunto (por si se reenvían desde EVO o se ven en clientes viejos) — aunque Resend sí los soporta.
- Todos con texto visible y editable en el código; más adelante, en un panel de "Correos automáticos" (Fase 3).

### 4.7 Reglas de negocio (para implementar en SQL, no en el navegador)
1. **Cupo**: reservas en estado `reservada`/`asistió`/`pendiente_pago` (no vencida) ≤ cupo de la sesión. Validar con bloqueo de fila (como `competition_spots_taken` + `FOR UPDATE`) para que dos personas no tomen el último lugar.
2. **Una reserva por persona por sesión.**
3. **Ventana de reserva**: no antes de N días; no después del inicio.
4. **Membresía**: solo si la membresía está vigente el día de la sesión; si hay máximo semanal, contar reservas no canceladas (incluye faltas) de esa semana (lunes–domingo, hora de México).
5. **Cancelación**: si faltan ≥12 h → `cancelada` (libera lugar; si pagó en línea, ver 4.9). Si faltan <12 h → `cancelada_tarde` (libera lugar pero cuenta como falta, no reembolso).
6. **Falta**: al terminar la sesión, las reservas sin marcar pueden quedar como `faltó` automáticamente (o el profe marca). Pierde la clase.
7. **Pago en línea**: la reserva queda `pendiente_pago` y aparta el lugar unos minutos (p. ej. 15). Si Clip confirma → `reservada`. Si no → se libera. Nunca se confirma un pago desde el navegador: siempre consultando la API de Clip (igual que la competencia).
8. **Pago en el gym**: reserva `reservada` con `por_cobrar`. Staff la marca cobrada en "Clase de hoy".
9. **Sesión cancelada por el gym**: todas las reservas → `cancelada_por_gym`, correo a todos.
10. **Zona horaria**: todo en `America/Mexico_City`.
11. **Auditoría**: cada cambio de staff deja rastro (como `competition_audit_log`).

### 4.8 Modelo de datos propuesto (Supabase / Postgres)

Nombres tentativos; prefijo `class_` para no chocar con lo existente.

```sql
-- Ajustes globales de clases (una fila)
class_settings (
  id, book_ahead_days INT DEFAULT 7, cancel_hours INT DEFAULT 12,
  membership_weekly_limit INT NULL,          -- NULL = ilimitado
  allow_pay_at_gym BOOLEAN DEFAULT true,
  online_hold_minutes INT DEFAULT 15,
  rules_text TEXT, updated_at
)

-- Tipo de clase
class_types (
  id, name, description, level TEXT,          -- Básico/Intermedio/Avanzado o 1-5
  default_capacity INT, default_duration_min INT,
  price_cents INT,                            -- clase suelta
  default_instructor_id UUID NULL,            -- profiles.id (staff)
  color TEXT, image_url TEXT, is_active BOOLEAN, sort_order INT, created_at
)

-- Horario semanal (plantilla)
class_schedules (
  id, class_type_id, weekday SMALLINT,        -- 0=domingo … 6=sábado
  start_time TIME, duration_min INT, capacity INT,
  instructor_id UUID NULL, starts_on DATE, ends_on DATE NULL, is_active BOOLEAN
)

-- Sesión concreta (generada desde horarios o creada suelta)
class_sessions (
  id, class_type_id, schedule_id NULL,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, capacity INT,
  instructor_id UUID NULL, price_cents INT,
  status TEXT CHECK (status IN ('scheduled','cancelled','finished')),
  cancel_reason TEXT NULL, created_at,
  UNIQUE (schedule_id, starts_at)             -- generar sin duplicar
)

-- Reserva
class_bookings (
  id, session_id, climber_id,                 -- climbers.id (cuenta del cliente)
  status TEXT CHECK (status IN ('pending_payment','booked','attended','no_show',
                                'cancelled','cancelled_late','cancelled_by_gym')),
  payment_type TEXT CHECK (payment_type IN ('membership','online','at_gym','courtesy')),
  payment_status TEXT CHECK (payment_status IN ('not_needed','pending','paid','refunded')),
  paid_method TEXT NULL,                      -- 'clip' | 'cash' | 'card' | ...
  amount_cents INT, hold_expires_at TIMESTAMPTZ NULL,
  booked_at, cancelled_at, checked_at, created_by UUID NULL,  -- staff si fue walk-in
  UNIQUE (session_id, climber_id) WHERE status NOT IN ('cancelled','cancelled_late','cancelled_by_gym')
)

-- Pagos en línea de clases (mismo patrón que competition_payments)
class_payments (... provider 'clip', provider_payment_id, payment_url, status, amount_cents, ...)
class_payment_events (... bitácora cruda, solo inserción ...)

-- Membresía mínima (semilla de la Fase 4)
memberships (
  id, climber_id, plan_name TEXT, valid_from DATE, valid_until DATE,
  note TEXT, created_by UUID, created_at
)

-- Datos de cliente que faltan en climbers
ALTER TABLE climbers ADD full_name TEXT, ADD phone TEXT, ADD birth_date DATE;

class_audit_log (... igual que competition_audit_log ...)
```

RPCs (funciones de Postgres) tentativas:
- Públicas: `get_class_calendar(from, to)`, `book_class(session_id, payment_type)`, `cancel_booking(booking_id)`, `get_my_bookings()`.
- Edge Function `class-payments` (o extender `competition-payments`): crear link de Clip para una reserva, webhook, consulta de estado, correos.
- Staff (solo admin/staff): `admin_upsert_class_type`, `admin_upsert_schedule`, `admin_generate_sessions(weeks)`, `admin_cancel_session`, `admin_mark_attendance(booking_id, attended|no_show)`, `admin_walk_in(session_id, climber o datos)`, `admin_mark_paid(booking_id, method)`, `admin_set_membership(climber_id, valid_until)`, `get_class_report(month)`.
- Cron: generar sesiones de las próximas semanas, marcar faltas al terminar, liberar holds vencidos, mandar recordatorios.

Seguridad: RLS activado en todas las tablas sin políticas abiertas; todo pasa por RPCs `SECURITY DEFINER` que validan rol/usuario (patrón de la competencia).

### 4.9 Reembolsos / saldo (pendiente de decidir)
Caso: alguien pagó en línea una clase suelta y cancela con ≥12 h, o el gym cancela la sesión.
- Opción A: **reembolso en Clip** (staff lo hace en el panel de Clip; Relámpago solo lo registra, como en la competencia).
- Opción B: **saldo a favor** para otra clase (más simple para el negocio, evita comisiones).
- Propuesta: B por defecto, A si la sesión la cancela el gym y el cliente lo pide.

### 4.10 Pruebas antes de publicar
- SQL en **PGlite** (local): cupo con dos reservas simultáneas al último lugar, ventanas de reserva, cancelación a 12 h exactas (borde), límite semanal de membresía (incluye faltas), membresía vencida, sesión cancelada, holds vencidos, permisos (anon vs cliente vs staff).
- Edge Function con Clip y Resend falsos (pago aprobado, rechazado, duplicado, tarde).
- Pantallas en navegador (local) contra datos de prueba.
- En producción: una clase de prueba, reservar con cuenta del dueño, pagar $1 si hace falta, cancelar, revisar correos en Resend; luego borrar la prueba.

### 4.11 Despliegue
1. SQL nuevo en `src/supabase/clases.sql` (+ `clases_pagos.sql`) → el dueño da **Run** en el SQL Editor.
2. Edge Function → el dueño da **Deploy** (Verify JWT apagado si recibe webhook de Clip).
3. Frontend → `git push` (Vercel publica solo).
4. Agregar "Clases" al menú del panel de staff y un enlace en la página principal / Mi cuenta.

### 4.12 Estimación gruesa
Al ritmo de la competencia (que se hizo en pocos días con pruebas): **1 a 2 semanas** para una primera versión usable de la Fase 1, sin contar las pruebas con clientes reales. La parte de pagos en línea es la más delicada (pero el patrón ya existe).

---

## 5. Preguntas abiertas (para pimponear)

**Clases**
1. ¿Qué clases van a dar al principio? (nombres, nivel, duración, cupo, precio suelto, horarios, quién las da)
2. ¿La membresía da clases ilimitadas o un máximo por semana? ¿Todas las membresías igual?
3. ¿Con cuántos días de anticipación se puede reservar? (propuesta 7)
4. "Pago en el gym": ¿se permite para cualquiera o solo para clientes conocidos? ¿Y si nunca paga?
5. ¿Se permite que alguien llegue sin reservar si hay lugar (walk-in)?
6. ¿Reembolso en Clip o saldo a favor cuando cancela a tiempo? (ver 4.9)
7. ¿Recordatorio 24 h antes, la mañana del día, o ambos?
8. ¿Se marca falta automáticamente al terminar la clase si nadie marcó asistencia, o siempre a mano?
9. ¿Las clases deben verse en la TV (`/leaderboard/display`) o en la landing `jaibamuro.com`?
10. ¿Los menores necesitan algo especial (responsiva, adulto)?

**Más allá de las clases**
11. ¿Qué planes/membresías vende hoy y a qué precio? (para la Fase 4)
12. ¿Qué correos automáticos quiere sí o sí? (bienvenida, vencimiento, te extrañamos, cumpleaños…)
13. ¿Qué información del cliente necesita ver en su ficha?
14. ¿Cuándo le gustaría apagar EVO del todo? (define el orden de las fases 4–6)
15. ¿Torniquete algún día? ¿Qué aparato?

---

## 6. Cómo retomar este trabajo

**Si lo retoma Claude Code (en este repo):**
1. Leer este documento y `docs/bitacora.md` (cronología de todo lo hecho).
2. Revisar el patrón de la competencia, que es el modelo a copiar: `src/supabase/competencia*.sql`, `supabase/functions/competition-payments/index.ts`, `src/pages/public/CompetitionPage.tsx`, `src/pages/staff/CompetitionAdminPage.tsx`.
3. Confirmar con el dueño las decisiones pendientes (sección 4.2 y 5) antes de programar.
4. Recordar: el dueño da Run/Deploy en Supabase; `npx tsc -b` antes de push; actualizar bitácora.

**Si se lo das a Claude en el chat (para pensar ideas):**
- Pega este documento completo y pídele, por ejemplo:
  - "Ayúdame a responder las preguntas abiertas de la sección 5 para mi gym de escalada."
  - "Propón los textos de los correos de la sección 4.6."
  - "¿Qué me falta considerar en las reglas de la sección 4.7?"
  - "Diseña cómo se vería la pantalla `/clases` en el celular."
- Las respuestas se pueden traer de vuelta a Claude Code para programarlas.

---

## 7. Historial de este documento
- **2026-10-23**: creado. Investigación de EVO (clases), decisiones de cobro/faltas/cancelación/lista de espera, plan de fases y diseño de la Fase 1.
