-- Cronograma de Catedra: planilla semanal con contenidos, actividades y horas
CREATE TABLE IF NOT EXISTS curso_cronograma_semanas (
    id SERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    semana_numero SMALLINT NOT NULL CHECK (semana_numero > 0),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    contenidos TEXT[] NOT NULL DEFAULT '{}',
    actividades TEXT[] NOT NULL DEFAULT '{}',
    horas NUMERIC(5,1) DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, semana_numero)
);

CREATE INDEX IF NOT EXISTS idx_cronograma_semanas_curso ON curso_cronograma_semanas(curso_id);

-- Evaluaciones del curso: parcial y final con fechas y alcances
CREATE TABLE IF NOT EXISTS curso_evaluaciones (
    id SERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('parcial', 'final')),
    fecha DATE,
    alcance_prueba TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_evaluaciones_curso ON curso_evaluaciones(curso_id);
