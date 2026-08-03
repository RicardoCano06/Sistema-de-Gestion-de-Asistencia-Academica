-- Texto legible persistido por el backend (nombre de facultad/carrera, semestres, cantidad, etc.)
ALTER TABLE auditoria_eventos
    ADD COLUMN IF NOT EXISTS recurso_resumen TEXT;

COMMENT ON COLUMN auditoria_eventos.recurso_resumen IS
    'Descripción corta humana del recurso; prioridad sobre resoluciones por tabla al listar auditoría';
