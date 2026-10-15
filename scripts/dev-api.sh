#!/usr/bin/env bash
# Runs the built API against the local development database (scripts/dev-db.sh).
# The web dev server on :5173 proxies /api here, so BASE_URL points at it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$ROOT/.data/encryption.key"
mkdir -p "$ROOT/.data"
# Stable per checkout, so stored secrets stay readable across restarts.
[[ -f "$KEY_FILE" ]] || openssl rand -base64 32 >"$KEY_FILE"

PORT="${PORT:-3000}"
if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "Ordler API is already running on http://localhost:$PORT (stop it first to restart)." >&2
  else
    echo "Port $PORT is used by another process; set PORT=... to use a different one." >&2
  fi
  exit 1
fi

"$ROOT/scripts/dev-db.sh" start
export DATABASE_URL="postgres://ordler@127.0.0.1:${ORDLER_DEV_DB_PORT:-5433}/ordler"
export ENCRYPTION_KEY_FILE="$KEY_FILE"
export BASE_URL="${BASE_URL:-http://localhost:5173}"
export PORT
exec node "$ROOT/apps/api/dist/main.js"
