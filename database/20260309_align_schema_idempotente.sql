-- =================================================================
-- MIGRACION IDPOTENTE DE ALINEACION DE ESQUEMA
-- Fecha: 2026-03-09
-- Objetivo: alinear esquema Supabase con backend actual (Node/React)
-- =================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------------
-- 1) Tipos enumerados (seguros)
-- -------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_usuario') THEN
        CREATE TYPE estado_usuario AS ENUM ('activo', 'inactivo', 'suspendido');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_matricula') THEN
        CREATE TYPE estado_matricula AS ENUM ('regular', 'en_riesgo', 'irregular');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_sesion') THEN
        CREATE TYPE estado_sesion AS ENUM ('programada', 'abierta', 'cerrada', 'cancelada');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_asistencia') THEN
        CREATE TYPE estado_asistencia AS ENUM ('presente', 'ausente', 'justificada');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_alerta_asistencia') THEN
        CREATE TYPE tipo_alerta_asistencia AS ENUM ('preventiva', 'riesgo', 'critica');
    END IF;
END
$$;

-- -------------------------------------------------------------
-- 2) Usuarios: normalizar username/permisos
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS usuarios
    ADD COLUMN IF NOT EXISTS username VARCHAR(50);

ALTER TABLE IF EXISTS usuarios
    ADD COLUMN IF NOT EXISTS permisos_especiales JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Si existe columna legacy "usuario", usarla para completar username.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'
          AND column_name = 'usuario'
    ) THEN
        EXECUTE $sql$
            UPDATE usuarios
            SET username = COALESCE(NULLIF(TRIM(username), ''), NULLIF(TRIM(usuario), ''))
            WHERE (username IS NULL OR TRIM(username) = '')
              AND (usuario IS NOT NULL AND TRIM(usuario) <> '')
        $sql$;
    END IF;
END
$$;

-- Completar username faltante a partir del email (si aplica).
UPDATE usuarios
SET username = LOWER(TRIM(SPLIT_PART(email, '@', 1)))
WHERE (username IS NULL OR TRIM(username) = '')
  AND email IS NOT NULL;

-- Enforce NOT NULL solo si no quedan nulos.
DO $$
DECLARE
    v_nulls INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_nulls FROM usuarios WHERE username IS NULL OR TRIM(username) = '';
    IF v_nulls = 0 THEN
        ALTER TABLE usuarios ALTER COLUMN username SET NOT NULL;
    END IF;
END
$$;

-- Crear unique de username solo si no hay duplicados.
DO $$
DECLARE
    v_dups INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_dups
    FROM (
        SELECT username
        FROM usuarios
        WHERE username IS NOT NULL AND TRIM(username) <> ''
        GROUP BY username
        HAVING COUNT(*) > 1
    ) t;

    IF v_dups = 0 THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'usuarios'
              AND constraint_name = 'usuarios_username_key'
              AND constraint_type = 'UNIQUE'
        ) THEN
            ALTER TABLE usuarios ADD CONSTRAINT usuarios_username_key UNIQUE (username);
        END IF;
    ELSE
        RAISE NOTICE 'No se crea UNIQUE(usuarios.username): existen duplicados';
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);

-- -------------------------------------------------------------
-- 3) Alumnos: alinear columnas esperadas por backend/reportes
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS alumnos
    ADD COLUMN IF NOT EXISTS numero_orden INTEGER,
    ADD COLUMN IF NOT EXISTS nombres VARCHAR(100),
    ADD COLUMN IF NOT EXISTS apellidos VARCHAR(100);

-- Backfill desde nombre_apellido (si existe) cuando falten nombres/apellidos.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'alumnos'
          AND column_name = 'nombre_apellido'
    ) THEN
        EXECUTE $sql$
            UPDATE alumnos
            SET
                nombres = COALESCE(NULLIF(TRIM(nombres), ''),
                                   NULLIF(TRIM(SPLIT_PART(nombre_apellido, ' ', 1)), '')),
                apellidos = COALESCE(NULLIF(TRIM(apellidos), ''),
                                     NULLIF(TRIM(SUBSTRING(nombre_apellido FROM POSITION(' ' IN nombre_apellido) + 1)), ''))
            WHERE (nombres IS NULL OR TRIM(nombres) = '')
               OR (apellidos IS NULL OR TRIM(apellidos) = '')
        $sql$;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumnos_numero_orden
    ON alumnos(numero_orden)
    WHERE numero_orden IS NOT NULL;

