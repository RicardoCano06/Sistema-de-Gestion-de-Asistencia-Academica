-- -----------------------------------------------------------------
-- TABLA DE TOKENS DE REFRESCO
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tokens_refresco (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expiracion TIMESTAMPTZ NOT NULL,
    revocado BOOLEAN NOT NULL DEFAULT FALSE
);
-- =================================================================
-- ESQUEMA BASE - SISTEMA DE ASISTENCIA UNIVERSITARIA
-- PostgreSQL / Supabase
-- =================================================================

-- -----------------------------------------------------------------
-- EXTENSIONES
-- -----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------
-- TIPOS ENUMERADOS
-- -----------------------------------------------------------------
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

-- -----------------------------------------------------------------
-- MODULO 1: USUARIOS, ROLES Y SEGURIDAD
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    telefono VARCHAR(30),
    password_hash VARCHAR(255) NOT NULL,
    estado estado_usuario NOT NULL DEFAULT 'activo',
    permisos_especiales JSONB NOT NULL DEFAULT '{}'::jsonb,
    ultimo_ingreso TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);

CREATE TABLE IF NOT EXISTS usuarios_roles (
    usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    rol_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    asignado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE IF NOT EXISTS docentes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    legajo VARCHAR(50) UNIQUE,
    titulo_academico VARCHAR(150)
);

-- alumnos: único obligatorio numero_documento (homónimos permitidos en nombre_apellido).
CREATE TABLE IF NOT EXISTS alumnos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    numero_documento VARCHAR(30) NOT NULL UNIQUE,
    numero_orden INTEGER,
    nombres VARCHAR(100),
    apellidos VARCHAR(100),
    nombre_apellido VARCHAR(150),
    referencia_carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL,
    semestre_curricular SMALLINT NOT NULL DEFAULT 1 CHECK (semestre_curricular >= 1 AND semestre_curricular <= 10),
    cohorte_anio SMALLINT NULL CHECK (cohorte_anio IS NULL OR (cohorte_anio >= 1990 AND cohorte_anio <= 2100))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumnos_numero_orden
    ON alumnos(numero_orden)
    WHERE numero_orden IS NOT NULL;

