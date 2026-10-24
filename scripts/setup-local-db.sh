#!/bin/sh
# Levanta la base de datos local y restaura tesis_backup.dump si existe.
docker compose up -d postgres
echo "Esperando a que PostgreSQL este listo..."
until docker compose exec -T postgres pg_isready -U postgres -d postgres; do
  sleep 2
done
echo "Base de datos local lista."