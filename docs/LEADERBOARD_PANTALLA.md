# Proyecto Relámpago — Sistema de Leaderboard Público en Pantalla Compartida

**Documento de diseño e implementación**
**Fecha:** 2026-07-20
**Propósito:** Implementar un sistema de gamificación por puntos con leaderboard visible en tiempo real en una pantalla física dentro del gym. Los clientes acumulan puntos al marcar rutas completadas desde su celular, y los mejores del día y del mes aparecen en la pantalla pública.

---

## 1. Contexto y motivación

### 1.1 Origen de la idea

Este sistema es una evolución de una conversación previa donde se seleccionaron 6 features de engagement para clientes vía QR de rutas:

- **Idea 1:** Marcar "la mandé" (send declarado por el cliente)
- **Idea 4:** Encuesta post-send de estilo
- **Idea 5:** Grado percibido
- **Idea 10:** Sistema de puntos por send
- **Idea 11:** Reto mensual con recompensa
- **Idea 17:** Dashboard admin de rutas fantasma

El presente documento **absorbe y expande** la idea 10 (puntos por send) y añade una dimensión pública mediante pantalla física. Las ideas 1, 4, 5 y 17 siguen aplicando pero no son objeto de este documento. La idea 11 (reto mensual con recompensa) se integra naturalmente con el sistema descrito aquí, pues comparte infraestructura de puntos.

### 1.2 Insight fundamental que redirige el diseño

**Los escaneos de QR NO son proxy de intentos.** La gente escanea 1-2 veces por ruta como máximo. Por lo tanto:
- No se pueden contar "intentos" desde el sistema.
- El escaneo sí sirve como proxy de "atención capturada".
- El único dato duro de resultado es el **send declarado** por el cliente.
- Todo el sistema de puntos se basa exclusivamente en sends declarados.

### 1.3 Qué cambia respecto al plan anterior

**Identidad persistente ahora es requisito, no opcional.** En las ideas 1, 4 y 5 originales, se podía vivir con `device_id`. Con el leaderboard público, necesitamos cuenta con nombre real o alias que persista entre visitas y entre dispositivos.

**El "ya lo completé" pasa de ser una feature más a ser la acción central del sistema.** Es el evento que dispara toda la cadena: guarda el send, suma puntos, actualiza los dos leaderboards, y potencialmente actualiza la pantalla.

### 1.4 Cambio de comportamiento esperado

El sistema busca convertir una actividad individual (escalar) en una actividad social visible. La pantalla crea "pulso" en el gym — ver nombres moviéndose en un tablero crea la sensación de que algo está pasando, incluso cuando la persona no conoce a nadie más ahí. Refuerza el hábito social del reconocimiento y construye comunidad más rápido.

---

## 2. Concepto central

### 2.1 En una frase

Cada ruta del gym tiene su QR (ya implementado). El cliente escanea, hace login si no lo ha hecho, y al completar la ruta pulsa un botón "YA LO COMPLETÉ" que le suma puntos según el grado. Sus puntos se acumulan en dos leaderboards (diario y mensual) visibles en una pantalla física dentro del gym que se actualiza en tiempo real.

### 2.2 Los tres componentes del sistema

**A) La app cliente (móvil):** ya existe la ficha del QR por ruta. Se le agrega:
- Requerimiento de login (obligatorio para participar en puntos).
- Botón "YA LO COMPLETÉ" que registra el send.
- Vista opcional del leaderboard actual y del score personal del usuario.

**B) La API/backend (Supabase):** captura sends, calcula puntos, mantiene totales agregados de leaderboards, y publica eventos en tiempo real cuando algo cambia.

**C) La pantalla física del gym:** una TV con navegador apuntando a un URL específico del leaderboard. Suscrita a los eventos en tiempo real del backend. Muestra dos tablas (diario, mensual) y un ticker de eventos recientes.

---

## 3. Flow completo del usuario

Paso a paso, desde que un cliente llega a mandar una ruta hasta que aparece en la pantalla:

**Paso 1 — Escanea el QR.** El QR está físicamente pegado junto a la ruta en el muro. Al escanearlo con la cámara del celular, se abre la URL de la ficha pública de esa ruta.

**Paso 2 — El sistema registra el escaneo.** Se crea un registro en la tabla `scans` con `(user_id opcional, route_id, scanned_at, device_id)`. Este timestamp es crítico para la validación anti-gaming del paso 5.

**Paso 3 — Login (si aplica).** Si el cliente no está autenticado, la ficha muestra las funciones limitadas (color, grado, información pública) pero el botón "YA LO COMPLETÉ" muestra un CTA que dice "Inicia sesión para sumar puntos". El cliente puede crear cuenta ahí o iniciar sesión si ya tiene.

**Paso 4 — Ve el botón "YA LO COMPLETÉ".** El botón es prominente, visible sin scroll, y con un estilo diferenciado del resto de la ficha. Junto al botón, un pequeño texto: "Sumarás X puntos" mostrando en tiempo real cuánto vale esa ruta.

