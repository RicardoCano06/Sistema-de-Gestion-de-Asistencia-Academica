-- Nombre vigente del rol de coordinación de facultad (sin barra ni género alternativo).
UPDATE roles
SET nombre = 'Coordinador de Facultad'
WHERE nombre IN (
  'Coordinador/a de Facultad',
  'Coordinadora de Facultad',
  'Director de Facultad'
);
