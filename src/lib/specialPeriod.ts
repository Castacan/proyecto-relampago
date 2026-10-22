// TEMPORAL (pedido del usuario 2026-10-21): del miércoles 21 al sábado 31
// de octubre la TV cambia las columnas HOY y SEMANA por una sola columna
// con el acumulado de ese rango, y deja MES igual. Desde el 1 de noviembre
// (00:00 hora de México) regresa sola a HOY / SEMANA / MES — no hay que
// desplegar nada. Ya pasada la fecha se puede borrar este archivo y su uso
// en useLeaderboard y LeaderboardDisplay.
export const SPECIAL_PERIOD = {
  startDate: '2026-10-21',   // inclusive, fecha de México
  endDate: '2026-10-31',     // inclusive, fecha de México
  // México centro es UTC-6 todo el año (sin horario de verano desde 2022).
  startISO: '2026-10-21T00:00:00-06:00',
  endISO: '2026-10-31T23:59:59.999-06:00',
  title: '21 AL 31 OCT',
  subtitle: 'Miércoles 21 a Sábado 31 de Octubre',
}

export function isSpecialPeriodActive(): boolean {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return today >= SPECIAL_PERIOD.startDate && today <= SPECIAL_PERIOD.endDate
}
