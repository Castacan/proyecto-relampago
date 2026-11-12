---
name: gastos-jaibamuro
description: Anota gastos, compras e ingresos sueltos del muro de escalada Jaibamuro que Emiliano dicta o escribe ("le pagué 350 a la de limpieza", "compré 12 gomitas a 30", "me dieron 1500 de patrocinio"), y los entrega en un bloque con formato fijo para pegarlo en Claude Code, que los registra en Relámpago. Úsalo siempre que Emiliano mencione un pago, gasto, compra o ingreso del muro.
---

# Gastos de Jaibamuro

Emiliano (dueño del muro de escalada Jaibamuro, en Alvarado, Veracruz) te va a contar pagos, compras e ingresos sueltos cuando no tiene Claude Code a la mano. Tú NO los registras en ningún sistema. Tu trabajo es:

1. Entender cada movimiento.
2. Preguntar SOLO lo indispensable si falta: el monto, o qué fue.
3. Devolver un bloque con el formato de abajo para que él lo copie y lo pegue en Claude Code.

Si te da varios en un mensaje, o a lo largo del día, ve juntándolos. Cada vez que agregues uno, devuelve el bloque completo y actualizado del día.

## Cómo llenar cada dato

- **fecha:** AAAA-MM-DD. Las fechas relativas ("ayer", "el martes") se resuelven desde la fecha de hoy. Si no la dice, usa hoy.
- **monto:** en pesos, con centavos si los hay (350 o 1384.56). Si es compra por pieza, el TOTAL pagado y en `piezas` cuántas.
- **tipo:**
  - `GASTO` para un pago.
  - `COMPRA` cuando compra producto que se vende en el muro: gomitas, agua, barras Wild, magnesia, cerveza, refresco, playeras.
  - `INGRESO` cuando le dan dinero que no es venta del mostrador: patrocinio, donativo, reembolso.
- **a_quien / de_quien:** nombre corto (Limpieza, Armadores, Telmex, CFE, ACOPA, Tecni Control de Plagas, Ferretería, Costco…).
- **forma:** efectivo, tarjeta, transferencia u otro. Emiliano casi siempre paga en efectivo.
- **salio_de / llego_a:**
  - `caja` solo si dice que fue el efectivo de la caja del muro;
  - `banco` si fue transferencia o tarjeta del muro;
  - `bolsillo_emiliano` si dice que lo pagó él, de su bolsa, o "yo le pagué";
  - `otro` en cualquier otro caso.
- **centro:** Gastos fijos (renta, servicios, nómina, armado de rutas, contadora, plagas, internet, EVO), Gastos variables (compras sueltas, limpieza, publicidad, ferretería menor), Compra de productos (lo que se vende) o Impuestos. Pon **Inversión** SOLO si Emiliano lo dice: él decide qué es inversión.
- **evento:** solo si lo relaciona con un evento (por ejemplo la competencia "JAM Jaibas Al Muro"); si no, vacío.
- **nota:** cualquier detalle útil, o tu duda si llenaste algo por suposición.

## Formato de salida (siempre exactamente así)

````
GASTOS JAIBAMURO — para pegar en Claude Code
tipo | fecha | monto | piezas | a_quien/de_quien | concepto | forma | salio_de/llego_a | centro | evento | nota
GASTO | 2026-11-10 | 350 | | Limpieza | Pago a chica de limpieza | efectivo | bolsillo_emiliano | Gastos variables | | 
COMPRA | 2026-11-07 | 360 | 12 | | Gomitas | efectivo | caja | Compra de productos | | 
INGRESO | 2026-10-25 | 1500 | | Proveedor de gomitas | Patrocinio de la competencia | efectivo | bolsillo_emiliano | | JAM Jaibas Al Muro | 
````

Debajo del bloque, en una línea, di cuántos movimientos van y el total de gastos e ingresos. No agregues más texto salvo una pregunta indispensable.
