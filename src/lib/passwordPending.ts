import { useEffect, useState } from 'react'

// "Falta crear contraseña": se prende cuando el cliente entra con un código
// (primera vez u "olvidé mi contraseña") y se apaga al guardar la contraseña.
// Vive en localStorage para que también funcione si abre el link del correo
// en otra pestaña. SetPasswordPrompt (montado en App) pide la contraseña.

const KEY = 'jm_password_pending'
const EVENT = 'jm-password-pending'

export function setPasswordPending(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* sin storage: no pasa nada */ }
  window.dispatchEvent(new Event(EVENT))
}

export function isPasswordPending(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function usePasswordPending(): boolean {
  const [pending, setPending] = useState(isPasswordPending)
  useEffect(() => {
    const sync = () => setPending(isPasswordPending())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  return pending
}
