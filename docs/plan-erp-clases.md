# Plan: ERP/CRM propio en Relámpago (empezando por Clases y Reservas)

> Documento vivo. Creado el 2026-10-23 a partir de una conversación entre el dueño de Jaibamuro y Claude (Claude Code), y afinado el mismo día con Claude en el chat (v2).
> Sirve para dos cosas: retomar el trabajo si se corta la sesión, y dárselo a otro asistente para seguir afinando ideas.
> **Nada de esto está programado todavía.** Lo único hecho es la investigación y las decisiones de abajo.

---

## 0. Resumen en 30 segundos

- Jaibamuro (gym de escalada en Veracruz) usa **EVO** (sistema brasileño para gimnasios, 79 USD/mes) para clientes, prospectos, planes, cobros y correos.
- El dueño quiere ir **dejando EVO por partes** hasta **apagarlo por completo**, y tener esas funciones dentro de **Relámpago**, su app propia (`app.jaibamuro.com`). El motivo principal no es el dinero: es **control y claridad**.
- **Primera prioridad: Clases y Reservas**, porque va a empezar a dar clases grupales. Se entrega en dos partes: **1a** (para arrancar ya) y **1b** (pagos en línea y automatizaciones).
- **Arranque con 3 clases**: Introductoria ($200), Escalada Jueves y Calistenia ($300 normal / $100 miembros, + 1 clase gratis al mes para miembros). **Todos los parámetros los cambia un admin desde el panel, sin tocar código.**
- **Toda persona tendrá cuenta en Relámpago** (ahí vivirán responsivas, historial, membresía). Esto es la semilla del CRM.
- EVO se queda funcionando mientras tanto. Cada parte se apaga en EVO solo cuando la versión de Relámpago esté probada.

---

## 1. Contexto

### 1.1 El negocio
- **Jaibamuro**: muro de escalada/boulder. Marca pública "JAIBAMURO".
- Pocos clientes con plan hoy: en EVO aparecen **22 clientes** (activos e inactivos) y **500 prospectos** (gente que vino, preguntó o dejó datos desde oct-2025).
- Solo **~4 clientes pagan con domiciliación** (cobro automático mensual con tarjeta).
- **Facturas (CFDI)**: casi nadie las pide. Cuando alguien la pide, la hace la contadora. **No se va a automatizar la facturación.**
- Tiene staff (por ejemplo Erick y Ximena aparecen como vendedores en EVO).
- La **clase introductoria** es el gancho del negocio. Hoy el dueño la agenda desde Instagram sin pedir datos.

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
1. **Actividad** (Administración → Actividades - Horarios → "Nueva actividad"): forma de horario (fijo semanal o bajo demanda), imagen/color, nombre, grupo, nivel, público, capacidad y duración estándar, dificultad 1–5, descripción, quién puede participar (todos o solo quien tiene plan), si se permite reservar, cupos para agregadores (Gympass/TotalPass), hasta cuándo salir, elegir lugar, dónde mostrarla (app Fiti, web, WOD TV), finalizar automática, lista de espera.
2. **Horario semanal** (Actividades → Más opciones → Horarios): día, hora, duración, capacidad, profesor.
3. **Clases** (Administración → Clases): otra vista con horarios, plazas disponibles, lista de espera, status.
4. **Plan** (Administración → Planes → Actividades): si el plan permite clases, cuántas, máximo por semana.
5. **Pantalla "Horarios"**: calendario semanal con filtros.
6. **Reserva** desde la app del cliente (Fiti) → Agenda.

### 2.2 Reglas que maneja EVO
- Ventanas de reserva (inicia / finaliza / cancela X tiempo antes), también por plan.
- Lista de espera con paso automático.
- Asistencia manual o con torniquete. Estados: reservado, presente, ausente.
- Penalización por falta opcional.
- Clase suelta sin membresía = actividad "libre".

Resumen: **Actividad → Horario semanal → Plan con límite → Reserva en app → Check-in → asistencia + penalizaciones.** Relámpago lo simplifica (ver sección 4).

---

## 3. Visión general del ERP/CRM en Relámpago (fases)

Principio: **cada fase es útil por sí sola** y no rompe nada de lo anterior. EVO sigue mientras tanto. **Meta final: apagar EVO por completo**; Relámpago será la única fuente de verdad.

