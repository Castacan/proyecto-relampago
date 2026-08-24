// Generador de imagen vertical (formato historia de Instagram, 1080×1920)
// para anunciar al ganador semanal/mensual — botón "📸 Crear imagen" en
// /staff/display → Ganadores (2026-08-23). Todo el dibujo pasa por canvas
// 2D nativo, sin librerías — se exporta como PNG y el navegador lo
// descarga, el staff lo sube a mano a Instagram (no hay integración
// directa posible sin Instagram Graph API, ver AUDITORIA/memoria del
// proyecto sobre el grid de Instagram de la landing).

export const WINNER_IMAGE_WIDTH = 1080
export const WINNER_IMAGE_HEIGHT = 1920

const COLOR_FONDO = '#013a4b'
const COLOR_SUPERFICIE = '#015169'
const COLOR_TEXTO_PRINCIPAL = '#f4f4f3'
const COLOR_TEXTO_SECUNDARIO = '#a8b3b8' // más claro que --color-texto-secundario (#71717a) — ese es para UI sobre fondos claros de card, aquí es texto directo sobre el azul petróleo y necesita más contraste
const COLOR_PRIMARIO = '#ff4d15'

export interface WinnerImageEntry {
  display_name: string
  total_points: number
}

export interface WinnerImageData {
  periodLabel: string // "GANADOR DEL MES" / "GANADOR DE LA SEMANA"
  dateRangeLabel: string // ej. "17–23 de Agosto"
  // Ambos opcionales (2026-08-24, periodos SIN patrocinio en Ganadores):
  // vacíos/undefined → se omiten por completo la sección de patrocinador y la
  // línea "se lleva: X" bajo el #1, queda un post limpio de solo top 3.
  sponsorName?: string
  prizeText?: string
  // 'top' (default): card grande justo debajo del encabezado, como siempre
  // (patrocinio real ligado al periodo). 'bottom' (2026-08-24, Ganadores sin
  // patrocinio: el staff elige el logo de un patrocinador YA existente en
  // el sistema, no sube uno nuevo) — crédito chico pegado al pie, arriba
  // del footer "@jaibamuro", para no competir visualmente con el ganador.
  sponsorPosition?: 'top' | 'bottom'
  top3: WinnerImageEntry[] // ya filtrado (sin excluidos), máx 3, top3[0] es el #1
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // necesario para exportar el canvas (toBlob) sin taint si el logo del patrocinador viene de Supabase Storage
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${src}`))
    img.src = src
  })
}

// Los pesos de Inter se cargan vía Google Fonts en index.html pero el
// navegador solo los baja cuando algo en el DOM realmente los usa — texto
// dibujado en canvas no cuenta, hay que pedirlos explícito o el canvas
// cae a la fuente default del sistema.
async function ensureFontsLoaded() {
  await Promise.all([
    document.fonts.load('900 80px Inter'),
    document.fonts.load('800 64px Inter'),
    document.fonts.load('700 48px Inter'),
    document.fonts.load('600 36px Inter'),
  ])
  await document.fonts.ready
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Dibuja `img` centrado en (cx, cy) sin deformarlo, cabiendo dentro de
// maxW×maxH. Regresa el tamaño real dibujado (útil para posicionar texto
// justo debajo).
function drawImageContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
  return { w, h }
}

// Reduce el tamaño de fuente hasta que `text` quepa en maxWidth (o llegue
// a minSize) — para nombres/premios de longitud variable en el card del #1.
function fitFontSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, minSize: number, weight: string): number {
  let size = startSize
  while (size > minSize) {
    ctx.font = `${weight} ${size}px Inter`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

export async function drawWinnerImage(
  canvas: HTMLCanvasElement,
  gymLogo: HTMLImageElement,
  sponsorLogo: HTMLImageElement | null,
  data: WinnerImageData
) {
  canvas.width = WINNER_IMAGE_WIDTH
  canvas.height = WINNER_IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  await ensureFontsLoaded()

  const W = WINNER_IMAGE_WIDTH
  const CX = W / 2
  const PAD_X = 80
  const CONTENT_W = W - PAD_X * 2

  // Fondo
  ctx.fillStyle = COLOR_FONDO
  ctx.fillRect(0, 0, W, WINNER_IMAGE_HEIGHT)

  // Glow sutil de acento detrás del encabezado
  const glow = ctx.createRadialGradient(CX, 480, 40, CX, 480, 520)
  glow.addColorStop(0, 'rgba(255,77,21,0.16)')
  glow.addColorStop(1, 'rgba(255,77,21,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 980)

  ctx.textAlign = 'center'

  // --- Logo del gym (agrandado 2026-08-24, antes 420×200) ---
  let y = 130
  const logoDims = drawImageContain(ctx, gymLogo, CX, y + 110, 520, 260)
  y += logoDims.h + 70

  // --- Encabezado "GANADOR DEL MES/SEMANA" ---
  ctx.fillStyle = COLOR_PRIMARIO
  ctx.font = '900 68px Inter'
  ctx.fillText(data.periodLabel, CX, y)
  y += 60

  ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
  ctx.font = '600 36px Inter'
  ctx.fillText(data.dateRangeLabel, CX, y)
  y += 90

  // --- Patrocinador arriba (omitido si no hay sponsorName, o si va abajo) ---
  const sponsorPosition = data.sponsorPosition ?? 'top'
  if (data.sponsorName && sponsorPosition === 'top') {
    ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
    ctx.font = '700 28px Inter'
    ctx.fillText('PATROCINA', CX, y)
    y += 40

    if (sponsorLogo) {
      const cardW = 340, cardH = 190
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, CX - cardW / 2, y, cardW, cardH, 28)
      ctx.fill()
      drawImageContain(ctx, sponsorLogo, CX, y + cardH / 2, cardW - 60, cardH - 60)
      y += cardH + 44
    }

    ctx.fillStyle = COLOR_TEXTO_PRINCIPAL
    ctx.font = '800 44px Inter'
    ctx.fillText(data.sponsorName, CX, y)
    y += 80
  } else {
    y += 30 // aire antes del card del #1, si no, queda muy pegado al rango de fechas
  }

  // --- Card grande del #1 ---
  const winner = data.top3[0]
  if (winner) {
    const cardH = 400
    ctx.fillStyle = COLOR_SUPERFICIE
    roundRect(ctx, PAD_X, y, CONTENT_W, cardH, 40)
    ctx.fill()
    ctx.strokeStyle = COLOR_PRIMARIO
    ctx.lineWidth = 5
    roundRect(ctx, PAD_X + 2.5, y + 2.5, CONTENT_W - 5, cardH - 5, 38)
    ctx.stroke()

    let innerY = y + 90
    ctx.fillStyle = COLOR_PRIMARIO
    ctx.font = '900 56px Inter'
    ctx.fillText('🏆 #1', CX, innerY)
    innerY += 100

    ctx.fillStyle = COLOR_TEXTO_PRINCIPAL
    const nameSize = fitFontSize(ctx, winner.display_name, CONTENT_W - 100, 76, 40, '900')
    ctx.font = `900 ${nameSize}px Inter`
    ctx.fillText(winner.display_name, CX, data.prizeText ? innerY : innerY + 20)
    innerY += 80

    if (data.prizeText) {
      const prizeLine = `se lleva: ${data.prizeText}`
      ctx.fillStyle = COLOR_PRIMARIO
      const prizeSize = fitFontSize(ctx, prizeLine, CONTENT_W - 100, 40, 24, '700')
      ctx.font = `700 ${prizeSize}px Inter`
      ctx.fillText(prizeLine, CX, innerY)
    }

    y += cardH + 50
  }

  // --- #2 y #3 ---
  const rowH = 130
  for (let i = 1; i <= 2; i++) {
    const entry = data.top3[i]
    if (!entry) continue
    ctx.fillStyle = COLOR_SUPERFICIE
    roundRect(ctx, PAD_X, y, CONTENT_W, rowH, 28)
    ctx.fill()

    ctx.textAlign = 'left'
    ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
    ctx.font = '900 52px Inter'
    ctx.fillText(`#${i + 1}`, PAD_X + 40, y + rowH / 2 + 18)

