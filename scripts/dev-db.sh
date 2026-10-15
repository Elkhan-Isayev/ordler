#!/usr/bin/env bash
# Local PostgreSQL 18 for development: a project-local cluster in .data/postgres on port 5433.
# Usage: scripts/dev-db.sh start|stop|status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data/postgres"
PORT="${ORDLER_DEV_DB_PORT:-5433}"
PGBIN="${PGBIN:-$(brew --prefix postgresql@18 2>/dev/null)/bin}"
# On macOS the postmaster refuses to start without a valid locale in the environment.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

if [[ ! -x "$PGBIN/pg_ctl" ]]; then
  echo "PostgreSQL 18 not found. Install it with: brew install postgresql@18" >&2
  exit 1
fi

case "${1:-start}" in
  start)
    if [[ ! -f "$DATA/PG_VERSION" ]]; then
      mkdir -p "$DATA"
      # Trust auth on 127.0.0.1 only: a throwaway development cluster, never exposed.
      "$PGBIN/initdb" -D "$DATA" -U ordler --auth=trust --encoding=UTF8 --locale=C >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA" -l "$ROOT/.data/postgres.log" -w \
        -o "-p $PORT -c listen_addresses=127.0.0.1 -k $DATA" start >/dev/null
    fi
    "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U ordler -d postgres -tAc \
      "select 1 from pg_database where datname = 'ordler'" | grep -q 1 ||
      "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U ordler ordler
    echo "PostgreSQL 18 ready: postgres://ordler@127.0.0.1:$PORT/ordler"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$DATA" status
    ;;
  *)
    echo "Usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
