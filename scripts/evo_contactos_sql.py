"""Genera el SQL que pega a las fichas de Relámpago el correo, celular y demás
datos de los clientes y prospectos exportados de EVO.

Uso:  python -I scripts/evo_contactos_sql.py <archivo de EVO .xlsx/.csv> <salida.sql>

La salida trae datos personales: generarla FUERA del repo y no subirla a git.

El archivo es la exportación de clientes/prospectos de EVO (CRM → Segmentación
o Clientes → Exportar). Las columnas se reconocen por su encabezado (ver
COLUMNAS); si EVO usa otro nombre, agrégalo ahí. El script dice qué columna
tomó para cada dato, para revisarlo antes de correr el SQL.

Qué hace el SQL (idempotente, se puede volver a correr):
· Liga cada contacto con su ficha por número de EVO (people.evo_id); si no,
  por nombre igual (sin acentos ni mayúsculas) cuando hay exactamente una
  ficha con ese nombre y sin número de EVO.
· SOLO LLENA LO QUE ESTÁ VACÍO: no sobrescribe un correo, celular, etc. que
  ya tenga la ficha (lo que capturó recepción o el cliente manda).
· Un correo que ya usa otra ficha no se pone (sería un duplicado): sale en
  la revisión del final para unirlas desde Personas → Posibles duplicados.
· Quien no tenga ficha (prospectos que nunca compraron) se crea con
  source = 'evo'.
"""
import csv
import re
import sys
import unicodedata
from datetime import date, datetime

