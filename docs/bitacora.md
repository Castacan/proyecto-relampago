# Bitácora — Proyecto Relámpago (Jaibamuro)

Registro de lo que se va haciendo, sesión por sesión. Lo más reciente arriba.

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

**Pendiente (SQL en Supabase):** los RPC `get_daily_leaderboard`,
`get_weekly_leaderboard` y `get_monthly_leaderboard` cortan en `LIMIT 50`
en producción. `src/supabase/schema.sql` ya dice `LIMIT 200`, pero hay que
correr esas 3 funciones en el SQL Editor para que del 51 en adelante
aparezcan. Mientras no se corra, el scroll funciona pero solo hasta el #50.
