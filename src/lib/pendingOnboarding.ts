// Marca explícita de "mandé un magic link/código y todavía no completo
// mi perfil de climber". Se usa para decidir si auto-abrir el paso de
// "elige tu alias" al volver con sesión pero sin climber.
//
// Antes esto se inferia leyendo window.location.hash en busca de
// "access_token" al montar la página — frágil por timing (la sesión
// podía no estar lista todavía cuando se leía el hash) y por formato
// (no cubre el flujo PKCE con ?code= en vez de #access_token=). Un
// flag explícito en localStorage (no sessionStorage: el link de correo
// suele abrir en una pestaña nueva) es determinista sin importar cómo
// ni cuándo vuelve la sesión.
const KEY = 'relampago_pending_onboarding'

export function markPendingOnboarding() {
  localStorage.setItem(KEY, '1')
}

export function isPendingOnboarding(): boolean {
  return localStorage.getItem(KEY) === '1'
}

export function clearPendingOnboarding() {
  localStorage.removeItem(KEY)
}
