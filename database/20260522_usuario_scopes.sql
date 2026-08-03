-- Alcance por usuario (facultad / carrera). Requerido por listarUsuarios (subconsulta scopes en usuarios.service).
-- Idempotente: seguro ejecutar más de una vez.

CREATE TABLE IF NOT EXISTS usuario_scopes (
    scope_id SERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    facultad_id INTEGER REFERENCES facultades(id) ON DELETE SET NULL,
    carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_usuario_scopes_usuario ON usuario_scopes(usuario_id);