**Paso 5 — Pulsa el botón.** Antes de registrar, el sistema valida:
- ✅ Que el usuario tenga cuenta activa.
- ✅ Que exista un scan reciente de esa ruta desde ese usuario o desde el mismo device (dentro de la ventana de tiempo válida, ver §6.2).
- ✅ Que el usuario no haya ya marcado esta misma ruta el día de hoy (evita doble tap accidental).

Si las tres validaciones pasan, se registra el send.

**Paso 6 — El backend procesa el send.**
1. Inserta registro en la tabla `sends` con `(user_id, route_id, sent_at, points_daily, points_monthly)`.
2. Calcula puntos según el grado (ver §4).
3. Asigna puntos al total diario del usuario (siempre).
4. Verifica si es la **primera vez este mes** que el usuario manda esta ruta (query a `sends` del usuario en el mes actual filtrado por `route_id`). Si es primera vez, asigna puntos al total mensual también. Si ya la mandó este mes, `points_monthly = 0`.
5. Publica evento en tiempo real (Supabase Realtime) con la información del send para que la pantalla lo reciba.

**Paso 7 — El usuario ve confirmación en su celular.** Pantalla de éxito: "¡Sumaste X puntos! Vas #12 hoy · Total mensual: Y puntos". Con opción de ver el leaderboard completo si lo quiere.

**Paso 8 — La pantalla del gym se actualiza.** Vía websocket, la página del leaderboard recibe el evento. Si el usuario entra o cambia de posición en el top 10 diario o en el top 5 mensual, la vista se actualiza. Independientemente, el ticker de eventos recientes muestra el evento durante unos segundos.

---

## 4. Sistema de puntos

### 4.1 Tabla de valores (versión 1, ajustable)

**Sistema lineal simple, valores enteros:**

| Grado | Puntos |
|-------|--------|
| V0    | 1      |
| V1    | 2      |
| V2    | 3      |
| V3    | 4      |
| V4    | 5      |
| V5    | 6      |
| V6    | 7      |
| V7    | 8      |
| V8    | 9      |

Si el gym utiliza grados intermedios (V0+, V1/V2, etc.), se les asigna el valor entero del grado inferior. Ejemplo: V1/V2 = 2 puntos, V2+ = 3 puntos.

### 4.2 Consecuencia esperada del sistema lineal

Con esta escala, **el volumen puede vencer a la dificultad**. Ejemplos:
- Mandar 5 rutas V0 = 5 puntos.
- Mandar 1 ruta V4 = 5 puntos.
- Mandar 5 rutas V6 = 35 puntos.
- Mandar 1 ruta V8 = 9 puntos.

Esto es una decisión consciente para esta primera versión. Estimula que la gente pruebe más rutas y no solo repita las de su grado tope. Se ajusta después de observar comportamiento en el primer mes.

### 4.3 No hay multiplicadores en esta primera versión

Descartados explícitamente para v1 (pueden agregarse después):
- Bonus por ruta reciente (Cruda).
- Bonus por primer send del día en esa ruta.
- Bonus por rango de dificultad (mandar arriba de tu grado habitual).

---

## 5. Los dos leaderboards

### 5.1 Leaderboard diario

**Alcance:** todos los sends del día actual (hora local del gym, medianoche a medianoche).

**Cómo se calcula:** suma de puntos por cada send registrado por el usuario ese día. Cada ruta cuenta **una sola vez por día** (para evitar que alguien marque la misma ruta 5 veces en un día para inflar).

**Ejemplo:** un cliente manda un V2 (3 pts), luego un V3 (4 pts), luego intenta marcar el V2 de nuevo. El segundo intento del V2 se rechaza como duplicado del día. Total diario = 7 puntos.

**Reset:** se reinicia automáticamente a las **00:00 hora local del gym** cada día. A partir de ese momento, el mismo cliente puede volver a marcar el mismo V2 y sí le contará.

**Se muestra en pantalla:** top 10 del día. Cada entrada muestra:
- Posición (1-10)
- Nombre o alias del usuario
- Puntos totales del día

### 5.2 Leaderboard mensual

**Alcance:** todos los sends del mes calendario actual (del día 1 al último día del mes, medianoche a medianoche).

**Cómo se calcula:** suma de puntos por cada send registrado por el usuario ese mes. Cada ruta cuenta **una sola vez en todo el mes**.

**Ejemplo canónico (dado por Inge):** un cliente manda un V2 rojo en desplome 10 veces en un mes, en 10 días distintos.
- Diario: cada uno de esos 10 días suma 3 puntos al total del día.
- Mensual: total del mes = 3 puntos (una sola vez).

Esto significa que el mensual **premia variedad**, no repetición. Un cliente que quiera subir en el mensual tiene que mandar rutas distintas.

**Consecuencia interesante:** escaladores de grados altos (V6-V8) tienen menos rutas disponibles de su grado en el gym. Van a topar su score mensual más rápido. Esto naturalmente equilibra la competencia entre grados. Un V2-climber muy activo puede acumular más puntos mensuales que un V6-climber que solo tiene 3-4 rutas de su grado disponibles.

