# Clases: cómo lo hace EVO y qué copiamos (2026-11-12)

Fuentes:
- El EVO de Jaibamuro (Administración → Actividades - Horarios / Agenda, en solo lectura, sin guardar nada).
- EVA, la IA de EVO, con 2 preguntas.
- Su manual (evohelp.w12app.com.br):
  - Configuración de actividades en horarios;
  - Configuraciones generales;
  - Check-in de actividades;
  - Bonificación y penalización;
  - Actividad en el plan;
  - Reposiciones.

## Cómo lo organiza EVO

**1. Actividad** (la clase: "Escalada", "Calistenia").
- Grupo, color, imagen, nivel, capacidad, duración, descripción y dificultad.
- ¿Quién puede entrar?
  - "Todos" (clase libre o suelta);
  - o "Solo quien compró un plan o servicio de ese grupo".
- ¿El cliente puede reservar?
  - **Inicia reserva cuánto antes**: cuándo se abre.
  - **Finaliza reserva cuánto antes**: cuándo se cierra.
  - **Tolerancia**: reservar ya empezada la clase.
  - **Cancela sin pagar cuánto antes**.
- **Lista de espera**: prendida por defecto. Si alguien cancela, avisa a los que esperan.
- **Check-in** (pase de lista):
  - abre X minutos antes y cierra al empezar, con tolerancia de unos minutos;
  - si no hace check-in, **se libera su lugar** y se le avisa ("Tu lugar ha sido liberado");
  - el check-in puede ser automático al pasar por el control de acceso.
- **Penalizar falta**: si reservó y no vino, se le castiga (ver 3).
- Otros:
  - finalizar la clase sola;
  - mostrar en la app;
  - pedir calificación de 1 a 5 estrellas al terminar;
  - elegir número de lugar.

**2. Horarios.** Cada actividad se pone en la parrilla con día, hora, capacidad e instructor. Una clase completa se cancela desde la agenda, con permiso.

**3. Configuración general:**
- Cuántos días adelante ve el cliente la parrilla.
- **Penalización por falta:** el castigo **no es dinero**. Durante X días el cliente **solo ve los próximos 2 días** de clases. Se le quita al cumplir N asistencias seguidas.
- **Bonificación:** cada N asistencias seguidas le regala clases extra, con vigencia.
- **Clase de prueba:** límite de clases de prueba por persona y por actividad. Se renueva cada X meses.
- Marcar "primera vez" del cliente en la lista, para que el coach lo atienda.
- Marcar "cliente moroso" en la lista (solo informativo).
- No dejar reservar a clientes bloqueados.

**4. Plan** (cómo se cobra):
- Por **cantidad total de sesiones**: paquete de 8, que vence con el plan.
- Por **límite semanal**: 2 por semana.
- Por **límite mensual**.
- **Ilimitado**.
- "Clases fijas" (inscripción a un horario fijo).
- **Reposiciones:** si avisa con tiempo, la falta queda justificada y puede recuperar la clase otro día, con límite y caducidad.

**5. Permisos** (Administración → Permisos): por perfil (Coach, Recepción, Admin) decides quién marca asistencia, quién cancela una clase completa, etc.

**Recomendación de EVA para un lugar chico (6–8 personas):**

| Regla | Valor |
|---|---|
| Abre reserva | 7 días antes |
| Cierra reserva | 1–2 h antes |
| Cancelación sin penalización | 2–4 h antes |
| Lista de espera | prendida |
| Penalizar faltas | sí; opcional bloquear reservas unos días |
| Check-in | abre 15–30 min antes, cierra al empezar, tolerancia 5–10 min |
| Permisos | perfiles separados de coach, recepción y admin |

## Cómo está hoy Relámpago

- Se reserva 7 días antes. Se cancela sin perder hasta **12 h** antes. Sobrecupo de 1 solo para staff.
- 1 clase gratis al mes para miembros. Precio de miembro $100 y normal $300. Se puede "pagar en el gym".
- Pase de lista a mano (Asistió / Faltó).
- **No existen todavía:**
  - lista de espera;
  - liberar el lugar si no llega;
  - castigo por faltar;
  - cierre de reservas X horas antes;
  - límite de clase de prueba;
  - paquetes de N clases;
  - permisos por perfil;
  - el check-in no se liga con Acceso.

## Propuesta (copiar lo bueno de EVO, en orden)

**A. Antes del lunes 16 (solo ajustes):**
1. Cancelación sin perder: de 12 h → **4 h**, como recomienda EVA.
2. Cierre de reservas: **1 h** antes de la clase.
3. Las clases se cobran **desde Clases**, y Vender queda para cobrar en mostrador. Esto evita cobrar doble.
4. Cancelar una clase completa: **solo el admin** por ahora, como EVO con permisos.

**B. Primera semana:**

5. **Check-in con Acceso.** Si alguien con reserva pasa por Acceso (cámara), queda "Asistió". Si a los **10 min** de empezar no ha llegado, su lugar se libera y queda "Faltó".
6. **Lista de espera.** Si la clase está llena te anotas. Si alguien cancela, el primero de la lista entra solo y le llega correo.
7. **Castigo por faltar, al estilo EVO.** Quien falta sin avisar 2 veces en el mes ya no puede reservar con "pago en el gym": tiene que pagar antes. No se cobra multa.

**C. Después:**
- Paquetes de clases (8 al mes, etc.).
- Clase de prueba limitada a 1 por persona.
- Bonificación por asistencia.
- Calificación de la clase.
- Marca de "primera vez" en la lista.
- Permisos de coach.