| Fase | Qué | Por qué en este orden | Dificultad |
|---|---|---|---|
| **1a** | **Clases y Reservas básicas** (ver 4.12) | Las clases empiezan pronto | Media |
| **1b** | Pagos en línea de clases (Clip), recordatorios, faltas automáticas, reportes | Lo delicado (dinero) va después de que lo básico funcione | Media |
| 2 | **CRM**: ficha de persona (prospecto/cliente), notas, quién lo atiende, de dónde llegó, seguimiento, **responsivas firmadas**, **acompañantes** | Lo que más le estorba de EVO; la base (personas) ya nace en la Fase 1 | Baja-media |
| 3 | **Correos automáticos claros**: bienvenida, "tu plan vence en X días", "te extrañamos", cumpleaños, cada uno con su texto visible y un interruptor | Dolor de EVO; Resend ya funciona | Baja-media |
| 4 | **Planes, venta en mostrador, corte de caja** y **reporte mensual para la contadora** | Necesario para dejar EVO de verdad | Media |
| 5 | **Check-in con QR** y asistencia general | Barato; los QR ya existen | Media |
| 6 | **Reconocimiento facial + torniquete**, **cobro recurrente** (domiciliación) | Resuelve asistencia y faltas de forma automática; solo 4 domiciliados hoy | Alta |

Fuera de alcance por ahora: **facturación CFDI automática** (la hace la contadora), app nativa (todo es web móvil), multi-sucursal.

Puntos difíciles conocidos para fases futuras:
- **Reconocimiento facial**: en México los datos biométricos son **datos personales sensibles**. Requiere consentimiento expreso y por escrito, y un aviso de privacidad que lo mencione. Encaja en la responsiva (Fase 2). Revisar con abogado antes de implementarlo.
- **Cobro recurrente**: guardar tarjeta con el procesador, cobrar cada mes, reintentos, cancelación. Clip quizá no lo soporte; Openpay o Stripe sí. Con 4 clientes se puede cobrar a mano con link de Clip mientras tanto.
- **Migración desde EVO**: exportar clientes/prospectos/planes, limpiar duplicados (hay registros repetidos y uno genérico "VENTAS GENERAL PRODUCTOS"), operar un mes en paralelo.
- **Correo masivo**: cuidar entregabilidad y dar opción de "darse de baja".

---

## 4. Fase 1 — Clases y Reservas (detalle)

### 4.1 Catálogo inicial de clases

| Clase | Precio normal | Precio miembro | ¿Entra en la clase gratis mensual? | Horario | Cómo se reserva |
|---|---|---|---|---|---|
| **Introductoria** | $200 | — (mismo) | No | **Variable**: a veces fija, a veces cuando alguien la pide | **Solo staff/admin**. El sistema casi solo **registra la venta** (persona, fecha, monto, método). |
| **Escalada Jueves** | $300 | $100 | Sí | Jueves (hora por definir) | En línea por el cliente o por staff |
| **Calistenia** | $300 | $100 | Sí | **Lunes y miércoles 17:00** (provisional) | En línea por el cliente o por staff |

- **Todo esto es editable por un admin** desde el panel: precios, precio miembro, si entra en la gratis mensual, horarios, cupo, duración, profe, si se reserva en línea o solo staff, si está activa. Nada debe estar fijo en el código.
- Pendiente: duración, cupo y profe de Jueves y Calistenia; hora del jueves.

### 4.2 Decisiones tomadas por el dueño (2026-10-23)

| Tema | Decisión |
|---|---|
| **Formas de pago** | **En línea** (Clip, al reservar), **en el gym** (reserva en línea y paga en mostrador; staff lo marca), o **clase gratis mensual** (miembros). **No** paquetes de clases por ahora. |
| **Membresía** | **No incluye clases ilimitadas.** Da **precio miembro** ($100) y **1 clase gratis al mes** (de Jueves o Calistenia). |
| **Clase gratis mensual** | **No acumulable.** Mes **calendario** (1 al último día, hora de México). Se reinicia cada mes. La cantidad (1) es un ajuste editable. |
| **Si reserva y no llega** | **Pierde la clase.** Si era pagada en línea, no se reembolsa. Si era la gratis del mes, se gasta. |
| **Cancelación** | Hasta **12 horas antes** sin perder la clase. |
| **Cancelación tarde (<12 h)** | Cuenta igual que una falta: **gasta la clase gratis** si la usó; no hay reembolso si pagó. |
| **Lista de espera** | **No hay.** |
| **Castigo a quien aparta con "pago en el gym" y no llega** | **Ninguno por ahora.** Se observa el comportamiento en el reporte de faltas. A futuro, el torniquete/reconocimiento facial resuelve la asistencia. |
| **Sobrecupo** | Al principio se tolera un poco (ej. 7 en clase de 6), pero con regla clara (ver 4.7, regla 8). |
| **Cuentas** | **Toda persona tendrá cuenta.** Los walk-ins llegan, el staff les crea su cuenta ahí mismo y los mete al sistema. Ahí vivirán responsivas firmadas, etc. |
| **Acompañantes** | Una cuenta podrá reservar para **acompañantes** (ej. papá/mamá con hijos). **Pendiente diseñarlo a fondo** (ver 4.10). |
| **Mover una sesión que ya tiene reservas** | Solo un **admin** (no staff) y **avisando antes** a los inscritos. |
| **Reembolsos** | Por defecto **reagendar** (mover la reserva pagada a otra sesión). Reembolso en Clip solo si el gym cancela y el cliente lo pide. |
| **EVO** | Eventualmente se apaga. Mientras tanto, el staff mantiene la membresía al día en ambos lados. |

