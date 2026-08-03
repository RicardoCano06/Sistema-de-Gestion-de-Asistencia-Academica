-- Métricas de asistencia: estado irregular / habilitación solo por porcentaje.
-- Elimina la creación automática de alertas_asistencia al cruzar 2, 3 o 4 faltas.
-- Aplicar en Supabase SQL Editor o psql después de desplegar backend con reportes solo % < 75.
--
-- Requiere: database/20260520_asistencia_acumulativa_periodo.sql (o schema.sql equivalente).

CREATE OR REPLACE FUNCTION recalcular_metricas_asistencia(p_matricula_id INTEGER)
RETURNS VOID AS $$
DECLARE
    v_curso_id INTEGER;
    v_total_planificado INTEGER := 0;
    v_sesiones_cerradas INTEGER := 0;
    v_min_cerradas_evaluar INTEGER := 0;
    v_presentes INTEGER := 0;
    v_justificadas INTEGER := 0;
    v_faltas INTEGER := 0;
    v_porcentaje NUMERIC(5,2) := 100.00;
    v_estado estado_matricula := 'regular';
BEGIN
    IF p_matricula_id IS NULL THEN
        RETURN;
    END IF;

    SELECT mat.curso_id
    INTO v_curso_id
    FROM matriculas mat
    WHERE mat.id = p_matricula_id;

    IF v_curso_id IS NULL THEN
        RETURN;
    END IF;

    v_total_planificado := total_clases_planificadas_curso(v_curso_id);

    SELECT COUNT(*)
    INTO v_sesiones_cerradas
    FROM sesiones_clase sc
    WHERE sc.curso_id = v_curso_id
      AND LOWER(sc.estado::text) = 'cerrada';

    IF v_total_planificado > 0 THEN
        v_min_cerradas_evaluar := CEIL(v_total_planificado::NUMERIC * 0.75)::INTEGER;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE a.estado = 'presente'),
        COUNT(*) FILTER (WHERE a.estado = 'justificada' OR COALESCE(a.justificada, FALSE) = TRUE),
        COUNT(*) FILTER (
            WHERE NOT (
                a.estado = 'presente'
                OR a.estado = 'justificada'
                OR COALESCE(a.justificada, FALSE) = TRUE
            )
        )
    INTO v_presentes, v_justificadas, v_faltas
    FROM sesiones_clase sc
    LEFT JOIN asistencias a
        ON a.sesion_id = sc.id AND a.matricula_id = p_matricula_id
    WHERE sc.curso_id = v_curso_id
      AND LOWER(sc.estado::text) = 'cerrada';

    IF v_total_planificado > 0 THEN
        v_porcentaje := ROUND(
            ((v_presentes + v_justificadas)::NUMERIC / v_total_planificado::NUMERIC) * 100,
            2
        );
    ELSE
        v_porcentaje := 100.00;
        v_faltas := 0;
        v_justificadas := 0;
    END IF;

    v_estado := CASE
        WHEN v_min_cerradas_evaluar > 0 AND v_sesiones_cerradas < v_min_cerradas_evaluar THEN 'regular'
        WHEN v_porcentaje < 75 THEN 'irregular'
        WHEN v_porcentaje < 80 THEN 'en_riesgo'
        ELSE 'regular'
    END;

    UPDATE matriculas
    SET porcentaje_asistencia = v_porcentaje,
        faltas_acumuladas = v_faltas,
        justificaciones_aprobadas = v_justificadas,
        estado_academico = v_estado
    WHERE id = p_matricula_id;

    IF v_total_planificado > 0 THEN
        INSERT INTO habilitaciones_examen (matricula_id, porcentaje_final, habilitado)
        VALUES (p_matricula_id, v_porcentaje, (v_porcentaje >= 75 AND v_estado <> 'irregular'))
        ON CONFLICT (matricula_id)
        DO UPDATE SET porcentaje_final = EXCLUDED.porcentaje_final,
                      habilitado = EXCLUDED.habilitado,
                      generado_en = NOW();
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Opcional: recalcular todas las matrículas con asistencias registradas
-- DO $$
-- DECLARE mid INTEGER;
-- BEGIN
--   FOR mid IN SELECT DISTINCT matricula_id FROM asistencias ORDER BY matricula_id
--   LOOP
--     PERFORM recalcular_metricas_asistencia(mid);
--   END LOOP;
-- END $$;
