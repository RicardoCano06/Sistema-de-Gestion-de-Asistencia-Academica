ALTER TABLE lotes_importacion
    ADD COLUMN IF NOT EXISTS destino_facultad VARCHAR(150),
    ADD COLUMN IF NOT EXISTS destino_carrera VARCHAR(150),
    ADD COLUMN IF NOT EXISTS destino_facultad_id INTEGER REFERENCES facultades(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS destino_carrera_id INTEGER REFERENCES carreras(id) ON DELETE SET NULL;
