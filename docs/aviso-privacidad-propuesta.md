# Aviso de privacidad: propuesta v2 (para revisión de Inge y, de preferencia, de un abogado)

Preparado el 2026-11-11 para reemplazar el BORRADOR v1, que dice "BORRADOR — revisar con un abogado" en su primera línea y los clientes lo verían al firmar.

**Antes de publicarlo, Inge llena o confirma lo que está entre [corchetes]:**
- Responsable: **Regina Valle Gutiérrez** (persona física), confirmado por Inge el 2026-11-11.
- Correo para datos personales: propongo hola@jaibamuro.com. Confirmar que alguien lo lee.
- El domicilio ya es el de Google: Paraíso del Estero 5A, Alvarado, Ver., C.P. 95264. Confirmar que sirve como domicilio para recibir solicitudes.

**Cómo se publica:** Configuración → Responsiva y reglamento → Aviso de privacidad → pegar el texto → guardar como versión nueva.
- Al guardar, quien firmó la v1 tendrá que firmar la v2. Hoy solo la firmó Inge, como prueba.
- Si prefieres, te lo dejo como SQL listo para Run.

Nota: el texto sigue lo que pide la ley mexicana de datos personales: identidad y domicilio del responsable, datos que se recaban (marcando los sensibles), finalidades, transferencias, derechos ARCO, revocación y cambios. No sustituye la revisión de un abogado, sobre todo por ser datos biométricos.

---

## Texto para la app (lo que ve y firma el cliente)

**AVISO DE PRIVACIDAD — JAIBAMURO**

**¿Quién cuida tus datos?**
Regina Valle Gutiérrez, que opera el gimnasio de escalada Jaibamuro, con domicilio en Paraíso del Estero 5A, Alvarado, Veracruz, C.P. 95264, es responsable de tus datos personales. Para cualquier tema de privacidad escríbenos a hola@jaibamuro.com o pregunta en recepción.

**¿Qué datos usamos?**
- Tus datos de contacto: nombre, celular, correo y fecha de nacimiento.
- El contacto de emergencia y, si eres menor de edad, los datos de tu mamá, papá o tutor.
- Tu historial en el gimnasio: visitas, membresías, clases, compras y pagos. Los datos de tu tarjeta los guarda el procesador de pagos (Openpay o Clip), no nosotros.
- Tu firma de la responsiva y del reglamento.
- **Solo si lo autorizas:** una foto de tu cara y una representación numérica de tus rasgos faciales para reconocerte al llegar. Es un **dato biométrico**, que la ley considera **dato personal sensible**.

**¿Para qué los usamos?**
Para darte el servicio (finalidades necesarias):
1. Registrarte, darte acceso y llevar tu membresía y tus clases.
2. Cobrarte y darte tus comprobantes.
3. Contactar a tu persona de emergencia si te pasa algo.
4. Cumplir la responsiva, el reglamento y nuestras obligaciones legales.

Con tu permiso (finalidades opcionales):
5. Reconocerte con la cámara de recepción para que no tengas que dar tu nombre ni mostrar nada.
6. Mandarte avisos de promociones, eventos y competencias.

Si no quieres las opcionales 5 o 6, dínoslo en recepción o por correo. **Sin cámara te buscamos por nombre y tienes el mismo servicio.**

**Tu cara (dato biométrico)**
- La guardamos solo para reconocerte en recepción. No la usamos para nada más, no la vendemos y no la compartimos.
- Solo la ve el personal de Jaibamuro.
- La borramos cuando nos lo pidas, o a los 2 años de tu última visita.

**¿Con quién compartimos tus datos?**
Con nadie, salvo:
- los procesadores de pago (Openpay o Clip), para cobrarte;
- los servicios que alojan nuestro sistema y mandan nuestros correos, que solo los guardan por cuenta nuestra;
- una autoridad, si la ley nos lo exige.

**Tus derechos**
Puedes pedir **ver** tus datos, **corregirlos**, **borrarlos** u **oponerte** a algún uso (derechos ARCO), y también **retirar tu permiso**, sobre todo el de tu cara.
- Escríbenos a hola@jaibamuro.com o pídelo en recepción, con tu nombre y lo que necesitas.
- Te respondemos en un máximo de 20 días hábiles.

**Menores de edad**
Si eres menor de 18 años, tu mamá, papá o tutor firma este aviso contigo y autoriza el uso de tus datos.

**Cambios**
Si cambiamos este aviso te lo diremos en la app y en recepción. Si el cambio toca tu cara o algo que necesite tu permiso, te pediremos firmar de nuevo.

**Consentimiento**
Al firmar, acepto este aviso de privacidad y otorgo mi consentimiento expreso y por escrito para el uso de mis datos personales para las finalidades descritas, incluidos mis datos sensibles (biométricos) si autorizo el reconocimiento con cámara. Si soy menor de edad, firma mi mamá, papá o tutor.

Última actualización: 11 de noviembre de 2026.

---

## Diferencias con el BORRADOR v1
- Ya no dice "BORRADOR" ni "revisar con un abogado".
- Tiene nombre del responsable, domicilio y correo reales. La v1 decía "el correo del gimnasio".
- Separa las finalidades necesarias de las opcionales: la cámara y las promociones. Así se puede decir que no sin perder el servicio, que es lo que pide la ley.
- Dice con quién se comparten los datos (procesadores de pago) y en cuánto tiempo se responde (20 días hábiles).
- Usa un lenguaje más corto y directo, con encabezados en forma de pregunta, porque así lo pidió la revisión "Lupita".

## Pendiente técnico relacionado (no está en este texto)
Hoy firmar el aviso **equivale** a autorizar la cámara: `erp_face_consent` solo revisa que exista la firma. Para que la cámara sea de verdad opcional, convendría agregar una casilla "Sí autorizo el reconocimiento con cámara" al firmar y que `staff_save_face` la exija. Lo programo si Inge lo aprueba.
