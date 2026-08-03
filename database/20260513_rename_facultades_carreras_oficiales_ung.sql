-- Nombres oficiales UNG (facultades y carreras). Idempotente: solo renombra si existe el valor antiguo.

BEGIN;

UPDATE facultades
SET nombre = 'Facultad de Ciencias y Tecnología'
WHERE nombre IN (
    'Facultad de Ciencias y Tecnologia',
    'Facultad de Ciencias y Tecnologias'
);

UPDATE carreras c
SET nombre = 'Licenciatura en Ciencias de la Educación'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Humanidades y Ciencias de la Educación'
  AND c.nombre = 'Ciencias de la Educación';

UPDATE carreras c
SET nombre = 'Licenciatura en Psicología Clínica'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Humanidades y Ciencias de la Educación'
  AND c.nombre IN ('Psicología', 'Psicologia');

UPDATE carreras c
SET nombre = 'Licenciatura en Ciencias del Deporte'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Humanidades y Ciencias de la Educación'
  AND c.nombre = 'Ciencias del Deporte';

UPDATE carreras c
SET nombre = 'Licenciatura en Educación Inicial'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Humanidades y Ciencias de la Educación'
  AND c.nombre = 'Educación Inicial';

UPDATE carreras c
SET nombre = 'Licenciatura en Educación Escolar Básica'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Humanidades y Ciencias de la Educación'
  AND c.nombre = 'Educación Escolar Básica';

UPDATE carreras c
SET nombre = 'Licenciatura en Diseño Gráfico'
FROM facultades f
WHERE c.facultad_id = f.id
  AND f.nombre = 'Facultad de Ciencias y Tecnología'
  AND c.nombre = 'Diseño Gráfico';

COMMIT;
