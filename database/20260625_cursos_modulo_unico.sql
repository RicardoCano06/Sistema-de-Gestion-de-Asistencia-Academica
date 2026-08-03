-- Cada modulo academico solo puede tener un curso asignado
ALTER TABLE cursos ADD CONSTRAINT uq_cursos_modulo_id UNIQUE (modulo_id);
