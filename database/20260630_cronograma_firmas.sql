-- Firma digital del docente sobre el cronograma de catedra completo
CREATE TABLE IF NOT EXISTS curso_cronograma_firmas (
    id SERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    docente_id UUID NOT NULL REFERENCES docentes(id) ON DELETE RESTRICT,
    firmado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, docente_id)
);

CREATE INDEX IF NOT EXISTS idx_cronograma_firmas_curso ON curso_cronograma_firmas(curso_id);
