# Auditoría de Estado Actual — Sistema Relámpago / Jaibamuro

Fecha de esta auditoría: **2026-07-25**. Último commit en `main`: `d3026a1`.

Convención de nombres en este documento: **Jaibamuro** = la marca/negocio de cara al cliente (el gym). **Relámpago** ("Proyecto Relámpago") = nombre interno del repositorio/sistema técnico. El código y los documentos previos usan ambos términos de forma mezclada; ver Sección 9 para el detalle de qué tan completo está el rebranding.

Metodología: todo lo descrito aquí viene de leer el código fuente directamente (no de los `.md` previos), de consultar la base de datos de Supabase en vivo vía REST (conteos de filas reales), y del historial de git. Donde hay contradicción con `ARQUITECTURA_VISUAL.md`, `DOCUMENTACION.md` o `docs/LEADERBOARD_PANTALLA.md`, se prioriza el estado real del código y se señala explícitamente. No existe un archivo `CADENA_PANORAMICA.md` en el repo — el contenido equivalente vive dentro de `DOCUMENTACION.md` (§6) y `ARQUITECTURA_VISUAL.md`.

---

## 1. Stack técnico y arquitectura general

**Framework:** React 19.1.0 + TypeScript ~5.8.3, sobre Vite 6.3.5 (no Next.js — SPA pura con `react-router-dom` 7.6.2 en modo `BrowserRouter`, sin SSR/SSG).

**Librerías clave:**
| Librería | Versión | Uso |
|---|---|---|
| `@supabase/supabase-js` | ^2.49.8 | Cliente único de datos + auth + storage + realtime |
| `konva` / `react-konva` | ^9.3.20 / ^19.0.7 | Canvas panorámico (`ChainCanvas`) |
| `tailwindcss` / `@tailwindcss/vite` | ^4.1.6 / ^4.3.1 | Estilos — Tailwind v4 "CSS-first", **sin `tailwind.config.js`** |
| `jsqr` | ^1.4.0 | Lectura de QR desde `<canvas>`/cámara (staff y ahora cliente) |
| `react-qr-code` | ^2.2.0 | Generación visual de QR (inventario, impresión) |

No hay Zustand/Redux/React Query — todo el estado de datos es `useState` + hooks custom con `fetch` directo a Supabase por componente.

**Estructura de carpetas (raíz del proyecto):**
```
src/
  components/   13 componentes reutilizables (ver Sección 5)
  hooks/        9 hooks de datos (useZones, useRoutes, useVolumes, useChain, useAuth, useProfile, useClimber, useLeaderboard, useQrByRoute, useVolumeCatalog)
  lib/          8 módulos: auth.ts, chain.ts, colors.ts, device.ts, freshness.ts, points.ts, supabase.ts, zoneGroups.ts
  pages/
    public/     PublicWallPage, PublicRoutePage, LeaderboardDisplay, MyAccountPage
    staff/      LoginPage, StaffLayout, WallPage, QrInventoryPage, AdminPage, StatsPage, CalibrationPage, VolumeCatalogPage
  supabase/     schema.sql, seed.sql, zones_update.sql (desactualizados, ver Sección 7)
  types/        index.ts (tipos de dominio, a mano) y database.ts (tipos "generados", stale)
docs/           EMAIL_SETUP.md, LEADERBOARD_PANTALLA.md
public/wall/    2 imágenes de prueba sin usar (ver Sección 9)
ARQUITECTURA_VISUAL.md, DOCUMENTACION.md   docs de arquitectura previas (parcialmente desactualizadas)
```

**Deploy:** Vercel, proyecto `Proyecto-Relampago` bajo la org `Castacan's Org` (plan Free), branch `main` → producción automática en cada push. `vercel.json` solo define un rewrite SPA (`/(.*) → /index.html`); no hay configuración de build custom, Vercel usa detección automática de Vite (`npm run build` → `tsc -b && vite build`). Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (clave pública "publishable", expuesta al cliente por diseño). No verificado desde este documento si estas variables están configuradas en el dashboard de Vercel además de en `.env` local — hay que confirmarlo ahí directamente.

---

## 2. Mapa completo del sitio (rutas)

Fuente: `src/App.tsx`, única definición de rutas del proyecto.

