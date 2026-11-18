#!/usr/bin/env bash
# Prova di ripristino di PostgreSQL, ripetibile e non distruttiva.
#
# Fa un backup del database indicato, lo ripristina in un container temporaneo e verifica che i
# dati ci siano: schemi dei tenant, changelog di Liquibase e un conteggio di righe confrontato con
# l'origine. Stampa i tempi di backup e di ripristino, che sono la misura da riportare come RPO e
# RTO nel runbook operativo.
#
# L'origine non viene mai modificata: il ripristino avviene in un container usa e getta.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=taurus PGPASSWORD=... PGDATABASE=taurus \
#     scripts/ops/restore-test.sh
#
# Valori predefiniti: quelli del docker compose di sviluppo (taurus-be/src/main/docker).
set -euo pipefail

# host.docker.internal raggiunge il database dell'host sia su Docker Desktop sia su Linux,
# dove ci pensa --add-host piu' sotto.
PGHOST="${PGHOST:-host.docker.internal}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-taurus}"
PGPASSWORD="${PGPASSWORD:-password}"
PGDATABASE="${PGDATABASE:-taurus}"
IMAGE="${POSTGRES_IMAGE:-postgres:18.7}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
DUMP="$WORK_DIR/taurus-$(date -u +%Y%m%dT%H%M%SZ).dump"
CONTAINER="taurus-restore-test-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_source() {
  docker run --rm -e PGPASSWORD="$PGPASSWORD" --add-host=host.docker.internal:host-gateway -v "$WORK_DIR:/work" "$IMAGE" "$@"
}

echo "== Backup di $PGDATABASE da $PGHOST:$PGPORT"
backup_start=$(date +%s)
run_source pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "/work/$(basename "$DUMP")"
backup_end=$(date +%s)
size=$(du -h "$DUMP" | cut -f1)
echo "   backup completato in $((backup_end - backup_start))s, dimensione $size"

echo "== Conteggi all'origine"
source_schemas=$(run_source psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -At -c \
  "select count(*) from information_schema.schemata where schema_name not in ('pg_catalog','information_schema','public') and schema_name not like 'pg_%'")
source_changelog=$(run_source psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -At -c \
  "select count(*) from databasechangelog")
echo "   schemi tenant: $source_schemas, migrazioni applicate: $source_changelog"

echo "== Ripristino in un container temporaneo"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB="$PGDATABASE" \
  -e POSTGRES_USER="$PGUSER" -v "$WORK_DIR:/work" "$IMAGE" >/dev/null
for attempt in $(seq 60); do
  docker exec "$CONTAINER" pg_isready -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1 && break
  sleep 1
done

restore_start=$(date +%s)
docker exec -e PGPASSWORD=restore-test "$CONTAINER" \
  pg_restore -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-privileges "/work/$(basename "$DUMP")"
restore_end=$(date +%s)
echo "   ripristino completato in $((restore_end - restore_start))s"

echo "== Verifiche sul ripristino"
restored_schemas=$(docker exec -e PGPASSWORD=restore-test "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -At -c \
  "select count(*) from information_schema.schemata where schema_name not in ('pg_catalog','information_schema','public') and schema_name not like 'pg_%'")
restored_changelog=$(docker exec -e PGPASSWORD=restore-test "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -At -c \
  "select count(*) from databasechangelog")

failures=0
if [ "$restored_schemas" != "$source_schemas" ]; then
  echo "   FALLITO: schemi tenant ripristinati $restored_schemas invece di $source_schemas"
  failures=1
fi
if [ "$restored_changelog" != "$source_changelog" ]; then
  echo "   FALLITO: migrazioni ripristinate $restored_changelog invece di $source_changelog"
  failures=1
fi

if [ "$failures" -ne 0 ]; then
  echo "Prova di ripristino non superata. Backup conservato in $DUMP"
  exit 1
fi

echo "   schemi tenant e migrazioni corrispondono all'origine"
echo
echo "Esito: ripristino verificato."
echo "Backup: $((backup_end - backup_start))s. Ripristino: $((restore_end - restore_start))s. Dump: $DUMP"
echo "Riportare questi tempi, con la dimensione del dump, come misura di RPO e RTO nel runbook operativo."