**Reset:** se reinicia automáticamente el **día 1 de cada mes a las 00:00 hora local del gym**.

**Se muestra en pantalla:** top 5 del mes. Cada entrada muestra:
- Posición (1-5)
- Nombre o alias del usuario
- Puntos totales del mes

### 5.3 Reglas de deduplicación (resumen)

| Escenario | Diario | Mensual |
|-----------|--------|---------|
| Mando ruta X hoy por primera vez | Cuenta | Cuenta |
| Mando ruta X hoy, ya la había mandado hoy | NO cuenta | NO cuenta |
| Mando ruta X hoy, ya la mandé este mes en otro día | Cuenta | NO cuenta |
| Mando ruta X hoy, ya la mandé el mes pasado | Cuenta | Cuenta |

### 5.4 Zona horaria y reset

**Todos los timestamps se guardan en UTC en la base de datos.**

**Todos los cálculos de "día actual" y "mes actual" se hacen en la hora local del gym.** La zona horaria del gym se define como una constante o configuración del sistema.

**Recomendación técnica:** al calcular pertenencia a un día o mes, convertir el `sent_at` UTC a hora local del gym antes de determinar la fecha calendario. Esto evita que un send hecho a las 11:30 PM aparezca en el día siguiente por conversión de zona horaria.

---

## 6. Sistema anti-gaming

### 6.1 Contexto

Con puntos que eventualmente pueden dar recompensas, existe incentivo para que alguien intente sumar puntos sin realmente haber escalado. Ejemplo: tomar foto de un QR, escanearlo desde casa, marcar "ya lo completé" desde el sofá.

La solución adoptada es una combinación de dos mecanismos + un letrero explícito que apela al sistema de honor.

### 6.2 Mecanismo A: QR físicamente pegado en la pared

Los QRs son físicos, únicos por ruta, y están pegados al muro junto a la ruta correspondiente. Ya está implementado en Relámpago actual.

**Debilidad conocida:** alguien puede tomar foto del QR con su celular y escanearlo después. Este mecanismo por sí solo no basta.

### 6.3 Mecanismo B: Ventana de tiempo entre escaneo y "ya lo completé"

**Regla:** el botón "YA LO COMPLETÉ" solo funciona si el usuario (o su device) escaneó el QR de esa ruta en los últimos **30 minutos**.

**Implementación:**
1. Cada escaneo de QR crea un registro en la tabla `scans` con `(user_id o device_id, route_id, scanned_at)`.
2. Al pulsar "YA LO COMPLETÉ", el backend verifica: `¿existe algún scan de este route_id por este user_id o device_id en los últimos 30 minutos?`
3. Si sí, se procede. Si no, se rechaza con mensaje: "Vuelve a escanear el QR para confirmar tu send".

**Consecuencia:** para hacer trampa, alguien tendría que:
1. Ir al gym físicamente y escanear todos los QRs que quiere marcar.
2. Marcarlos en menos de 30 minutos cada uno.
3. Repetir esto en persona múltiples veces.

Para la mayoría de la gente, el esfuerzo de la trampa supera la recompensa (unos puntos en un tablero). Los pocos que lo intenten se autocondenan al desgaste.

**Valor de 30 minutos:** balance entre no forzar al usuario a marcar inmediatamente (puede querer intentar unas veces más antes de marcar) y no permitir escaneos de horas atrás. Ajustable a la experiencia real.

### 6.4 Mecanismo C: Sistema de honor con letrero visible

En el gym, junto a la pantalla del leaderboard, se pone un letrero físico que explique el sistema con lenguaje directo:

> **Este es un sistema de honor.** Marca solo las rutas que realmente completaste. La comunidad lo agradece.

La combinación de los tres mecanismos (QR físico + ventana de tiempo + letrero) cubre bien la mayoría de casos. Si eventualmente se detecta abuso, se puede agregar geolocalización o verificación por WiFi del gym como Mecanismo D. No se incluye en esta primera versión.

---

## 7. Identidad del cliente

### 7.1 Cuenta obligatoria

Para participar en puntos y leaderboard, el usuario **debe tener cuenta**. Sin cuenta, puede ver la ficha de la ruta y darle 👍/👎 pero no puede sumar puntos.

### 7.2 Datos mínimos por cuenta

- **Email:** único, requerido, verificado por link mágico o código de verificación.
- **Nombre o alias público:** lo que aparece en la pantalla del leaderboard. Puede ser nombre real, apodo, o cualquier alias que el usuario elija. Editable después.
- **Consentimiento de aparecer en leaderboard público:** checkbox durante creación de cuenta. Si NO acepta, sus puntos se acumulan pero no aparece en la pantalla ni en el leaderboard visible dentro de la app. Ver §7.4.
- **Fecha de creación de cuenta**
- **Fecha del último login** (útil para métricas)

### 7.3 Método de autenticación sugerido

**Opción recomendada:** email + link mágico (magic link). El usuario escribe su email, recibe un link temporal en su correo, hace clic, ya está autenticado. Sin contraseña.