| Path | Qué muestra | Acceso | Cómo se llega | Estado |
|---|---|---|---|---|
| `/` | Nada propio — `<Navigate to="/muro" replace>` inmediato | Público | Escribir el dominio pelón | Implementado. No existe una landing/home de marketing; el dominio raíz *es* la vista del muro. |
| `/muro` | Canvas panorámico público del muro (`PublicWallPage`) | Público | URL directa, o redirect desde `/` | Implementado y funcionando |
| `/q/:qrId` | Ficha pública de una ruta (`PublicRoutePage`) | Público | **QR físico pegado en la pared** (uso principal), o URL directa | Implementado y funcionando |
| `/leaderboard/display` | Pantalla de leaderboard para TV del gym | Público — **sin ninguna protección de ruta ni de rol** | URL escrita manualmente en el dispositivo/TV que la muestra | Implementado y funcionando en código; en producción casi sin uso real (ver Sección 8) |
| `/mi-cuenta` | Perfil del cliente/climber: alias, puntos, historial | Público a nivel de ruta; el contenido exige sesión de climber (si no hay sesión, muestra pantalla de login) | Ícono en el header de `/q/:qrId`, o URL directa | Implementado y funcionando |
| `/login` | Formulario email + contraseña para staff | Público (es el propio formulario) | URL directa (no hay link visible desde vistas públicas) | Implementado y funcionando |
| `/staff` (index) | `WallPage` — muro editable para dibujar rutas/volúmenes | Requiere sesión Supabase (cualquiera — ver hueco en Sección 9) | Tras login en `/login`, o URL directa si ya hay sesión | Implementado y funcionando |
| `/staff/qr` | Inventario de QR codes | Requiere sesión (cualquiera) | Tab bar de staff | Implementado y funcionando |
| `/staff/stats` | Dashboard de estadísticas | Requiere sesión + **rol admin verificado en código** (`StatsPage.tsx:150-155`) | Tab bar, solo visible si `profile.role === 'admin'` | Implementado y funcionando |
| `/staff/admin` | Config de cadena, catálogo de volúmenes, generar QRs, exportar CSV, restaurar rutas | Requiere sesión (cualquiera) — **sin verificación de rol admin en el código de la página**, solo el tab está oculto a no-admins | Tab bar (solo admins la ven), o URL directa por cualquier staff logueado | Implementado y funcionando, con hueco de control de acceso (Sección 9) |
| `/staff/calibration` | Herramienta de calibración de pares de puntos entre zonas | Requiere sesión (cualquiera) — **mismo hueco**: sin guard de rol en el código | Botón dentro de `/staff/admin`, o URL directa | Implementado y funcionando, con el mismo hueco |
| `/staff/volume-catalog` | Catálogo de formas de volúmenes (dibujar, nombrar, cantidad) | Requiere sesión + **rol admin verificado en código** (`VolumeCatalogPage.tsx:277-282`) | Botón dentro de `/staff/admin` | Implementado y funcionando |

---

## 3. Descripción textual de las pantallas clave

### 3.1 Home / raíz (`/`)
No existe una pantalla propia: `App.tsx` redirige de inmediato a `/muro`. Alguien que entra al dominio sin QR y sin sesión ve exactamente lo descrito en 3.3 (vista de zona pública), empezando en la primera zona de la cadena ("Pared Izquierda").

### 3.2 Ficha pública de una ruta — `/q/:qrId` (`PublicRoutePage.tsx`)
**Orden vertical de elementos:**
1. Barra de color superior (1.5 · altura, color sólido de la ruta) — todo el ancho.
2. Mini-header: link "← Muro" a la izquierda; si hay sesión, un círculo de avatar (inicial del alias o ⚡) a la derecha que enlaza a `/mi-cuenta`.
3. `LoginBanner` — solo si NO hay sesión: barra sutil zinc-900, ícono ⚡, texto "Inicia sesión para sumar puntos al leaderboard", botón "Entrar", botón ✕ para descartar (se guarda en `sessionStorage`, reaparece si se cierra el navegador).
4. Bloque de identidad de la ruta: swatch de color 64×64 redondeado + grado en fuente mono gigante (`text-5xl`) + nombre de color + nombre de zona.
5. Badge de frescura: píldora con punto pulsante + etiqueta ("Crudo" / "Al dente" / "Quemada").
6. `SendButton` — botón principal de gamificación (ver estados abajo).
7. Sección Beta: si no hay beta subida, placeholder "🎬 Beta no disponible aún"; si hay beta y no se ha revelado, botón "👁 Ver beta"; al tocar, se muestra la imagen/gif.
8. Sección de voto, empujada al fondo con `mt-auto`: título "¿Qué te pareció?" + `VoteButtons` (👍/👎 grandes).
9. Footer centrado: "⚡ Jaibamuro".

