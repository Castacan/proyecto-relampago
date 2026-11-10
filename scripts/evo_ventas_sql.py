"""Genera el SQL que importa a Relámpago las ventas exportadas de EVO.

Uso:  python -I scripts/evo_ventas_sql.py <Vendas.xlsx de EVO> <salida.sql>

La salida trae nombres de clientes: generarla FUERA del repo y no subirla a git.

El Excel es Gestión/Reportes → Ventas → Ventas detalladas → Exportar, con
Tipo = Plan, Plan adicional fijo, Producto y Servicio (adicional opcional y
secundario hacen que salga vacío). El SQL que sale es idempotente: cada venta
lleva su número de EVO (sales.evo_sale_id) y cada persona el suyo
(people.evo_id), así que se puede volver a correr con un Excel más nuevo y solo
agrega lo que falte.
"""
import sys
import openpyxl

# Nombre en EVO (en minúsculas) → nombre del producto en Relámpago.
# Los que no estén aquí se importan con su descripción de EVO y sin producto.
PRODUCTOS = {
    'pase diario': 'Pase Diario',
    'renta de gatas': 'Renta de gatas',
    'renta de magnesiera': 'Renta de magnesiera',
    'clase introductoria': 'Clase Introductoria',
    'membresia domiciliacion': 'Membresía Domiciliación',
    'membresia mensual': 'Membresía Mensual',
    'membresia trimestral': 'Membresía Trimestral',
    'agua kirkland 500ml': 'Agua Kirkland 500 ml',
    'cerveza': 'Cerveza',
    'refresco': 'Refresco',
    'gomitas': 'Gomitas',
    'barra proteina wild caramelo 45g': 'Barra Wild Caramelo 45 g',
    'barra proteina wild chocolate 45g': 'Barra Wild Chocolate 45 g',
    'barra proteina wild chocolate amargo 45g': 'Barra Wild Chocolate amargo 45 g',
    'barra proteina wild chocolate/cacahuate 45g': 'Barra Wild Chocolate/cacahuate 45 g',
    'barra proteina wild chocolate/coco 45g': 'Barra Wild Chocolate/coco 45 g',
    'barra proteina wild chocolate/moka 45g': 'Barra Wild Chocolate/moka 45 g',
    'barra proteina wild chocolate/naranja 45g': 'Barra Wild Chocolate/naranja 45 g',
    'barra proteina wild limon 45g': 'Barra Wild Limón 45 g',
    'magnesia staiker moonstones': 'Magnesia Staiker Moonstones',
    'magnesia staiker polvo 130g': 'Magnesia Staiker polvo 130 g',
    'magnesia yohua': 'Magnesia Yohua',
}

# Forma de pago de EVO → método de Relámpago. None = sin pago (no se crea sale_payment).
METODOS = {
    'efectivo': ('cash', None),
    'tarjeta de crédito': ('card', 'Crédito'),
    'tarjeta de débito': ('card', 'Débito'),
    'tarjeta de credito - online': ('card', 'En línea (EVO)'),
    'tarjeta de crédito, efectivo': ('other', 'Mixto tarjeta + efectivo según EVO'),
    'ninguno': (None, 'Ninguno'),
    'saldo deudor': (None, 'Saldo deudor'),
}

# "Personas" de EVO que en realidad son el mostrador: la venta queda sin persona.
SIN_PERSONA = {'ventas general productos'}


def q(v):
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def nombre_bonito(s):
    s = ' '.join(str(s or '').split())
    # Title case respetando "(MENOR)" y partículas.
    out = []
    for w in s.split(' '):
        lw = w.lower()
        if lw in ('de', 'del', 'la', 'las', 'los', 'y'):
            out.append(lw)
        elif w.startswith('('):
            out.append(w.lower())
        else:
            out.append(lw[:1].upper() + lw[1:])
    if out:
        out[0] = out[0][:1].upper() + out[0][1:]
    return ' '.join(out)


def main(src, dst):
    ws = openpyxl.load_workbook(src, data_only=True).active
    filas, total_evo = [], None
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[1] is None:
            if r[9] and str(r[9]).startswith('Total general'):
                total_evo = str(r[9])
            continue
        if not str(r[1]).strip() or r[10] is None:
            continue
        filas.append(r)

    valores, metodos_raros = [], set()
    for r in filas:
        _, tipo, cid, nom, ape, item, desc, _ini, cant, val, vid, fecha, met, emp, _orig = r
        full = f'{nom or ""} {ape or ""}'.strip()
        persona = None if full.lower() in SIN_PERSONA else nombre_bonito(full)
        d = ' '.join(str(desc or '').split())
        prod = PRODUCTOS.get(d.lower())
        m = METODOS.get(str(met or '').strip().lower())
        if m is None:
            metodos_raros.add(met)
            m = ('other', str(met))
        cents = round(float(val or 0) * 100)
        valores.append('(' + ', '.join([
            str(int(vid)), str(int(cid)) if cid and persona else 'NULL', q(persona),
            q(fecha.strftime('%Y-%m-%d %H:%M:%S')), q(prod or d), q(prod), str(int(cant or 1)), str(cents),
            q(m[0]), q(m[1]), q(emp), q(tipo),
        ]) + ')')

    if metodos_raros:
        print('OJO métodos sin mapear (van como other):', metodos_raros, file=sys.stderr)

    sql = PLANTILLA.replace('--VALORES--', ',\n'.join(valores)).replace('--TOTAL_EVO--', total_evo or '?')
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(sql)
    print(f'{len(filas)} renglones, {len({r[10] for r in filas})} ventas -> {dst}')