Ventajas: cero fricción de "recordar contraseña", cero mantenimiento de recuperación de cuentas.
Desventaja: requiere abrir el correo (un paso más). En la práctica, la mayoría de la gente ya tiene el correo abierto.

Alternativa: OAuth con Google/Apple si Supabase Auth lo facilita. Es un solo tap si el usuario ya tiene sesión en Google/Apple. Consideración para v1 o para agregar después.

### 7.4 Opción de privacidad

Durante la creación de cuenta, checkbox obligatorio:

> ¿Quieres aparecer en el leaderboard público de la pantalla del gym?
> ● Sí, con mi nombre / alias
> ○ No, quiero acumular puntos privadamente

Esta preferencia es editable después en el perfil del usuario.

**Comportamiento:**
- Si `visible_in_leaderboard = true`: el usuario aparece en la pantalla con su nombre/alias.
- Si `visible_in_leaderboard = false`: el usuario NO aparece en la pantalla, ni siquiera si está entre los top. Sus puntos se acumulan igual y él los ve en su perfil personal.

**Nota importante:** cuando un usuario "invisible" está en el top 10, el sistema debe omitirlo y mostrar al #11 en su lugar. La pantalla nunca debe mostrar posiciones vacías.

### 7.5 Consideraciones legales (LFPDPPP en México)

Al recabar email + nombre y hacer un uso público de la información (mostrar nombre en pantalla), se requiere:
- Aviso de privacidad claro al momento de crear cuenta.
- Consentimiento expreso para el uso público (el checkbox de §7.4 cumple esto).
- Mecanismo de ejercer derechos ARCO (acceso, rectificación, cancelación, oposición). Puede ser un email de contacto en el aviso.

---

## 8. Diseño de la pantalla física

### 8.1 Layout general

La pantalla se divide en tres zonas principales:

```
┌──────────────────────────────────────────────────┐
│   TICKER DE EVENTOS RECIENTES (banda superior)   │
├────────────────────────────┬─────────────────────┤
│                            │                     │
│   LEADERBOARD DIARIO       │  LEADERBOARD        │
│   (zona principal, 65%)    │  MENSUAL            │
│                            │  (zona secundaria,  │
│                            │  35%)               │
│                            │                     │
└────────────────────────────┴─────────────────────┘
```

### 8.2 Zona principal: Leaderboard diario

**Título arriba:** "HOY" en tipografía grande.

**Debajo:** la fecha actual (ej. "Domingo 20 de julio").

**Lista de top 10:** cada entrada muestra:
- Posición grande (1-10). El #1 destacado (tamaño extra o color distintivo).
- Nombre / alias del usuario.
- Puntos.

**Formato sugerido de cada línea:**

```
#1   ANDRÉS G.              23 pts
#2   MARÍA L.               19 pts
#3   ...                    ...
```

**Tipografía:** el nombre y los puntos del #1 tienen que verse desde 5-6 metros. Estimado: mínimo 60-70 píxeles de altura para la fila del #1, escalando hacia abajo (40-50 px para los últimos). Los tamaños exactos dependen de la resolución y tamaño de la TV, pero el principio es: **grande, legible desde lejos, con jerarquía clara**.

**Contraste:** alto. Fondo oscuro con texto claro, o fondo claro con texto oscuro. Evitar grises intermedios que no se leen a distancia.

### 8.3 Zona secundaria: Leaderboard mensual

**Título arriba:** "MES" o "JULIO" (nombre del mes actual).

**Debajo:** rango del mes ("1-31 de julio").

**Lista de top 5:** mismo formato que el diario pero con menos entradas y más chico.

### 8.4 Ticker de eventos recientes

**Banda superior o inferior de la pantalla** (elegir según pruebas visuales).

Muestra los últimos ~5-8 eventos recientes rotando. Texto tipo:

> ANDRÉS G. mandó V4 verde · MARÍA L. mandó V2 amarillo · JULIO R. sumó su primer send · CARLA hizo el V5 rojo del desplome

**Función:** dar visibilidad a sends que no llegan al top 10. Especialmente importante para principiantes que están mandando sus primeros V0-V2 y necesitan sentir que su logro también existe.

**Comportamiento:** cada nuevo send aparece en el ticker durante unos segundos y luego se archiva. Solo se muestran los eventos de las últimas 2-3 horas (para que el ticker refleje "lo que está pasando ahora"). Si no hay actividad reciente, el ticker se puede ocultar o mostrar mensaje genérico ("Sé el próximo en mandar").

### 8.5 Elementos NO incluidos en esta primera versión

Explícitamente descartados por Inge para v1 (pueden agregarse después):

- **Animaciones grandes al cambiar posición.** En v1 los leaderboards solo se actualizan (el DOM cambia), sin animación llamativa. Se puede agregar después si la experiencia lo pide.
- **"Ruta caliente del día"** (ruta con más sends). No se muestra en v1.
- **Categorías por nivel, edad o género.** El leaderboard es todo el gym vs. todo el gym. Sin filtros. Se reevalúa después de meses de uso si se detecta que la desigualdad desmotiva a principiantes.