**Estados de `SendButton`:** sin sesión (CTA gris "Inicia sesión para sumar N puntos") → con sesión sin perfil de climber (CTA "Completa tu perfil...") → listo (botón amarillo grande "🏆 YA LO COMPLETÉ +N pts") → cargando (spinner) → éxito (card verde con puntos ganados) → ya enviado hoy → **`no_scan`** (pide reconfirmar con QR: desde el commit `9ca7e87` esto abre `ConfirmScanModal` in-app en vez de mandar a la cámara nativa del sistema) → error.

**Estados de página completa (antes de llegar al contenido normal):** cargando (spinner centrado), QR no reconocido (🤔), QR disponible/sin asignar (📦, con CTA "Crear ruta" solo si hay sesión), ruta retirada (🏁, CTA "Ver el muro").

### 3.3 Vista de zona / canvas panorámico (`ChainCanvas`, usado en `/muro` y `/staff`)
**Interacción de scroll:** pan horizontal por arrastre (mouse o touch), zoom por pellizco (`MIN_ZOOM=0.35`, `MAX_ZOOM=5`) y por rueda del mouse en desktop, doble-tap resetea el zoom a 1 con animación de 180ms. Al llegar al borde de una foto, arrastrar más allá produce un "peek" (asoma la siguiente/anterior foto) y, si se suelta pasando 40px de umbral o con swipe rápido (>0.35px/ms), dispara una transición animada de 240ms (ease-out-cubic) a la zona vecina.

**Overlays (público, `/muro`):**
- Header fijo arriba: logo (cuadrito amarillo + ⚡) + wordmark "Jaibamuro" a la izquierda; píldora "N rutas" con punto verde a la derecha.
- Botón "Mapa" (esquina superior derecha, colapsado por defecto): al tocarlo despliega un minimapa SVG esquemático de todo el muro (polígonos por zona coloreados según frescura de la ruta más vieja, badges numéricos de conteo, zona activa resaltada en blanco); botón ✕ para colapsar de nuevo.
- Badge de zona activa (esquina superior izquierda): nombre de la zona visible actualmente.
- Estado vacío: "No hay rutas todavía" centrado si `routes.length === 0`.
- Rutas dibujadas como `Line` de Konva sobre la foto, con badge de frescura flotante (etiqueta pública "Crudo/Al dente/Quemada" en vez de días) anclado sobre el punto más alto de cada ruta, con algoritmo de separación (push-apart) para que los badges no se encimen entre sí.

**Overlays adicionales en `/staff` (`WallPage`):** mismo canvas más badge de zona con conteo "`X rutas · Y vols`", hints contextuales flotantes según el modo activo (dibujando, revisando, reposicionando volumen, ajustando volumen, colocando desde catálogo), barra de acciones inferior (botones "Volumen" / "+ Nueva ruta" en reposo; cambia según el modo), y varios bottom sheets (selector de color, selector de volumen de catálogo, action sheet de volumen, formulario de ruta nueva).

### 3.4 Dashboard admin (`/staff/stats`, `StatsPage.tsx`)
Toggle superior "Actuales / Históricas" (píldora amarilla). Debajo, en orden:
1. Fila de 3 stat-cards grandes (varía según toggle: activas/promedio días/la más vieja en "Actuales"; total/activas/retiradas en "Históricas").
2. Card "Por zona" — gráfica de barras horizontales, 5 zonas agrupadas (Pared Izq, Flanco Túnel Izq, Desplome, Flanco Túnel Der, Pared Der).
3. Card "Por color" — gráfica de columnas, 14 colores con su hex real, punto de color como leyenda en vez de texto.
4. Card "Por grado" — columnas V0-V9 en amarillo.
5. Card "Color × Grado" — solo colores con ≥1 ruta, chips de grado (`V3 ×2`).
6. Card "Volúmenes" — stats de activos/vida promedio (o total/activos/retirados + vida promedio en históricas).
7. Card "Frescura" — barra apilada horizontal + leyenda con conteos, **solo visible en vista "Actuales"**.

Guard: si `profile.role !== 'admin'`, redirige a `/staff`.

### 3.5 Herramienta de calibración (`/staff/calibration`, `CalibrationPage.tsx`)
Selector de cadena (píldoras — hoy solo existe una cadena, "Perímetro"). Por cada par de zonas adyacentes en la cadena, una card con: título "ZonaA → ZonaB", conteo de pares calibrados + porcentaje de transición calculado, botón Guardar (estados: Guardar / Guardando… / ✓ Guardado, deshabilitado si 0 pares); texto instructivo dinámico ("Paso 1: toca un punto en A" → "Paso 2: toca el mismo punto en B", con link "cancelar"); dos paneles de foto lado a lado (aspect 16:9, `object-contain` con letterboxing correctamente calculado), cada uno mostrando puntos numerados de colores (hasta 8, reutilizando una paleta de 8 colores) y dos polígonos punteados de referencia (amarillo = pares 1-4, azul = pares 5-8); chips removibles debajo con cada par. **No tiene guard de rol admin en el código** (ver Sección 9).

