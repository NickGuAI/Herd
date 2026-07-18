#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/operations/deploy/ec2"
INSTALLER="$SCRIPT_DIR/install-ec2.sh"
SERVICE_TEMPLATE="$SCRIPT_DIR/herd.service"
SMOKE_PORT="${HERD_EC2_SMOKE_PORT:-21001}"
SMOKE_TMP_DIR=""
SMOKE_SERVER_PID=""
EXPECTED_RUNTIME_HOST_ENV='HERD_HOST'
if [[ "$EXPECTED_RUNTIME_HOST_ENV" == 'HERD_HOST' ]]; then
  STALE_RUNTIME_HOST_ENV='HAMMU''RABI_HOST'
else
  STALE_RUNTIME_HOST_ENV='HERD_HOST'
fi

fail() {
  printf '[ec2-smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[ec2-smoke] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

assert_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

assert_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq "$needle" "$file" || fail "$file does not contain: $needle"
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  ! grep -Fq "$needle" "$file" || fail "$file still contains stale text: $needle"
}

escape_sed_replacement() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  printf '%s' "$value"
}

run_container() {
  require_command docker

  local image="${HERD_EC2_SMOKE_IMAGE:-node:22-bookworm-slim}"
  log "running container approximation with $image"
  docker run --rm \
    -e HERD_EC2_SMOKE_INSIDE_CONTAINER=1 \
    -e HERD_EC2_SMOKE_PORT=20001 \
    -v "$REPO_ROOT:/workspace:ro" \
    -w /workspace \
    "$image" \
    bash -lc '
      set -euo pipefail
      if ! command -v curl >/dev/null 2>&1; then
        apt-get update
        apt-get install -y --no-install-recommends curl ca-certificates
      fi
      bash operations/deploy/ec2/smoke-test.sh --inside-container
    '
}

validate_deploy_contract() {
  assert_file "$INSTALLER"
  assert_file "$SERVICE_TEMPLATE"

  assert_contains "$INSTALLER" 'SERVICE_NAME="herd"'
  assert_contains "$INSTALLER" 'SERVICE_PORT="20001"'
  assert_contains "$INSTALLER" 'SERVICE_TEMPLATE_PATH="$SCRIPT_DIR/herd.service"'
  assert_contains "$INSTALLER" '$INSTALL_DIR/apps/herd'
  assert_contains "$INSTALLER" '$INSTALL_DIR/packages/herd-cli/bin/herd.mjs'
  assert_contains "$INSTALLER" 'HERD_DATA_DIR="$DATA_DIR"'
  assert_contains "$INSTALLER" 'HERD_DB_PATH="$DATA_DIR/herd.sqlite"'
  assert_contains "$INSTALLER" 'verify_direct_listener'
  assert_contains "$INSTALLER" 'retire_legacy_caddy_site'
  assert_contains "$INSTALLER" 'systemctl restart "$SERVICE_NAME"'
  assert_contains "$INSTALLER" 'systemctl reload caddy.service'
  assert_contains "$INSTALLER" 'port_listener_pids'
  assert_contains "$INSTALLER" 'migrate_legacy_hervald_service'
  assert_contains "$INSTALLER" 'systemctl disable --now hervald.service || true'
  assert_contains "$INSTALLER" 'rm -f /etc/systemd/system/hervald.service'
  assert_not_contains "$INSTALLER" 'install_caddy'
  assert_not_contains "$INSTALLER" 'CADDY_TEMPLATE_PATH'
  assert_not_contains "$INSTALLER" 'check-herd-split-shell'
  assert_not_contains "$INSTALLER" 'verify_split_shell_topology'

  assert_contains "$SERVICE_TEMPLATE" 'Description=Herd server'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=PORT=__SERVICE_PORT__'
  assert_contains "$SERVICE_TEMPLATE" "Environment=${EXPECTED_RUNTIME_HOST_ENV}=0.0.0.0"
  assert_contains "$SERVICE_TEMPLATE" 'Environment=HERD_DATA_DIR=__DATA_DIR__'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=HERD_DB_PATH=__DATA_DIR__/herd.sqlite'
  assert_contains "$SERVICE_TEMPLATE" "ExecStart=/usr/bin/env PORT=__SERVICE_PORT__ ${EXPECTED_RUNTIME_HOST_ENV}=0.0.0.0 node dist-server/server/index.js"
  assert_not_contains "$SERVICE_TEMPLATE" "${STALE_RUNTIME_HOST_ENV}="
}

render_service_template() {
  local tmp_dir="$1"
  local app_dir="$tmp_dir/repo/apps/herd"
  local data_dir="$tmp_dir/data"

  mkdir -p "$app_dir" "$tmp_dir/repo/packages/herd-cli/bin" "$data_dir"
  printf '{"name":"herd","scripts":{"build":"true","db:ready":"true"}}\n' > "$app_dir/package.json"
  printf '#!/usr/bin/env node\nconsole.log("herd cli smoke")\n' > "$tmp_dir/repo/packages/herd-cli/bin/herd.mjs"
  chmod +x "$tmp_dir/repo/packages/herd-cli/bin/herd.mjs"

  sed \
    -e "s|__APP_USER__|herd|g" \
    -e "s|__APP_GROUP__|herd|g" \
    -e "s|__APP_DIR__|$(escape_sed_replacement "$app_dir")|g" \
    -e "s|__HOME_DIR__|$(escape_sed_replacement "$tmp_dir/home")|g" \
    -e "s|__DATA_DIR__|$(escape_sed_replacement "$data_dir")|g" \
    -e "s|__PNPM_BIN__|/usr/local/bin/pnpm|g" \
    -e "s|__SERVICE_PORT__|$SMOKE_PORT|g" \
    "$SERVICE_TEMPLATE" > "$tmp_dir/herd.service"
}