### 8.6 Estados especiales

- **Sin actividad hoy:** si no hay ningún send del día, el leaderboard diario muestra un mensaje "Nadie ha marcado un send hoy. ¡Sé el primero!" en vez de una tabla vacía.
- **Sin actividad este mes:** similar para el mensual (raro pero posible los primeros días del mes).
- **Reconexión:** si el websocket se cae, la pantalla muestra un pequeño indicador discreto en una esquina ("Reconectando..."). Cuando se restablece, actualiza sin recargar.

---

## 9. Arquitectura de datos

### 9.1 Nuevas tablas

**Tabla `users` (o `profiles`, según convención Supabase Auth):**

```
users
  id                      – UUID (Supabase Auth)
  email                   – string, único
  display_name            – string (nombre o alias público)
  visible_in_leaderboard  – boolean, default true
  created_at              – timestamp
  updated_at              – timestamp
  last_login_at           – timestamp
```

**Tabla `scans`:**

```
scans
  id                      – UUID
  user_id                 – FK a users.id (nullable si el usuario no está logueado)
  device_id               – string (fingerprint del dispositivo, siempre presente)
  route_id                – FK a routes.id
  scanned_at              – timestamp (UTC)
```

Uso: verificación anti-gaming (§6.3).

**Tabla `sends`:**

```
sends
  id                      – UUID
  user_id                 – FK a users.id (NO nullable, requiere login)
  route_id                – FK a routes.id
  sent_at                 – timestamp (UTC)
  points_daily            – int (siempre igual al valor del grado)
  points_monthly          – int (0 si es duplicado en el mes, valor del grado si es primera vez)

  # Índices sugeridos:
  # - (user_id, sent_at) para queries de leaderboard
  # - (route_id, user_id, sent_at) para verificar duplicados
```

### 9.2 Vistas o queries de leaderboard

**Leaderboard diario:**

```sql
SELECT
  u.display_name,
  SUM(s.points_daily) AS total
FROM sends s
JOIN users u ON u.id = s.user_id
WHERE s.sent_at >= [inicio del día en hora local del gym convertido a UTC]
  AND s.sent_at <  [inicio del día siguiente en hora local del gym convertido a UTC]
  AND u.visible_in_leaderboard = true
GROUP BY u.id, u.display_name
ORDER BY total DESC
LIMIT 10
```

**Leaderboard mensual:**

```sql
SELECT
  u.display_name,
  SUM(s.points_monthly) AS total
FROM sends s
JOIN users u ON u.id = s.user_id
WHERE s.sent_at >= [inicio del mes en hora local del gym convertido a UTC]
  AND s.sent_at <  [inicio del siguiente mes en hora local del gym convertido a UTC]
  AND u.visible_in_leaderboard = true
GROUP BY u.id, u.display_name
ORDER BY total DESC
LIMIT 5
```

**Consideración de performance:** para un gym con volumen moderado (cientos de sends al día), estas queries son triviales. Si el volumen crece a miles, considerar tabla materializada o cache con invalidación por evento.

### 9.3 Lógica del "primera vez este mes"

Al insertar un nuevo send, calcular `points_monthly`:

```
IF EXISTS (
  SELECT 1 FROM sends
  WHERE user_id = [current user]
    AND route_id = [current route]
    AND sent_at >= [inicio del mes local]
    AND sent_at <  [inicio del siguiente mes local]
    AND id != [current send id]
)
THEN points_monthly = 0
ELSE points_monthly = [valor del grado]
```

### 9.4 Verificación del "ya lo mandé hoy"

Antes de insertar un send, verificar duplicado del día:

```
IF EXISTS (
  SELECT 1 FROM sends
  WHERE user_id = [current user]
    AND route_id = [current route]
    AND sent_at >= [inicio del día local]
    AND sent_at <  [inicio del día siguiente local]
)
THEN rechazar con mensaje "Ya marcaste esta ruta hoy"
ELSE proceder con insert
```

### 9.5 Actualización en tiempo real

**Supabase Realtime (websockets sobre Postgres).**

La pantalla física se suscribe a cambios en la tabla `sends` (INSERT events). Al recibir un evento, el frontend:

1. Ejecuta las dos queries de leaderboard.
2. Actualiza el DOM del leaderboard diario y mensual.
3. Agrega el evento al ticker con nombre del usuario, grado, color de la ruta.

Alternativa (más simple pero menos elegante): polling cada 10-15 segundos con las queries. Funciona bien para v1 si se quiere evitar la complejidad de websockets. Recomendación: **empezar con Realtime desde el principio**, ya que es la forma correcta y Supabase lo facilita.

---

## 10. Hardware

### 10.1 Fase 1 (MVP, para probar la idea): PC + HDMI + TV

**Setup:**
- TV vieja que Inge ya tiene, colocada en un lugar visible del gym.
- Cable HDMI conectando la TV a una PC (la de Inge o una dedicada).
- Chrome abierto en pantalla completa (F11) apuntando a la URL del leaderboard.