### 4.3 Decisiones propuestas por Claude (pendientes de confirmar, se pueden ajustar después)

| Tema | Propuesta |
|---|---|
| ¿Desde cuándo se puede reservar? | **7 días antes** (ajuste). |
| ¿Hasta cuándo? | Hasta el inicio de la clase (ajuste en minutos). |
| ¿Quién marca asistencia? | Profe o recepción en "Clase de hoy". |
| Falta automática | Solo si el profe ya marcó al menos a una persona en esa sesión. Si nadie marcó nada, la sesión queda **"sin pasar lista"** y aparece en un aviso para staff. |
| Recordatorio | 24 h antes (ajuste). |
| Menores | Se marca "Menor" en la lista; responsiva de tutor en Fase 2. |
| ¿Cómo sabe Relámpago quién es miembro? | Staff/admin marca "Membresía vigente hasta DD/MM" por persona. |

### 4.4 Conceptos (modelo mental, más simple que EVO)
- **Persona**: cualquier cliente o prospecto. **Puede existir sin login** (el staff la crea con nombre y celular, como un "prospecto" de EVO). Cuando da su correo, se le activa el login (OTP) y puede reservar sola. Ahí se guardan membresía, historial, responsivas y acompañantes.
- **Clase (tipo)**: "Escalada Jueves", "Calistenia"… con sus precios, cupo, duración, profe y reglas.
- **Horario semanal**: "cada lunes 17:00, 60 min, cupo 8, profe X". Una clase puede tener varios (Calistenia: lunes y miércoles).
- **Sesión**: una clase en una fecha concreta. Se genera desde los horarios o se crea suelta (útil para la Introductoria cuando se da a demanda).
- **Reserva**: una persona en una sesión, con su estado, su precio aplicado y su forma de pago.
- **Venta suelta**: para la Introductoria cuando no hay sesión: solo se registra persona, fecha, monto y método.

### 4.5 Estados de una reserva

```
reservada ──(llega, profe marca)──> asistió
    │
    ├──(no llega)──> faltó   (pierde la clase; si usó la gratis, se gasta)
    │
    ├──(cancela ≥12 h antes)──> cancelada   (libera lugar; devuelve gratis; si pagó en línea → reagendar)
    │
    ├──(cancela <12 h antes)──> cancelada_tarde (libera lugar; cuenta como falta; gasta la gratis)
    │
    └──(gym cancela la sesión)──> cancelada_por_gym (devuelve gratis; reagendar o reembolso)

pendiente_pago (solo pago en línea, mientras paga en Clip; aparta el lugar unos minutos)
```

Cada reserva guarda **dos cosas separadas**:
- **Precio aplicado** (`price_tier`): `regular` ($300) | `member` ($100) | `free_monthly` (gratis del mes) | `courtesy`.
- **Cómo paga** (`payment_method`): `online` (Clip) | `at_gym` (mostrador) | `none` (gratis o cortesía).

Estado de pago: `not_needed` | `pending` | `paid` | `refunded`. Si pagó en mostrador se guarda el método (efectivo/tarjeta).

### 4.6 Pantallas

**Públicas (cliente, celular primero):**
1. **`/clases`**: calendario de la semana y la siguiente. Cada sesión muestra clase, hora, profe, lugares libres ("3 lugares" / "Llena") y precio. Si es miembro: "$100 o usa tu clase gratis del mes" (o "Ya usaste tu clase gratis de octubre").
2. **Detalle de sesión → Reservar**: pide login si no hay. Opciones según aplique: "Usar mi clase gratis del mes" / "Pagar en línea" / "Pagar en el gym". Aceptar reglas (cancelación 12 h, falta = pierde).
3. **Mi cuenta → Clases**: próximas reservas, Cancelar (con aviso si ya es tarde), historial, y si le queda la clase gratis del mes.
4. Página de resultado del pago: "Reserva confirmada" o "Falta tu pago".