### 3.6 `/mi-cuenta` (`MyAccountPage.tsx`, feature reciente, commit `2aed906`)
Header: "← Muro" / título "Mi cuenta" / botón "Salir" (logout). Sin sesión: pantalla centrada (⚡, "Inicia sesión para ver tus puntos y estadísticas", botón CTA que abre `ClimberAuthSheet`, link "← Volver al muro"). Con sesión, en orden: card de alias editable (input de texto + checkbox "Aparecer en el leaderboard" + botón Guardar con 3 estados) · sección "Puntos" (2 stat-cards: hoy / mes actual, con posición en el ranking si > 0 puntos, vía RPC `get_my_stats`) · sección "Últimas rutas" (hasta 20 registros vía RPC `get_my_sends`, cada fila: punto de color + grado + zona + puntos ganados + fecha, o estado vacío "Aún no has marcado ninguna ruta") · email del usuario al fondo.

### 3.7 Pantalla de leaderboard para TV (`/leaderboard/display`, `LeaderboardDisplay.tsx`)
Pensada para pantalla completa sin interacción táctil (`select-none`). Ticker superior (h-14): anuncio rotativo cada 4s del send más reciente ("X mandó Y color"), o placeholder "Sé el primero en mandar hoy" si no hay eventos; indicador de reconexión si el canal Realtime se cae. Cuerpo dividido 65/35: leaderboard diario ("HOY" + fecha en español, filas con tamaño de fuente que escala según el rank — gigante para #1, mediano top-3, normal el resto) a la izquierda; leaderboard mensual (mes + rango de fechas) más compacto a la derecha. Footer: "⚡ El Muro · Jaibamuro". Actualización en tiempo real vía suscripción a `INSERT` en la tabla `sends` (Supabase Realtime).

### 3.8 `ClimberAuthSheet` — auth de cliente (usado en `/q/:qrId` y `/mi-cuenta`)
Bottom sheet con pasos: **email** (input + botón "Enviar link mágico") → **sent** (icono 📬, "revisa tu correo", **desde hoy** también un input de código de 6 dígitos con botón "Confirmar código" como alternativa al link — ver Sección 6 — más botón de reenvío con countdown de 30s y link "Cambiar correo") → **setup** (alias + checkbox de visibilidad + disclaimer de privacidad + botón "Entrar al leaderboard").

### 3.9 Móvil vs. desktop
El proyecto es mobile-first de forma explícita: botones grandes (`py-3.5`+), bottom sheets que se deslizan desde abajo (no se adaptan a modal centrado en desktop), zonas de tap amplias. En desktop, `ChainCanvas` gana soporte de rueda del mouse para pan/zoom que no existe en touch. No hay layout de escritorio dedicado en ninguna pantalla — todo usa el mismo `max-w-md mx-auto` o similar, dejando espacio vacío a los lados en pantallas anchas.

---

## 4. Sistema de branding y estilos

**Paleta:**
| Uso | Hex | Fuente |
|---|---|---|
| Fondo de página | `#09090b` | hardcodeado en `src/index.css` (equivale a zinc-950) |
| Texto base | `#fafafa` | hardcodeado en `src/index.css` |
| Acento primario (CTAs, highlights) | `#facc15` | Tailwind `yellow-400`, usado por clase utilitaria en todo el código, no como token propio |
| Frescura — verde ("Crudo") | `#22c55e` | `src/lib/freshness.ts` |
| Frescura — amarillo ("Al dente") | `#eab308` | `src/lib/freshness.ts` |
| Frescura — rojo ("Quemada") | `#ef4444` | `src/lib/freshness.ts` |
| 14 colores de presas | ver tabla abajo | `src/lib/colors.ts` |

Colores de presas (`ROUTE_COLORS`): Amarillo `#FACC15` · Azul `#3B82F6` · Rojo `#CC0000` · Verde `#22C55E` · Pantano `#5E7A3B` · Naranja `#F97316` · Fosfo `#FF3800` · Rosa `#EC4899` · Rosa Pálido `#F9A8D4` · Morado `#A855F7` · Negro `#1C1C1E` · Blanco `#F1F5F9` · Marmoleado `#8CBAD6` · Café `#78350F`.

El resto de la UI (fondos de cards, bordes, textos secundarios) usa directamente las clases `zinc-*` por defecto de Tailwind (`bg-zinc-900`, `border-zinc-800/80`, `text-zinc-500`, etc.) sin una paleta neutra propia definida.

**Tipografía:** Inter (pesos 400-900) para texto general, JetBrains Mono (pesos 700-800) para grados/datos numéricos — ambas cargadas desde Google Fonts CDN en `index.html`, declaradas como variables CSS (`--font-sans`, `--font-mono`) dentro de un bloque `@theme` en `src/index.css` (sintaxis "CSS-first" de Tailwind v4). **No hay una escala tipográfica formal** para heading/body/caption: cada pantalla aplica tamaños ad hoc vía utilidades (`text-2xl font-black` en un H1, `text-3xl` en otro, `text-sm`/`text-xs` para cuerpo/captions sin regla consistente).

**Spacing y radios:** sin tokens formalizados. Radios usados de forma repetida pero no centralizada: `rounded-xl` (cards pequeñas), `rounded-2xl` (el más común — cards, botones), `rounded-3xl` (bottom sheets, cards grandes), `rounded-full` (píldoras, círculos, avatares).

**Dónde vive la configuración:** no existe `tailwind.config.js` — Tailwind v4 se configura vía `@tailwindcss/vite` (plugin en `vite.config.ts`) + el bloque `@theme` de `src/index.css`, que **solo define las 2 variables de fuente**. Todo lo demás (colores, spacing, radios) usa la escala default de Tailwind sin extensión.

**Logo/marca:** no existe un archivo de logo. La "marca" en pantalla es literalmente el emoji ⚡ dentro de una caja `bg-yellow-400` redondeada, repetido como JSX inline en al menos 4 archivos (`LoginPage.tsx`, `StaffLayout.tsx`, `PublicWallPage.tsx`, y solo el emoji sin caja en el footer de `LeaderboardDisplay.tsx`). El favicon del navegador sigue siendo el `/vite.svg` por defecto de Vite — no relacionado con la marca. El wordmark es el texto plano "Jaibamuro" en `font-black tracking-tight`, sin tratamiento tipográfico propio.

---

## 5. Componentes UI reutilizables

| Componente | Propósito | Archivo | Props principales |
|---|---|---|---|
| `ChainCanvas` | Canvas panorámico principal (pan/zoom/dibujo/tap detection/badges) | `components/ChainCanvas/index.tsx` (1322 líneas) | `zones, anchors, routes, volumes, paintMode, isStaff, onRouteClick, onVolumeClick, onBlobComplete, jumpToZoneId`, y ~10 props más para los distintos modos de edición de volúmenes |
| `ZoneMap` | Minimapa SVG esquemático — modo completo (selector) y modo `mini` (overlay colapsable) | `components/ZoneMap/index.tsx` | `zones, routes, onZoneSelect, mini?, selectedZoneIds?, onCollapse?` |
| `RouteForm` | Bottom sheet para guardar una ruta nueva (color/grado/zona/notas) | `components/RouteForm/index.tsx` | `blobPath, zones, initialColor?, initialZoneId?, assignQrId?, onSave, onCancel` |
| `RouteDetail` | Bottom sheet staff: ver/editar/retirar ruta, votos, beta, QR | `components/RouteDetail/index.tsx` (355 líneas) | `route, zones, onClose, onUpdate, onRetire` |
| `VolumeDetail` | Bottom sheet staff: días en pared, date picker, retirar | `components/VolumeDetail/index.tsx` | `volume, zones, onClose, onRetire, onUpdate?` |
| `VoteButtons` | 👍/👎 públicos por `device_id` | `components/VoteButtons/index.tsx` | `routeId` |
| `SendButton` | Botón de gamificación "YA LO COMPLETÉ" con toda su máquina de estados | `components/SendButton/index.tsx` | `route, qrId, climber, climberLoading, onNeedAuth, onNeedOnboarding` |
| `ClimberAuthSheet` | Bottom sheet de auth de cliente (magic link + código OTP + onboarding) | `components/ClimberAuthSheet/index.tsx` | `isOpen, onClose, onDone, startAtSetup?` |
| `LoginBanner` | Banner sutil de login en la ficha pública | `components/LoginBanner/index.tsx` | `onEnter` |
| `ConfirmScanModal` | **Nuevo** (commit `9ca7e87`): re-escaneo de QR in-app para confirmar send | `components/ConfirmScanModal/index.tsx` | `qrId, routeId, userId, onConfirmed, onClose` |
| `QrScanner` | Escáner de cámara para asignar un QR físico a una ruta (staff) | `components/QrScanner/index.tsx` | `routeId, onAssigned, onClose` |
| `ErrorBoundary` | Boundary genérico, mensaje de error hardcodeado a "Error en AdminPage" aunque se usa también en Calibration/VolumeCatalog | `components/ErrorBoundary.tsx` | `children` |
| `ZoneCanvas` | **Legacy, sin uso** — versión anterior de canvas de una sola zona (pre-cadena panorámica) | `components/ZoneCanvas/index.tsx` (447 líneas) | — no se importa en ningún otro archivo del proyecto |

---

## 6. Estado del sistema de autenticación

Hay **dos identidades independientes que comparten la misma instancia de Supabase Auth** (`src/lib/supabase.ts`, `createClient` sin opciones custom de `auth`):

1. **Staff/admin:** email + contraseña (`supabase.auth.signInWithPassword`, `lib/auth.ts` función `signIn`). Gatea `/staff/*` a nivel de ruta vía `ProtectedRoute` en `App.tsx`, que solo verifica que exista *alguna* sesión — no el rol. El rol (`staff` | `admin`) vive en la tabla `profiles` y se verifica manualmente dentro de páginas específicas (ver Sección 9 para el hueco de cobertura).
2. **Cliente (climber):** passwordless. Dos mecanismos que llegan al mismo resultado:
   - **Magic link** (`signInWithOtp` con `emailRedirectTo`), tal como antes.
   - **Código de 6 dígitos** (`verifyOtp({ email, token, type: 'email' })`) — agregado hoy (`lib/auth.ts` función `verifyEmailOtp`, commit `9ca7e87`) para resolver un bug real reportado por el usuario: el link de magic link, al abrirse dentro del navegador embebido de la app de correo (Gmail webview), no comparte sesión con el navegador real del teléfono. El código no requiere salir de la pestaña. **Bloqueado en producción hoy:** el template de email de Supabase no permite mostrar el código porque el proyecto usa el servicio de correo default (sin Custom SMTP) — hace falta conectar Resend con un dominio propio para desbloquear la edición del template.
   - Primer login exitoso → onboarding (alias + visibilidad) → se crea el registro en `climbers` (tabla separada de `profiles`).

**`/mi-cuenta`:** implementada y funcional (ver 3.6). Depende de `useClimber()` (lee `climbers` por `session.user.id`) y de las RPCs `get_my_stats`/`get_my_sends`.

**Sesión y refresh tokens:** comportamiento 100% default del cliente de Supabase JS — no hay ninguna configuración custom de `flowType`, storage o duración en `lib/supabase.ts`. La expectativa de "60-90 días, recordarme para siempre" es una decisión de producto registrada en notas de proyecto, **no algo forzado por este código** — depende de la configuración del proyecto de Supabase en el dashboard (JWT expiry / refresh token reuse), no verificada desde aquí.

---

## 7. Modelo de datos actual

Confirmado contra la base de datos en vivo (consulta REST directa, 2026-07-25) — no contra `src/supabase/schema.sql`, que está desactualizado (ver Sección 9).

| Tabla | Campos principales | Relaciones |
|---|---|---|
| `zones` | name, slug, order_index, image_url, chain_id, chain_position | pertenece a 0 o 1 `chains` |
| `chains` | name, axis | tiene muchas `zones`, muchos `zone_anchors` |
| `zone_anchors` | chain_id, zone_a_id, zone_b_id, point_pairs[] (hasta 8 pares), overlaps legacy | une dos `zones` consecutivas dentro de una cadena |
| `routes` | color, grade, zone_id, chain_id, status, placed_at, retired_at, blob_path[], notes | pertenece a `zones`; referenciada por `qr_codes`, `votes`, `betas`, `sends` |
| `volumes` | zone_id, chain_id, perimeter[], details[][], zone_offsets{}, catalog_id, rotation, vol_scale, status, placed_at | opcionalmente referencia `volume_catalog` |
| `volume_catalog` | name, shape[] (normalizado 0-1), details[][], quantity | referenciada por `volumes.catalog_id` |
| `qr_codes` | status (available/in_use), route_id | 1:1 opcional con `routes` |
| `votes` | route_id + device_id (PK compuesta), value | pertenece a `routes` |
| `betas` | route_id, file_url, uploaded_by | pertenece a `routes`; sube a Supabase Storage |
| `profiles` | name, role (staff/admin) | 1:1 con `auth.users`, creado automáticamente por trigger `on_auth_user_created` en **cada** signup (staff o climber) |
| `climbers` | email, display_name, visible_in_leaderboard | 1:1 con `auth.users`, se crea manualmente en el onboarding (no por trigger) |
| `scans` | route_id, device_id, user_id (nullable) | anti-gaming: ventana de tiempo entre escaneo y "ya lo completé" |
| `sends` | user_id, route_id, sent_at, points_daily, points_monthly | producida por la RPC `submit_send`, consumida por el leaderboard |

**Conteos reales verificados hoy:** 11 zonas totales (6 dentro de la cadena "Perímetro", 5 sin cadena) · 27 rutas activas · 15 volúmenes activos · 50 QR codes · 1 climber registrado · 1 send registrado. El sistema de cuentas/leaderboard, aunque completo en código, prácticamente no tiene uso real todavía.

**Contradicción con notas previas de proyecto:** las notas de la sesión anterior (2026-07-17) describían la cadena con solo 4 zonas (Pared Izq sin calibrar, Fondo Izq calibrado, Flanco Túnel Izq y Desplome "pendientes"). El estado real hoy tiene **6 zonas ya en la cadena**, incluyendo Flanco Túnel Derecho y Fondo Derecho (mitad izquierda) que no aparecían en esa nota. `ARQUITECTURA_VISUAL.md` menciona "las 10 zonas actuales" — el conteo real hoy es 11.

Funciones RPC en uso (ninguna documentada en `schema.sql`, todas creadas vía el SQL Editor del dashboard): `submit_send`, `get_daily_leaderboard`, `get_monthly_leaderboard`, `get_recent_events`, `get_my_stats`, `get_my_sends`.

---

## 8. Features en desarrollo activo

| Feature | Estado | Referencia |
|---|---|---|
| Cadena panorámica (pan/zoom/transiciones/calibración) | **Madura** — usuario confirmó que "funciona bien" el 2026-07-22, sin cambios pendientes ahí | `ARQUITECTURA_VISUAL.md`, `DOCUMENTACION.md` §6 (ambos parcialmente desactualizados en detalles menores, ver Sección 9) |
| Sistema de volúmenes + catálogo | Lista, en uso diario por staff | `DOCUMENTACION.md` §7 |
| Sistema de gamificación / leaderboard / cuentas cliente | **Código completo y lanzado** (commits `c56134c` → `2aed906` → `9ca7e87`), pero con adopción real mínima (1 climber, 1 send a la fecha) | `docs/LEADERBOARD_PANTALLA.md` (spec original de 720 líneas, el documento más completo y aún la mejor referencia de intención de producto) |
| Login por código de 6 dígitos + re-escaneo QR in-app | **Recién implementado hoy** (commit `9ca7e87`), bloqueado end-to-end hasta conectar Resend/dominio propio | Sin doc propio — solo el mensaje de commit y una nota dentro de `docs/EMAIL_SETUP.md` |
| Setup de email transaccional (Resend + dominio propio) | **En progreso** — usuario decidió hoy comprar dominio en vez de usar el sandbox de Resend; dominio aún no comprado | `docs/EMAIL_SETUP.md` (actualizado hoy, es la guía paso a paso vigente) |
| Rebranding textual "Jaibamuro" | Hecho para strings visibles (commit `d3026a1`, hoy); deliberadamente no tocado en identificadores internos (`localStorage` keys, comentarios de `schema.sql`) | — |

---

## 9. Deuda técnica y áreas conocidas de fricción

1. **Hueco de control de acceso en `/staff/admin` y `/staff/calibration`:** ninguna de las dos páginas verifica `profile.role` en código (`AdminPage.tsx` y `CalibrationPage.tsx` no importan `useProfile`), a diferencia de `StatsPage.tsx:150-155` y `VolumeCatalogPage.tsx:277-282` que sí lo hacen. Hoy solo el tab bar (`StaffLayout.tsx`) oculta el link a no-admins — cualquier cuenta de staff logueada puede llegar a esas páginas escribiendo la URL directamente.
2. **RLS de Supabase no distingue staff de climber:** las políticas de `zones`, `routes`, `qr_codes` y `betas` en `schema.sql` (ej. `zones_write_staff`, `routes_all_staff`) usan `auth.uid() IS NOT NULL` como única condición — *cualquier* usuario autenticado, incluyendo un climber que solo inició sesión con magic link para ver su leaderboard, pasa esa condición a nivel de base de datos. Antes de escalar el número de cuentas de clientes reales, vale la pena revisar si esto debe endurecerse (ej. verificar `profiles.role` en las policies).
3. **`src/types/database.ts` desactualizado:** solo documenta `profiles`, `zones`, `routes`, `qr_codes`, `votes`, `betas` — le faltan por completo `chains`, `zone_anchors`, `volumes`, `volume_catalog`, `climbers`, `scans`, `sends`. El patrón de escape (`const db = supabase as unknown as any`) se repite en al menos 15 archivos como consecuencia directa de esto.
4. **`src/supabase/schema.sql` no refleja la base real:** faltan las mismas tablas de arriba más las 6 funciones RPC listadas en Sección 7. Solo `get_my_stats`/`get_my_sends` fueron documentadas retroactivamente (commit `889ac1f`, hoy).
5. **`ZoneCanvas` es código muerto:** 447 líneas, sin ningún importador en el resto del proyecto. Candidato directo a borrar.
6. **Imágenes de prueba huérfanas:** `public/wall/test der.jpeg` y `test izq.jpeg` viajan en el bundle público sin usarse (las fotos reales de zona viven en Supabase Storage vía `image_url`).
7. **Sin tokens de diseño:** colores, spacing y radios se repiten como utilidades de Tailwind inline en cada archivo, sin una capa central. Esto va a hacer más lento cualquier rediseño coherente si no se extrae primero un sistema de tokens.
8. **Sin logo real ni favicon de marca:** ver Sección 4 — la "marca" es un emoji duplicado en 4 archivos, y el favicon sigue siendo el default de Vite.
9. **Docs desactualizadas:** `DOCUMENTACION.md` y `ARQUITECTURA_VISUAL.md` son anteriores al sistema de leaderboard/cuentas de cliente, al minimapa colapsable, y al login por OTP — no los mencionan en absoluto. Ya se encontró al menos un dato duro incorrecto (conteo de zonas, Sección 7).
10. **Login de staff sin recuperación de contraseña visible ni rate-limiting explícito en el cliente** — depende enteramente de las protecciones default de Supabase Auth, no hay UI para "olvidé mi contraseña".
11. **`ErrorBoundary` tiene un mensaje hardcodeado** ("Error en `AdminPage`") aunque se reutiliza también envolviendo `CalibrationPage` y `VolumeCatalogPage` en `App.tsx` — el mensaje de error sería engañoso si el error ocurre en alguna de esas otras dos páginas.

---

## 10. Consideraciones para el rediseño

- **Rutas candidatas a repensar, no a eliminar:** `/leaderboard/display` tiene código maduro pero casi sin uso real todavía — es buen momento para validar el diseño visual antes de que haya tráfico real de gym, en vez de después.
- **Duplicación de código notable:** `PublicWallPage.tsx` y `WallPage.tsx` (staff) comparten casi toda la lógica de `ChainCanvas` + `ZoneMap`, diferenciándose solo por `isStaff` y las capas de edición encima. Un rediseño visual del canvas o del minimapa debería tratarse como un solo cambio que afecta ambas vistas, no dos rediseños separados.
- **La pieza más madura y menos riesgosa de tocar visualmente:** `ChainCanvas` (pan/zoom/transiciones/badges) — confirmado estable por el usuario. La pieza más frágil y con más deuda: el layer de autenticación de cliente (dos flujos de login, bloqueado por email, con el hueco de RLS de la Sección 9) — cualquier rediseño de esa zona debería ir acompañado de resolver el bloqueador de Resend primero, si no el rediseño visual no se puede probar end-to-end.
- **Oportunidad de reorganización:** no existe hoy una capa de "design tokens" (Sección 4/9) — antes de rediseñar pantalla por pantalla, definir esa capa una vez evitaría reescribir clases de Tailwind repetidas en los ~25 archivos de `pages/`+`components/`.
- **`ZoneCanvas` legacy:** bórralo antes de empezar el rediseño para no confundir a quien explore el repo por primera vez (incluyendo a otra IA) pensando que es código en uso.
- **El "logo" no existe todavía como asset:** cualquier conversación de rediseño de marca debería empezar por decidir si Jaibamuro tiene o va a tener un logo real, porque hoy literalmente no hay ningún archivo de imagen de marca en el proyecto — todo es el emoji ⚡.
- **Los `.md` de referencia deberían consolidarse:** `DOCUMENTACION.md` y `ARQUITECTURA_VISUAL.md` se solapan bastante y ambos están desactualizados en distintos puntos; en vez de mantener los tres (más este nuevo), podría valer la pena que este documento reemplace a los dos viejos como fuente única de estado, y que `docs/LEADERBOARD_PANTALLA.md` se mantenga solo como spec de producto (no de estado).
