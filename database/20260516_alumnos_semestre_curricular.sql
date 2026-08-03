-- Semestre curricular institucional por alumno (carrera de referencia); promoción manual en Académico.
ALTER TABLE IF EXISTS alumnos
    ADD COLUMN IF NOT EXISTS semestre_curricular SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS alumnos_semestre_curricular_check;
ALTER TABLE alumnos
    ADD CONSTRAINT alumnos_semestre_curricular_check CHECK (semestre_curricular >= 1 AND semestre_curricular <= 10);

COMMENT ON COLUMN alumnos.semestre_curricular IS 'Semestre curricular institucional asociado a referencia_carrera_id (promoción de cohorte).';

CREATE INDEX IF NOT EXISTS idx_alumnos_ref_carrera_semestre
    ON alumnos (referencia_carrera_id, semestre_curricular)
    WHERE referencia_carrera_id IS NOT NULL;
