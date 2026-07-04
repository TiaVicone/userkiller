#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ELECTRON_DIR="$ROOT_DIR/electron"
BACKEND_PORT="${BACKEND_PORT:-5001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
START_ELECTRON="${START_ELECTRON:-0}"
PIDS=()

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing command: $1"
    exit 1
  fi
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local name="$2"
  for _ in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✅ $name is ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "❌ Timed out waiting for $name: $url"
  exit 1
}

print_step() {
  echo
  echo "==> $1"
}

require_cmd node
require_cmd npm
require_cmd curl

if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
  echo "❌ backend/frontend directories not found"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/config.json" ]]; then
  echo "❌ Missing backend/config.json"
  echo "   Copy backend/config.example.json to backend/config.json and fill your DeepSeek API key first."
  exit 1
fi

print_step "Installing backend dependencies"
npm --prefix "$BACKEND_DIR" install

print_step "Installing frontend dependencies"
npm --prefix "$FRONTEND_DIR" install

if [[ "$START_ELECTRON" == "1" ]]; then
  if [[ ! -d "$ELECTRON_DIR" ]]; then
    echo "❌ electron directory not found"
    exit 1
  fi
  print_step "Installing electron dependencies"
  npm --prefix "$ELECTRON_DIR" install
fi

print_step "Starting backend on port $BACKEND_PORT"
PORT="$BACKEND_PORT" npm --prefix "$BACKEND_DIR" run dev &
PIDS+=("$!")
wait_for_http "http://localhost:$BACKEND_PORT/api/health" "backend"

print_step "Starting frontend on port $FRONTEND_PORT"
npm --prefix "$FRONTEND_DIR" run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" &
PIDS+=("$!")
wait_for_http "http://localhost:$FRONTEND_PORT" "frontend"

echo

echo "🎉 Userkiller trial environment is ready"
echo "   Frontend: http://localhost:$FRONTEND_PORT"
echo "   Backend : http://localhost:$BACKEND_PORT"

if [[ "$START_ELECTRON" == "1" ]]; then
  print_step "Starting Electron"
  (
    cd "$ELECTRON_DIR"
    npm run dev
  ) &
  PIDS+=("$!")
  echo "🖥️  Electron launch requested"
fi

echo
echo "Press Ctrl+C to stop all started processes."
wait
