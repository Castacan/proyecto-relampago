import { useEffect } from 'react'

// Pantallas que nadie toca (la TV con la Raspberry Pi en /leaderboard/display):
// cada pocos minutos revisa si en Vercel hay una versión nueva de la app y, si la hay,
// recarga la página sola. Así los cambios llegan a la TV sin que nadie la mueva.
// No recarga mientras la ruleta está girando o anunciando (window.__noAutoReload).
const CHECK_MS = 5 * 60 * 1000

function currentBundle(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return s ? new URL(s.src, location.href).pathname : null
}

export function useAutoUpdate() {
  useEffect(() => {
    const mine = currentBundle()
    if (!mine) return // en desarrollo (vite) no hay bundle
    const check = async () => {
      if ((window as unknown as { __noAutoReload?: boolean }).__noAutoReload) return
      try {
        const res = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const html = await res.text()
        const m = html.match(/\/assets\/index-[^"']+\.js/)
        if (m && m[0] !== mine) location.reload()
      } catch {
        // sin internet: se intenta en la siguiente vuelta
      }
    }
    const t = setInterval(check, CHECK_MS)
    return () => clearInterval(t)
  }, [])
}
