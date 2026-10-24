-- Reescribe URLs absolutas de Supabase Storage a URLs locales del backend.
UPDATE justificaciones
SET documento_url = 'http://localhost:4000/uploads/justificativos/' ||
    regexp_replace(documento_url, '.*/justificativos/', '')
WHERE documento_url IS NOT NULL
  AND documento_url ILIKE '%/justificativos/%';

-- Verificacion
SELECT COUNT(*) AS urls_supabase_restantes
FROM justificaciones
WHERE documento_url ILIKE '%supabase.co%';