**Staff (`/staff/clases`):**
1. **Clases** (solo admin edita): tipos de clase con todos sus parámetros y sus horarios semanales en la misma pantalla.
2. **Calendario de sesiones**: generar sesiones, crear sesión suelta, cancelar una sesión (avisa por correo). **Mover** una sesión con reservas: solo admin, y manda aviso antes.
3. **Clase de hoy** (celular/tablet del profe): inscritos con nombre, "Menor", precio aplicado y si debe pago; botones **Asistió / Faltó**; **walk-in** (buscar persona o crearla ahí mismo con nombre + celular); **cobrar** a los de pago en el gym; marca "sobrecupo" si aplica.
4. **Registrar Introductoria**: venta rápida (persona nueva o existente, fecha, monto, método), con o sin sesión.
5. **Personas / Membresías (mínimo)**: buscar o crear persona; "membresía vigente hasta…"; nota.
6. **Ajustes de clases** (solo admin): días de anticipación, horas para cancelar (12), clases gratis por mes (1), tolerancia de sobrecupo, si se permite pago en el gym, textos de reglas.
7. **Reporte**: asistencia por clase, faltas por persona (incluye quién aparta en el gym y no llega), clases gratis usadas, ingresos por clase (en línea vs gym) por mes → CSV para la contadora.

### 4.7 Reglas de negocio (en SQL, no en el navegador)
1. **Cupo**: reservas en `reservada`/`asistió`/`pendiente_pago` (no vencida) ≤ cupo. Validar con bloqueo de fila (`FOR UPDATE`, como en la competencia).
2. **Una reserva por persona por sesión.**
3. **Ventana de reserva**: no antes de N días; no después del inicio. Si la clase es "solo staff", el cliente no puede reservarla.
4. **Precio miembro**: solo si la membresía está vigente el día de la sesión.
5. **Clase gratis mensual**: solo miembros vigentes, solo clases marcadas como elegibles. Se cuenta por **mes calendario de la fecha de la sesión** (hora de México). Gastan la gratis: `reservada`, `pendiente_pago` no aplica, `asistió`, `faltó`, `cancelada_tarde`. La devuelven: `cancelada` (≥12 h) y `cancelada_por_gym`. **No se acumula.**
6. **Cancelación**: ≥12 h → `cancelada`. <12 h → `cancelada_tarde` (cuenta como falta, sin reembolso, gasta la gratis).
7. **Falta**: el profe marca. Automática al terminar la sesión **solo si ya se pasó lista** (al menos una persona marcada); si no, la sesión queda "sin pasar lista" para revisión.
8. **Pago en línea y sobrecupo**: la reserva queda `pendiente_pago` y aparta el lugar 15 min (ajuste). Si Clip confirma a tiempo → `reservada`. **Si el pago llega después de vencido el apartado**:
   - si hay lugar → se confirma;
   - si no hay lugar pero no se pasa de la **tolerancia de sobrecupo** (ajuste, propuesta 1) → se confirma y se marca "sobrecupo" en Clase de hoy;
   - si se pasa → queda pagada para **reagendar**, con aviso al cliente y al staff.
   Nunca se confirma un pago desde el navegador: siempre consultando la API de Clip.
9. **Pago en el gym**: `reservada` + `pending`; staff marca cobrada en Clase de hoy. Sin castigo por faltar (por ahora).
10. **Sesión cancelada por el gym**: todas las reservas → `cancelada_por_gym`, correo a todos, se devuelve la gratis.
11. **Mover sesión con reservas**: solo admin; manda correo a los inscritos con el cambio. Editar un horario semanal **no mueve** sesiones ya generadas que tengan reservas; solo afecta sesiones futuras vacías. Las que tengan gente se mueven una por una con aviso.
12. **Zona horaria**: `America/Mexico_City`.
13. **Auditoría**: cada cambio de staff/admin deja rastro.

### 4.8 Modelo de datos propuesto (Supabase / Postgres)

Nombres tentativos; prefijo `class_` para no chocar con lo existente.

