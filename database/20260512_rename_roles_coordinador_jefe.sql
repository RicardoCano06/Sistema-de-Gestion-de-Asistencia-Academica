-- Renombra roles (mismo id / mismas relaciones usuarios_roles; solo cambia el texto mostrado y enviado por API).
UPDATE roles SET nombre = 'Coordinador/a de Facultad' WHERE nombre = 'Director de Facultad';
UPDATE roles SET nombre = 'Jefe de Carrera' WHERE nombre = 'Coordinador de Carrera';
