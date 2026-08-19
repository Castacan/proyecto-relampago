// Extraído de LeaderboardDisplay.tsx (antes local ahí) para compartirlo
// con el countdown de patrocinadores — misma hora local que usa la TV.
export function nowMX(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
}

export function toMXDate(iso: string): Date {
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
}