**Decisión de arquitectura para Claude Code**: hoy `climbers.id` = usuario de Supabase Auth, así que no puede haber personas sin login. Opciones:
- (A) Nueva tabla `people` (persona) con `auth_user_id` opcional; `climbers` se enlaza a ella cuando hay login. Las reservas apuntan a `people`.
- (B) Crear usuarios de Auth "sin confirmar" para los walk-ins.
Propuesta: **A**, porque además es la base del CRM, las responsivas y los acompañantes. Revisar el impacto en leaderboard/sends antes de decidir.

```sql
-- Persona (cliente o prospecto); puede no tener login
people (
  id UUID PK, auth_user_id UUID NULL UNIQUE,   -- = climbers.id cuando tiene cuenta
  full_name TEXT, phone TEXT, email TEXT NULL, birth_date DATE NULL,
  source TEXT NULL,                            -- instagram, walk-in, web…
  created_by UUID NULL, created_at
)
-- (Fase 2) people_companions: titular → acompañante. Ver 4.10.

-- Ajustes globales de clases (una fila)
class_settings (
  id, book_ahead_days INT DEFAULT 7, cancel_hours INT DEFAULT 12,
  free_classes_per_month INT DEFAULT 1,
  overbook_tolerance INT DEFAULT 1,
  allow_pay_at_gym BOOLEAN DEFAULT true,
  online_hold_minutes INT DEFAULT 15,
  reminder_hours INT DEFAULT 24,
  rules_text TEXT, updated_at
)

-- Tipo de clase
class_types (
  id, name, description, level TEXT,
  default_capacity INT, default_duration_min INT,
  price_cents INT,                             -- precio normal (ej. 30000)
  member_price_cents INT NULL,                 -- precio miembro (ej. 10000); NULL = igual al normal
  eligible_free_monthly BOOLEAN DEFAULT false, -- entra en la gratis del mes
  booking_mode TEXT CHECK (booking_mode IN ('online','staff_only')),
  default_instructor_id UUID NULL,
  color TEXT, image_url TEXT, is_active BOOLEAN, sort_order INT, created_at
)

-- Horario semanal (plantilla)
class_schedules (
  id, class_type_id, weekday SMALLINT,         -- 0=domingo … 6=sábado
  start_time TIME, duration_min INT, capacity INT,
  instructor_id UUID NULL, starts_on DATE, ends_on DATE NULL, is_active BOOLEAN
)

-- Sesión concreta (generada desde horario o creada suelta)
class_sessions (
  id, class_type_id, schedule_id NULL,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, capacity INT,
  instructor_id UUID NULL,
  price_cents INT, member_price_cents INT NULL,  -- copia al generar; editable por sesión
  status TEXT CHECK (status IN ('scheduled','cancelled','finished')),
  attendance_taken BOOLEAN DEFAULT false,
  cancel_reason TEXT NULL, created_at,
  UNIQUE (schedule_id, starts_at)
)

-- Reserva
class_bookings (
  id, session_id, person_id,
  status TEXT CHECK (status IN ('pending_payment','booked','attended','no_show',
                                'cancelled','cancelled_late','cancelled_by_gym')),
  price_tier TEXT CHECK (price_tier IN ('regular','member','free_monthly','courtesy')),
  payment_method TEXT CHECK (payment_method IN ('online','at_gym','none')),
  payment_status TEXT CHECK (payment_status IN ('not_needed','pending','paid','refunded')),
  paid_with TEXT NULL,                         -- 'clip' | 'cash' | 'card'
  amount_cents INT, hold_expires_at TIMESTAMPTZ NULL,
  is_overbook BOOLEAN DEFAULT false,
  needs_reschedule BOOLEAN DEFAULT false,
  booked_at, cancelled_at, checked_at, created_by UUID NULL
)
-- Índice parcial (en Postgres va aparte, no dentro del CREATE TABLE):
CREATE UNIQUE INDEX class_bookings_one_active
  ON class_bookings (session_id, person_id)
  WHERE status NOT IN ('cancelled','cancelled_late','cancelled_by_gym');

-- Venta suelta (Introductoria sin sesión)
class_sales (
  id, class_type_id, person_id, sold_on DATE, amount_cents INT,
  paid_with TEXT, note TEXT, created_by UUID, created_at
)

-- Pagos en línea de clases (mismo patrón que competition_payments)
class_payments (... provider 'clip', provider_payment_id, payment_url, status, amount_cents, ...)
class_payment_events (... bitácora cruda, solo inserción ...)

-- Membresía mínima (semilla de la Fase 4)
memberships (
  id, person_id, plan_name TEXT, valid_from DATE, valid_until DATE,
  note TEXT, created_by UUID, created_at
)

class_audit_log (... igual que competition_audit_log ...)
```

