-- Homónimos: nombre_apellido puede repetirse. Identidad del alumno = numero_documento (UNIQUE en tabla).
-- Idempotente: quita UNIQUE sobre nombre_apellido (constraint o nombre típico de índice).

ALTER TABLE IF EXISTS alumnos DROP CONSTRAINT IF EXISTS alumnos_nombre_apellido_key;

DROP INDEX IF EXISTS alumnos_nombre_apellido_key;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'alumnos'
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) LIKE '%nombre_apellido%'
    LOOP
        EXECUTE format('ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END $$;