CREATE TABLE IF NOT EXISTS auditorias (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID REFERENCES usuarios(id),
    accion VARCHAR(100) NOT NULL,
    tabla_afectada VARCHAR(80) NOT NULL,
    registro_afectado UUID,
    descripcion TEXT,
    origen_ip VARCHAR(45),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditoria_eventos (
    id BIGSERIAL PRIMARY KEY,
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id UUID,
    actor_usuario_id UUID REFERENCES usuarios(id),
    actor_email VARCHAR(150),
    actor_username VARCHAR(80),
    actor_roles TEXT[] NOT NULL DEFAULT '{}',
    modulo VARCHAR(60) NOT NULL,
    accion VARCHAR(80) NOT NULL,
    recurso_tipo VARCHAR(80),
    recurso_id VARCHAR(120),
    recurso_resumen TEXT,
    resultado VARCHAR(10) NOT NULL DEFAULT 'ok',
    severidad VARCHAR(10) NOT NULL DEFAULT 'baja',
    ip VARCHAR(64),
    user_agent TEXT,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    antes JSONB,
    despues JSONB,
    CONSTRAINT auditoria_eventos_resultado_check CHECK (resultado IN ('ok', 'error')),
    CONSTRAINT auditoria_eventos_severidad_check CHECK (severidad IN ('baja', 'media', 'alta'))
);

-- -----------------------------------------------------------------
-- MODULO 2: ESTRUCTURA ACADEMICA
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facultades (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL UNIQUE,
    estado BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carreras (
    id SERIAL PRIMARY KEY,
    facultad_id INTEGER NOT NULL REFERENCES facultades(id) ON DELETE RESTRICT,
    nombre VARCHAR(150) NOT NULL,
    codigo VARCHAR(20) UNIQUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (facultad_id, nombre)
);

-- Alcance operativo (coordinación de facultad / jefatura de carrera). Usado en listado de usuarios y resolverAlcanceMatriculasFacultad.
CREATE TABLE IF NOT EXISTS usuario_scopes (
    scope_id SERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    facultad_id INTEGER REFERENCES facultades(id) ON DELETE SET NULL,
    carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_usuario_scopes_usuario ON usuario_scopes(usuario_id);

CREATE TABLE IF NOT EXISTS planes_estudio (
    id SERIAL PRIMARY KEY,
    carrera_id INTEGER NOT NULL REFERENCES carreras(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    resolucion VARCHAR(100),
    anio_vigencia SMALLINT,
    UNIQUE (carrera_id, nombre)
);

CREATE TABLE IF NOT EXISTS materias (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES planes_estudio(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    codigo VARCHAR(30) NOT NULL,
    semestre SMALLINT NOT NULL DEFAULT 1 CHECK (semestre >= 1 AND semestre <= 10),
    carga_horaria SMALLINT,
    UNIQUE (plan_id, codigo)
);

CREATE TABLE IF NOT EXISTS modulos_academicos (
    id SERIAL PRIMARY KEY,
    materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    anio SMALLINT NOT NULL,
    mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'planificado',
    UNIQUE (materia_id, anio, mes)
);

CREATE TABLE IF NOT EXISTS cursos (
    id SERIAL PRIMARY KEY,
    modulo_id INTEGER NOT NULL REFERENCES modulos_academicos(id) ON DELETE CASCADE,
    docente_id UUID NOT NULL REFERENCES docentes(id) ON DELETE RESTRICT,
    aula VARCHAR(100),
    horario_inicio TIME,
    horario_fin TIME,
    cupo INTEGER,
    notas TEXT
);

-- -----------------------------------------------------------------
-- MODULO 3: SESIONES DE CLASE
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones_clase (
    id SERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    estado estado_sesion NOT NULL DEFAULT 'programada',
    observaciones TEXT,
    cerrado_por UUID REFERENCES usuarios(id),
    cerrado_en TIMESTAMPTZ,
    UNIQUE (curso_id, fecha)
);

-- -----------------------------------------------------------------
-- MODULO 4: MATRICULAS Y ASISTENCIA
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matriculas (
    id SERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    alumno_id UUID NOT NULL REFERENCES alumnos(id) ON DELETE RESTRICT,
    estado_academico estado_matricula NOT NULL DEFAULT 'regular',
    porcentaje_asistencia NUMERIC(5,2) NOT NULL DEFAULT 100.00,
    faltas_acumuladas SMALLINT NOT NULL DEFAULT 0,
    justificaciones_aprobadas SMALLINT NOT NULL DEFAULT 0,
    fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
    orden_lista INTEGER,
    UNIQUE (curso_id, alumno_id)
);

CREATE TABLE IF NOT EXISTS asistencias (
    id BIGSERIAL PRIMARY KEY,
    sesion_id INTEGER NOT NULL REFERENCES sesiones_clase(id) ON DELETE CASCADE,
    matricula_id INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
    estado estado_asistencia NOT NULL,
    justificada BOOLEAN NOT NULL DEFAULT FALSE,
    observaciones TEXT,
    registrado_por UUID NOT NULL REFERENCES usuarios(id),
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sesion_id, matricula_id)
);

CREATE TABLE IF NOT EXISTS justificaciones (
    id BIGSERIAL PRIMARY KEY,
    asistencia_id BIGINT NOT NULL UNIQUE REFERENCES asistencias(id) ON DELETE CASCADE,
    motivo TEXT NOT NULL,
    documento_url TEXT,
    estado_revision VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    revisado_por UUID REFERENCES usuarios(id),
    revisado_en TIMESTAMPTZ,
    comentarios_revision TEXT
);

CREATE TABLE IF NOT EXISTS alertas_asistencia (
    id BIGSERIAL PRIMARY KEY,
    matricula_id INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
    tipo_alerta tipo_alerta_asistencia NOT NULL,
    faltas_acumuladas SMALLINT NOT NULL,
    umbral_porcentaje NUMERIC(5,2) NOT NULL,
    generado_por UUID REFERENCES usuarios(id),
    generado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE IF NOT EXISTS habilitaciones_examen (
    id BIGSERIAL PRIMARY KEY,
    matricula_id INTEGER NOT NULL UNIQUE REFERENCES matriculas(id) ON DELETE CASCADE,
    porcentaje_final NUMERIC(5,2) NOT NULL,
    habilitado BOOLEAN NOT NULL,
    generado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generado_por UUID REFERENCES usuarios(id)
);

-- -----------------------------------------------------------------
-- MODULO 5: IMPORTACION E INTEGRACION
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lotes_importacion (
    id BIGSERIAL PRIMARY KEY,
    tipo_lote VARCHAR(50) NOT NULL, -- alumnos, docentes, matriculas, facultades, carreras, planes
    descripcion TEXT,
    archivo_fuente TEXT,
    destino_facultad VARCHAR(150),
    destino_carrera VARCHAR(150),
    destino_facultad_id INTEGER REFERENCES facultades(id) ON DELETE SET NULL,
    destino_carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL,
    cohorte_anio SMALLINT NULL,
    total_registros INTEGER,
    procesados INTEGER DEFAULT 0,
    errores INTEGER DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    ejecutado_por UUID REFERENCES usuarios(id),
    ejecutado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotente: si la tabla ya existía sin las columnas de destino (migración 20260413).
ALTER TABLE IF EXISTS lotes_importacion
    ADD COLUMN IF NOT EXISTS destino_facultad VARCHAR(150),
    ADD COLUMN IF NOT EXISTS destino_carrera VARCHAR(150),
    ADD COLUMN IF NOT EXISTS destino_facultad_id INTEGER REFERENCES facultades(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS destino_carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS registros_importacion (
    id BIGSERIAL PRIMARY KEY,
    lote_id BIGINT NOT NULL REFERENCES lotes_importacion(id) ON DELETE CASCADE,
    fila INTEGER,
    datos JSONB,
    valido BOOLEAN DEFAULT TRUE,
    mensaje_error TEXT
);

-- -----------------------------------------------------------------
-- MODULO 6: REPORTES Y ACTAS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS actas_generadas (
    id BIGSERIAL PRIMARY KEY,
    curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
    tipo_acta VARCHAR(50) NOT NULL, -- asistencia, habilitados
    url_documento TEXT NOT NULL,
    generado_por UUID REFERENCES usuarios(id),
    generado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parametros JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS estadisticas_ausentismo (
    id BIGSERIAL PRIMARY KEY,
    curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    periodo VARCHAR(20) NOT NULL,
    total_sesiones SMALLINT NOT NULL,
    total_faltas INTEGER NOT NULL,
    porcentaje_ausentismo NUMERIC(5,2) NOT NULL,
    calculado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, periodo)
);

-- -----------------------------------------------------------------
-- INDICES DE APOYO
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_matriculas_curso ON matriculas(curso_id);
CREATE INDEX IF NOT EXISTS idx_matriculas_curso_orden ON matriculas(curso_id, orden_lista);
CREATE INDEX IF NOT EXISTS idx_matriculas_alumno ON matriculas(alumno_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_sesion ON asistencias(sesion_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_matricula ON asistencias(matricula_id);
CREATE INDEX IF NOT EXISTS idx_alertas_matricula ON alertas_asistencia(matricula_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_curso_fecha ON sesiones_clase(curso_id, fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_fecha_hora ON auditoria_eventos(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_actor_usuario_id ON auditoria_eventos(actor_usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_modulo_accion ON auditoria_eventos(modulo, accion);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_resultado ON auditoria_eventos(resultado);

-- -----------------------------------------------------------------
-- DISPARADOR PARA actualizado_en EN usuarios
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_timestamp_usuario()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usuarios_actualizado ON usuarios;
CREATE TRIGGER trg_usuarios_actualizado
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp_usuario();

-- -----------------------------------------------------------------
-- FUNCIONES DE NEGOCIO PARA ASISTENCIAS
-- -----------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION trg_asistencias_recalculo()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalcular_metricas_asistencia(OLD.matricula_id);
    ELSE
        PERFORM recalcular_metricas_asistencia(NEW.matricula_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asistencias_recalculo ON asistencias;
CREATE TRIGGER trg_asistencias_recalculo
AFTER INSERT OR UPDATE OR DELETE ON asistencias
FOR EACH ROW
EXECUTE FUNCTION trg_asistencias_recalculo();

-- -----------------------------------------------------------------
-- VISTAS DE CONSULTA Y REPORTES
-- -----------------------------------------------------------------
-- vw_planilla_asistencia
-- Nota: el JOIN legacy "usuarios u_al ON u_al.id = al.id" fue eliminado en la
-- migracion 20260309_align_schema_idempotente.sql porque alumnos no comparte
-- id con usuarios en el modelo operativo. Se usa al.nombres/al.apellidos.
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

CREATE OR REPLACE VIEW vw_resumen_asistencia_curso AS
SELECT
    c.id AS curso_id,
    m.nombre AS materia,
    m.semestre AS semestre,
    mo.anio,
    mo.mes,
    COUNT(mat.id) AS total_matriculas,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'regular') AS alumnos_regulares,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'en_riesgo') AS alumnos_riesgo,
    COUNT(*) FILTER (WHERE mat.estado_academico = 'irregular') AS alumnos_irregulares,
    ROUND(AVG(mat.porcentaje_asistencia)::NUMERIC, 2) AS promedio_asistencia,
    SUM(mat.faltas_acumuladas) AS faltas_totales
FROM cursos c
JOIN modulos_academicos mo ON mo.id = c.modulo_id
JOIN materias m ON m.id = mo.materia_id
JOIN matriculas mat ON mat.curso_id = c.id
GROUP BY c.id, m.nombre, m.semestre, mo.anio, mo.mes;

-- vw_habilitados_examen: ver nota en vw_planilla_asistencia.
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


