-- Backfill: asigna referencia_carrera_id desde el último lote completado de tipo "alumnos"
-- por cada CI presente en registros_importacion válidos (corrige datos previos a la sincronización en código).
WITH docs AS (
    SELECT
        ri.lote_id,
        TRIM(BOTH FROM NULLIF(
            COALESCE(
                ri.datos->>'numero_documento',
                ri.datos->>'ci',
                ri.datos->>'CI',
                ri.datos->>'cedula',
                ri.datos->>'Cedula',
                ri.datos->>'cedula de identidad civil',
                ri.datos->>'Cédula de identidad civil',
                ri.datos->>'cedula_identidad_civil',
                ri.datos->>'documento',
                ri.datos->>'num_documento',
                ri.datos->>'num doc',
                ri.datos->>'numero_doc',
                ri.datos->>'documento_numero',
                ri.datos->>'numero_c'
            ),
            ''
        )) AS doc
    FROM registros_importacion ri
    WHERE ri.valido = TRUE
),
picked AS (
    SELECT DISTINCT ON (d.doc)
        d.doc,
        li.destino_carrera_id
    FROM docs d
    INNER JOIN lotes_importacion li ON li.id = d.lote_id
        AND li.tipo_lote = 'alumnos'
        AND li.estado = 'completado'
        AND li.destino_carrera_id IS NOT NULL
    WHERE d.doc IS NOT NULL AND d.doc <> ''
    ORDER BY d.doc, li.id DESC
)
UPDATE alumnos al
SET referencia_carrera_id = picked.destino_carrera_id
FROM picked
WHERE TRIM(al.numero_documento) = picked.doc
  AND picked.destino_carrera_id IS NOT NULL;
