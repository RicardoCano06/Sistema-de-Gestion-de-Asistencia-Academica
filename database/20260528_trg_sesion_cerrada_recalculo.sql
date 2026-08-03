-- Al cerrar una jornada, recalcular % de todas las matrículas del curso.
-- Complementa el backend (recalc post-commit); cubre cierres vía SQL u otros clientes.
-- Requiere: recalcular_metricas_asistencia (20260520 / 20260521).

CREATE OR REPLACE FUNCTION trg_sesion_cerrada_recalculo()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND LOWER(COALESCE(NEW.estado::text, '')) = 'cerrada'
       AND LOWER(COALESCE(OLD.estado::text, '')) <> 'cerrada'
    THEN
        PERFORM recalcular_metricas_asistencia(m.id)
        FROM matriculas m
        WHERE m.curso_id = NEW.curso_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sesion_cerrada_recalculo ON sesiones_clase;
CREATE TRIGGER trg_sesion_cerrada_recalculo
    AFTER UPDATE OF estado ON sesiones_clase
    FOR EACH ROW
    EXECUTE FUNCTION trg_sesion_cerrada_recalculo();