**Consideraciones operativas críticas:**

1. **La PC no puede apagarse mientras el leaderboard esté en uso.** Si se apaga, la pantalla queda negra.
2. **Chrome debe quedar en pantalla completa (F11).** Si accidentalmente se sale de pantalla completa (Esc), se ve la barra de direcciones — feo pero funcional.
3. **Prevenir que Windows/Mac entre en modo sleep o suspenda la pantalla.** Ajustar configuración de energía:
   - Windows: Panel de control → Opciones de energía → Cambiar plan → "Nunca" en apagar pantalla y suspender.
   - Mac: Preferencias del Sistema → Ahorro de energía → Nunca poner en reposo.
4. **Mover el mouse cada tanto** para evitar screensaver. Alternativa: instalar app tipo "Caffeine" que previene el sleep sin intervención manual.
5. **Si Chrome se cierra o crashea**, hay que abrirlo manualmente. Considerar extensión de "auto-reload tab" que refresca cada X minutos como fallback.
6. **Salida de audio:** si la TV se pone como salida de audio por el HDMI, y no lo quieres, verificar configuración de audio del sistema para que no cambie.
7. **Resolución:** verificar que Chrome se abra con la resolución nativa de la TV (1920x1080 típicamente para TV vieja). Si aparece con letterbox negro, ajustar en configuración de pantalla del sistema.

**Duración esperada de esta fase:** 2-4 semanas mientras se valida:
- Que la gente sí voltea a ver la pantalla.
- Que el flow de escaneo → login → "ya lo completé" funciona sin bugs.
- Que el sistema no explota con carga real.
- Que las decisiones de diseño (top 10 diario, top 5 mensual, ticker) son las correctas o necesitan ajuste.

### 10.2 Fase 2 (Producción): Raspberry Pi 4

Después de validar la Fase 1, se migra a hardware dedicado.

**Componentes:**
- Raspberry Pi 4 (modelo 4GB): ~1,800-2,500 MXN
- Fuente de poder oficial: ~400 MXN
- MicroSD 32GB: ~200 MXN
- Cable HDMI (o el que ya se usa en Fase 1): ~150 MXN
- Case opcional (recomendado para durabilidad): ~300 MXN

**Total: ~2,500-3,500 MXN**

**Ventajas sobre PC:**
- Consumo eléctrico bajísimo (~5 watts vs 40-80W de una PC).
- Sin ventilador (silenciosa).
- Diseñada para estar prendida 24/7.
- Sin actualizaciones automáticas que reinicien.
- Cuando llega la luz después de un corte, arranca sola.

**Setup técnico (una vez):**

1. Instalar Raspberry Pi OS (versión con escritorio) en la microSD usando Raspberry Pi Imager.
2. Configurar WiFi en el primer arranque.
3. Instalar Chromium (viene preinstalado en la mayoría de versiones).
4. Configurar autoinicio: crear un script que arranque con el sistema y abra Chromium en modo kiosk apuntando a la URL del leaderboard:

   ```bash
   chromium-browser --kiosk --noerrdialogs --disable-infobars --start-fullscreen [URL]
   ```

5. Agregar el script a `~/.config/autostart/` o `/etc/xdg/lxsession/LXDE-pi/autostart` para que se ejecute al login.
6. Deshabilitar el screen blanking del sistema para que la pantalla nunca se apague.
7. Configurar auto-login del usuario Pi para que no pida contraseña al arrancar.

**Comportamiento resultante:** conectar HDMI + corriente → arranca sola → abre Chromium en pantalla completa con el leaderboard → cero mantenimiento por meses.

### 10.3 Consideraciones de software para la pantalla (aplican a ambas fases)

**El frontend del leaderboard debe cumplir:**

1. **Ser una URL directa y estable.** Ejemplo: `https://relampago.mx/leaderboard/display` (o el subdominio/ruta que se use). El navegador del hardware apunta ahí y ya.
2. **Ser resiliente a pérdidas de conexión.** Si el WiFi se cae, mostrar mensaje pequeño "Reconectando..." en una esquina y reintentar automáticamente. Nunca quedarse en blanco.
3. **Auto-reload en caso de crash del websocket.** Si el evento de reconexión falla más de X intentos, hacer full reload de la página.
4. **No requerir interacción del usuario.** La pantalla del gym no tiene teclado ni mouse — cualquier flujo que requiera clic, tecla, o dismiss de modal, no funciona ahí.
5. **Diseño responsive pero optimizado para 1920x1080 landscape.** Puede haber variaciones (algunas TVs son 4K, otras 720p), pero el punto óptimo es 1080p landscape.
6. **Cero autenticación.** La URL del display es pública (no expone datos privados, solo lo que ya se muestra en la pantalla). Si por seguridad se prefiere autenticar el display, usar un token en la URL: `https://relampago.mx/leaderboard/display?token=xyz` — pero esto complica el setup del hardware.

---

## 11. Notas técnicas específicas para implementación