RPCs tentativas:
- Públicas: `get_class_calendar(from, to)` (incluye si la persona tiene gratis disponible), `book_class(session_id, price_tier, payment_method)`, `cancel_booking(booking_id)`, `get_my_bookings()`.
- Edge Function `class-payments` (o extender `competition-payments`): link de Clip, webhook, consulta de estado, correos.
- Staff: `admin_upsert_person`, `admin_mark_attendance`, `admin_walk_in`, `admin_mark_paid`, `admin_register_sale`, `admin_set_membership`, `get_class_report(month)`.
- **Solo admin**: `admin_upsert_class_type`, `admin_upsert_schedule`, `admin_generate_sessions(weeks)`, `admin_cancel_session`, `admin_move_session` (con aviso), `admin_update_settings`.
- Cron: generar sesiones de las próximas semanas, marcar faltas (si se pasó lista), liberar holds vencidos, recordatorios.

Seguridad: RLS en todas las tablas sin políticas abiertas; todo pasa por RPCs `SECURITY DEFINER` que validan rol (staff vs admin) y usuario.

### 4.9 Correos (Resend, remitente `hola@jaibamuro.com`)
- **Reserva confirmada** (fecha, hora, profe, precio aplicado, reglas, botón "Ver mis reservas").
- **Recordatorio** 24 h antes (ajuste), con `pg_cron`.
- **Cancelación** (si fue tarde: aviso de que se pierde / se gasta la gratis).
- **Sesión cancelada o movida por el gym** (disculpa, nueva fecha si aplica, qué pasa con su pago).
- **Pago recibido tarde / requiere reagendar**.
- Textos visibles y editables en el código; más adelante en un panel (Fase 3).

### 4.10 Pendiente: acompañantes (diseñar a fondo después)
Caso típico: una mamá con cuenta reserva para sus dos hijos. Preguntas a resolver:
- ¿El acompañante es una persona propia en `people` (con su historial y responsiva) ligada al titular?
- ¿Quién recibe los correos? ¿Quién paga?
- ¿Un acompañante adulto puede después tener su propia cuenta y "independizarse"?
- ¿Cuenta la gratis del mes del titular o del acompañante (si también es miembro)?
- Responsiva de menor firmada por el tutor.

### 4.11 Pruebas antes de publicar
- SQL en **PGlite**: cupo con dos reservas simultáneas al último lugar, ventanas, cancelación en el borde de 12 h, clase gratis (mes calendario, no acumulable, devolución al cancelar a tiempo, gasto al faltar o cancelar tarde), precio miembro con membresía vencida, pago tardío con y sin lugar y con tolerancia de sobrecupo, falta automática solo con lista pasada, permisos (anon / cliente / staff / admin).
- Edge Function con Clip y Resend falsos.
- Pantallas en local con datos de prueba.
- En producción: una clase de prueba, reservar con la cuenta del dueño, pagar $1 si hace falta, cancelar, revisar correos; luego borrar la prueba.

### 4.12 Entregas y despliegue

**Fase 1a (para arrancar clases ya):**
- Personas (crear sin login), membresía mínima.
- Tipos de clase, horarios, sesiones, ajustes (todo editable por admin).
- Reserva con precio miembro, clase gratis mensual o pago en el gym.
- Cancelación con regla de 12 h.
- Clase de hoy (asistencia, walk-in, cobrar en mostrador).
- Registrar Introductoria.
- Correo de confirmación y de cancelación.

**Fase 1b:**
- Pago en línea con Clip (apartado, pago tardío, sobrecupo, reagendar).
- Recordatorios, falta automática, mover sesión con aviso.
- Reportes y CSV.

**Despliegue (igual para ambas):**
1. SQL nuevo en `src/supabase/clases.sql` (+ `clases_pagos.sql` en 1b) → el dueño da **Run**.
2. Edge Function → el dueño da **Deploy** (Verify JWT apagado si recibe webhook de Clip).
3. Frontend → `git push`.
4. "Clases" en el menú de staff y enlace en la página principal / Mi cuenta.

Estimación gruesa: 1a en ~1 semana; 1b en ~1 semana más. Lo más delicado son los pagos en línea (pero el patrón ya existe).

