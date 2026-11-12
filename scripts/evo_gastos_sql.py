"""Genera el SQL que importa a Relámpago los gastos (cuentas a pagar) de EVO.

Uso:  python -I scripts/evo_gastos_sql.py <export de Cuentas a pagar .xlsx> <salida.sql>

El Excel sale de Financiero → Cuentas a pagar, quitando el filtro de fecha,
con Status = Pendiente + Pagar (sin las eliminadas) y el botón de descarga.
Columnas: ID, Favorecido, Beneficiario, Descripción, Centro de costos,
Vencimiento, Pago, Valor, Monto de liquidación, Categoría, Conciliación, Status.
Las fechas vienen como M/D/AAAA.

El SQL es idempotente: cada gasto lleva su número de EVO (expenses.evo_id).
· Favorecido → proveedor (expense_payees). Los "Empleados" se ligan con su
  ficha de empleado (por las palabras del nombre) y quedan como Nómina.
· El Excel no trae cómo se pagó: aquí queda método 'other', pagado desde 'other'.
· Mes del gasto = mes del vencimiento.

MÉTODO, CUENTA Y MES REALES (2026-11-12): el Excel no los trae, pero la
pantalla vieja sí (Financiero → "Cuentas a pagar", no la "(nuevo)"). Se abre
su iframe directo (evo3.w12app.com.br/Financeiro/ContasPagar/ContasPagar?idFilial=…),
se busca con un rango amplio de vencimiento y se lee la tabla Kendo:
  jQuery('.k-grid').data('kendoGrid').dataSource → pageSize(500) → data()
Campos: ID_CONTA_PAGAR (= evo_id), FORMA_PAGAMENTO (1 efectivo, 3 débito,
7 transferencia…), ID_CONTA_BANCARIA (294 Caja Interno, 295 Santander) y
DT_COMPETENCIA (mes). Con eso se arma un UPDATE de expenses por evo_id.
"""
import sys
import unicodedata
from datetime import datetime

import openpyxl

CENTROS = {'gastos fijos': 'Gastos fijos', 'gastos variables': 'Gastos variables', 'compra productos': 'Compra de productos'}
TIPO = {'empleados': 'employee', 'bancos': 'government', 'fornecedores': 'supplier'}
CHICAS = {'de', 'del', 'la', 'las', 'los', 'y'}
SIGLAS = {'cfe', 'sat', 'dj', 'evo', 'acopa', 'clip', 'seinso', 'comex'}


