-- Materias agrupadas por semestre dentro del plan de estudio (1 = primer semestre, etc.)
ALTER TABLE materias
  ADD COLUMN IF NOT EXISTS semestre SMALLINT NOT NULL DEFAULT 1;

UPDATE materias SET semestre = 1 WHERE semestre IS NULL;

ALTER TABLE materias DROP CONSTRAINT IF EXISTS materias_semestre_check;
ALTER TABLE materias ADD CONSTRAINT materias_semestre_check CHECK (semestre >= 1 AND semestre <= 10);

COMMENT ON COLUMN materias.semestre IS 'Orden curricular: 1 = primer semestre del plan, etc.';
