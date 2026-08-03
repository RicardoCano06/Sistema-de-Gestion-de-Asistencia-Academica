-- Índice GIN trigram para búsqueda textual rápida de alumnos
-- Habilita ILIKE '%termino%' con escaneo indexado en vez de seq scan.
-- Cubre: numero_documento, nombres, apellidos, nombre_apellido

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_alumnos_busqueda_trgm
    ON alumnos
    USING gin (
        (COALESCE(numero_documento, '') || ' ' ||
         COALESCE(nombres, '') || ' ' ||
         COALESCE(apellidos, '') || ' ' ||
         COALESCE(nombre_apellido, '')) gin_trgm_ops
    );

ANALYZE alumnos;