-- -------------------------------------------------------------
-- 4) Materias: columna usada por scripts de smoke
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS materias
    ADD COLUMN IF NOT EXISTS carga_horaria SMALLINT;

-- Materias: semestre curricular dentro del plan (1..10); ver también database/20260512_materias_semestre.sql
ALTER TABLE IF EXISTS materias
    ADD COLUMN IF NOT EXISTS semestre SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF to_regclass('public.materias') IS NOT NULL THEN
        UPDATE materias SET semestre = 1 WHERE semestre IS NULL;
        ALTER TABLE materias DROP CONSTRAINT IF EXISTS materias_semestre_check;
        ALTER TABLE materias ADD CONSTRAINT materias_semestre_check CHECK (semestre >= 1 AND semestre <= 10);
        COMMENT ON COLUMN materias.semestre IS 'Orden curricular: 1 = primer semestre del plan, etc.';
    END IF;
END
$$;

-- -------------------------------------------------------------
-- 4.1) Cursos: columnas usadas por backend académico
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS cursos
    ADD COLUMN IF NOT EXISTS aula VARCHAR(100),
    ADD COLUMN IF NOT EXISTS horario_inicio TIME,
    ADD COLUMN IF NOT EXISTS horario_fin TIME,
    ADD COLUMN IF NOT EXISTS cupo INTEGER;

-- -------------------------------------------------------------
-- 5) Tokens de refresco: asegurar estructura base
-- -------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.usuarios') IS NOT NULL THEN
        EXECUTE $sql$
            CREATE TABLE IF NOT EXISTS tokens_refresco (
                id BIGSERIAL PRIMARY KEY,
                usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                token TEXT NOT NULL UNIQUE,
                creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expiracion TIMESTAMPTZ NOT NULL,
                revocado BOOLEAN NOT NULL DEFAULT FALSE
            )
        $sql$;
    END IF;
END
$$;

-- -------------------------------------------------------------
-- 6) Vistas corregidas para no depender de JOIN alumnos -> usuarios
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW vw_planilla_asistencia AS
SELECT
    sc.id AS sesion_id,
    sc.fecha,
    sc.estado AS estado_sesion,
    c.id AS curso_id,
    m.nombre AS materia,
    mo.anio,
    mo.mes,
    CONCAT(u_doc.nombres, ' ', u_doc.apellidos) AS docente,
    mat.id AS matricula_id,
    CONCAT(COALESCE(al.nombres, ''), ' ', COALESCE(al.apellidos, '')) AS alumno,
    al.numero_documento,
    mat.estado_academico,
    mat.porcentaje_asistencia,
    COALESCE(a.estado, 'ausente'::estado_asistencia) AS estado_asistencia,
    COALESCE(a.justificada, FALSE) AS asistencia_justificada,
    a.observaciones
FROM sesiones_clase sc
JOIN cursos c ON c.id = sc.curso_id
JOIN modulos_academicos mo ON mo.id = c.modulo_id
JOIN materias m ON m.id = mo.materia_id
JOIN docentes d ON d.id = c.docente_id
JOIN usuarios u_doc ON u_doc.id = d.usuario_id
JOIN matriculas mat ON mat.curso_id = c.id
JOIN alumnos al ON al.id = mat.alumno_id
LEFT JOIN asistencias a ON a.sesion_id = sc.id AND a.matricula_id = mat.id;

CREATE OR REPLACE VIEW vw_habilitados_examen AS
SELECT
    he.id AS habilitacion_id,
    c.id AS curso_id,
    m.nombre AS materia,
    mo.anio,
    mo.mes,
    mat.id AS matricula_id,
    CONCAT(COALESCE(al.nombres, ''), ' ', COALESCE(al.apellidos, '')) AS alumno,
    al.numero_documento,
    he.porcentaje_final,
    he.habilitado,
    he.generado_en
FROM habilitaciones_examen he
JOIN matriculas mat ON mat.id = he.matricula_id
JOIN cursos c ON c.id = mat.curso_id
JOIN modulos_academicos mo ON mo.id = c.modulo_id
JOIN materias m ON m.id = mo.materia_id
JOIN alumnos al ON al.id = mat.alumno_id;

COMMIT;
