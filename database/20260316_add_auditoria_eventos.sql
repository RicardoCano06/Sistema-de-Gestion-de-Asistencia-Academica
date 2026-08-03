-- =================================================================
-- MIGRACION AUDITORIA EVENTOS
-- Fecha: 2026-03-16
-- Objetivo: estructura robusta para trazabilidad operativa
-- =================================================================

BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_fecha_hora ON auditoria_eventos(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_actor_usuario_id ON auditoria_eventos(actor_usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_modulo_accion ON auditoria_eventos(modulo, accion);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_resultado ON auditoria_eventos(resultado);

COMMIT;
