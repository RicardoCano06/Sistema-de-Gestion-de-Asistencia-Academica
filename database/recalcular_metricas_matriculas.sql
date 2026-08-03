-- Mantenimiento: alinea matriculas.porcentaje_asistencia (y faltas / estado / habilitación)
-- con recalcular_metricas_asistencia (período lun–jue del módulo + extras; solo sesiones cerradas).
-- Aplicar antes: database/20260520_asistencia_acumulativa_periodo.sql
--
-- Caso de uso: justificaciones aprobadas que ya figuran en la planilla pero el % en
-- matriculas quedó desactualizado porque el backend pisaba el valor con un cálculo
-- que no contaba justificadas.
--
-- Ejecutar en el SQL editor de Supabase (o psql) tras desplegar el backend corregido.

-- Una sola matrícula (sustituir el id):
-- SELECT recalcular_metricas_asistencia(12345);

-- Todas las matrículas que tienen al menos un registro en asistencias (recomendado):
DO $$
DECLARE
  mid INTEGER;
BEGIN
  FOR mid IN SELECT DISTINCT matricula_id FROM asistencias ORDER BY matricula_id
  LOOP
    PERFORM recalcular_metricas_asistencia(mid);
  END LOOP;
END $$;

-- Opcional: también matrículas sin filas en asistencias (fuerza 100 % / cero faltas según función):
-- DO $$
-- DECLARE mid INTEGER;
-- BEGIN
--   FOR mid IN SELECT id FROM matriculas ORDER BY 1
--   LOOP
--     PERFORM recalcular_metricas_asistencia(mid);
--   END LOOP;
-- END $$;
