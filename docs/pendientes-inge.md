# Pendientes de Inge en la compu

Actualizado: 2026-11-11. Tacha cada punto conforme lo hagas.

## Hoy, en cuanto llegues (5 minutos) — Runs 1 y 2 HECHOS el 2026-11-11

En el Chrome de la compu ya hay 3 pestañas abiertas:

1. [x] **Supabase, pestaña 1:** "talla de gatas + terminal Clip". Dale **Run**. Debe decir *Success*.
2. [x] **Supabase, pestaña 2:** "membresías de EVO" (también trae la lista de domiciliados de EVO). Dale **Run**. Abajo deben salir tres renglones:
   - `sin persona`: **0**
   - `membresias de EVO en Relampago`: **38**
   - `vigentes hoy`: **4**
3. [ ] **EVO:** inicia sesión y avísame. Yo exporto clientes con correo y celular, y gastos.

Si un Run marca error, mándame foto y no corras lo demás.

## Clases (empiezan el lunes 16): antes del viernes

- [ ] **Cancelar las sesiones del mié 11 y jue 12**, que hoy se pueden reservar: /staff/clases → Hoy → ir a ese día → "Cancelar clase". No edites los horarios después, o se vuelven a abrir.
- [ ] **Apagar "Pide responsiva firmada"** en Acceso mientras los clientes viejos firman. Hoy está prendido.
- [ ] **Decidir 3 reglas** (ver `docs/auditoria-2026-11-11.md`, sección B):
  1. Las clases se cobran solo desde Clases → Cobrar, no desde Vender.
  2. Qué pasa si alguien reserva "pago en el gym" y no llega.
  3. Si el coach puede cancelar una clase o solo tú.
- [ ] Hacer la **prueba de 10 pasos** de la sección E de la auditoría.

## Aviso de privacidad

- [x] Responsable: Regina Valle Gutiérrez.
- [x] Correo: hola@jaibamuro.com hoy NO recibe (el dominio no tiene MX). Elegiste la opción 2: reenvío a Gmail + responder como hola@ (ver abajo).
- [ ] Cuando hola@ ya reciba, te pego el SQL del aviso v2 para Run.

## Correo hola@jaibamuro.com (opción 2), en la PC, unos 20 min

1. [ ] **Namecheap** (tú inicias sesión; yo hago el cambio si quieres): Domain List → jaibamuro.com → Manage → Advanced DNS → Mail Settings: **Email Forwarding** → Redirect Email → alias `hola` → `jaibamuro@gmail.com`. No toques los registros de `send` ni `resend._domainkey`: son los de los correos de la app.
2. [ ] Yo mando un correo de prueba a hola@ y confirmas que llega a jaibamuro@gmail.com.
3. [ ] **Resend** (resend.com, tú inicias sesión): API Keys → Create → nombre `gmail-hola`, permiso **Sending access**, dominio jaibamuro.com. Copia la llave (empieza con `re_`; se ve una sola vez) y **no me la mandes**.
4. [ ] **Gmail** de jaibamuro@gmail.com → Configuración → Ver toda la configuración → **Cuentas e importación** → "Enviar como" → **Agregar otra dirección**:
   - Nombre: `Jaibamuro`. Correo: `hola@jaibamuro.com`. Desmarca "Tratar como alias".
   - Servidor SMTP: `smtp.resend.com` · Puerto `465` · Usuario: `resend` · Contraseña: la llave del paso 3 · **SSL**.
   - Gmail manda un código a hola@, que gracias al paso 1 llega a tu Gmail. Escríbelo y listo.
5. [ ] (Opcional) En "Enviar como", marca "Responder desde la misma dirección a la que se envió el mensaje" para contestar siempre como hola@.

## Laptop de recepción

- [ ] Seguir `docs/recepcion-laptop.md`: perfil de Chrome, que abra sola en Acceso, que no se duerma y dónde poner la cámara.

## Domiciliados de EVO

- [ ] Después del Run 2, en **Domiciliaciones** aparece la tarjeta **"Pasar de EVO"** con los 4, cuándo les cobraría EVO y un botón **Domiciliar**. Mándales el link antes de esa fecha. Cuando registren su tarjeta, **cancela su cobro en EVO**.

## Terminal Clip

4. [ ] **Confirmar el modelo.** La API solo sirve con **Clip Stand 2** (además de Ultra, PinPad y Total 3). Atrás o en la caja debe decir "Stand 2". Si es la Stand de primera generación, pregúntale a Clip si es compatible antes de seguir.
5. [ ] **Pedir la app PinPad:** manda un correo a **sdk@payclip.com** con el número de serie de la terminal, pidiendo que instalen la app PinPad para usar la API de Punto de Venta. Te pueden pedir la verificación de identidad del comercio.
6. [ ] Cuando Clip la instale, avísame y te dejo listo el **Deploy** de la función `clip-terminal` (Verify JWT apagado).
7. [ ] En la app: **Configuración → Integraciones → Terminal Clip**:
   - Pon el número de serie.
   - Prende el interruptor.
   - Dale **Probar conexión con Clip**.
8. [ ] **Primera prueba:** en Vender, una agua con "Terminal Clip (automático)" y paga con tu tarjeta. Luego la cancelas en el portal de Clip.

## Recepción con cámara

9. [ ] Abrir **Acceso** en la laptop de recepción con la webcam y probar que te reconozca:
   - Primero registra tu cara con "Registrar su cara".
   - La cámara debe estar a la altura de la cara y sin contraluz de la puerta.
10. [ ] **Leer el aviso de privacidad** (BORRADOR), que es obligatorio para guardar caras: Configuración → Documentos. Dime qué cambiarle.
11. [ ] **Revisar "Pide responsiva firmada"** en Acceso: déjalo **apagado** mientras los clientes viejos no hayan firmado. Si está prendido, se les niega la entrada.

## Migración EVO (lo que falta)

- [x] Ventas históricas (1,182 ventas, $201,046).
- [x] Membresías: Run hecho el 2026-11-11 (punto 2). Son 4 vigentes, todas de domiciliación.
  - Uno de los 4 (venta EVO 1525768, 7-nov) tiene "Saldo deudor" en EVO: debe esa mensualidad.
- [ ] Contactos (correo y celular): necesita el punto 3.
- [ ] Gastos desde oct-2025: necesita el punto 3.
- [ ] Los 4 domiciliados: cuando les toque su siguiente cobro en EVO, pasarlos a la domiciliación de Relámpago con su link (registran su tarjeta otra vez). Después se cancela su cobro en EVO.
- [ ] Dar de baja EVO: al final, después de 1–2 semanas usando los dos.

## Viejos que siguen abiertos

- Borrar la persona "Test" de la prueba de Openpay. Si no, el día 23 se le intenta cobrar en sandbox.
- Registrar el WiFi del muro para la asistencia del staff y completar el horario de Erick.
- Contar cerveza y refresco, que estaban en negativo.