### 11.1 Ventana de tiempo del anti-gaming

El valor de **30 minutos** para la ventana entre `scanned_at` y `sent_at` es una decisión inicial. Consideraciones para el equipo técnico:

- No debe ser demasiado corto (10 min es agresivo si alguien está intentando la ruta y toma varios turnos).
- No debe ser demasiado largo (2 horas permite escanear al llegar y marcar al final de la sesión sin haber realmente escalado).
- 30 minutos es un balance razonable y ajustable en configuración del backend sin cambio de código.

### 11.2 Zona horaria del gym

Definir como constante o config: `GYM_TIMEZONE = 'America/Mexico_City'` (o la que aplique).

Todas las funciones que calculan "día actual" y "mes actual" usan esta constante. Si el gym eventualmente abre sucursales en otras zonas horarias, cada gym tendría su propio timezone.

### 11.3 Manejo de casos edge

**Send en el minuto que cambia el día:** si un send se registra a las 23:59:58 hora local, cuenta al día que está terminando. Si se registra a las 00:00:03 del día siguiente, cuenta al día nuevo. La conversión de UTC a hora local debe ser precisa.

**Send en el minuto que cambia el mes:** análogo al anterior pero para el mensual.

**Usuario deshabilita `visible_in_leaderboard` a mitad del día:** sus puntos existentes se recalculan? No. Sus puntos siguen existiendo pero deja de aparecer en el leaderboard. Si vuelve a habilitarlo, reaparece. El campo `visible_in_leaderboard` se consulta en tiempo real por la query del leaderboard.

**Usuario cambia su `display_name`:** el nombre se actualiza inmediatamente en la próxima query del leaderboard. Los sends históricos no guardan el nombre (se joinea con users cada vez).

**Usuario elimina su cuenta:** decisión de negocio. Opciones:
- (A) Hard delete: sus sends se borran, sus puntos desaparecen del historial.
- (B) Soft delete: se marca la cuenta como eliminada, sus sends permanecen pero no aparecen en leaderboard.
- (C) Anonymize: sus sends permanecen atribuidos a "usuario anónimo" pero pierde su nombre.

Recomendación: **B (soft delete)** para no romper estadísticas históricas y cumplir con LFPDPPP (que permite oposición al tratamiento, no borrado técnico completo).

### 11.4 Rate limiting

Aunque el sistema anti-gaming (§6) previene mucho abuso, considerar rate limits generales en el endpoint de "ya lo completé":
- Máximo 30 sends por usuario por hora (imposible físicamente escalar tan rápido).
- Máximo 100 sends por usuario por día (holgado incluso para sesiones muy largas).

Estos límites detectan bots o abuso automatizado, no comportamiento genuino.

### 11.5 Endpoints necesarios (sugerencia, adaptable a la arquitectura actual)

- `POST /api/scans` — registrar escaneo de QR (autenticado opcionalmente).
- `POST /api/sends` — registrar send con validaciones.
- `GET /api/leaderboard/daily` — top 10 del día.
- `GET /api/leaderboard/monthly` — top 5 del mes.
- `GET /api/users/me/stats` — total de puntos del usuario en día y mes actual, posición en leaderboard.
- `GET /leaderboard/display` — la vista HTML del leaderboard para la pantalla (no un endpoint API, sino la página misma).

---

## 12. Fases de implementación sugeridas

### Fase 0: Preparación

1. Definir zona horaria del gym como constante.
2. Diseñar mockup visual del leaderboard (puede hacerse con Figma o directamente en HTML).
3. Configurar Supabase Realtime en el proyecto (si no está ya activo).

### Fase 1: Backend y datos

1. Crear tablas `users` (o extender `profiles` de Supabase Auth), `scans`, `sends`.
2. Implementar lógica de puntos según grado.
3. Implementar validación anti-gaming (ventana de tiempo de 30 min).
4. Implementar validación de duplicado del día.
5. Implementar lógica "primera vez este mes" para `points_monthly`.
6. Implementar queries de leaderboard diario y mensual con timezone del gym.
7. Configurar Realtime subscription en la tabla `sends`.

### Fase 2: Flow de cliente móvil

1. Agregar sistema de autenticación (magic link + display_name + visible_in_leaderboard).
2. Modificar la ficha del QR de ruta:
   - Registrar `scan` al abrir la ficha.
   - Mostrar botón "YA LO COMPLETÉ" con puntos que sumará.
   - Si no está logueado, mostrar CTA para crear cuenta.
3. Implementar el POST del send con las validaciones.
4. Mostrar pantalla de confirmación post-send.
5. (Opcional) Agregar vista personal de "mi score" con puntos totales del día y mes.

### Fase 3: Pantalla física

1. Desarrollar la vista `/leaderboard/display` como página web independiente.
2. Optimizar CSS para 1920x1080 landscape con tipografías grandes.
3. Implementar suscripción websocket a la tabla `sends`.
4. Implementar ticker de eventos recientes.
5. Implementar estados de reconexión y de "sin actividad".
6. Probar en la TV del gym con la PC (Fase 1 de hardware).

