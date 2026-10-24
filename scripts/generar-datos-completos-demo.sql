-- ============================================================
-- Generación COMPLETA de datos de asistencia para demo
-- Crea sesiones cerradas para todos los días lectivos del módulo
-- e inserta asistencias con distribución realista por alumno.
-- ============================================================

-- 1. Crear sesiones cerradas para todos los días lectivos (lun-jue)
--    de cada módulo académico de cada curso
INSERT INTO sesiones_clase (curso_id, fecha, estado, modalidad, cerrado_por, cerrado_en)
SELECT c.id, d.fecha, 'cerrada', 'presencial',
       '32029678-83d0-4709-b121-626bcb95b201'::uuid, NOW()
FROM cursos c
JOIN modulos_academicos m ON m.id = c.modulo_id
CROSS JOIN LATERAL generate_series(m.fecha_inicio, m.fecha_fin, '1 day'::interval) AS d(fecha)
WHERE EXTRACT(DOW FROM d.fecha) BETWEEN 1 AND 4
ON CONFLICT (curso_id, fecha) DO NOTHING;

-- 2. Deshabilitar trigger de recálculo para inserción masiva
ALTER TABLE asistencias DISABLE TRIGGER trg_asistencias_recalculo;

-- 3. Insertar asistencias con perfil por alumno:
--    matricula_id % 3 = 0 -> 95% presente (regular)
--    matricula_id % 3 = 1 -> 80% presente (en riesgo)
--    matricula_id % 3 = 2 -> 60% presente (irregular)
INSERT INTO asistencias (sesion_id, matricula_id, estado, justificada, registrado_por)
SELECT sc.id, m.id,
       CASE
         WHEN (m.id % 3) = 0 THEN
           CASE WHEN random() < 0.95 THEN 'presente'::estado_asistencia ELSE 'ausente'::estado_asistencia END
         WHEN (m.id % 3) = 1 THEN
           CASE WHEN random() < 0.80 THEN 'presente'::estado_asistencia ELSE 'ausente'::estado_asistencia END
         ELSE
           CASE WHEN random() < 0.60 THEN 'presente'::estado_asistencia ELSE 'ausente'::estado_asistencia END
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