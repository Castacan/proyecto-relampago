-- ============================================================
-- Aviso de privacidad v2 (2026-11-11). Reemplaza el BORRADOR v1.
-- Responsable: Regina Valle Gutiérrez (persona física), confirmado por Inge.
-- Texto fuente y notas: docs/aviso-privacidad-propuesta.md
--
-- Los documentos son inmutables: se apaga la v1 (is_current = false, permitido
-- por legal_immutable) y se inserta la v2. Quien firmó la v1 tendrá que firmar
-- la v2 (hoy solo Inge, de prueba). La cámara sigue pidiendo "haber firmado el
-- aviso" (erp_face_consent cuenta cualquier versión).
-- Idempotente: si la v2 ya existe no hace nada.
-- ============================================================
DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM public.legal_documents WHERE doc_key = 'privacidad' AND body LIKE '%Regina Valle Gutiérrez%') THEN
    RAISE NOTICE 'La v2 del aviso ya existe';
    RETURN;
  END IF;
  UPDATE public.legal_documents SET is_current = false WHERE doc_key = 'privacidad' AND is_current;
  INSERT INTO public.legal_documents (doc_key, version, kind, title, body, required, sort_order)
  VALUES ('privacidad',
          coalesce((SELECT max(version) FROM public.legal_documents WHERE doc_key = 'privacidad'), 0) + 1,
          'other', 'Aviso de privacidad', $txt$AVISO DE PRIVACIDAD — JAIBAMURO

¿QUIÉN CUIDA TUS DATOS?
Regina Valle Gutiérrez, que opera el gimnasio de escalada Jaibamuro, con domicilio en Paraíso del Estero 5A, Alvarado, Veracruz, C.P. 95264, es responsable de tus datos personales. Para cualquier tema de privacidad escríbenos a hola@jaibamuro.com o pregunta en recepción.

¿QUÉ DATOS USAMOS?
• Tus datos de contacto: nombre, celular, correo y fecha de nacimiento.
• Tu contacto de emergencia y, si eres menor de edad, los datos de tu mamá, papá o tutor.
• Tu historial en el gimnasio: visitas, membresías, clases, compras y pagos. Los datos de tu tarjeta los guarda el procesador de pagos (Openpay o Clip), no nosotros.
• Tu firma de la responsiva y del reglamento.
• Solo si lo autorizas: una foto de tu cara y una representación numérica de tus rasgos faciales para reconocerte al llegar. Es un dato biométrico, que la ley considera dato personal sensible.

¿PARA QUÉ LOS USAMOS?
Para darte el servicio (finalidades necesarias):
1. Registrarte, darte acceso y llevar tu membresía y tus clases.
2. Cobrarte y darte tus comprobantes.
3. Contactar a tu persona de emergencia si te pasa algo.
4. Cumplir la responsiva, el reglamento y nuestras obligaciones legales.
Con tu permiso (finalidades opcionales):
5. Reconocerte con la cámara de recepción para que no tengas que dar tu nombre ni mostrar nada.
6. Mandarte avisos de promociones, eventos y competencias.
Si no quieres las opcionales 5 o 6, dínoslo en recepción o por correo. Sin cámara te buscamos por nombre y tienes el mismo servicio.

TU CARA (DATO BIOMÉTRICO)
La guardamos solo para reconocerte en recepción. No la usamos para nada más, no la vendemos y no la compartimos. Solo la ve el personal de Jaibamuro. La borramos cuando nos lo pidas o a los 2 años de tu última visita.

¿CON QUIÉN COMPARTIMOS TUS DATOS?
Con nadie, salvo con los procesadores de pago (Openpay o Clip) para cobrarte, con los servicios que alojan nuestro sistema y mandan nuestros correos (que solo los guardan por cuenta nuestra) y con una autoridad si la ley nos lo exige.

TUS DERECHOS
Puedes pedir ver tus datos, corregirlos, borrarlos u oponerte a algún uso (derechos ARCO), y también retirar tu permiso, sobre todo el de tu cara. Escríbenos a hola@jaibamuro.com o pídelo en recepción con tu nombre y lo que necesitas. Te respondemos en un máximo de 20 días hábiles.

MENORES DE EDAD
Si eres menor de 18 años, tu mamá, papá o tutor firma este aviso contigo y autoriza el uso de tus datos.

CAMBIOS
Si cambiamos este aviso te lo diremos en la app y en recepción. Si el cambio toca tu cara o algo que necesite tu permiso, te pediremos firmar de nuevo.

CONSENTIMIENTO
Al firmar, acepto este aviso de privacidad y otorgo mi consentimiento expreso y por escrito para el uso de mis datos personales para las finalidades descritas, incluidos mis datos sensibles (biométricos) si autorizo el reconocimiento con cámara. Si soy menor de edad, firma mi mamá, papá o tutor.

Última actualización: 11 de noviembre de 2026.$txt$,
          true, 3);
END;
$priv$;

SELECT doc_key, version, title, is_current FROM public.legal_documents WHERE doc_key = 'privacidad' ORDER BY version;
