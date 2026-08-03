-- Índices estratégicos para consultas de planilla de asistencia
-- Elimina latencias en JOINs entre asistencias ↔ sesiones_clase ↔ matriculas

CREATE INDEX IF NOT EXISTS idx_asistencias_sesion_matricula
    ON asistencias(sesion_id, matricula_id);

ANALYZE asistencias;
ANALYZE sesiones_clase;
ANALYZE matriculas;
