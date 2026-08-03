-- Ejecutar ANTES de 20260529_vw_resumen_asistencia_semestre.sql en producción (Supabase SQL Editor).
-- Si devuelve filas, hay objetos que dependen de la vista; evaluar DROP ... CASCADE y recrear dependientes.
-- Ejecutar ambos scripts en ventana de tráfico cero: DROP VIEW requiere AccessExclusiveLock y puede
-- bloquear lecturas concurrentes hasta completarse.

SELECT
    n.nspname AS esquema_dependiente,
    c.relname AS objeto_dependiente,
    c.relkind AS tipo
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class c ON c.oid = r.ev_class
JOIN pg_class ref ON ref.oid = d.refobjid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ref.relname = 'vw_resumen_asistencia_curso'
  AND c.relname <> 'vw_resumen_asistencia_curso'
ORDER BY esquema_dependiente, objeto_dependiente;
