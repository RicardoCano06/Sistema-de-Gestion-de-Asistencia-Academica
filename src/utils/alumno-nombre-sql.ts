/**
 * Fragmento SQL para JOIN `alumnos al`: muestra "Apellidos, Nombres" con coma
 * cuando hay datos en columnas separadas; si no, usa `nombre_apellido` (importaciones).
 */
export const SQL_ALUMNO_APELLIDOS_COMA_NOMBRES =
    "CASE WHEN COALESCE(TRIM(al.apellidos), '') <> '' OR COALESCE(TRIM(al.nombres), '') <> '' THEN TRIM(CONCAT(COALESCE(TRIM(al.apellidos), ''), ', ', COALESCE(TRIM(al.nombres), ''))) ELSE NULLIF(TRIM(al.nombre_apellido), '') END";

/** Orden de filas en planilla: importación primero; legacy sin orden → apellido. Requiere alias `mat` y `al`. */
export const SQL_ORDEN_MATRICULA_PLANILLA =
    'mat.orden_lista NULLS LAST, al.apellidos NULLS LAST, al.nombres NULLS LAST, al.nombre_apellido NULLS LAST, mat.id';
