-- Actas regenerables: sin archivo en Storage; url apunta a endpoint de regeneración.
-- curso_id nullable para exports globales (usuarios, auditoría, consolidados).

ALTER TABLE actas_generadas
    ALTER COLUMN curso_id DROP NOT NULL;

ALTER TABLE actas_generadas
    ADD COLUMN IF NOT EXISTS parametros JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN actas_generadas.parametros IS
    'Parámetros para regenerar el PDF con datos actuales (periodo, filtros, alumnoId, etc.).';

COMMENT ON COLUMN actas_generadas.url_documento IS
    'Ruta API de descarga regenerable (/reportes/actas/{id}/pdf) o URL legacy de Storage.';
