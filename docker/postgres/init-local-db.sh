#!/bin/sh
DB="${POSTGRES_DB:-postgres}"
USER="${POSTGRES_USER:-postgres}"
DUMP="/backup/tesis_backup.dump"

if [ ! -f "$DUMP" ]; then
  echo "No se encontro $DUMP. Se inicializa la base de datos vacia."
  exit 0
fi

echo "Restaurando backup desde $DUMP..."
# Supabase instala extensiones (uuid-ossp) en el schema 'extensions'.
psql -v ON_ERROR_STOP=0 -U "$USER" -d "$DB" -c 'CREATE SCHEMA IF NOT EXISTS extensions;' || true
psql -v ON_ERROR_STOP=0 -U "$USER" -d "$DB" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;' || true
psql -v ON_ERROR_STOP=0 -U "$USER" -d "$DB" -c "ALTER DATABASE $DB SET search_path TO public, extensions;" || true

pg_restore --no-owner --no-privileges --dbname="$DB" "$DUMP" || true

if [ -f /scripts/rewrite-urls.sql ]; then
  echo "Reescribiendo URLs de Storage para modo local..."
  psql -v ON_ERROR_STOP=0 -U "$USER" -d "$DB" -f /scripts/rewrite-urls.sql || true
fi

echo "Restauracion finalizada."