**Estado (2026-10-23):** Fase 1a programada (commit `d758710`): `src/supabase/clases.sql`, Edge Function `class-emails`, `/clases`, `/staff/clases`. Se eligió la **opción A** (tabla `people`). Escalada Jueves 17:00 (profe: el dueño), Calistenia lunes y miércoles 17:00 (coach externo), cupo 6, 60 min. Falta Run del SQL y desplegar `class-emails`.

---

## 4b. Perfil de cliente, ventas y caja (siguiente paso, pedido 2026-10-23)

El dueño quiere el **perfil de cliente "bien planchado"** para poder **vender desde ahí** (como en EVO). Todo vive dentro de `app.jaibamuro.com` (misma base, mismas cuentas, mismo panel de staff); `jaibamuro.com` sigue siendo la página de presentación con botones hacia la app.

### 4b.1 Cómo lo hace EVO (revisado 2026-10-23 con la ficha del dueño, sin vender nada)

**Ficha del cliente** (encabezado: foto, nombre, código, estado del plan, botón **NUEVA VENTA**). Pestañas: Perfil · Registro · Financiero · Ventas · Seguimiento · Planes · Invitados · Clases · Actividades.
- **Perfil (resumen):** estado de acceso (bloqueado/permitido), pendientes, planes (nombre, vigencia, estado), cargos próximos, historial de ventas (ID, fecha, qué se vendió, valor), uso de la app, "Acerca de" (nombre, correo, celular, CURP, nacimiento, observaciones, antigüedad), frecuencia de visitas y **riesgo de abandono**, saldo deudor / saldo a favor, historial de contactos (correos/notificaciones enviados).
- **Registro (datos):** nombre, apellido, apodo, género, país, CURP, RFC, nacimiento, profesión, estado civil, nombre preferido; contactos (celular con lada, correo); dirección completa; vencimiento de exámenes (médico, nutricional, dermatológico, evaluación física); **contactos de emergencia**; preferencias (no correos / no llamadas / no SMS-WhatsApp); acceso con QR; credencial; observaciones. Sub-pestañas: Datos personales, Interacciones, Documentos, **Responsables** (tutores), Formas de cobro.

**Venta (3 pasos):**
1. **Nueva venta:** pestañas Planes / Productos / Servicios. Al elegir un plan pide fecha de inicio y calcula el vencimiento; campos "Acuerdo" (convenio), **Descuento**, Observaciones; carrito con subtotal, impuesto, descuento y total.
2. **Cobro:** Tarjetas (crédito/débito, terminal o en línea, operadora, monto, meses, autorización, últimos 4), Efectivo, Transferencia. Se pueden **combinar varios pagos**; si pagan de más genera **crédito** (saldo a favor).
3. **Resumen de la venta.**

**Caja:** no se puede vender sin **abrir caja** (monto inicial). Es **una caja por empleado**; muestra totales del día por forma de pago (efectivo, cheque, tarjetas, otros), ventas, ingresos y egresos. Acciones: **Retirada** (sacar efectivo), **Pago** (gasto pagado con la caja), Exportar, Imprimir, **Cerrar caja** (confirmación + usuario y contraseña; no pide contar el efectivo).

**Planes que existen hoy en EVO:** Membresía Domiciliación $600/mes (recurrente), Membresía Mensual $1,000 (1 mes), Membresía Trimestral $2,800 (3 meses), Pase Diario $120 (1 día), Membresía Parejas $0 (precio sin configurar o se pone a mano).

### 4b.2 Propuesta para Relámpago (más simple)

**Ficha de persona** (`/staff/personas/:id`), en una sola pantalla con secciones:
- Encabezado: nombre, "Miembro hasta…" o "Sin membresía", menor de edad, **botón Vender**.
- **Datos:** nombre, celular, correo, nacimiento, de dónde llegó, contacto de emergencia, tutor (si es menor), preferencias de contacto, nota. (Sin CURP/RFC/exámenes por ahora.)
- **Membresía:** vigente/vencida, historial de membresías.
- **Ventas:** historial (fecha, qué, monto, cómo pagó, quién vendió).
- **Clases:** próximas reservas, asistencias, faltas, clase gratis del mes usada o no.
- **Saldo a favor** (si se implementa).
- **Notas / seguimiento:** notas con fecha y autor (semilla del CRM).

**Catálogo de productos** (admin edita): planes (con duración en días/meses → al venderlos crean/extienden la membresía), pases (día), clases sueltas (Introductoria), y productos físicos simples (si los vende: magnesia, renta de zapatos…).

