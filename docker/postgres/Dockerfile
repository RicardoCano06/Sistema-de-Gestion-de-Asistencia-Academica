FROM postgres:17-alpine
COPY init-local-db.sh /docker-entrypoint-initdb.d/01-restore.sh
COPY rewrite-urls.sql /scripts/rewrite-urls.sql
RUN chmod +x /docker-entrypoint-initdb.d/01-restore.sh