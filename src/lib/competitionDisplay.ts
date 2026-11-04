// TEMPORAL (pedido del dueño 2026-11-03): desde hoy y hasta el día de la
// competencia (viernes 7 de noviembre, inclusive) la TV (/leaderboard/display)
// NO muestra el leaderboard ni los slides: muestra la información de la
// competencia.
// 2026-11-04: con las reglas nuevas (docs/competencia-reglas.md) qué bloque
// es de qué categoría es SECRETO, así que ya no se muestran rutas por
// categoría: solo horarios, número de bloques y cómo se juega.
// El 8 de noviembre a las 00:00 (hora de México) la TV regresa sola a
// HOY / SEMANA / MES. Ya pasada la fecha se puede borrar este archivo y su uso
// en LeaderboardDisplay.
export const COMPETITION_DISPLAY = {
  startDate: '2026-11-03', // inclusive, fecha de México
  endDate: '2026-11-07',   // inclusive, fecha de México
  title: 'JAM · Jaibas Al Muro',
  subtitle: 'Viernes 7 de noviembre',
  slots: ['10:00 a 12:00', '12:30 a 2:30', '3:00 a 5:00'],
  awards: 'Premiación 5:30 pm',
  blocks: 24,
  rules: [
    'Intenta los bloques que quieras, en el orden que quieras.',
    'Los bloques más difíciles valen más. La zona vale la mitad.',
    'Cuentan tus 5 mejores bloques.',
    'Cada caída resta 0.01: ¡atrévete con los difíciles!',
    'Cada zona es un boleto para la rifa.',
  ],
}

export function isCompetitionDisplayActive(): boolean {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return today >= COMPETITION_DISPLAY.startDate && today <= COMPETITION_DISPLAY.endDate
}
