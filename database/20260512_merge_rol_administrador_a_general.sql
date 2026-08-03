-- Unifica el rol legado «Administrador» en «Administrador General».
-- Ejecutar una vez por base. Idempotente si ya no existe «Administrador».
--
-- Tras esto, el código solo considera «Administrador General» como administración global.

DO $$
DECLARE
  rid_legacy int;
  rid_ag int;
BEGIN
  SELECT id INTO rid_legacy FROM roles WHERE nombre = 'Administrador' LIMIT 1;
  SELECT id INTO rid_ag FROM roles WHERE nombre = 'Administrador General' LIMIT 1;

  IF rid_legacy IS NULL THEN
    RAISE NOTICE 'No existe rol «Administrador»; migración omitida.';
    RETURN;
  END IF;

  IF rid_ag IS NULL THEN
    RAISE EXCEPTION 'Falta el rol «Administrador General» en la tabla roles. Crearlo antes de migrar.';
  END IF;

  INSERT INTO usuarios_roles (usuario_id, rol_id)
  SELECT ur.usuario_id, rid_ag
  FROM usuarios_roles ur
  WHERE ur.rol_id = rid_legacy
    AND NOT EXISTS (
      SELECT 1 FROM usuarios_roles x
      WHERE x.usuario_id = ur.usuario_id AND x.rol_id = rid_ag
    );

  DELETE FROM usuarios_roles WHERE rol_id = rid_legacy;

  DELETE FROM roles WHERE id = rid_legacy;

  RAISE NOTICE 'OK: usuarios migrados a «Administrador General» y rol «Administrador» eliminado.';
END $$;
