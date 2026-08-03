-- Cohorte de ingreso: separa alumnos de la misma carrera y semestre curricular (p. ej. promoción 2024 vs 2025).
ALTER TABLE IF EXISTS lotes_importacion
    ADD COLUMN IF NOT EXISTS cohorte_anio SMALLINT NULL;

ALTER TABLE IF EXISTS alumnos
    ADD COLUMN IF NOT EXISTS cohorte_anio SMALLINT NULL;

ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS alumnos_cohorte_anio_check;
ALTER TABLE alumnos
    ADD CONSTRAINT alumnos_cohorte_anio_check CHECK (cohorte_anio IS NULL OR (cohorte_anio >= 1990 AND cohorte_anio <= 2100));

COMMENT ON COLUMN lotes_importacion.cohorte_anio IS 'Año de cohorte del listado importado (se asigna a cada alumno al confirmar el lote).';
COMMENT ON COLUMN alumnos.cohorte_anio IS 'Año de ingreso / cohorte institucional (listas y promoción por grupo).';
