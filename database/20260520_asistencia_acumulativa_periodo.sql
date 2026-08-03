-- Asistencia acumulativa: % = (presentes + justificadas en sesiones cerradas) / días lectivos del módulo (+ extras).
-- Lun–Jue entre fecha_inicio y fecha_fin; extras = sesiones en fechas fuera de lun–jue dentro del período.

CREATE OR REPLACE FUNCTION contar_dias_lectivos_modulo(p_fecha_inicio DATE, p_fecha_fin DATE)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_d DATE;
BEGIN
    IF p_fecha_inicio IS NULL OR p_fecha_fin IS NULL OR p_fecha_fin < p_fecha_inicio THEN
        RETURN 0;
    END IF;

    v_d := p_fecha_inicio;
    WHILE v_d <= p_fecha_fin LOOP
        IF EXTRACT(DOW FROM v_d) BETWEEN 1 AND 4 THEN
            v_count := v_count + 1;
        END IF;
        v_d := v_d + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION contar_dias_extra_sesiones_curso(p_curso_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_extra INTEGER := 0;
BEGIN
    SELECT COUNT(DISTINCT sc.fecha::date)
    INTO v_extra
    FROM sesiones_clase sc
    JOIN cursos c ON c.id = sc.curso_id
    JOIN modulos_academicos ma ON ma.id = c.modulo_id
    WHERE sc.curso_id = p_curso_id
      AND sc.fecha::date BETWEEN ma.fecha_inicio::date AND ma.fecha_fin::date
      AND EXTRACT(DOW FROM sc.fecha) NOT BETWEEN 1 AND 4;

    RETURN COALESCE(v_extra, 0);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION total_clases_planificadas_curso(p_curso_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_inicio DATE;
    v_fin DATE;
    v_base INTEGER;
    v_extra INTEGER;
BEGIN
    SELECT ma.fecha_inicio::date, ma.fecha_fin::date
    INTO v_inicio, v_fin
    FROM cursos c
    JOIN modulos_academicos ma ON ma.id = c.modulo_id
    WHERE c.id = p_curso_id;

    v_base := contar_dias_lectivos_modulo(v_inicio, v_fin);
    v_extra := contar_dias_extra_sesiones_curso(p_curso_id);
    RETURN COALESCE(v_base, 0) + COALESCE(v_extra, 0);
END;
$$ LANGUAGE plpgsql STABLE;

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
