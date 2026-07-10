# Relámpago — Documentación completa del sistema

> App web de gestión del gimnasio de escalada **El Muro**.  
> Stack: React + TypeScript + Tailwind CSS + Supabase + Konva.  
> Deploy: Vercel (PWA optimizada para móvil).

---

## Índice

1. [Visión general](#1-visión-general)
2. [Lo que ve el cliente — Vista pública del muro](#2-lo-que-ve-el-cliente--vista-pública-del-muro)
3. [Lo que ve el cliente — Página de ruta via QR](#3-lo-que-ve-el-cliente--página-de-ruta-via-qr)
4. [Lo que ve el staff — Gestión del muro](#4-lo-que-ve-el-staff--gestión-del-muro)
5. [Lo que ve el admin — Herramientas adicionales](#5-lo-que-ve-el-admin--herramientas-adicionales)
6. [Sistema de Cadena Panorámica](#6-sistema-de-cadena-panorámica)
7. [Sistema de Volúmenes](#7-sistema-de-volúmenes)
8. [Sistema de QR Codes](#8-sistema-de-qr-codes)
9. [Sistema de Votación](#9-sistema-de-votación)
10. [Sistema de Frescura](#10-sistema-de-frescura)
11. [Arquitectura técnica y base de datos](#11-arquitectura-técnica-y-base-de-datos)
12. [Rutas URL completas](#12-rutas-url-completas)

---

## 1. Visión general

Relámpago es una web app diseñada para el gimnasio de escalada **El Muro**. Tiene dos audiencias principales:

| Audiencia | Acceso | Propósito |
|-----------|--------|-----------|
| **Clientes** | Público, sin login | Ver el muro en tiempo real, escanear QRs de las rutas |
| **Staff / Setters** | Login requerido | Dibujar rutas y volúmenes sobre las fotos del muro |
| **Admins** | Login requerido (rol elevado) | Todo lo del staff + dashboard de estadísticas + configuración técnica |

La app está pensada para usarse en **teléfono móvil**. El diseño es oscuro (zinc-950 como fondo), con amarillo (#facc15) como color de acento.

---

## 2. Lo que ve el cliente — Vista pública del muro

**URL:** `/muro`  
**Acceso:** Público, sin login

### Pantalla principal

El cliente abre la app y ve el **muro completo** en formato foto panorámica horizontal. La pantalla está dividida en dos zonas:

```
┌─────────────────────────────────────────┐
│  ⚡ Relámpago          [● 12 rutas]     │  ← Header fijo
├─────────────────────────────────────────┤
│                                         │
│     FOTO DEL MURO (scroll horizontal)  │
│                                         │
│   ~~~~~~~~~   ↔ rutas dibujadas        │
│        ○━━━━━━━━○   ↔ otra ruta        │
│                                         │
│   [Pared Izquierda ▸ ━━━━ ○]          │  ← Indicador zona
├─────────────────────────────────────────┤
│      [minimap del muro completo]        │  ← ZoneMap
└─────────────────────────────────────────┘
```

### Cadena Panorámica (experiencia principal)

El cliente ve las fotos del muro enlazadas horizontalmente, como si fueran una panorámica continua:

- **Scroll / swipe izquierda-derecha** para desplazarse entre zonas del muro (Pared Izquierda → Fondo Izquierdo → Flanco Túnel → …)
- Las fotos tienen **transición suave**: al llegar al borde derecho de una foto, aparece el borde izquierdo de la siguiente. Un pequeño "peek" de la foto siguiente da feedback visual antes de soltar.
- Si se suelta a mitad de camino, la foto hace **snap-back** a la posición más cercana.
- **Pellizco para zoom** (pinch-to-zoom) y **doble tap** para resetear.
- El **indicador de puntos** (estilo carrusel) en la parte inferior muestra cuántas zonas hay y cuál está activa.

### Rutas dibujadas sobre las fotos

Cada ruta aparece como una **línea trazada a mano** sobre la foto:

- **Color de la línea** = color real de las presas (amarillo, azul, rojo, verde, naranja, rosa, morado, negro, blanco, café)
- **Halo de frescura** = un glow de color detrás de la línea que indica qué tan reciente es la ruta:
  - 🟢 **Verde** — Crudo (≤ 10 días). Ruta nueva, presas sin rozar.
  - 🟡 **Amarillo** — Al dente (11–20 días). Ruta en buen estado.
  - 🔴 **Rojo** — Quemada (> 20 días). Ruta vieja, ya conocida por todos.
- **Etiqueta de frescura** flotante sobre la ruta: muestra el texto "Crudo", "Al dente" o "Quemada" con el color correspondiente.
- Las rutas que **cruzan entre fotos** (cross-zone) aparecen en ambas fotos, alineadas por el sistema de calibración.

### Tocar una ruta

Al tocar una ruta dibujada, la app navega automáticamente a **la página pública del QR de esa ruta** (si tiene QR asignado). Esto permite al cliente ver detalles, el video beta y votar.

### Minimap

En la esquina inferior derecha hay un pequeño mapa del muro completo (ZoneMap) que muestra todas las zonas. Toca una zona para ir directamente a ella, saltando la transición suave.

### Badge de nombre de zona

En la esquina superior izquierda aparece el nombre de la zona activa: "Pared Izquierda", "Fondo Izquierdo", etc.

---

## 3. Lo que ve el cliente — Página de ruta via QR

**URL:** `/q/:qrId`  
**Acceso:** Público, sin login  
**Cómo llega el cliente:** Escaneando el código QR pegado físicamente debajo de la ruta en el muro.

### Caso 1: QR con ruta activa

Esta es la pantalla principal del cliente. Contiene toda la información de la ruta:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← barra del color de la ruta (arriba de todo)

  [■]  V4                     ← color box + grado en grande
       Azul · Pared Izquierda ← color y zona

  ● Al dente                  ← badge de frescura (color + texto animado)

  ┌──────────────────────────┐
  │  👁 Ver beta              │  ← botón (toca para revelar)
  │     toca para revelar     │
  └──────────────────────────┘
  (si ya se tocó, muestra la imagen/video del beta)

  ¿QUÉ TE PARECIÓ?
  ┌──────────┐  ┌──────────┐
  │    👍    │  │    👎    │  ← botones de votación
  └──────────┘  └──────────┘

  ── ⚡ Relámpago    Ver todo el muro → ──
```

**Detalles importantes:**
- La **barra de color** en la parte superior (1.5px de alto) refleja exactamente el color de las presas.
- El **grado** (V0–V12) aparece en tipografía monospace muy grande.
- El **badge de frescura** tiene un punto animado (pulse) del color correspondiente.
- El **beta** está oculto por defecto — hay que tocarlo para verlo. Esto es intencional: preserva la experiencia de resolver la ruta sin spoilers. Una vez revelado, muestra la foto/video.
- La **sección de votación** con 👍/👎 está anclada al fondo de la página. El voto se guarda por dispositivo (localStorage), así que al entrar de nuevo el botón ya aparece seleccionado.
- Al final hay un enlace "Ver todo el muro →" que lleva a `/muro`.

### Caso 2: QR no encontrado

Pantalla de error con "QR no reconocido" + explicación.

### Caso 3: QR sin ruta asignada (disponible)

Muestra "Sin ruta asignada". Si el usuario tiene sesión de staff iniciada, aparece un botón para crear la ruta directamente.

### Caso 4: QR cuya ruta fue retirada

Muestra "Esta ruta ya no está" + invitación a ver el muro completo.

---

## 4. Lo que ve el staff — Gestión del muro

**URL:** `/staff`  
**Acceso:** Requiere login (Supabase Auth)  
**Navegación:** Barra inferior con tabs: Muro · QRs · Stats (solo admin) · Admin (solo admin)

### 4.1 Tab "Muro" — Vista del staff

Misma vista panorámica que el cliente (Cadena Panorámica con scroll horizontal), pero con capacidades de edición encima.

**Diferencias vs vista pública:**
- En lugar de "Crudo/Al dente/Quemada", el staff ve el **número exacto de días** sobre cada ruta (ej: "14d").
- El staff puede **dibujar rutas** y **dibujar volúmenes**.
- El staff puede **tocar una ruta o volumen** para ver su ficha y retirarlo.

### 4.2 Dibujar una ruta nueva

Flujo completo:

1. **Botón "Nueva ruta"** (amarillo, esquina inferior derecha) → abre el picker de color.

2. **Picker de colores** (bottom sheet): el setter elige el color de las presas. Hay 10 colores: Amarillo, Azul, Rojo, Verde, Naranja, Rosa, Morado, Negro, Blanco, Café. La paleta visual muestra círculos de color.

3. **Modo dibujo** ("Dibuja la ruta con el dedo"): el setter traza con el dedo sobre la foto, siguiendo el recorrido de la ruta. La línea aparece en tiempo real mientras se dibuja, con el color elegido. Sobre el área de dibujo no hay pan/scroll (el toque se captura para dibujar).

4. **Revisión** ("¿Se ve bien?"): la ruta dibujada aparece como línea punteada/sólida sobre la foto. El setter puede:
   - **Rehacer** → vuelve al modo dibujo para trazar de nuevo.
   - **Continuar →** → abre el formulario.

5. **Formulario de ruta** (bottom sheet):
   - Color confirmado (modificable).
   - Grado (V0–V12, default V4).
   - Zona (selector, pre-seleccionada la zona activa).
   - Notas opcionales (campo de texto libre).
   - Si se llegó desde un QR (URL `/staff?qr=xxx`), el QR se asigna automáticamente al guardar.
   - Botón **Guardar** → inserta en DB y refesca el mapa.

### 4.3 Dibujar un volumen

Los volúmenes son las figuras 3D de fibra/madera que se ponen en el muro para crear variantes de agarre. El staff puede dibujar su silueta:

1. **Botón "Volumen"** (gris, junto a "Nueva ruta") → inicia el modo perímetro.

2. **Modo perímetro** ("Dibuja el perímetro del volumen"): el setter traza con el dedo el contorno del volumen. Hay una **línea de cierre** punteada que siempre va del último punto dibujado al primero, mostrando cómo quedaría cerrado.

3. **Revisión del perímetro** ("¿Se ve bien el perímetro?"): el polígono aparece relleno en gris translúcido. El setter puede:
   - **Rehacer** → vuelve a dibujar.
   - **+ Detalles** → pasa a modo detalle para añadir trazos de detalle sobre el volumen.
   - **Guardar** → guarda solo el perímetro.

4. **Modo detalles** (opcional): el setter puede trazar líneas oscuras sobre el volumen para marcar bordes, aristas o detalles visuales. Puede hacer múltiples trazos. El contador "2 trazos" actualiza en el hint.

5. **Botón "Listo"** → guarda volumen con perímetro + detalles.

**Aspecto visual del volumen:**
- Perímetro: polígono relleno con `rgba(110,110,110,0.38)` (gris translúcido) y borde gris.
- Detalles: líneas oscuras `rgba(55,55,55,0.92)` de 5px de ancho.
- Los volúmenes siempre aparecen **debajo de las rutas** (misma capa Konva pero renderizados primero).

### 4.4 Tocar una ruta (ficha de ruta — staff)

Al tocar una ruta en la vista de muro, aparece un bottom sheet con la ficha completa:

- Días en pared (exacto) con badge de frescura.
- Color + grado + zona.
- Conteo de votos (👍 / 👎).
- **Edición**: se puede cambiar color, grado, zona y notas.
- **Beta**: el staff puede subir fotos/videos como beta. Se almacenan en Supabase Storage.
- **Asignar QR**: escáner de cámara integrado para escanear un QR físico y asignarlo a la ruta.
- **Retirar ruta**: doble confirmación ("Retirar" → "¿Seguro?") para evitar retiros accidentales. Al retirar, la ruta desaparece del muro para staff y clientes, y el QR asociado queda "disponible" de nuevo.

### 4.5 Tocar un volumen (action sheet)

Al tocar cualquier volumen (en su zona original o en zona cruzada), aparece un action sheet con:

- **Mover en esta zona** → modo reposicionamiento (ver §7.2).
- **Ver detalles / Retirar** → ficha del volumen (días en pared + botón retirar con doble confirmación).
- **Cancelar**.

### 4.6 Tab "QRs" — Inventario de códigos QR

Lista completa de todos los QR codes del sistema, con:

- **Cards de resumen** en la parte superior: Disponibles (verde) / En uso (amarillo) / Total (blanco).
- **Filtros**: Todos · Disponibles · Asignados.
- **Grid de tarjetas** (2 columnas): cada tarjeta muestra el ID corto del QR, su estado (punto verde/amarillo) y si está asignado, el color + grado + zona de la ruta.
- Al **tocar una tarjeta** aparece el QR en grande para imprimir.

---

## 5. Lo que ve el admin — Herramientas adicionales

Los admins tienen dos tabs adicionales: **Stats** y **Admin**.

### 5.1 Tab "Stats" — Dashboard de estadísticas

**Solo visible para admins.** Los no-admins que visiten la URL directamente son redirigidos al muro.

El dashboard muestra:

#### Tarjetas de resumen (3 valores grandes en amarillo)
- **Rutas activas** — total actual.
- **Promedio días** — media de días en pared de todas las rutas activas.
- **La más vieja** — cuántos días lleva la ruta más antigua.

#### Frescura
Barra apilada proporcional con tres segmentos de color:
- 🟢 Verde = Crudo (≤ 10 días)
- 🟡 Amarillo = Al dente (11–20 días)
- 🔴 Rojo = Quemada (> 20 días)

Con leyenda debajo mostrando el conteo de cada categoría en número grande.

#### Por zona
Barras horizontales ordenadas de mayor a menor, mostrando cuántas rutas activas hay en cada zona del muro.

#### Por color
**Gráfico de columnas verticales** con los 10 colores en el eje X. La etiqueta de cada columna es un círculo del color (no texto). Muestra todos los colores aunque tengan 0 rutas.

#### Por grado
**Gráfico de columnas verticales** con V0 a V12 en el eje X. Barra amarilla. Muestra todos los grados aunque tengan 0 rutas.

*En ambos gráficos de columnas: el número de rutas aparece encima de cada barra en blanco y negrita. Los que tienen 0 rutas aparecen en gris oscuro.*

### 5.2 Tab "Admin" — Configuración del sistema

#### Cadena Panorámica
Lista de zonas actualmente en la cadena (con su posición 0, 1, 2…) y lista de zonas sin cadena. El admin puede:
- **+ Agregar** una zona libre al final de la cadena (crea automáticamente el zone_anchor entre la última zona y la nueva).
- **Quitar** una zona de la cadena (con confirmación, elimina sus calibraciones).

#### Calibración de Cadenas
Botón que navega a `/staff/calibration` — la herramienta de calibración por puntos para ajustar la alineación entre fotos contiguas. Se marcan pares de puntos equivalentes en ambas fotos (máximo 8 pares) y el sistema usa regresión lineal para calcular la transformación.

#### Generar QR Codes
Campo numérico (1–50) + botón "Crear QRs" → genera QRs con UUIDs únicos en la DB, los muestra en un grid de 3 columnas con opción de imprimir.

#### Exportar Rutas
Descarga un CSV con todas las rutas (activas e históricas): ID, Color, Grado, Zona, Estado, Fecha de colocación, Fecha de retiro, Notas.

---

## 6. Sistema de Cadena Panorámica

Este es el sistema técnico central de la app. Transforma las fotos individuales de cada zona en una **experiencia panorámica continua**.

### Concepto

Cada sección del muro tiene su propia foto de alta resolución. Las fotos se ordenan en una "cadena" (Cadena Panorámica) donde unas se superponen con las adyacentes. El sistema calcula dónde termina una foto y empieza la siguiente usando **pares de calibración**.

### Calibración por puntos

Para cada par de zonas contiguas (A → B), un admin marca hasta 8 pares de puntos equivalentes: "este punto en la foto A corresponde a este punto en la foto B". El sistema usa **regresión lineal** (transformación afín, 4 grados de libertad) para calcular la función de conversión `aToB` y su inversa `bToA`.

Con más pares, mejor es la alineación. Con 0–2 pares, no hay rendering cross-zone.

### Coordenadas de cadena

Las rutas y volúmenes se almacenan en **coordenadas normalizadas de cadena** (x: 0–1 de totalW, y: 0–1 de CHAIN_H=900). Esto hace que:
- Las coordenadas sean independientes del zoom.
- Al actualizar la calibración, las rutas se re-alinean automáticamente en el siguiente render.
- Una ruta puede cruzar de la foto A a la foto B físicamente.

### Cross-zone rendering

Las rutas y volúmenes que pertenecen a la zona A también se renderizan en la zona B (cuando hay calibración válida), usando la función `aToB` para transformar cada punto. El mismo proceso en sentido contrario para B→A. El resultado visual es que una ruta que cruza el límite físico entre zonas aparece continua en ambas vistas.

### Transiciones

- Scroll hasta el borde → aparece un "peek" de la siguiente foto.
- Soltar después del umbral (40px) → **transición animada** (240ms, easing out-cubic) a la siguiente zona.
- Soltar antes del umbral → **snap-back** a la posición original.
- **Swipe rápido** (velocidad > 0.35 px/ms) también activa la transición aunque no haya llegado al umbral.

---

## 7. Sistema de Volúmenes

### 7.1 ¿Qué es un volumen?

En escalada, un **volumen** es una estructura geométrica (triangular, trapezoidal, etc.) de fibra o madera que se atornilla al muro para crear cambios de ángulo o texturas. A diferencia de las presas (que son el foco de una ruta), los volúmenes son parte del muro mismo y afectan a todas las rutas que los cruzan.

### 7.2 Reposicionamiento por zona

Cuando un volumen dibujado en la zona A aparece en la zona B via cross-zone rendering, la calibración puede no alinearlo perfectamente. El staff puede corregir esto:

1. Tocar el volumen en zona B → action sheet → "Mover en esta zona".
2. El volumen se resalta con **borde amarillo**.
3. El staff arrastra el volumen con el dedo a su posición correcta.
4. "Guardar posición" → se guarda un offset `{dx, dy}` en `zone_offsets[zoneId]` en la DB.
5. El volumen en zona A **no cambia**. Solo la vista desde zona B usa el offset.

Lo mismo aplica para la zona original: tocar el volumen en zona A → "Mover en esta zona" → ajustar → guardar. El offset se guarda en `zone_offsets[zone_A_id]`.

Los offsets son en coordenadas normalizadas de la foto (0–1), independientes del zoom.

---

## 8. Sistema de QR Codes

### Flujo completo

```
Admin genera QRs →  QR impreso físicamente
                    pegado en el muro bajo la ruta
                         ↓
Staff escanea QR → asigna ruta al QR (al guardar la ruta)
                         ↓
Cliente escanea QR → abre /q/:id → ve info de la ruta
                         ↓
Staff retira ruta → QR queda "disponible" de nuevo
```

### Tipos de QR
- **available** — sin ruta asignada, listo para usar.
- **in_use** — asignado a una ruta activa.

Un mismo QR puede reutilizarse: cuando se retira una ruta, el QR vuelve a "available" y puede asignarse a una ruta nueva.

---

## 9. Sistema de Votación

Los clientes pueden votar 👍 o 👎 en cada ruta desde la página del QR.

- **Identificación por dispositivo**: no requiere login. Se usa un UUID guardado en `localStorage` del navegador del cliente.
- **Toggle**: tocar el mismo botón dos veces cancela el voto.
- **Cambio de voto**: tocar el otro botón cambia directamente.
- Los votos se almacenan en la tabla `votes` con `route_id + device_id` como clave única.
- El staff ve el **conteo agregado** de 👍 y 👎 en la ficha de la ruta (RouteDetail).

---

## 10. Sistema de Frescura

Las rutas tienen un "ciclo de vida" visual que comunica al cliente cuán reciente es la ruta:

| Nivel | Color | Texto | Rango |
|-------|-------|-------|-------|
| green | #22c55e | Crudo | 0–10 días |
| yellow | #eab308 | Al dente | 11–20 días |
| red | #ef4444 | Quemada | > 20 días |

Este sistema se usa en:
- **Vista pública del muro**: halo de color detrás de cada línea de ruta + etiqueta flotante.
- **Página de QR**: badge con punto animado.
- **Ficha de ruta (staff)**: mismo badge + número exacto de días.
- **Dashboard de stats (admin)**: barra apilada y tarjeta "La más vieja".

Los umbrales (10 y 20 días) están definidos en `src/lib/freshness.ts` y son fáciles de ajustar.

---

## 11. Arquitectura técnica y base de datos

### Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Estilos | Tailwind CSS v4 |
| Canvas / Drawing | Konva + react-konva |
| Backend / DB | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (email + password) |
| Storage | Supabase Storage (betas/fotos) |
| Deploy | Vercel |

### Tablas principales

#### `zones`
Cada sección física del muro con foto.
```
id, name, slug, order_index
image_url          → foto de la zona (en Supabase Storage)
chain_id           → referencia a qué cadena pertenece
chain_position     → orden dentro de la cadena (0, 1, 2…)
```

#### `chains`
Agrupa zonas en una cadena panorámica.
```
id, name, axis ('horizontal' | 'vertical')
```

#### `zone_anchors`
Calibración entre dos zonas contiguas.
```
id, chain_id
zone_a_id, zone_b_id    → par de zonas calibradas
point_pairs             → array de pares {a:{x,y}, b:{x,y}} (max 8)
a_overlap_start/end     → fracción del ancho de A que se superpone con B
b_overlap_start/end     → fracción del ancho de B que se superpone con A
```

#### `routes`
Rutas activas e históricas.
```
id, color, grade, setter_id
zone_id, chain_id
blob_path   → array de {x, y} en coordenadas de cadena (0–1)
status      → 'active' | 'retired'
placed_at, retired_at
notes
```

#### `volumes`
Volúmenes dibujados sobre el muro.
```
id, zone_id, chain_id
perimeter   → array de {x, y} en coordenadas de cadena
details     → array de arrays de {x, y} (trazos de detalle)
zone_offsets → Record<zone_id, {dx, dy}> — offsets de reposicionamiento
status      → 'active' | 'retired'
placed_at, retired_at
```

#### `qr_codes`
```
id (UUID — es también el path del QR)
status      → 'available' | 'in_use'
route_id    → FK a routes (null si disponible)
```

#### `votes`
```
route_id, device_id    → clave compuesta única
value                  → 'up' | 'down'
```

#### `betas`
```
id, route_id
file_url    → URL en Supabase Storage
created_at
```

#### `profiles`
```
id          → mismo UUID que auth.users
name
role        → 'staff' | 'admin'
```

### Seguridad (RLS)

Todas las tablas tienen Row Level Security activado:
- **Lectura pública** (`SELECT`): zonas, rutas activas, volúmenes activos, qr_codes, votos, betas.
- **Escritura**: solo usuarios autenticados con rol `staff` o `admin`.
- **Operaciones admin** (generar QRs, modificar cadenas): solo rol `admin`.

---

## 12. Rutas URL completas

| URL | Quién accede | Qué ve |
|-----|-------------|--------|
| `/` | Cualquiera | Redirect a `/muro` |
| `/muro` | **Clientes** | Vista panorámica del muro + rutas |
| `/q/:qrId` | **Clientes** | Ficha de ruta (grade, color, frescura, beta, votos) |
| `/login` | Staff | Formulario de login |
| `/staff` | Staff | Muro editable (dibujar rutas y volúmenes) |
| `/staff/qr` | Staff | Inventario de QR codes |
| `/staff/stats` | **Admin** | Dashboard de estadísticas |
| `/staff/admin` | **Admin** | Config de cadena, generar QRs, exportar CSV |
| `/staff/calibration` | **Admin** | Calibración de pares de zonas |

---

## Notas de diseño y UX

- **Todo está optimizado para móvil vertical**: botones grandes (py-3.5), zonas de tap amplias.
- **Sin recarga de página**: es una SPA con navegación por React Router.
- **Feedback instantáneo**: estados de loading con spinner amarillo, estados de error en rojo.
- **Double-confirm para acciones destructivas**: retirar ruta/volumen requiere dos toques.
- **El beta está oculto por defecto**: preserva la experiencia de resolver la ruta sin spoilers.
- **El staff ve días exactos; el cliente ve etiquetas**: "14d" vs "Al dente". La información técnica queda del lado del staff.
- **Colores**: diseño oscuro (zinc-950) con amarillo (#facc15) como acento principal. Los colores de las presas son los únicos elementos de color saturado en la interfaz del muro.
