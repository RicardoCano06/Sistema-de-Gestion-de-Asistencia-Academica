-- Elimina lotes pendientes sin filas (cargas fallidas que quedaron en el historial).
DELETE FROM lotes_importacion l
WHERE LOWER(TRIM(l.estado)) = 'pendiente'
  AND NOT EXISTS (
      SELECT 1 FROM registros_importacion r WHERE r.lote_id = l.id
  );