validate_installer_layout_resolution() {
  local tmp_dir="$1"

  (
    HERD_EC2_INSTALL_SOURCE_ONLY=1
    # shellcheck disable=SC1090
    source "$INSTALLER"

    INSTALL_DIR="$tmp_dir/repo"
    APP_DIR=""
    CLI_ENTRYPOINT=""
    APP_PACKAGE_NAME=""
    SERVICE_TEMPLATE_PATH="$SERVICE_TEMPLATE"

    resolve_repo_layout

    [[ "$APP_DIR" == "$tmp_dir/repo/apps/herd" ]] \
      || die "installer resolved wrong APP_DIR: $APP_DIR"
    [[ "$CLI_ENTRYPOINT" == "$tmp_dir/repo/packages/herd-cli/bin/herd.mjs" ]] \
      || die "installer resolved wrong CLI_ENTRYPOINT: $CLI_ENTRYPOINT"
    [[ "$APP_PACKAGE_NAME" == "herd" ]] \
      || die "installer resolved wrong APP_PACKAGE_NAME: $APP_PACKAGE_NAME"
  )
}

validate_legacy_caddy_migration() {
  local tmp_dir="$1"
  local source_caddyfile="$tmp_dir/Caddyfile"
  local migrated_caddyfile="$tmp_dir/Caddyfile.migrated"

  cat > "$source_caddyfile" <<'CADDY'
legion.example.com {
  reverse_proxy localhost:8080
}

http://herd.example.com:20001, :20001 {
  @api path /api/*
  handle @api {
    reverse_proxy 127.0.0.1:20009
  }
  handle {
    root * /srv/herd/dist
    try_files {path} /index.html
    file_server
  }
}
CADDY

  (
    HERD_EC2_INSTALL_SOURCE_ONLY=1
    # shellcheck disable=SC1090
    source "$INSTALLER"
    strip_legacy_caddy_site \
      "$source_caddyfile" \
      "$migrated_caddyfile" \
      'herd.example.com'
  )

  assert_contains "$migrated_caddyfile" 'legion.example.com {'
  assert_contains "$migrated_caddyfile" 'reverse_proxy localhost:8080'
  assert_not_contains "$migrated_caddyfile" 'herd.example.com'
  assert_not_contains "$migrated_caddyfile" '127.0.0.1:20009'

  local status=0
  if (
    HERD_EC2_INSTALL_SOURCE_ONLY=1
    # shellcheck disable=SC1090
    source "$INSTALLER"
    strip_legacy_caddy_site \
      "$source_caddyfile" \
      "$tmp_dir/Caddyfile.no-match" \
      'missing.example.com'
  ); then
    fail 'legacy Caddy migration unexpectedly removed a non-matching site'
  else
    status=$?
  fi
  [[ "$status" -eq 3 ]] \
    || fail "legacy Caddy migration returned unexpected no-match status: $status"
}

start_fake_direct_service() {
  local tmp_dir="$1"
  node - "$SMOKE_PORT" > "$tmp_dir/fake-direct.log" 2>&1 <<'NODE' &
const http = require('node:http')
const port = Number(process.argv[2])

const server = http.createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"ok"}\n')
    return
  }
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><html><body>Herd</body></html>\n')
})

server.listen(port, '0.0.0.0')
process.on('SIGTERM', () => server.close(() => process.exit(0)))
NODE
  printf '%s' "$!"
}

wait_for_health() {
  local url="$1"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "health check did not become ready: $url"
}

cleanup_inner() {
  if [[ -n "${SMOKE_SERVER_PID:-}" ]]; then
    kill "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
    wait "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SMOKE_TMP_DIR:-}" ]]; then
    rm -rf "$SMOKE_TMP_DIR"
  fi
}

run_inner() {
  require_command bash
  require_command curl
  require_command node

  SMOKE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/herd-ec2-smoke.XXXXXX")"
  trap cleanup_inner EXIT

  log "validating direct-ALB deploy contract"
  validate_deploy_contract
  render_service_template "$SMOKE_TMP_DIR"
  validate_installer_layout_resolution "$SMOKE_TMP_DIR"
  validate_legacy_caddy_migration "$SMOKE_TMP_DIR"

  assert_contains "$SMOKE_TMP_DIR/herd.service" 'Environment=PORT='"$SMOKE_PORT"
  assert_contains "$SMOKE_TMP_DIR/herd.service" "Environment=${EXPECTED_RUNTIME_HOST_ENV}=0.0.0.0"

  log "starting direct application approximation"
  SMOKE_SERVER_PID="$(start_fake_direct_service "$SMOKE_TMP_DIR")"
  wait_for_health "http://127.0.0.1:${SMOKE_PORT}/api/health"
  curl -fsS --max-time 2 "http://127.0.0.1:${SMOKE_PORT}/org" | grep -Eiq '<!doctype html|<html' \
    || fail "document route did not return HTML"

  log "restarting approximation to mimic reboot"
  kill "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
  wait "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
  SMOKE_SERVER_PID="$(start_fake_direct_service "$SMOKE_TMP_DIR")"
  wait_for_health "http://127.0.0.1:${SMOKE_PORT}/api/health"

  log "EC2 deploy smoke passed"
}

case "${1:-}" in
  --container)
    run_container
    ;;
  --inside-container)
    run_inner
    ;;
  -h|--help)
    printf '%s\n' 'Usage: bash operations/deploy/ec2/smoke-test.sh [--container|--inside-container]'
    ;;
  "")
    if [[ "${HERD_EC2_SMOKE_CONTAINER:-0}" == "1" ]]; then
      run_container
    else
      run_inner
    fi
    ;;
  *)
    fail "unknown argument: $1"
    ;;
esac
