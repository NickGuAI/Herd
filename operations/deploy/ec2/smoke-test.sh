#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/operations/deploy/ec2"
INSTALLER="$SCRIPT_DIR/install-ec2.sh"
SERVICE_TEMPLATE="$SCRIPT_DIR/herd.service"
CADDY_TEMPLATE="$SCRIPT_DIR/Caddyfile"
CHECK_SCRIPT="$SCRIPT_DIR/check-herd-split-shell.sh"
DOMAIN="${HERD_EC2_SMOKE_DOMAIN:-enterprise.example.test}"
PUBLIC_SHELL_PORT="20001"
SERVICE_PORT="20009"
SMOKE_TMP_DIR=""
SMOKE_SERVER_PID=""

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
  local old_service_template="her""vald.service"
  local old_app_path="\$INSTALL_DIR/apps/ham""murabi"
  local old_cli_path="\$INSTALL_DIR/packages/ham""murabi-cli/bin/ham""murabi.mjs"
  local old_env_data="HAM""MURABI_DATA_DIR="
  local old_env_db="HAM""MURABI_DB_PATH="
  local old_env_prefix="HAM""MURABI_"
  local old_service_description="Her""vald server"

  assert_file "$INSTALLER"
  assert_file "$SERVICE_TEMPLATE"
  assert_file "$CADDY_TEMPLATE"
  assert_file "$CHECK_SCRIPT"
  [[ -x "$CHECK_SCRIPT" ]] || fail "$CHECK_SCRIPT must be executable"

  assert_contains "$INSTALLER" 'SERVICE_NAME="herd"'
  assert_contains "$INSTALLER" 'SERVICE_PORT="20009"'
  assert_contains "$INSTALLER" 'SERVICE_TEMPLATE_PATH="$SCRIPT_DIR/herd.service"'
  assert_contains "$INSTALLER" 'CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-herd-split-shell.sh"'
  assert_contains "$INSTALLER" '$INSTALL_DIR/apps/herd'
  assert_contains "$INSTALLER" '$INSTALL_DIR/packages/herd-cli/bin/herd.mjs'
  assert_contains "$INSTALLER" 'HERD_DATA_DIR="$DATA_DIR"'
  assert_contains "$INSTALLER" 'HERD_DB_PATH="$DATA_DIR/herd.sqlite"'
  assert_contains "$INSTALLER" 'local shim_path="$shim_dir/herd"'
  assert_contains "$INSTALLER" 'migrate_legacy_hervald_service'
  assert_contains "$INSTALLER" 'systemctl disable --now hervald.service || true'
  assert_contains "$INSTALLER" 'rm -f /etc/systemd/system/hervald.service'
  assert_contains "$INSTALLER" 'systemctl is-active --quiet "${SERVICE_NAME}.service"'
  assert_contains "$INSTALLER" 'systemctl is-active --quiet hervald.service'

  assert_not_contains "$INSTALLER" "SERVICE_TEMPLATE_PATH=\"\$SCRIPT_DIR/$old_service_template\""
  assert_not_contains "$INSTALLER" "$old_app_path"
  assert_not_contains "$INSTALLER" "$old_cli_path"
  assert_not_contains "$INSTALLER" "$old_env_data"
  assert_not_contains "$INSTALLER" "$old_env_db"

  assert_contains "$SERVICE_TEMPLATE" 'Description=Herd server'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=PORT=__SERVICE_PORT__'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=HERD_HOST=127.0.0.1'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=HERD_DATA_DIR=__DATA_DIR__'
  assert_contains "$SERVICE_TEMPLATE" 'Environment=HERD_DB_PATH=__DATA_DIR__/herd.sqlite'
  assert_contains "$SERVICE_TEMPLATE" 'ExecStart=/usr/bin/env PORT=__SERVICE_PORT__ HERD_HOST=127.0.0.1 node dist-server/server/index.js'
  assert_not_contains "$SERVICE_TEMPLATE" "$old_env_prefix"
  assert_not_contains "$SERVICE_TEMPLATE" "$old_service_description"

  assert_contains "$CADDY_TEMPLATE" '__DOMAIN__, :20001'
  assert_contains "$CADDY_TEMPLATE" '@api path /api/* /v1/* /install.sh'
  assert_contains "$CADDY_TEMPLATE" 'reverse_proxy 127.0.0.1:__SERVICE_PORT__'
  assert_contains "$CADDY_TEMPLATE" 'root * __APP_DIR__/dist'
}

render_templates() {
  local tmp_dir="$1"
  local app_dir="$tmp_dir/repo/apps/herd"
  local data_dir="$tmp_dir/data"

  mkdir -p "$app_dir/dist" "$tmp_dir/repo/packages/herd-cli/bin" "$data_dir"
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
    -e "s|__SERVICE_PORT__|$SERVICE_PORT|g" \
    "$SERVICE_TEMPLATE" > "$tmp_dir/herd.service"

  sed \
    -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__APP_DIR__|$(escape_sed_replacement "$app_dir")|g" \
    -e "s|__SERVICE_PORT__|$SERVICE_PORT|g" \
    "$CADDY_TEMPLATE" > "$tmp_dir/Caddyfile"
}

