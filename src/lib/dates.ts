// Nombres en español compartidos — extraído de LeaderboardDisplay.tsx
// (2026-08-23) cuando WinnerImageModal necesitó los mismos arrays para
// formatear el rango de fechas del patrocinio en la imagen de ganador.
export const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
export const DAYS_ES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']

// Formatea una fecha "pura" (columna DATE de Postgres, ej. "2026-08-17",
// sin hora/timezone) sin pasar por Date() — new Date("YYYY-MM-DD") la
// interpreta como medianoche UTC, y formatearla en un dispositivo en
// CDMX (UTC-6) la corre un día hacia atrás. Partir el string evita eso.
export function fmtDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${d} de ${MONTHS_ES[m - 1]} ${y}`
}

// Igual que fmtDateOnly pero solo mes + año — para period_start de un mes
// calendario completo (siempre cae el día 1, no vale la pena mostrarlo).
export function fmtMonthOnly(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return `${MONTHS_ES[m - 1]} ${y}`
}
