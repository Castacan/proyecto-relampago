# Bitácora — Proyecto Relámpago (Jaibamuro)

Registro de lo que se va haciendo, sesión por sesión. Lo más reciente arriba.

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