PLANTILLA = r"""-- ============================================================
-- Importa las ventas históricas de EVO (generado por scripts/evo_ventas_sql.py).
-- Total del Excel según EVO: --TOTAL_EVO--
--
-- · Idempotente: sales.evo_sale_id y people.evo_id evitan duplicados; se puede
--   volver a correr con un Excel más nuevo y solo agrega lo que falte.
-- · Las ventas quedan con source = 'evo', sin caja (session_id NULL), sin
--   tocar inventario y sin crear membresías.
-- · Personas: se liga por número de EVO; si no, por nombre igual (sin acentos
--   ni mayúsculas) cuando hay exactamente una; si no, se crea la ficha.
--   "VENTAS GENERAL PRODUCTOS" (mostrador) queda sin persona.
-- · "Ninguno" / "Saldo deudor" en EVO: la venta entra sin pago registrado.
-- ============================================================

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS evo_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS people_evo_id_idx ON public.people (evo_id) WHERE evo_id IS NOT NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS evo_sale_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_evo_sale_id_idx ON public.sales (evo_sale_id) WHERE evo_sale_id IS NOT NULL;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_source_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_source_check CHECK (source IN ('pos','class','subscription','online','evo'));

DROP TABLE IF EXISTS evo_rows;
CREATE TEMP TABLE evo_rows (
  vid BIGINT, cid BIGINT, persona TEXT, fecha TIMESTAMP, descripcion TEXT, producto TEXT,
  cant INT, cents INT, metodo TEXT, ref TEXT, empleado TEXT, tipo TEXT
);

INSERT INTO evo_rows VALUES
--VALORES--;

DO $imp$
DECLARE
  v_people_new INT := 0; v_people_linked INT := 0; v_sales INT := 0;
  r RECORD; v_pid UUID; v_sale UUID;
BEGIN
  -- 1) Personas
  FOR r IN SELECT DISTINCT ON (cid) cid, persona FROM evo_rows WHERE cid IS NOT NULL ORDER BY cid LOOP
    IF EXISTS (SELECT 1 FROM people WHERE evo_id = r.cid) THEN CONTINUE; END IF;
    SELECT p.id INTO v_pid FROM people p
    WHERE p.evo_id IS NULL
      AND translate(lower(btrim(p.full_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(btrim(r.persona)), 'áéíóúüñ', 'aeiouun')
      AND (SELECT count(*) FROM people p2 WHERE translate(lower(btrim(p2.full_name)), 'áéíóúüñ', 'aeiouun')
                                             = translate(lower(btrim(r.persona)), 'áéíóúüñ', 'aeiouun')) = 1;
    IF FOUND THEN
      UPDATE people SET evo_id = r.cid, updated_at = now() WHERE id = v_pid;
      v_people_linked := v_people_linked + 1;
    ELSE
      INSERT INTO people (full_name, source, note, evo_id)
      VALUES (r.persona, 'evo', 'Importado de EVO (ventas) · id EVO ' || r.cid, r.cid);
      v_people_new := v_people_new + 1;
    END IF;
  END LOOP;

  -- 2) Ventas
  FOR r IN
    SELECT vid, min(cid) AS cid, min(fecha) AS fecha, sum(cents)::int AS total,
           min(metodo) AS metodo, min(ref) AS ref, min(empleado) AS empleado
    FROM evo_rows GROUP BY vid ORDER BY min(fecha), vid
  LOOP
    IF EXISTS (SELECT 1 FROM sales WHERE evo_sale_id = r.vid) THEN CONTINUE; END IF;
    INSERT INTO sales (person_id, session_id, source, status, subtotal_cents, discount_cents, total_cents, note, created_at, evo_sale_id)
    VALUES ((SELECT id FROM people WHERE evo_id = r.cid), NULL, 'evo', 'completed', r.total, 0, r.total,
            'Importada de EVO · venta ' || r.vid
              || coalesce(' · vendió ' || initcap(r.empleado), '')
              || CASE WHEN r.metodo IS NULL THEN ' · sin pago registrado en EVO (' || r.ref || ')' ELSE '' END,
            r.fecha AT TIME ZONE 'America/Mexico_City', r.vid)
    RETURNING id INTO v_sale;

    INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price_cents, discount_cents, total_cents)
    SELECT v_sale, (SELECT pr.id FROM products pr WHERE lower(pr.name) = lower(e.producto) LIMIT 1),
           e.descripcion, e.cant, (e.cents / greatest(e.cant, 1)), 0, e.cents
    FROM evo_rows e WHERE e.vid = r.vid;

    IF r.metodo IS NOT NULL AND r.total > 0 THEN
      INSERT INTO sale_payments (sale_id, method, amount_cents, reference, created_at)
      VALUES (v_sale, r.metodo, r.total, r.ref, r.fecha AT TIME ZONE 'America/Mexico_City');
    END IF;
    v_sales := v_sales + 1;
  END LOOP;

  RAISE NOTICE 'Personas nuevas: %, ligadas por nombre: %, ventas importadas: %', v_people_new, v_people_linked, v_sales;
END;
$imp$;

DROP TABLE IF EXISTS evo_rows;

-- Revisión: totales por mes de lo importado (comparar contra EVO).
SELECT to_char(created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM') AS mes,
       count(*) AS ventas, sum(total_cents) / 100.0 AS total
FROM public.sales WHERE source = 'evo' AND status = 'completed'
GROUP BY 1
UNION ALL
SELECT 'TOTAL', count(*), sum(total_cents) / 100.0 FROM public.sales WHERE source = 'evo' AND status = 'completed'
ORDER BY 1;
"""

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