    ctx.fillStyle = COLOR_TEXTO_PRINCIPAL
    ctx.font = '800 44px Inter'
    const name = truncateToWidth(ctx, entry.display_name, CONTENT_W - 400)
    ctx.fillText(name, PAD_X + 150, y + rowH / 2 + 16)

    ctx.textAlign = 'right'
    ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
    ctx.font = '800 40px Inter'
    ctx.fillText(`${entry.total_points} pts`, PAD_X + CONTENT_W - 40, y + rowH / 2 + 14)
    ctx.textAlign = 'center'

    y += rowH + 24
  }

  // --- Patrocinador abajo (crédito chico, 2026-08-24) — anclado a una
  // posición fija cerca del pie en vez de fluir con `y`, para que quede
  // igual sin importar cuánto contenido haya arriba (top3 completo o no,
  // premio o no). Con el layout actual (header + card #1 + hasta 2 filas)
  // sobra ~200px de aire antes de aquí, no debería solaparse.
  const footerY = WINNER_IMAGE_HEIGHT - 90
  if (data.sponsorName && sponsorPosition === 'bottom') {
    // creditY se corrió más arriba (antes footerY-210) para que quepa el
    // logo más grande sin pisar la línea divisoria del footer (footerY-50).
    const creditY = footerY - 270
    ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
    ctx.font = '700 26px Inter'
    ctx.fillText('PATROCINA', CX, creditY)

    if (sponsorLogo) {
      // Sin card blanca detrás (2026-08-24, a pedido del usuario) — el logo
      // se dibuja directo sobre el fondo. Bastante más grande que antes
      // (200×110 → 320×160) ya que no compite con nada más aquí abajo.
      const boxW = 320, boxH = 160
      const boxY = creditY + 30
      drawImageContain(ctx, sponsorLogo, CX, boxY + boxH / 2, boxW, boxH)
    } else {
      ctx.fillStyle = COLOR_TEXTO_PRINCIPAL
      ctx.font = '800 32px Inter'
      ctx.fillText(data.sponsorName, CX, creditY + 50)
    }
  }

  // --- Footer ---
  ctx.strokeStyle = 'rgba(244,244,243,0.15)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD_X, footerY - 50)
  ctx.lineTo(W - PAD_X, footerY - 50)
  ctx.stroke()

  ctx.fillStyle = COLOR_TEXTO_SECUNDARIO
  ctx.font = '700 34px Inter'
  ctx.fillText('@jaibamuro', CX, footerY)
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
