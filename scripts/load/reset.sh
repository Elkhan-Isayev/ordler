#!/usr/bin/env bash
# Recreates the throwaway load-test stack: PostgreSQL 18 without limits, Ordler at 1 CPU / 1 GB.
# Usage: scripts/load/reset.sh [cpus] [memory]   (defaults: 1 1g)
set -euo pipefail
CPUS="${1:-1}"
MEMORY="${2:-1g}"
docker rm -f ordler-load-api ordler-load-db >/dev/null 2>&1 || true
docker network create ordler-load >/dev/null 2>&1 || true
docker run -d --name ordler-load-db --network ordler-load -p 127.0.0.1:5434:5432 \
  -e POSTGRES_USER=ordler -e POSTGRES_PASSWORD=load-test-only -e POSTGRES_DB=ordler \
  postgres:18 -c max_connections=300 >/dev/null
until docker exec ordler-load-db pg_isready -U ordler -d ordler >/dev/null 2>&1; do sleep 1; done
sleep 2
docker run -d --name ordler-load-api --network ordler-load -p 127.0.0.1:3100:3000 \
  --cpus="$CPUS" --memory="$MEMORY" --memory-swap="$MEMORY" \
  -e DATABASE_URL=postgres://ordler:load-test-only@ordler-load-db:5432/ordler \
  -e BASE_URL=http://localhost:3100 -e LOG_LEVEL=warn "${ORDLER_IMAGE:-ordler:load}" >/dev/null
until curl -fsS http://localhost:3100/healthz >/dev/null 2>&1; do sleep 1; done
echo "Ordler at http://localhost:3100 (cpus=$CPUS memory=$MEMORY), database on 127.0.0.1:5434"
