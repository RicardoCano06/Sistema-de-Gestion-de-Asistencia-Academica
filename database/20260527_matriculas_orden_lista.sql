-- Orden de alumnos en planilla (según filas del Excel al importar / matricular).
ALTER TABLE matriculas
    ADD COLUMN IF NOT EXISTS orden_lista INTEGER;

CREATE INDEX IF NOT EXISTS idx_matriculas_curso_orden
    ON matriculas (curso_id, orden_lista);

COMMENT ON COLUMN matriculas.orden_lista IS
    'Posición en la lista del curso (1-based), según orden de importación o matriculación.';
