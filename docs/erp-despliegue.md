# ERP de Jaibamuro — qué se construyó y cómo dejarlo en vivo

> Creado 2026-10-23. Complementa `docs/plan-erp-clases.md` (el plan) y `docs/bitacora.md` (la cronología).

## 1. Qué hay

**Panel de staff (`/staff`) con menú lateral desplegable** (en el celular se abre con ☰):

| Sección | Ruta | Qué hace |
|---|---|---|
| Inicio | `/staff/inicio` | Caja, ventas del día, clases de hoy, cobros de domiciliación con problema, membresías por vencer, tarjetas pendientes, cumpleaños |
| Clientes → Personas | `/staff/personas` | Buscar / crear personas |
| Ficha | `/staff/personas/:id` | Datos (emergencia, tutor si es menor), membresía, domiciliación, compras, clases, notas de seguimiento; botones **Vender** y **Domiciliar** |
| Clientes → Domiciliaciones | `/staff/domiciliaciones` | Todas las domiciliaciones, filtros, "Cobrar lo que toca hoy" (admin) |
| Ventas → Vender | `/staff/vender` | Punto de venta: persona, artículos, descuentos, pagos combinados, cambio |
| Ventas → Caja | `/staff/caja` | Abrir con fondo, retiros/gastos, **corte contando el efectivo** (guarda diferencia), historial |
| Ventas → Historial | `/staff/ventas` | Ventas por fechas, detalle, anular (admin), CSV |
| Ventas → Reporte del mes | `/staff/reportes` | Por forma de pago, concepto, día y cortes; CSV para la contadora |
| Ventas → Inventario | `/staff/inventario` | Existencias, entradas (con egreso opcional), conteos, salidas por consumo/merma, movimientos, valor a costo |
| Finanzas → Egresos | `/staff/egresos` | (admin) Cuentas a pagar: egresos pagados/por pagar, recurrentes, a quién se paga, centros de costos, utilidad del mes, CSV |
| Clases | `/staff/clases` | (Fase 1a) asistencia, cobros, walk-ins, configuración de clases |
| Configuración → Productos y planes | `/staff/config/productos` | Catálogo; promo de domiciliación (meses + precio, prender/apagar) |
| Configuración → Integraciones y pagos | `/staff/config/integraciones` | Elegir Openpay/Stripe, llaves públicas, sandbox, estado de secretos, probar conexión, webhooks |
| Configuración → Ajustes generales | `/staff/config/general` | Caja obligatoria, reintentos de cobro, vigencia del link, aviso de vencimientos |
| Ver como cliente ↗ | `/mi-cuenta` | Abre la app del lado del cliente |

**Del lado del cliente:**
- `/mi-cuenta`: ahora arriba muestra **Mi membresía** (vigencia, clase gratis del mes), **domiciliación** (tarjeta, próximo cobro, botón para registrar/cambiar tarjeta), acceso a **Mis clases** y **Mis compras**.
- `/clases`: reservar clases.
- `/domiciliacion/:token`: registrar tarjeta (Openpay.js o Stripe.js; el número de tarjeta nunca pasa por nuestro servidor).

**Para entrar como cliente:** en la app (`app.jaibamuro.com`) cierra sesión de staff, entra con "Iniciar sesión" usando cualquier correo (te llega un código), y en `/clases` completa tus datos. Para que veas membresía/domiciliación en ese usuario, búscalo en Personas (aparece con "Con cuenta") y véndele algo o domicílialo.

## 2. Catálogo inicial (editable)

| Producto | Precio | Notas |
|---|---|---|
| Membresía Domiciliación | $800/mes | Recurrente; **promo activa: 3 meses a $600** (se puede apagar; quien ya la tiene la conserva) |
| Membresía Mensual | $1,000 | 1 mes |
| Membresía Trimestral | $2,800 | 3 meses |
| Pase Diario | $120 | No da membresía |
| Clase Introductoria | $200 | Ligada a la clase Introductoria |

Membresía Parejas **no** se creó (ya no se vende).

## 3. Cómo funciona la domiciliación