def q(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def bonito(s):
    out = []
    for w in ' '.join(str(s or '').split()).split(' '):
        lw = w.lower()
        base = lw.strip('()')
        if base in SIGLAS:
            out.append(w.upper())
        elif lw in CHICAS and out:
            out.append(lw)
        else:
            out.append(lw[:1].upper() + lw[1:] if not lw.startswith('(') else '(' + lw[1:2].upper() + lw[2:])
    return ' '.join(out)


def fecha(v):
    if isinstance(v, datetime):
        return v.date()
    return datetime.strptime(str(v).strip(), '%m/%d/%Y').date()


def norm(s):
    return unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower().strip()


def main(src, dst):
    ws = openpyxl.load_workbook(src, data_only=True, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    h = [norm(c) for c in rows[0]]
    col = {k: h.index(k) for k in ('id', 'favorecido', 'beneficiario', 'descripcion', 'centro de costos',
                                    'vencimiento', 'pago', 'valor', 'categoria', 'status')}
    vals, total, raros = [], 0, set()
    for r in rows[1:]:
        if r[col['id']] is None:
            continue
        status = norm(r[col['status']])
        if status not in ('pagar', 'pendiente'):
            continue
        cc_evo = norm(r[col['centro de costos']])
        cc = CENTROS.get(cc_evo)
        if cc is None:
            raros.add(r[col['centro de costos']])
            cc = 'Gastos variables'
        kind = TIPO.get(norm(r[col['beneficiario']]), 'other')
        cents = round(float(r[col['valor']]) * 100)
        total += cents
        due = fecha(r[col['vencimiento']])
        paid = fecha(r[col['pago']]) if r[col['pago']] and status == 'pagar' else None
        cat = 'Nómina' if kind == 'employee' else (r[col['categoria']] or cc)
        vals.append('(' + ', '.join([
            str(int(r[col['id']])), q(bonito(r[col['favorecido']])), q(kind), q(' '.join(str(r[col['descripcion']]).split())),
            q(cc), q(cat), str(cents), q(due.isoformat()), q(paid.isoformat() if paid else None),
        ]) + ')')
    if raros:
        print('OJO centros de costo sin mapear (van a Gastos variables):', raros, file=sys.stderr)
    sql = PLANTILLA.replace('--VALORES--', ',\n'.join(vals)).replace('--TOTAL--', f'{total / 100:,.2f}').replace('--N--', str(len(vals)))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(sql)
    print(f'{len(vals)} gastos, ${total / 100:,.2f} -> {dst}')


PLANTILLA = r"""-- ============================================================
-- Gastos de EVO → Egresos de Relámpago (generado por scripts/evo_gastos_sql.py).
-- --N-- gastos por $--TOTAL-- según el Excel. Idempotente (expenses.evo_id).
-- ============================================================

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS evo_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_evo_id_idx ON public.expenses (evo_id) WHERE evo_id IS NOT NULL;

DROP TABLE IF EXISTS evo_gastos;
CREATE TEMP TABLE evo_gastos (evo_id BIGINT, payee TEXT, kind TEXT, description TEXT, cost_center TEXT, category TEXT,
                              cents INT, due_on DATE, paid_on DATE, payee_id UUID);
INSERT INTO evo_gastos (evo_id, payee, kind, description, cost_center, category, cents, due_on, paid_on) VALUES
--VALORES--;

-- 1) Empleados: ligar con su ficha de empleado (todas las palabras del nombre de EVO, menos "staff").
DO $emp$
DECLARE r RECORD; v_emp employees%ROWTYPE; v_pid UUID;
BEGIN
  FOR r IN SELECT DISTINCT payee FROM evo_gastos WHERE kind = 'employee' LOOP
    SELECT e.* INTO v_emp FROM employees e
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(erp_norm_name(r.payee), ' ')) w
      WHERE w <> 'staff' AND position(w IN erp_norm_name(e.full_name)) = 0)
    ORDER BY e.created_at LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pid := v_emp.payee_id;
    IF v_pid IS NULL THEN
      SELECT id INTO v_pid FROM expense_payees WHERE lower(name) = lower(v_emp.full_name);
      IF v_pid IS NULL THEN
        INSERT INTO expense_payees (name, kind, default_category) VALUES (v_emp.full_name, 'employee', 'Nómina') RETURNING id INTO v_pid;
      END IF;
      UPDATE employees SET payee_id = v_pid WHERE id = v_emp.id;
    END IF;
    UPDATE evo_gastos SET payee_id = v_pid WHERE payee = r.payee;
  END LOOP;
END $emp$;

-- 2) Los demás proveedores: por nombre; si no existe, se crea.
INSERT INTO expense_payees (name, kind, default_cost_center)
SELECT DISTINCT ON (lower(g.payee)) g.payee, g.kind, g.cost_center
FROM evo_gastos g
WHERE g.payee_id IS NULL AND NOT EXISTS (SELECT 1 FROM expense_payees p WHERE lower(p.name) = lower(g.payee));
UPDATE evo_gastos g SET payee_id = p.id FROM expense_payees p WHERE g.payee_id IS NULL AND lower(p.name) = lower(g.payee);

-- 3) Gastos.
INSERT INTO expenses (payee_id, description, cost_center, category, amount_cents, due_on, period_month,
                      status, paid_on, method, paid_from, notes, evo_id)
SELECT g.payee_id, g.description, g.cost_center, g.category, g.cents, g.due_on, date_trunc('month', g.due_on)::date,
       CASE WHEN g.paid_on IS NULL THEN 'pending' ELSE 'paid' END, g.paid_on,
       CASE WHEN g.paid_on IS NULL THEN NULL ELSE 'other' END, CASE WHEN g.paid_on IS NULL THEN NULL ELSE 'other' END,
       'Importado de EVO · cuenta ' || g.evo_id, g.evo_id
FROM evo_gastos g
WHERE g.cents > 0 AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.evo_id = g.evo_id);

-- Revisión
SELECT 'gastos de EVO en Relampago' AS que, count(*)::text AS valor FROM expenses WHERE evo_id IS NOT NULL
UNION ALL SELECT 'total de EVO en Relampago', to_char(sum(amount_cents) / 100.0, 'FM999,999,990.00') FROM expenses WHERE evo_id IS NOT NULL
UNION ALL SELECT 'empleados ligados', string_agg(DISTINCT p.name, ', ') FROM expenses e JOIN expense_payees p ON p.id = e.payee_id WHERE e.evo_id IS NOT NULL AND p.kind = 'employee'
UNION ALL SELECT 'gastos sin proveedor', count(*)::text FROM expenses WHERE evo_id IS NOT NULL AND payee_id IS NULL;
"""

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
