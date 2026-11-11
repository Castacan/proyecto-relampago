# Laptop de recepción: cómo dejarla lista (cámara siempre abierta)

Objetivo: al prender la laptop, se abre sola la pantalla de **Acceso** con la webcam activa, sin barras del navegador ni pestañas sueltas, y no se apaga ni se duerme durante el horario.

Tiempo: unos 20 minutos, una sola vez. Está pensado para Windows con Google Chrome.

## 1. Cuenta del staff para recepción
- Cada persona del staff entra con **su propio usuario**: Empleados → dar de alta. Así la bitácora sabe quién vendió qué.
- La laptop **no guarda la contraseña de admin de Inge**. Si Inge entra ahí para algo, al terminar le da *Salir* y deja entrar al del turno.

## 2. Un perfil de Chrome solo para recepción
1. En Chrome: ícono de persona (arriba a la derecha) → **Agregar** → "Continuar sin cuenta" → nombre **Recepción**.
2. En ese perfil entra a **app.jaibamuro.com/staff/acceso** e inicia sesión con el usuario del turno.
3. Cuando pida la cámara, elige **Permitir**. Para que no vuelva a preguntar: candado junto a la dirección → Cámara → **Permitir**.
4. Si hay más de una cámara (la de la laptop y la webcam externa): candado → Configuración del sitio → Cámara → elige la **webcam de recepción**.

## 3. Que se abra sola, como app, al prender
1. Clic derecho en el escritorio → Nuevo → **Acceso directo**.
2. En la ubicación pega (una sola línea):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 1" --app=https://app.jaibamuro.com/staff/acceso
   ```
   - `--app` abre la página como ventana de app, sin pestañas ni barra de direcciones; el menú lateral del sistema sigue ahí para ir a Vender, Caja, etc.
   - Si "Profile 1" no abre el perfil Recepción, revisa en Chrome `chrome://version` → "Ruta del perfil": la última carpeta es el nombre que va ahí.
3. Nómbralo **Jaibamuro Recepción**.
4. Presiona `Win + R`, escribe `shell:startup` y Enter. Copia el acceso directo a esa carpeta. Desde ahí se abre solo al iniciar Windows.
5. Ya abierta, presiona **F11** para pantalla completa si quieres más espacio.

> No uso `--kiosk` (pantalla completa bloqueada) porque el staff necesita cambiar a Vender, Caja y Clases. Si algún día la laptop solo fuera para la cámara, se cambia `--app=` por `--kiosk`.

## 4. Que no se duerma
- Configuración → Sistema → **Inicio/apagado y suspensión** → Pantalla y Suspensión, **conectado a corriente: Nunca**.
- Déjala **conectada al cargador** todo el horario.
- Windows Update → Opciones avanzadas → **Horas activas**: 15:00 a 23:00 entre semana, para que no se reinicie a media tarde.

## 5. La cámara
- **Altura:** a la de la cara de un adulto parado frente al mostrador, unos 1.50–1.60 m. Si queda baja, ve barbillas.
- **Luz:** que la luz le dé **de frente** al cliente. No pongas la cámara viendo hacia la puerta o la ventana, porque el contraluz deja la cara negra.
- **Distancia:** que el cliente quede a unos 50–100 cm. Más lejos no lo reconoce.
- **Una cara a la vez:** si hay fila, que el siguiente espere un paso atrás.
- **Gorras, lentes oscuros y cubrebocas** bajan mucho el reconocimiento. En ese caso el staff lo busca por nombre en la misma pantalla.

## 6. Prueba antes de abrir
1. Prende la laptop: se debe abrir sola Acceso con la imagen de la cámara.
2. En la pantalla debe decir "N caras registradas".
3. Párate frente a la cámara (con tu cara ya registrada): debe salir tu perfil en 1–2 segundos.
4. Si dice "No se pudo abrir la cámara…": revisa el permiso (paso 2.3), que otra app (Zoom, Teams, la app Cámara) no la esté usando, o desconecta y conecta la webcam.

## 7. Privacidad
- La cámara **no graba** ni guarda video. Solo compara la cara contra las que ya están registradas, y solo hay cara registrada de quien firmó el aviso de privacidad.
- Pon un letrero chico en el mostrador: "Esta cámara reconoce a clientes registrados para agilizar tu entrada. No graba. Si no quieres usarla, dínoslo."