**Venta** (un solo paso, no tres): elegir artículos → descuento opcional → forma de pago (efectivo / tarjeta en terminal / transferencia; combinable) → listo. Al vender un plan, la membresía se crea o se extiende sola desde la fecha elegida (por defecto: hoy, o el día siguiente al vencimiento si sigue vigente).

**Caja simple:** "turno" por persona de staff: abrir con efectivo inicial, ver ventas del turno por forma de pago, registrar **retiros/gastos**, y **cerrar contando el efectivo** (Relámpago compara lo contado con lo esperado y guarda la diferencia — EVO no hace esto). Reporte mensual para la contadora.

### 4b.3 Preguntas para el dueño (antes de programar)
1. ¿Se deben **migrar** los clientes y prospectos de EVO (22 + 500) a Relámpago, o empezar de cero y ir capturando?
2. ¿Qué **productos** vende además de planes (magnesia, renta de equipo, bebidas…)?
3. ¿Quiere **caja por turno** obligatoria para vender, o solo un corte del día?
4. ¿Qué **datos** del cliente son obligatorios? (Propuesta: nombre y celular; correo para que tenga cuenta.)
5. ¿Membresía Parejas cómo funciona? (¿dos personas, un pago?)
6. ¿Descuentos libres o una lista fija (estudiante, convenio…)?
7. ¿Saldo a favor sí o no?

---

## 5. Preguntas abiertas

**Respondidas el 2026-10-23** (ver 4.1 y 4.2): clases iniciales, membresía y gratis mensual, pago en el gym sin castigo, walk-ins con cuenta creada por staff, reembolso = reagendar, mover sesiones solo admin, cancelación tarde, sobrecupo tolerado con plan, EVO se apaga eventualmente.

**Respondidas después:** Escalada Jueves 17:00 la da el dueño; Calistenia lunes y miércoles 17:00 coach externo; cupo 6 ambas; 60 min por defecto (editable). Persona sin login: opción A (`people`). Planes de EVO: ver 4b.1.

**Pendientes:**
1. Nombre del coach de Calistenia.
3. **Acompañantes**: diseño completo (ver 4.10).
4. Perfil de cliente, ventas y caja: preguntas de la sección 4b.3.
5. ¿Recordatorio 24 h antes, la mañana del día, o ambos?
6. ¿Las clases deben verse en la TV o en la landing `jaibamuro.com`?
7. Menores: ¿qué responsiva? (Fase 2).
8. ¿Qué planes/membresías vende hoy y a qué precio? (Fase 4).
9. ¿Qué correos automáticos quiere sí o sí? (Fase 3).
10. ¿Qué información del cliente necesita ver en su ficha? (Fase 2).
11. Reconocimiento facial y torniquete: ¿qué aparato? (Fase 6; requiere consentimiento biométrico).

---

## 6. Cómo retomar este trabajo

**Si lo retoma Claude Code (en este repo):**
1. Leer este documento y `docs/bitacora.md`.
2. Revisar el patrón de la competencia: `src/supabase/competencia*.sql`, `supabase/functions/competition-payments/index.ts`, `src/pages/public/CompetitionPage.tsx`, `src/pages/staff/CompetitionAdminPage.tsx`.
3. Decidir con el dueño el punto 4 de la sección 5 (personas sin login) antes de escribir SQL.
4. Empezar por la Fase 1a. Recordar: el dueño da Run/Deploy en Supabase; `npx tsc -b` antes de push; actualizar bitácora.

**Si se lo das a Claude en el chat:**
- "Diseñemos a fondo los acompañantes (sección 4.10)."
- "Propón los textos de los correos de la sección 4.9."
- "Diseña cómo se vería la pantalla `/clases` en el celular."

---

## 7. Historial de este documento
- **2026-10-23 (v1)**: creado. Investigación de EVO (clases), decisiones de cobro/faltas/cancelación/lista de espera, plan de fases y diseño de la Fase 1.
- **2026-10-23 (v3)**: Fase 1a programada; sección 4b con la ficha de cliente, venta y caja de EVO y la propuesta para Relámpago; planes reales de EVO.
- **2026-10-23 (v2)**: catálogo inicial de 3 clases con precios; membresía = precio miembro + 1 clase gratis mensual no acumulable (mes calendario); cancelación tarde gasta la gratis; reembolso = reagendar; sin castigo a pago en el gym; plan de sobrecupo; toda persona con cuenta (personas sin login creadas por staff); acompañantes pendiente; mover sesiones solo admin con aviso; Fase 1 dividida en 1a/1b; reconocimiento facial + torniquete en Fase 6; corregido el índice único parcial.
