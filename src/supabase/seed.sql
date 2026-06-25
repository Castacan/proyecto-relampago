-- ============================================================
-- Seed inicial — Zonas y QR codes
-- Ajustar nombres y coordenadas cuando el dueño confirme
-- ============================================================

INSERT INTO public.zones (name, slug, order_index, map_x, map_y, canvas_x_start, canvas_x_end) VALUES
  ('Pared izquierda',        'pared-izquierda',  1, 0.10, 0.50, 0.00, 0.20),
  ('Pared trasera derecha',  'pared-derecha',    2, 0.80, 0.50, 0.20, 0.40),
  ('Cara frontal núcleo',    'cara-frontal',     3, 0.50, 0.30, 0.40, 0.60),
  ('Flanco izquierdo',       'flanco-izquierdo', 4, 0.35, 0.50, 0.60, 0.70),
  ('Flanco derecho',         'flanco-derecho',   5, 0.65, 0.50, 0.70, 0.80),
  ('Túnel',                  'tunel',            6, 0.50, 0.70, 0.80, 0.90),
  ('Desplome',               'desplome',         7, 0.50, 0.55, 0.90, 1.00)
ON CONFLICT (slug) DO NOTHING;

-- QR codes pre-generados (001–050)
INSERT INTO public.qr_codes (id, status) VALUES
  ('001', 'available'), ('002', 'available'), ('003', 'available'), ('004', 'available'), ('005', 'available'),
  ('006', 'available'), ('007', 'available'), ('008', 'available'), ('009', 'available'), ('010', 'available'),
  ('011', 'available'), ('012', 'available'), ('013', 'available'), ('014', 'available'), ('015', 'available'),
  ('016', 'available'), ('017', 'available'), ('018', 'available'), ('019', 'available'), ('020', 'available'),
  ('021', 'available'), ('022', 'available'), ('023', 'available'), ('024', 'available'), ('025', 'available'),
  ('026', 'available'), ('027', 'available'), ('028', 'available'), ('029', 'available'), ('030', 'available'),
  ('031', 'available'), ('032', 'available'), ('033', 'available'), ('034', 'available'), ('035', 'available'),
  ('036', 'available'), ('037', 'available'), ('038', 'available'), ('039', 'available'), ('040', 'available'),
  ('041', 'available'), ('042', 'available'), ('043', 'available'), ('044', 'available'), ('045', 'available'),
  ('046', 'available'), ('047', 'available'), ('048', 'available'), ('049', 'available'), ('050', 'available')
ON CONFLICT (id) DO NOTHING;
