-- Renombra estado_matricula 'libre' → 'irregular' (terminología local).
-- Requiere PostgreSQL 10+ (ALTER TYPE ... RENAME VALUE).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'estado_matricula'
          AND e.enumlabel = 'libre'
    ) THEN
        ALTER TYPE estado_matricula RENAME VALUE 'libre' TO 'irregular';
    END IF;
END $$;

-- La vista no permite renombrar columnas con CREATE OR REPLACE; se recrea.
DROP VIEW IF EXISTS public.vw_resumen_asistencia_curso;

CREATE VIEW public.vw_resumen_asistencia_curso AS
SELECT
    c.id AS curso_id,
    m.nombre AS materia,
    mo.anio,
    mo.mes,
    COUNT(mat.id) AS total_matriculas,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'regular') AS alumnos_regulares,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'en_riesgo') AS alumnos_riesgo,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'irregular') AS alumnos_irregulares,
    ROUND(AVG(mat.porcentaje_asistencia)::NUMERIC, 2) AS promedio_asistencia,
    SUM(mat.faltas_acumuladas) AS faltas_totales
FROM cursos c
JOIN modulos_academicos mo ON mo.id = c.modulo_id
JOIN materias m ON m.id = mo.materia_id
JOIN matriculas mat ON mat.curso_id = c.id
GROUP BY c.id, m.nombre, mo.anio, mo.mes;
