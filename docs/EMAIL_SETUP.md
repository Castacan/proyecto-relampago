# Setup de email transaccional — Jaibamuro

Guía para conectar un dominio propio con Resend y Supabase para que los magic links salgan desde `hola@[tu-dominio]`.

---

## Paso 1 — Comprar el dominio ✅

Dominio: `jaibamuro.com` (comprado en Namecheap).

---

## Paso 2 — Crear cuenta en Resend ✅

1. Ir a [resend.com](https://resend.com) y crear cuenta gratuita.
2. Plan gratuito: 3,000 emails/mes, 100/día. Suficiente para producción inicial.

---

## Paso 3 — Verificar el dominio en Resend ✅

1. En Resend → **Domains** → **Add Domain**.
2. Ingresar el dominio `jaibamuro.com`.
3. Resend mostró los registros DNS (DKIM, SPF, DMARC, MX) que se agregaron en Namecheap:

| Tipo  | Nombre                          | Valor                              |
|-------|---------------------------------|------------------------------------|
| TXT   | `resend._domainkey.jaibamuro.com` | (clave DKIM de Resend)           |
| TXT   | `jaibamuro.com`                 | `v=spf1 include:amazonses.com ~all` |
| TXT   | `_dmarc.jaibamuro.com`          | `v=DMARC1; p=none; rua=mailto:...` |
| MX    | `send.jaibamuro.com`            | `feedback-smtp.us-east-1.amazonses.com` |

El registro MX requirió cambiar el modo "Mail Settings" de Namecheap a **Custom MX** (no aparece en la tabla normal de Host Records). Confirmado sin forwarding de correo activo antes de hacer el cambio.

4. DNS verificado como propagado externamente (8.8.8.8, 1.1.1.1); el estado "Verified" en el dashboard de Resend puede tardar unas horas más en confirmarse.

---

## Paso 4 — Crear API Key en Resend ✅

1. En Resend → **API Keys** → **Create API Key**.
2. Nombre: `jaibamuro-app-smtp`. Permisos: **Sending access**, restringido al dominio `jaibamuro.com` (no Full access).
3. Clave copiada directo al SMTP de Supabase (no se guardó en texto plano en ningún archivo).

---

## Paso 5 — Configurar Supabase para usar Resend como SMTP ✅

1. Supabase Dashboard → **Authentication** → **Emails** → pestaña **SMTP Settings** (no está bajo Providers).
2. Activar **Enable custom SMTP**.
3. Campos configurados:

| Campo             | Valor                         |
|-------------------|-------------------------------|
| Host              | `smtp.resend.com`             |
| Port              | `465`                         |
| Username          | `resend`                      |
| Password          | la API key `jaibamuro-app-smtp` |
| Sender name       | `Jaibamuro`                   |
| Sender email      | `hola@jaibamuro.com`          |

4. Guardado y verificado tras recargar la página (los valores persisten, salvo el password que Supabase nunca vuelve a mostrar).

---

## Paso 6 — Configurar Site URL y Redirect URLs en Supabase ✅

1. Supabase Dashboard → **Authentication** → **URL Configuration**.
2. **Site URL**: `https://app.jaibamuro.com`.
3. **Redirect URLs** (las 3 activas):
   - `https://app.jaibamuro.com/**`
   - `https://proyecto-relampago.vercel.app/**` (se dejó como fallback, no estorba)
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
<body style="margin:0;padding:0;background:#013a4b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#013a4b;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <img src="https://jaibamuro.com/logo-email.png" width="160" height="41" alt="Jaibamuro" style="display:block;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#015169;border-radius:20px;border:1px solid #026987;padding:36px 32px;">
              <h1 style="color:#f4f4f3;font-size:22px;font-weight:900;margin:0 0 8px;letter-spacing:-0.5px;">
                Tu link para entrar
              </h1>
              <p style="color:#a9c2c9;font-size:14px;margin:0 0 28px;line-height:1.6;">
                Haz clic en el botón para acceder a tu cuenta y ver tus puntos en el leaderboard.
              </p>

              <!-- CTA Button -->
              <a href="{{ .ConfirmationURL }}"
                 style="display:block;background:#ff4d15;color:#f4f4f3;text-decoration:none;font-weight:900;font-size:16px;text-align:center;padding:16px 24px;border-radius:14px;letter-spacing:-0.3px;">
                ENTRAR A JAIBAMURO
              </a>

              <p style="color:#71717a;font-size:12px;text-align:center;margin:24px 0 8px;line-height:1.6;">
                ¿El botón no abre bien desde tu app de correo? Usa este código en la pantalla donde pediste el acceso:
              </p>
              <p style="color:#ff4d15;font-size:28px;font-weight:900;text-align:center;letter-spacing:0.3em;margin:0 0 20px;font-family:monospace;">
                {{ .Token }}
              </p>

              <p style="color:#71717a;font-size:12px;text-align:center;margin:0;line-height:1.6;">
                El link y el código expiran en 1 hora y solo pueden usarse una vez.<br/>
                Si no pediste este correo, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="color:#52717a;font-size:11px;margin:0;">
                Jaibamuro · Escalada hecha en Veracruz
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

3. En **Subject**: `Tu link para entrar a Jaibamuro`

---

## Paso 8 — Verificar en producción

1. Abrir la app en producción.
2. Escanear un QR y tocar "Entrar".
3. Ingresar un correo real.
4. Verificar que el correo llegue desde `hola@jaibamuro.com` con el diseño correcto.
5. Hacer clic en el botón → debe regresar a la ruta que estabas viendo.
6. Por separado, probar el código: pedir el link de nuevo, copiar el código de 6 dígitos del correo y pegarlo en el campo "o ingresa el código" sin tocar el botón — debe iniciar sesión igual, sin salir de la pestaña.

---

## Variables de entorno (si se migra a Resend SDK directamente)

Si en el futuro se prefiere llamar a Resend directamente desde un Edge Function en lugar de SMTP:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=hola@jaibamuro.com
```

Por ahora la integración vía SMTP de Supabase es suficiente y más simple.
