-- Carrera declarada en importación de alumnos (alcance coordinación / ficha sin matrícula).
ALTER TABLE IF EXISTS alumnos
    ADD COLUMN IF NOT EXISTS referencia_carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alumnos_referencia_carrera_id ON alumnos(referencia_carrera_id)
    WHERE referencia_carrera_id IS NOT NULL;
