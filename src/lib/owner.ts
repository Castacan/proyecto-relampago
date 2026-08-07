// Único correo con acceso a /staff/insights (dashboard de datos de clientes).
// Guard real vive en el RPC get_admin_insights (SECURITY DEFINER, checa
// auth.jwt() ->> 'email' en la base de datos) — esta constante solo controla
// la UI (ocultar el tab, redirigir si alguien entra por URL directa).
export const OWNER_EMAIL = 'esz1996mx@gmail.com'

export function isOwner(email: string | null): boolean {
  return email != null && email.toLowerCase() === OWNER_EMAIL
}
