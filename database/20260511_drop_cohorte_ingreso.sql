-- Quitar año/cohorte de ingreso del alumno (ya no se usa en la aplicación).
ALTER TABLE alumnos DROP COLUMN IF EXISTS cohorte_ingreso;