validate_installer_layout_resolution() {
  local tmp_dir="$1"

  (
    # Load the installer's real layout resolver without running the root/systemd
    # install path; the full systemd path remains EC2-operator verification.
    HERD_EC2_INSTALL_SOURCE_ONLY=1
    # shellcheck disable=SC1090
    source "$INSTALLER"

    INSTALL_DIR="$tmp_dir/repo"
    APP_DIR=""
    CLI_ENTRYPOINT=""
    APP_PACKAGE_NAME=""
    SERVICE_TEMPLATE_PATH="$SERVICE_TEMPLATE"
    CADDY_TEMPLATE_PATH="$CADDY_TEMPLATE"
    CHECK_SCRIPT_PATH="$CHECK_SCRIPT"

    resolve_repo_layout

    [[ "$APP_DIR" == "$tmp_dir/repo/apps/herd" ]] \
      || die "installer resolved wrong APP_DIR: $APP_DIR"
    [[ "$CLI_ENTRYPOINT" == "$tmp_dir/repo/packages/herd-cli/bin/herd.mjs" ]] \
      || die "installer resolved wrong CLI_ENTRYPOINT: $CLI_ENTRYPOINT"
    [[ "$APP_PACKAGE_NAME" == "herd" ]] \
      || die "installer resolved wrong APP_PACKAGE_NAME: $APP_PACKAGE_NAME"
  )
}

start_fake_split_shell() {
  local tmp_dir="$1"
  cat > "$tmp_dir/fake-split-shell.mjs" <<'NODE'
import http from 'node:http'

const servicePort = Number(process.env.SERVICE_PORT)
const shellPort = Number(process.env.PUBLIC_SHELL_PORT)

if (!Number.isInteger(servicePort) || !Number.isInteger(shellPort)) {
  throw new Error('SERVICE_PORT and PUBLIC_SHELL_PORT must be integers')
}

const api = http.createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"ok":true}\n')
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found\n')
})

const shell = http.createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok\n')
    return
  }

  if (request.url === '/api/health') {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: servicePort,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      },
    )
    upstream.on('error', () => {
      response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('bad gateway\n')
    })
    request.pipe(upstream)
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found\n')
})

await Promise.all([
  new Promise((resolve) => api.listen(servicePort, '127.0.0.1', resolve)),
  new Promise((resolve) => shell.listen(shellPort, '127.0.0.1', resolve)),
])

process.on('SIGTERM', () => {
  shell.close()
  api.close()
  process.exit(0)
})

setInterval(() => {}, 2147483647)
NODE

  SERVICE_PORT="$SERVICE_PORT" PUBLIC_SHELL_PORT="$PUBLIC_SHELL_PORT" \
    node "$tmp_dir/fake-split-shell.mjs" > "$tmp_dir/fake-split-shell.log" 2>&1 &
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

run_split_shell_check() {
  local tmp_dir="$1"
  bash "$CHECK_SCRIPT" \
    --domain "$DOMAIN" \
    --caddyfile "$tmp_dir/Caddyfile" \
    --service-port "$SERVICE_PORT" \
    --shell-port "$PUBLIC_SHELL_PORT"
}

run_inner() {
  require_command bash
  require_command curl
  require_command node

  SMOKE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/herd-ec2-smoke.XXXXXX")"
  SMOKE_SERVER_PID=""
  trap cleanup_inner EXIT

  log "validating renamed deploy contract"
  validate_deploy_contract
  render_templates "$SMOKE_TMP_DIR"
  validate_installer_layout_resolution "$SMOKE_TMP_DIR"

  assert_contains "$SMOKE_TMP_DIR/herd.service" 'WorkingDirectory='"$SMOKE_TMP_DIR"'/repo/apps/herd'
  assert_contains "$SMOKE_TMP_DIR/herd.service" 'Environment=PORT=20009'
  assert_contains "$SMOKE_TMP_DIR/herd.service" 'Environment=HERD_HOST=127.0.0.1'
  assert_contains "$SMOKE_TMP_DIR/Caddyfile" "$DOMAIN, :20001"
  assert_contains "$SMOKE_TMP_DIR/Caddyfile" 'reverse_proxy 127.0.0.1:20009'

  log "starting loopback app and shell approximation"
  SMOKE_SERVER_PID="$(start_fake_split_shell "$SMOKE_TMP_DIR")"
  wait_for_health "http://127.0.0.1:${SERVICE_PORT}/api/health"
  wait_for_health "http://127.0.0.1:${PUBLIC_SHELL_PORT}/healthz"
  wait_for_health "http://127.0.0.1:${PUBLIC_SHELL_PORT}/api/health"
  run_split_shell_check "$SMOKE_TMP_DIR"

  log "restarting approximation to mimic reboot"
  kill "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
  wait "$SMOKE_SERVER_PID" >/dev/null 2>&1 || true
  SMOKE_SERVER_PID="$(start_fake_split_shell "$SMOKE_TMP_DIR")"
  wait_for_health "http://127.0.0.1:${SERVICE_PORT}/api/health"
  wait_for_health "http://127.0.0.1:${PUBLIC_SHELL_PORT}/api/health"
  run_split_shell_check "$SMOKE_TMP_DIR"

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
    cat <<'EOF'
Usage: bash operations/deploy/ec2/smoke-test.sh [--container|--inside-container]

Runs the enterprise EC2 deploy-lane smoke test. Use --container for the CI and
operator-side approximation of a fresh EC2 installer path.
EOF
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
