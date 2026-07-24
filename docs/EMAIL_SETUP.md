# Setup de email transaccional — Jaibamuro

Guía para conectar un dominio propio con Resend y Supabase para que los magic links salgan desde `hola@[tu-dominio]`.

---

## Paso 1 — Comprar el dominio

Recomendado: `relampago.mx` o `jaibamuro.mx`. Registradores confiables: GoDaddy, Namecheap, Cloudflare Registrar.

---

## Paso 2 — Crear cuenta en Resend

1. Ir a [resend.com](https://resend.com) y crear cuenta gratuita.
2. Plan gratuito: 3,000 emails/mes, 100/día. Suficiente para producción inicial.

---

## Paso 3 — Verificar el dominio en Resend

1. En Resend → **Domains** → **Add Domain**.
2. Ingresar el dominio (ej. `relampago.mx`).
3. Resend mostrará registros DNS que debes agregar en tu proveedor del dominio:

| Tipo  | Nombre                          | Valor                              |
|-------|---------------------------------|------------------------------------|
| TXT   | `resend._domainkey.relampago.mx` | (clave DKIM que te da Resend)      |
| TXT   | `relampago.mx`                  | `v=spf1 include:amazonses.com ~all` |
| TXT   | `_dmarc.relampago.mx`           | `v=DMARC1; p=none; rua=mailto:...` |

4. Después de agregar los registros, hacer clic en **Verify** en Resend. La verificación puede tomar 5-60 minutos.

---

## Paso 4 — Crear API Key en Resend

1. En Resend → **API Keys** → **Create API Key**.
2. Permisos: **Sending access**.
3. Guardar la clave (solo se muestra una vez): `re_xxxxxxxxxxxx`

---

## Paso 5 — Configurar Supabase para usar Resend como SMTP

1. Ir a Supabase Dashboard → **Authentication** → **Providers** → **Email**.
2. Activar **Custom SMTP**.
3. Llenar los campos:

| Campo             | Valor                         |
|-------------------|-------------------------------|
| Host              | `smtp.resend.com`             |
| Port              | `465`                         |
| Username          | `resend`                      |
| Password          | `re_xxxxxxxxxxxx` (tu API key)|
| Sender name       | `Jaibamuro`                   |
| Sender email      | `hola@relampago.mx`           |

4. Guardar.

---

## Paso 6 — Configurar Site URL y Redirect URLs en Supabase

1. Supabase Dashboard → **Authentication** → **URL Configuration**.
2. **Site URL**: `https://proyecto-relampago.vercel.app` (o tu dominio personalizado cuando lo tengas).
3. **Redirect URLs** (agregar todas):
   - `https://proyecto-relampago.vercel.app/**`
   - `http://localhost:5173/**` (para desarrollo local)

Sin esto, los magic links no redirigen correctamente.

---

## Paso 7 — Actualizar el template del correo en Supabase

**Importante:** el template incluye `{{ .Token }}`, el código de 6 dígitos que la app
usa como alternativa al link (para cuando el link se abre en el navegador embebido
de la app de correo y no comparte sesión con el navegador real del teléfono — un
problema común en Android/iOS). Si ya tenías este template pegado desde antes de
2026-07-24, hay que actualizarlo para que incluya el código.

1. Supabase Dashboard → **Authentication** → **Email Templates** → **Magic Link**.
2. Reemplazar con el siguiente HTML:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Entra a Jaibamuro</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;background:#facc15;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;line-height:1;">⚡</div>
                <span style="color:#ffffff;font-size:20px;font-weight:900;letter-spacing:-0.5px;">Jaibamuro</span>
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#18181b;border-radius:20px;border:1px solid #27272a;padding:36px 32px;">
              <h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 8px;letter-spacing:-0.5px;">
                Tu link para entrar
              </h1>
              <p style="color:#71717a;font-size:14px;margin:0 0 28px;line-height:1.6;">
                Haz clic en el botón para acceder a tu cuenta y ver tus puntos en el leaderboard.
              </p>

              <!-- CTA Button -->
              <a href="{{ .ConfirmationURL }}"
                 style="display:block;background:#facc15;color:#09090b;text-decoration:none;font-weight:900;font-size:16px;text-align:center;padding:16px 24px;border-radius:14px;letter-spacing:-0.3px;">
                ENTRAR A JAIBAMURO ⚡
              </a>

              <p style="color:#52525b;font-size:12px;text-align:center;margin:24px 0 8px;line-height:1.6;">
                ¿El botón no abre bien desde tu app de correo? Usa este código en la pantalla donde pediste el acceso:
              </p>
              <p style="color:#facc15;font-size:28px;font-weight:900;text-align:center;letter-spacing:0.3em;margin:0 0 20px;font-family:monospace;">
                {{ .Token }}
              </p>

              <p style="color:#52525b;font-size:12px;text-align:center;margin:0;line-height:1.6;">
                El link y el código expiran en 1 hora y solo pueden usarse una vez.<br/>
                Si no pediste este correo, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="color:#3f3f46;font-size:11px;margin:0;">
                Jaibamuro · El Muro
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

3. En **Subject**: `Tu link para entrar a Jaibamuro ⚡`

---

## Paso 8 — Verificar en producción

1. Abrir la app en producción.
2. Escanear un QR y tocar "Entrar".
3. Ingresar un correo real.
4. Verificar que el correo llegue desde `hola@relampago.mx` con el diseño correcto.
5. Hacer clic en el botón → debe regresar a la ruta que estabas viendo.
6. Por separado, probar el código: pedir el link de nuevo, copiar el código de 6 dígitos del correo y pegarlo en el campo "o ingresa el código" sin tocar el botón — debe iniciar sesión igual, sin salir de la pestaña.

---

## Variables de entorno (si se migra a Resend SDK directamente)

Si en el futuro se prefiere llamar a Resend directamente desde un Edge Function en lugar de SMTP:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=hola@relampago.mx
```

Por ahora la integración vía SMTP de Supabase es suficiente y más simple.
