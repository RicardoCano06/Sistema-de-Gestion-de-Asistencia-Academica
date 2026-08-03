-- Incluye semestre curricular en la vista de resumen por curso (evita JOINs adicionales en el servicio).
-- PRE-REQUISITO PRODUCCIÓN: ejecutar 20260529_vw_resumen_asistencia_semestre_precheck.sql.
-- Si hay dependencias, usar DROP VIEW ... CASCADE solo tras planificar la recreación de objetos afectados.
-- VENTANA DE MANTENIMIENTO: ejecutar con tráfico cero (DROP VIEW → AccessExclusiveLock).
-- CREATE OR REPLACE no permite insertar columnas en medio; se recrea la vista.
DROP VIEW IF EXISTS vw_resumen_asistencia_curso;

CREATE VIEW vw_resumen_asistencia_curso AS
SELECT
    c.id AS curso_id,
    m.nombre AS materia,
    m.semestre AS semestre,
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
GROUP BY c.id, m.nombre, m.semestre, mo.anio, mo.mes;
