// TEMPORAL (pedido del dueño 2026-11-03): desde hoy y hasta el día de la
// competencia (viernes 7 de noviembre, inclusive) la TV (/leaderboard/display)
// NO muestra el leaderboard ni los slides: muestra solo qué números de ruta
// le tocan a cada categoría. Las categorías compiten mezcladas en los mismos
// bloques de horario, así que cada quien busca sus rutas por número.
// El 8 de noviembre a las 00:00 (hora de México) la TV regresa sola a
// HOY / SEMANA / MES. Ya pasada la fecha se puede borrar este archivo y su uso
// en LeaderboardDisplay.
//
// ⚠️ Los números de abajo son DE EJEMPLO (aleatorios de 1 a 30) mientras el
// dueño define los reales; el viernes los cambia aquí.
export const COMPETITION_DISPLAY = {
  startDate: '2026-11-03', // inclusive, fecha de México
  endDate: '2026-11-07',   // inclusive, fecha de México
  title: 'JAM · Jaibas Al Muro',
  subtitle: 'Viernes 7 de noviembre · Rutas por categoría',
  schedule: '10:00 a 12:00 · 12:30 a 2:30 · 3:00 a 5:00 · Premiación 5:30 pm',
  // Columnas = nivel; dentro de cada una, Femenil y Varonil.
  levels: [
    {
      name: 'BÁSICO',
      categories: [
        { name: 'Básico Femenil', routes: [2, 3, 4, 5, 11, 12, 13, 18, 19, 21] },
        { name: 'Básico Varonil', routes: [2, 5, 8, 10, 13, 18, 19, 26, 29, 30] },
      ],
    },
    {
      name: 'INTERMEDIO',
      categories: [
        { name: 'Intermedio Femenil', routes: [2, 3, 7, 8, 14, 17, 23, 25, 26, 30] },
        { name: 'Intermedio Varonil', routes: [4, 5, 6, 10, 14, 18, 19, 22, 27, 28] },
      ],
    },
    {
      name: 'AVANZADO',
      categories: [
        { name: 'Avanzado Femenil', routes: [2, 4, 8, 14, 18, 19, 21, 23, 26, 27] },
        { name: 'Avanzado Varonil', routes: [3, 4, 7, 12, 18, 19, 21, 23, 29, 30] },
      ],
    },
  ],
}

export function isCompetitionDisplayActive(): boolean {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return today >= COMPETITION_DISPLAY.startDate && today <= COMPETITION_DISPLAY.endDate
}
