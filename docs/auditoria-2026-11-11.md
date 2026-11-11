# Auditoría de la plataforma (2026-11-11)

**Cómo se hizo:**
- Tomé capturas reales de producción (staff) y de la app en local (cliente).
- Tres revisores independientes las vieron con papeles distintos, leyendo además el código para saber qué pasa en cada clic:
  - **"Dani"**: recepcionista nuevo, primer día solo.
  - **"Lupita"**: 47 años, poco hábil con apps, con un hijo de 14.
  - **QA de Clases**: revisó el módulo que se lanza el lunes 16-nov.
- Nadie cambió nada en producción.

Estado de cada punto: ✅ ya arreglado (en GitHub) · 🟡 decisión de Inge · 🔧 por programar.

## A. Bloqueantes antes del lunes 16 (clases)

| # | Qué pasa | Estado |
|---|---|---|
| A1 | **Las clases de esta semana (mié 11 y jue 12) ya se pueden reservar** en /clases, aunque las clases empiezan el lunes. | 🟡 En /staff/clases → Hoy, ir a mié 11 y jue 12 → **Cancelar clase** (motivo "Las clases empiezan el lunes 16"). **Después no editar los horarios antes del viernes 13**: al guardar un horario se vuelven a crear abiertas. |
| A2 | Al dar "Reservar" sin sesión salía **"Suma tus puntos… leaderboard"** con "Enviar link mágico" y luego obligaba a escoger un alias que **sale en la TV**. | ✅ Ahora dice "Aparta tu lugar · Mandar código", no pide alias, no publica en la TV y abre sola la clase que querías. |
| A3 | **Casi nadie figura como miembro:** precio de miembro ($100) y clase gratis dependen de las membresías de Relámpago. Hoy solo hay 4 (las de EVO, pendientes de Run). | 🟡 Run de las membresías. Para miembros que paguen en efectivo o fuera de EVO, darles su membresía en su ficha. |
| A4 | **Fichas duplicadas:** al iniciar sesión, la cuenta solo se liga a una ficha si el correo coincide. Las 448 fichas de EVO no tienen correo, así que se crea otra persona sin historial ni membresía. | 🔧 Importar contactos de EVO (necesita tu login en EVO) + aviso "posible duplicado" y botón para unir fichas. |
| A5 | **La reserva no exige responsiva firmada**, y "Asistió" tampoco. Solo Acceso la revisa. Alguien puede tomar la clase sin firmar. | 🟡 Regla simple: toda persona de la clase pasa primero por Acceso. Si prefieres, programo que la reserva pida las firmas. |

## B. Importantes (esta semana)

**Clases**
- **Tres formas de cobrar una clase** (Clases → "+ Persona", Clases → "Cobrar" y Vender → "Clases semanales"). La venta en Vender **no aparta lugar** y la reserva queda "por cobrar", así que se puede cobrar dos veces.
  - 🟡 Regla propuesta: *las clases se cobran solo desde Clases → Cobrar*, y Vender solo para cosas sueltas. Puedo esconder "Clases semanales" en Vender.
- **"Pago en el gym" no tiene consecuencia:** la reserva no vence, faltar no cuesta nada (solo pierde la clase gratis) y ocupa lugar. Además una reserva sin pagar da entrada al muro todo ese día. 🟡 Decidir la regla.
- Con la caja cerrada, "Cobrar" en Clases decía "No se pudo completar". ✅ Ahora dice "La caja está cerrada: ábrela en Caja…".
- Solo un admin puede cancelar una sesión. 🟡 ¿El coach o el staff deberían poder?
- En el "por cobrar" de cada sesión cuentan también los que faltaron. 🔧