- El calendario, la promoción y los reintentos los lleva **nuestra base**; el proveedor (Openpay o Stripe) solo guarda la tarjeta y cobra cuando se le pide. Así se puede cambiar de proveedor sin rehacer nada.
- Alta: Ficha → **Domiciliar** → elegir plan (y si aplica promo) → sale un **link**. Se abre en la tablet del gym o se manda por WhatsApp. La persona registra su tarjeta; si ya toca, se cobra al momento.
- Si ya tiene membresía pagada, el primer cobro se programa **al día siguiente de que venza** (no se cobra doble).
- Cada mes, el cobro automático (pg_cron, cada hora de 9:00 a 21:00) cobra lo que toque. Éxito → venta + membresía del mes + recibo por correo.
- Rechazo → reintentos a los **1, 3 y 5 días** (configurable) + correo con link para cambiar tarjeta; en el Inicio aparece como "cobro con problema". Al cambiar tarjeta se reintenta al instante.
- **Sin cobros dobles:** cada intento tiene llave única (Openpay `order_id`, Stripe `Idempotency-Key`); si la respuesta no llega, no se marca fallido: se le pregunta al proveedor con la misma llave antes de reintentar.
- Cancelar: al terminar lo pagado (default) o de inmediato.
- Probado con proveedores simulados (36 casos, incluidos timeouts, duplicados, corridas simultáneas, webhooks, 3DS). **Falta probarlo con el sandbox real de Openpay/Stripe.**

## 4. Pasos para dejarlo en vivo (el dueño da Run/Deploy)

1. **SQL Editor → Run**, en este orden (cada uno es idempotente):
   1. `src/supabase/clases.sql` (si aún no se corrió)
   2. `src/supabase/erp.sql`
   3. `src/supabase/erp_finanzas.sql` (egresos + inventario; **siempre después de erp.sql**, también si se vuelve a correr erp.sql)
   4. `src/supabase/erp_crm.sql` (responsivas, archivos, acceso, empleados, estados, correos, bitácora; después de erp_finanzas.sql). Crea el bucket privado `expedientes`.
   5. Edge Function `crm-emails` (Verify JWT apagado) y luego `src/supabase/erp_crm_cron.sql` (toma solo la llave del cron de cobros).
   6. `src/supabase/erp_checklist.sql` (checklist diario del staff; después de erp_crm.sql). Crea el bucket privado `checklist` y la plantilla inicial (solo si está vacía).
   7. `src/supabase/erp_caja_cierre.sql` (cierre automático de caja + aviso al admin; **siempre al final**, también si se vuelve a correr erp.sql o erp_checklist.sql). Programa el cron `erp-cierre-caja` (00:05 de México) y requiere la versión de `crm-emails` con la acción `cash_alert`.
2. **Edge Functions → crear y desplegar** (Verify JWT **apagado** en las dos):
   - `class-emails` (código en `supabase/functions/class-emails/index.ts`)
   - `billing` (código en `supabase/functions/billing/index.ts`)
3. **Secrets** (Edge Functions → Secrets):
   - `OPENPAY_PRIVATE_KEY` = llave privada de Openpay (**de sandbox** para probar primero)
   - (si se usa Stripe) `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - (recomendado) `BILLING_CRON_KEY` = una contraseña larga inventada
4. En el panel: **Configuración → Integraciones**: elegir Openpay, ID de comercio, llave pública, dejar "Modo pruebas", **Guardar**, **Probar conexión**.
5. Webhook de Openpay: dar de alta la dirección que muestra la pantalla; el código de verificación queda en la bitácora (`billing_events`).
6. **SQL Editor → Run** `src/supabase/erp_cron.sql` (poniendo el `BILLING_CRON_KEY` si se definió).
7. Prueba completa en sandbox: crear persona de prueba con tu correo → Domiciliar → registrar tarjeta 4111 1111 1111 1111 → ver venta, membresía y recibo; probar una tarjeta de rechazo.
8. Pasar a producción: cambiar el secreto a la llave privada de producción, la llave pública y el ID de producción, y quitar "Modo pruebas".

## 5. Decisiones que tomé (para revisar juntos)

- Motor de domiciliación propio (no "suscripciones" del proveedor) para que la promo funcione igual en Openpay y Stripe.
- Caja única por día (no una por empleado); el corte **pide contar el efectivo** y exige nota si no cuadra.
- No se puede vender (ni cobrar clases) con la caja cerrada (se puede apagar en Ajustes).
- Los precios solo los cambia un admin; el staff puede poner descuentos.
- Anular una venta (admin) anula la membresía que dio; el dinero se devuelve por fuera.
- Los cobros de domiciliación no se anulan desde el panel (se reembolsan en el proveedor).
- El cliente puede cambiar su tarjeta desde Mi cuenta, pero **cancelar la domiciliación lo hace el staff**.
- Reintentos 1, 3 y 5 días; después ya no se intenta solo (queda "cobro pendiente").
- Inicio del primer cobro: hoy, o al vencer su membresía vigente.

## 6. Ideas de EVO para más adelante

Congelar/suspender membresía (con límites), restricciones por edad/género en planes, límite de entradas por día/semana, convenios/empresas con descuento, cupones, club de recompensas, comisiones de vendedores, cuentas por pagar, evaluaciones físicas, PAR-Q / responsiva digital, control de acceso con QR o torniquete, campañas de correo/WhatsApp segmentadas, automatizaciones (ausentes, cumpleaños, vencimientos).
