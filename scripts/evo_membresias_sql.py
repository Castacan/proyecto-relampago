"""Genera el SQL que crea en Relámpago las membresías que se vendieron en EVO.

Uso:  python -I scripts/evo_membresias_sql.py <Vendas.xlsx de EVO> <salida.sql>

Usa el MISMO Excel de ventas que scripts/evo_ventas_sql.py y se corre DESPUÉS
de importar las ventas (necesita people.evo_id y sales.evo_sale_id).

Por cada renglón de membresía ("Membresía Mensual", "Trimestral",
"Domiciliación") crea un periodo en public.memberships:
  valid_from  = "Inicio en" de EVO (si no hay, la fecha de venta)
  valid_until = valid_from + 1 o 3 meses − 1 día
ligado a la persona (evo_id) y a la venta (evo_sale_id). Idempotente: si la
venta ya tiene membresía, no la repite. No toca domiciliaciones (las tarjetas
viven en EVO; cada domiciliado vuelve a registrar la suya).

La salida solo trae números de EVO (sin nombres), pero igual va FUERA del repo.
"""
import calendar
import datetime as dt
import sys

import openpyxl


def add_months(d, m):
    y = d.year + (d.month - 1 + m) // 12
    mo = (d.month - 1 + m) % 12 + 1
    return d.replace(year=y, month=mo, day=min(d.day, calendar.monthrange(y, mo)[1]))


def main(src, dst):
    ws = openpyxl.load_workbook(src, data_only=True).active
    vals, hoy, vigentes = [], dt.date.today(), set()
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[1] or r[10] is None:
            continue
        desc = ' '.join(str(r[6] or '').split())
        if not desc.lower().startswith('membres'):
            continue
        meses = 3 if 'trimes' in desc.lower() else 1
        ini = (r[7] or r[11]).date()
        fin = add_months(ini, meses) - dt.timedelta(days=1)
        if fin >= hoy:
            vigentes.add(int(r[2]))
        plan = desc.title().replace('Membresia', 'Membresía').replace('Domiciliacion', 'Domiciliación')
        vals.append(f"({int(r[10])}, {int(r[2])}, '{plan}', '{ini}', '{fin}')")

    sql = PLANTILLA.replace('--VALORES--', ',\n'.join(vals))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(sql)
    print(f'{len(vals)} membresías, {len(vigentes)} personas vigentes al {hoy} -> {dst}')


PLANTILLA = r"""-- ============================================================
-- Membresías vendidas en EVO → public.memberships (scripts/evo_membresias_sql.py).
-- Correr DESPUÉS del SQL de ventas de EVO. Idempotente.
-- ============================================================
DROP TABLE IF EXISTS evo_memb;
CREATE TEMP TABLE evo_memb (vid BIGINT, cid BIGINT, plan TEXT, desde DATE, hasta DATE);
INSERT INTO evo_memb VALUES
--VALORES--;

INSERT INTO public.memberships (person_id, plan_name, valid_from, valid_until, note, sale_id, product_id)
SELECT p.id, e.plan, e.desde, e.hasta, 'Importada de EVO · venta ' || e.vid, s.id,
       (SELECT pr.id FROM public.products pr WHERE lower(pr.name) = lower(e.plan) LIMIT 1)
FROM evo_memb e
JOIN public.people p ON p.evo_id = e.cid
LEFT JOIN public.sales s ON s.evo_sale_id = e.vid
WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.sale_id = s.id AND s.id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.person_id = p.id AND m.note = 'Importada de EVO · venta ' || e.vid);

-- Revisión: renglones del Excel que no encontraron persona (deberían ser 0).
SELECT 'sin persona' AS revision, count(*) AS n FROM evo_memb e WHERE NOT EXISTS (SELECT 1 FROM public.people p WHERE p.evo_id = e.cid)
UNION ALL
SELECT 'membresias de EVO en Relampago', count(*) FROM public.memberships WHERE note LIKE 'Importada de EVO%'
UNION ALL
SELECT 'vigentes hoy', count(DISTINCT person_id) FROM public.memberships
  WHERE note LIKE 'Importada de EVO%' AND valid_until >= (now() AT TIME ZONE 'America/Mexico_City')::date
    AND valid_from <= (now() AT TIME ZONE 'America/Mexico_City')::date;
DROP TABLE IF EXISTS evo_memb;
"""

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