**Recepción y fichas (efecto de la importación de EVO)**
- Las 448 fichas de EVO salen como **"PROSPECTO"**, en **"Nuevos sin foto"** (Acceso) y en **"Personas nuevas 448 · últimos 7 días"** (Inicio). Tapan a los nuevos de verdad. 🔧 Sacarlas de esas listas y llamarlas "Cliente de EVO".
- **"Pide responsiva firmada ✓" está PRENDIDO.** Con eso, todo cliente de EVO aparece "NO PUEDE PASAR". Además parece una etiqueta pero es un interruptor sin confirmación. 🟡 Apagarlo mientras la gente firma. 🔧 Convertirlo en "Responsiva obligatoria: SÍ · cambiar" con confirmación.
- En Vender: si no eliges persona, el pase no da entrada; si la persona no ha firmado, cobras y luego "No puede pasar". 🔧 Avisar *antes* de cobrar.

**Caja**
- "Cerrar caja" es un solo clic sin confirmar, y la explicación de la diferencia es opcional (en el Turno es obligatoria). 🔧
- El historial muestra "SIN CORTE (SE CERRÓ SOLA)" en rojo los días 29–31 oct con "efectivo esperado" de días sin ventas. Confunde. 🔧

**Registro de clientes y aviso**
- El aviso de privacidad decía "BORRADOR — revisar con un abogado". ✅ Propuesta v2 en `docs/aviso-privacidad-propuesta.md` (faltan tu nombre o razón social y confirmar el correo).
- **Mamá con hijo menor:** con un mismo correo solo se registra una persona. Si la mamá "corrige datos" con los del hijo, **sobrescribe su propia ficha**. 🔧 Agregar "Registrar a un menor a mi cargo" en /registro.
- Registro solo por correo: quien no puede abrir su correo se atora. 🔧 Poner visible "¿No puedes entrar a tu correo? Te registramos en recepción".
- Firma: el botón "Firmar" se queda gris sin decir qué falta. 🔧

**Domiciliación (link al cliente)**
- La garantía "no guardamos tu tarjeta" va hasta abajo; el mes y el año van en campos separados; si el banco rechaza, sale "¡Listo!" en verde y el error en rojo al mismo tiempo. 🔧

## C. Menores
- "Bienvenido" en masculino en /registro.
- "Coach externo" en lugar del nombre del coach.
- "Aún no abre" no dice cuándo abre la reserva.
- La membresía queda hasta abajo en Mi cuenta.
- "Dejar pasar de todos modos" está muy a la mano.
- En la ficha aparece la nota técnica "id EVO 145989".
- Inicio muestra a recepción "Cobros con problema" y "Por surtir".
- Los descuentos son libres para cualquier staff (sin límite).
- El Turno muestra "0 de 45 obligatorias" y el encargado es otra persona.

## D. Lo que está bien (no tocar)
- El resultado de Acceso: grande, claro, con motivo, talla de gatas, última visita y atajo a Cobrar.
- El cobro en Vender: monto automático, "Cambio" grande y "Dar entrada a…" al terminar.
- El tono de /registro: "Paso 1 de 3" y errores en lenguaje normal.
- La reserva una vez dentro: "Pagas al llegar…" y "Cancelas a tiempo: no pierdes nada".
- Lo técnico de clases: zona horaria, regla de 12 h, cupo sin sobreventa y sobrecupo solo para staff.

## E. Prueba manual de clases antes del lunes (15 min)
1. Cancelar las sesiones del mié 11 y jue 12 (A1).
2. Abrir app.jaibamuro.com/clases en una ventana de incógnito: no deben salir el 11 ni el 12; el lun 16 dice "Reservar".
3. Con un correo de prueba sin membresía: reservar el lun 16 "Pagar en el gym" → debe decir $300 y llegar el correo.
4. Con una cuenta con membresía: debe ver $100 y "clase gratis"; reservar gratis; la segunda vez ya no se la ofrece.
5. Cancelar esa reserva (faltan más de 12 h): "no pierdes nada" y regresa la clase gratis.
6. En /staff/clases con la caja **cerrada**, "Cobrar" → debe decir que la caja está cerrada. Abrir caja, cobrar y ver la venta en Caja.
7. "+ Persona" con alguien sin correo en una clase llena: entra como "Sobrecupo"; el siguiente ya no.
8. Pasar lista: "Asistió" / "Faltó".
9. Pasar a la persona de prueba por Acceso sin firmas: debe bloquearla.
10. Borrar las reservas de prueba.
