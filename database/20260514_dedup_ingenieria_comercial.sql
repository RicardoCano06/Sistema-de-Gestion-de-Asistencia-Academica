-- Elimina la carrera duplicada "Ingenieria Comercial" (sin tilde) que coexiste con
-- "Ingeniería Comercial" (con tilde) dentro de la misma facultad.
-- Estrategia: conservar la de menor id (más antigua / con más datos asociados) y
-- reasignar todas las FK de la descartada a la conservada, luego borrar la descartada.

DO $$
DECLARE
    v_mantener  INTEGER;
    v_borrar    INTEGER;
BEGIN
    -- Identificar las dos carreras buscando ambas variantes por nombre exacto
    SELECT MIN(id), MAX(id)
    INTO v_mantener, v_borrar
    FROM carreras
    WHERE lower(trim(nombre)) IN ('ingenieria comercial', 'ingeniería comercial');

    -- Si no existen dos registros distintos no hay nada que hacer
    IF v_mantener IS NULL OR v_mantener = v_borrar THEN
        RAISE NOTICE 'No se encontró duplicado de Ingeniería Comercial. Nada que hacer.';
        RETURN;
    END IF;

    RAISE NOTICE 'Conservando carrera id=%, descartando id=%', v_mantener, v_borrar;

    -- Reasignar referencias antes de borrar
    UPDATE alumnos           SET referencia_carrera_id = v_mantener WHERE referencia_carrera_id = v_borrar;
    UPDATE usuario_scopes    SET carrera_id            = v_mantener WHERE carrera_id            = v_borrar;
    UPDATE lotes_importacion SET destino_carrera_id    = v_mantener WHERE destino_carrera_id    = v_borrar;

    -- planes_estudio tiene ON DELETE CASCADE desde carrera_id;
    -- reasignar antes de borrar para no perder datos.
    UPDATE planes_estudio SET carrera_id = v_mantener WHERE carrera_id = v_borrar;

    -- Borrar la carrera duplicada (las FK restantes son ON DELETE CASCADE / SET NULL)
    DELETE FROM carreras WHERE id = v_borrar;

    RAISE NOTICE 'Duplicado eliminado correctamente.';
END;
$$;
