-- Fecha de ultima promocion de semestre curricular (NULL = nunca promovido)
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS promocionado_en TIMESTAMPTZ NULL;
