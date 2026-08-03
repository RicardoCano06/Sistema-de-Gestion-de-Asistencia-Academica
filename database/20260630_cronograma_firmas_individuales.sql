-- Firmas individuales por semana y por evaluacion (reemplaza curso_cronograma_firmas)
ALTER TABLE curso_cronograma_semanas ADD COLUMN IF NOT EXISTS firmado_por UUID REFERENCES docentes(id);
ALTER TABLE curso_cronograma_semanas ADD COLUMN IF NOT EXISTS firmado_en TIMESTAMPTZ;

ALTER TABLE curso_evaluaciones ADD COLUMN IF NOT EXISTS firmado_por UUID REFERENCES docentes(id);
ALTER TABLE curso_evaluaciones ADD COLUMN IF NOT EXISTS firmado_en TIMESTAMPTZ;

-- La tabla curso_cronograma_firmas queda obsoleta; se puede eliminar luego de verificar migracion
-- DROP TABLE IF EXISTS curso_cronograma_firmas;
