-- Corrige total_registros inflados (p. ej. 25 filas Excel guardadas como 50 por sumar al crear y al cargar).
UPDATE lotes_importacion l
SET total_registros = COALESCE(stats.cnt, 0)
FROM (
    SELECT lote_id, COUNT(*)::int AS cnt
    FROM registros_importacion
    GROUP BY lote_id
) stats
WHERE l.id = stats.lote_id;

UPDATE lotes_importacion l
SET total_registros = 0
WHERE NOT EXISTS (
    SELECT 1 FROM registros_importacion r WHERE r.lote_id = l.id
);
