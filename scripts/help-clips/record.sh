#!/usr/bin/env bash
# Records the Help page clips (apps/web/public/help/*.webm) against a throwaway demo workspace:
# a fresh database on the dev cluster, the built API and a Vite dev server on their own ports.
# Usage: scripts/help-clips/record.sh [clip-id ...]   (no ids: every clip)
# Needs: PostgreSQL 18 (scripts/dev-db.sh), ffmpeg, `pnpm exec playwright install chromium`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_PORT="${HELP_CLIPS_API_PORT:-3210}"
WEB_PORT="${HELP_CLIPS_WEB_PORT:-5210}"
DB_PORT="${ORDLER_DEV_DB_PORT:-5433}"
DB="${HELP_CLIPS_DB:-ordler_help_clips}"
PGBIN="${PGBIN:-$(brew --prefix postgresql@18 2>/dev/null)/bin}"
WORK="$ROOT/.data/help-clips"
mkdir -p "$WORK"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg)." >&2; exit 1; }

(cd "$ROOT" && pnpm turbo run build --filter=@ordler/api >/dev/null)
"$ROOT/scripts/dev-db.sh" start >/dev/null
# Every run starts from first-run setup, so the clips always show the same demo data.
"$PGBIN/dropdb" -h 127.0.0.1 -p "$DB_PORT" -U ordler --if-exists "$DB"
"$PGBIN/createdb" -h 127.0.0.1 -p "$DB_PORT" -U ordler "$DB"
[[ -f "$WORK/encryption.key" ]] || openssl rand -base64 32 >"$WORK/encryption.key"

PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

DATABASE_URL="postgres://ordler@127.0.0.1:$DB_PORT/$DB" \
  ENCRYPTION_KEY_FILE="$WORK/encryption.key" \
  BASE_URL="http://localhost:$WEB_PORT" PORT="$API_PORT" LOG_LEVEL=warn \
  node "$ROOT/apps/api/dist/main.js" >"$WORK/api.log" 2>&1 &
PIDS+=($!)
# exec, so the tracked PID is Vite itself and cleanup stops it (a pnpm wrapper would orphan it).
(cd "$ROOT/apps/web" && ORDLER_API_URL="http://localhost:$API_PORT" \
  exec ./node_modules/.bin/vite --port "$WEB_PORT" --strictPort >"$WORK/web.log" 2>&1) &
PIDS+=($!)

for _ in $(seq 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 &&
    curl -fsS "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break
  sleep 1
done

export ORDLER_URL="http://localhost:$WEB_PORT"
export HELP_CLIPS_STATE="$WORK/state.json"
node "$ROOT/scripts/help-clips/seed.mjs"
node "$ROOT/scripts/help-clips/record.mjs" "$@"