# dato → encabezados posibles (normalizados: minúsculas, sin acentos ni signos).
COLUMNAS = {
    'cid': ['id', 'codigo', 'id cliente', 'codigo cliente', 'id del cliente', 'matricula', 'id evo', 'idcliente', 'cod'],
    'nombre': ['nombre', 'nombres', 'nombre del cliente', 'cliente', 'prospecto', 'nombre completo'],
    'apellido': ['apellido', 'apellidos'],
    'email': ['email', 'e mail', 'correo', 'correo electronico', 'mail'],
    'celular': ['celular', 'telefono celular', 'movil', 'whatsapp', 'cel'],
    'telefono': ['telefono', 'tel', 'telefono fijo', 'telefonos'],
    'nacimiento': ['nacimiento', 'fecha de nacimiento', 'fecha nacimiento', 'cumpleanos', 'data de nascimento'],
    'genero': ['sexo', 'genero'],
    'tipo': ['tipo', 'situacion', 'status', 'estatus', 'estado'],
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', s).split())


def q(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def nombre_bonito(s):
    s = ' '.join(str(s or '').split())
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


def celular(v):
    d = re.sub(r'\D', '', str(v or ''))
    if d.startswith('521') and len(d) == 13:
        d = d[3:]
    elif d.startswith('52') and len(d) == 12:
        d = d[2:]
    return d if len(d) == 10 else None


def correo(v):
    e = str(v or '').strip().lower()
    return e if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', e) else None


def fecha(v):
    if isinstance(v, datetime):
        v = v.date()
    if isinstance(v, date):
        d = v
    else:
        s = str(v or '').strip()
        d = None
        for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%y'):
            try:
                d = datetime.strptime(s[:10], fmt).date()
                break
            except ValueError:
                pass
    if d is None or d.year < 1920 or d > date.today():
        return None
    return d.isoformat()


def genero(v):
    g = norm(v)
    if g in ('f', 'femenino', 'mujer', 'feminino'):
        return 'F'
    if g in ('m', 'masculino', 'hombre'):
        return 'M'
    return None


def leer(src):
    if src.lower().endswith('.csv'):
        raw = open(src, 'rb').read()
        txt = raw.decode('utf-8-sig') if raw[:3] == b'\xef\xbb\xbf' else raw.decode('utf-8', errors='replace')
        dialect = csv.Sniffer().sniff(txt[:4096], delimiters=',;\t')
        return list(csv.reader(txt.splitlines(), dialect))
    import openpyxl
    ws = openpyxl.load_workbook(src, data_only=True, read_only=True).active
    return [list(r) for r in ws.iter_rows(values_only=True)]


def main(src, dst):
    rows = leer(src)
    # Encabezado: el primer renglón (de los 10 primeros) con nombre y algún contacto.
    hdr_i, idx = None, {}
    for i, r in enumerate(rows[:10]):
        h = [norm(c) for c in r]
        found = {}
        for key, names in COLUMNAS.items():
            for j, c in enumerate(h):
                if c in names and key not in found and j not in found.values():
                    found[key] = j
        if 'nombre' in found and ({'email', 'celular', 'telefono'} & found.keys()):
            hdr_i, idx = i, found
            break
    if hdr_i is None:
        sys.exit('No encontré el encabezado (nombre + correo/celular). Encabezados vistos: '
                 + ' | '.join(str(c) for c in rows[0]))
    print('Columnas tomadas:', ', '.join(f'{k} = "{rows[hdr_i][j]}"' for k, j in idx.items()), file=sys.stderr)

    get = lambda r, k: (r[idx[k]] if k in idx and idx[k] < len(r) else None)
    valores, sin_contacto = [], 0
    vistos = set()
    for r in rows[hdr_i + 1:]:
        full = ' '.join(str(x) for x in (get(r, 'nombre'), get(r, 'apellido')) if x)
        full = nombre_bonito(full)
        if len(full) < 3:
            continue
        cid = re.sub(r'\D', '', str(get(r, 'cid') or '')) or None
        key = cid or norm(full)
        if key in vistos:
            continue
        vistos.add(key)
        em, cel = correo(get(r, 'email')), celular(get(r, 'celular')) or celular(get(r, 'telefono'))
        if not em and not cel:
            sin_contacto += 1
        valores.append('(' + ', '.join([
            cid or 'NULL', q(full), q(em), q(cel), q(fecha(get(r, 'nacimiento'))), q(genero(get(r, 'genero'))),
            q(str(get(r, 'tipo') or '').strip()[:40] or None),
        ]) + ')')

    if not valores:
        sys.exit('El archivo no trae contactos.')
    sql = PLANTILLA.replace('--VALORES--', ',\n'.join(valores))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(sql)
    print(f'{len(valores)} contactos ({sin_contacto} sin correo ni celular) -> {dst}')


PLANTILLA = r"""-- ============================================================
-- Contactos de EVO → fichas de Relámpago (generado por scripts/evo_contactos_sql.py).
-- Solo llena datos vacíos; no sobrescribe. Idempotente.
-- ============================================================

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS evo_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS people_evo_id_idx ON public.people (evo_id) WHERE evo_id IS NOT NULL;

DROP TABLE IF EXISTS evo_contacts;
CREATE TEMP TABLE evo_contacts (cid BIGINT, persona TEXT, email TEXT, phone TEXT, birth DATE, gender TEXT, tipo TEXT,
                                person_id UUID, how TEXT, email_used_by UUID, email_skip BOOLEAN NOT NULL DEFAULT false);

INSERT INTO evo_contacts (cid, persona, email, phone, birth, gender, tipo) VALUES
--VALORES--;

-- 1) Ligar con su ficha.
UPDATE evo_contacts c SET person_id = p.id, how = 'evo_id'
FROM people p WHERE c.cid IS NOT NULL AND p.evo_id = c.cid;

UPDATE evo_contacts c SET person_id = m.id, how = 'nombre'
FROM (
  SELECT c2.ctid AS c_tid, min(p.id::text)::uuid AS id
  FROM evo_contacts c2
  JOIN people p ON p.evo_id IS NULL AND NOT p.is_archived
   AND regexp_replace(translate(lower(btrim(p.full_name)), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g')
     = regexp_replace(translate(lower(btrim(c2.persona)), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g')
  WHERE c2.person_id IS NULL
  GROUP BY c2.ctid HAVING count(*) = 1
) m
WHERE c.ctid = m.c_tid;

-- Dos contactos de EVO no pueden caer en la misma ficha por nombre: esos se crean aparte.
UPDATE evo_contacts c SET person_id = NULL, how = NULL
WHERE c.how = 'nombre' AND (SELECT count(*) FROM evo_contacts c2 WHERE c2.person_id = c.person_id) > 1;

-- 2) Correos que ya usa OTRA ficha: no se ponen (salen en la revisión).
UPDATE evo_contacts c SET email_used_by = p.id, email_skip = true
FROM people p WHERE c.email IS NOT NULL AND lower(p.email) = c.email AND p.id IS DISTINCT FROM c.person_id;
-- El mismo correo en dos contactos de EVO: solo el primero lo usa.
UPDATE evo_contacts c SET email_skip = true
WHERE c.email IS NOT NULL AND NOT c.email_skip
  AND EXISTS (SELECT 1 FROM evo_contacts c2 WHERE c2.email = c.email AND c2.ctid < c.ctid);

-- 3) Llenar SOLO lo vacío.
UPDATE people p SET
  email      = coalesce(p.email, CASE WHEN NOT c.email_skip THEN c.email END),
  phone      = coalesce(p.phone, c.phone),
  birth_date = coalesce(p.birth_date, c.birth),
  gender     = coalesce(p.gender, c.gender),
  evo_id     = coalesce(p.evo_id, c.cid),
  updated_at = now()
FROM evo_contacts c
WHERE c.person_id = p.id
  AND (   (p.email IS NULL AND c.email IS NOT NULL AND NOT c.email_skip)
       OR (p.phone IS NULL AND c.phone IS NOT NULL)
       OR (p.birth_date IS NULL AND c.birth IS NOT NULL)
       OR (p.gender IS NULL AND c.gender IS NOT NULL)
       OR (p.evo_id IS NULL AND c.cid IS NOT NULL));

-- 4) Quien no tiene ficha: se crea (prospectos que nunca compraron, etc.).
INSERT INTO people (full_name, email, phone, birth_date, gender, source, evo_id, note)
SELECT c.persona, CASE WHEN NOT c.email_skip THEN c.email END, c.phone, c.birth, c.gender, 'evo', c.cid,
       'Importado de EVO (contactos)' || coalesce(' · ' || c.tipo, '')
FROM evo_contacts c
WHERE c.person_id IS NULL
  AND (c.cid IS NULL OR NOT EXISTS (SELECT 1 FROM people p WHERE p.evo_id = c.cid));

-- Revisión
SELECT 'contactos en el archivo' AS que, count(*)::text AS cuantos FROM evo_contacts
UNION ALL SELECT 'ligados por numero de EVO', count(*)::text FROM evo_contacts WHERE how = 'evo_id'
UNION ALL SELECT 'ligados por nombre', count(*)::text FROM evo_contacts WHERE how = 'nombre'
UNION ALL SELECT 'fichas nuevas', count(*)::text FROM evo_contacts WHERE person_id IS NULL
UNION ALL SELECT 'correo ya usado por otra ficha (posible duplicado)', count(*)::text FROM evo_contacts WHERE email_used_by IS NOT NULL
UNION ALL SELECT 'correo repetido dentro del archivo (no se puso)', count(*)::text FROM evo_contacts WHERE email_skip AND email_used_by IS NULL
UNION ALL SELECT 'personas con correo o celular (total)', count(*)::text FROM people WHERE email IS NOT NULL OR phone IS NOT NULL
UNION ALL SELECT 'personas en total', count(*)::text FROM people;
"""

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
