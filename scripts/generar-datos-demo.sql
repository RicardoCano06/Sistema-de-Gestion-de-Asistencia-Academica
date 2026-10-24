-- ============================================================
-- Generación de datos de asistencia para demo (solo local)
-- Crea sesiones cerradas y asistencias aleatorias para cursos
-- que no tienen datos, sin tocar los existentes.
-- ============================================================

-- 1. Crear una sesión cerrada por curso que no tenga ninguna
--    (usa la fecha de inicio del módulo académico)
INSERT INTO sesiones_clase (curso_id, fecha, estado, modalidad, cerrado_por, cerrado_en)
SELECT c.id, m.fecha_inicio, 'cerrada', 'presencial',
       '32029678-83d0-4709-b121-626bcb95b201'::uuid, NOW()
FROM cursos c
JOIN modulos_academicos m ON m.id = c.modulo_id
WHERE NOT EXISTS (
    SELECT 1 FROM sesiones_clase sc
    WHERE sc.curso_id = c.id AND sc.estado = 'cerrada'
)
AND NOT EXISTS (
    SELECT 1 FROM sesiones_clase sc
    WHERE sc.curso_id = c.id AND sc.fecha = m.fecha_inicio
)
ON CONFLICT (curso_id, fecha) DO NOTHING;

-- 2. Deshabilitar trigger de recálculo para inserción masiva
ALTER TABLE asistencias DISABLE TRIGGER trg_asistencias_recalculo;

-- 3. Insertar asistencias aleatorias (70% presente / 30% ausente)
--    solo donde no exista ya un registro
INSERT INTO asistencias (sesion_id, matricula_id, estado, justificada, registrado_por)
SELECT sc.id, m.id,
       CASE WHEN random() < 0.7
            THEN 'presente'::estado_asistencia
            ELSE 'ausente'::estado_asistencia
       END,
       FALSE,
       '32029678-83d0-4709-b121-626bcb95b201'::uuid
FROM sesiones_clase sc
JOIN cursos c ON c.id = sc.curso_id
JOIN matriculas m ON m.curso_id = c.id
WHERE sc.estado = 'cerrada'
  AND NOT EXISTS (
      SELECT 1 FROM asistencias a
      WHERE a.sesion_id = sc.id AND a.matricula_id = m.id
  )
ON CONFLICT (sesion_id, matricula_id) DO NOTHING;

-- 4. Reactivar trigger
ALTER TABLE asistencias ENABLE TRIGGER trg_asistencias_recalculo;

-- 5. Recalcular métricas una sola vez por matrícula
SELECT recalcular_metricas_asistencia(id) FROM matriculas;

-- 6. Verificación
SELECT 'sesiones_cerradas' AS metrica, COUNT(*)::int AS valor FROM sesiones_clase WHERE estado = 'cerrada'
UNION ALL
SELECT 'asistencias', COUNT(*)::int FROM asistencias
UNION ALL
SELECT 'matriculas_con_metricas', COUNT(*)::int FROM matriculas WHERE porcentaje_asistencia IS NOT NULL;