### Fase 4: Validación con hardware temporal

1. Conectar TV a PC vía HDMI.
2. Configurar Chrome en pantalla completa.
3. Dejar corriendo 2-4 semanas.
4. Observar comportamiento real:
   - ¿La gente voltea a ver?
   - ¿Los principiantes se motivan o se desmotivan?
   - ¿Hay bugs con el flujo?
   - ¿Los tamaños de fuente son legibles?
   - ¿La regla mensual "1 vez por ruta" tiene el efecto esperado en distribución de scores?

### Fase 5: Migración a Raspberry Pi

Después de validar la Fase 4, comprar y configurar la RPi para operación permanente.

### Fase 6: Ajustes post-lanzamiento

Basados en la observación de la Fase 4:
- Posibles ajustes al sistema de puntos (¿lineal está bien o necesita ser exponencial?).
- Posibles ajustes a la ventana anti-gaming (¿30 min es el número correcto?).
- Posibles adiciones a la pantalla (animaciones, ruta caliente, categorías) si la data lo justifica.

---

## 13. Decisiones tomadas explícitamente

Estas decisiones ya no requieren discusión — están fijadas para v1:

1. **Sistema de puntos lineal V0=1 hasta V8=9.** Simple, ajustable después.
2. **Leaderboard diario:** top 10, reset a medianoche hora local, misma ruta cuenta una vez por día.
3. **Leaderboard mensual:** top 5, reset el día 1 del mes, cada ruta cuenta una sola vez en todo el mes.
4. **Anti-gaming:** QR físico + ventana de tiempo de 30 minutos + letrero de sistema de honor.
5. **Sin animaciones grandes en v1.** Solo actualización del DOM.
6. **Sin ruta caliente en v1.**
7. **Sin categorías.** Todo el gym vs todo el gym.
8. **Cuenta obligatoria** para participar en puntos.
9. **Opción de privacidad:** usuarios pueden acumular puntos sin aparecer en pantalla pública.
10. **Hardware fase 1:** PC + HDMI + TV vieja. Fase 2 posterior: Raspberry Pi 4.

## 14. Cosas dejadas para después / a ajustar

1. Los valores exactos de puntos por grado (revisar tras primer mes de datos).
2. La ventana de tiempo del anti-gaming (30 min es tentativa).
3. Animaciones en la pantalla al cambiar posición.
4. Categorías por nivel/edad/género si aparece señal de que las hace falta.
5. Multiplicadores por ruta reciente, primer send del día, etc.
6. "Ruta caliente del día" en la pantalla.
7. Verificación por geolocalización o WiFi del gym como refuerzo anti-gaming.
8. Sistema de recompensas físicas por milestones de puntos (integra con idea 11 original).
9. Notificaciones push cuando el usuario baja del top 10 o cuando alguien lo rebasa.

## 15. Preguntas abiertas para Claude Code

Estas son decisiones técnicas que Claude Code debe tomar durante la implementación, guiado por el resto del documento:

1. **Estructura exacta de las tablas.** El documento sugiere columnas y tipos, pero Claude Code puede ajustar según convenciones del proyecto actual.
2. **Convención de nombres.** Verificar si el proyecto usa camelCase o snake_case y adaptar.
3. **Manejo de sesión.** Cómo integrar magic link auth con la arquitectura actual de Supabase.
4. **Storage de tokens en el cliente móvil.** Cookies vs localStorage — decidir según lo que ya usa el proyecto.
5. **Migración de rutas existentes.** No requiere migración: las rutas ya existen, solo se les agrega la capacidad de recibir sends puntuados. No hay dato viejo que perder.
6. **Manejo del reset diario/mensual.** ¿Se usa un cron job para "cerrar" el día/mes, o simplemente los queries filtran por rango de fechas? Recomendación: **la segunda opción, sin cron**. Los queries siempre filtran por rango, no hay que "cerrar" nada.

---

## 16. Resumen ejecutivo para presentar a Claude Code

**Qué se construye:**
- Sistema de puntos por sends declarados en la app cliente.
- Dos leaderboards en tiempo real (diario y mensual) con reglas de deduplicación distintas.
- Pantalla física en el gym con URL dedicada que muestra ambos leaderboards + ticker de eventos.
- Mecanismos anti-gaming: QR físico + ventana de tiempo de 30 min + letrero de honor.
- Cuentas obligatorias con opción de privacidad.

**Qué NO se construye en v1:**
- Animaciones, ruta caliente, categorías, multiplicadores, geolocalización.

**Stack técnico:**
- Supabase (DB + Auth + Realtime), como el resto del proyecto.
- React + Konva en el cliente (como ya está).
- Frontend adicional para la vista `/leaderboard/display` optimizada para pantalla grande.

**Hardware:**
- Fase 1: PC vieja + HDMI a TV vieja de Inge (para validar).
- Fase 2: Raspberry Pi 4 (para operación definitiva, después de validar).

---

*Fin del documento. Proyecto Relámpago, 2026-07-20.*
