#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Herd"
DEFAULT_REPO_SLUG="NickGuAI/Herd"
DEFAULT_REPO_BRANCH="main"
REQUIRED_NODE_MAJOR="22"
REQUIRED_NODE_VERSION="22.16.0"
REQUIRED_PNPM_VERSION="10.23.0"
SERVICE_NAME="herd"
SERVICE_PORT="20001"

TARGET_DOMAIN=""
APP_USER=""
REPO_SLUG="$DEFAULT_REPO_SLUG"
REPO_BRANCH="$DEFAULT_REPO_BRANCH"
INSTALL_DIR=""
DATA_DIR=""

APP_HOME=""
APP_GROUP=""
APP_DIR=""
APP_PACKAGE_NAME=""
CLI_ENTRYPOINT=""
NODE_BIN=""
PNPM_BIN=""
SYSTEM_PATH=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_TEMPLATE_PATH="$SCRIPT_DIR/herd.service"
CADDYFILE_PATH="${HERD_CADDYFILE_PATH:-/etc/caddy/Caddyfile}"

log() {
  printf '[%s] %s\n' "$SERVICE_NAME" "$*"
}

warn() {
  printf '[%s] WARN: %s\n' "$SERVICE_NAME" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$SERVICE_NAME" "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: sudo bash install-ec2.sh --domain <fqdn> [options]

Options:
  --domain <fqdn>       Public DNS name routed by the ALB (required)
  --app-user <user>     Linux user that owns the checkout and runs the service
  --repo-slug <owner/name>
                        GitHub repo to clone (default: ${DEFAULT_REPO_SLUG})
  --branch <branch>     Git branch to deploy (default: ${DEFAULT_REPO_BRANCH})
  --install-dir <path>  Checkout directory (default: ~app-user/.herd)
  --data-dir <path>     HERD_DATA_DIR value (default: ~app-user/.herd)
  --service-port <port> Direct ALB target port (default: ${SERVICE_PORT})
  -h, --help            Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        [[ $# -ge 2 ]] || die "--domain requires a value"
        TARGET_DOMAIN="$2"
        shift 2
        ;;
      --domain=*)
        TARGET_DOMAIN="${1#*=}"
        shift
        ;;
      --app-user)
        [[ $# -ge 2 ]] || die "--app-user requires a value"
        APP_USER="$2"
        shift 2
        ;;
      --app-user=*)
        APP_USER="${1#*=}"
        shift
        ;;
      --repo-slug)
        [[ $# -ge 2 ]] || die "--repo-slug requires a value"
        REPO_SLUG="$2"
        shift 2
        ;;
      --repo-slug=*)
        REPO_SLUG="${1#*=}"
        shift
        ;;
      --branch)
        [[ $# -ge 2 ]] || die "--branch requires a value"
        REPO_BRANCH="$2"
        shift 2
        ;;
      --branch=*)
        REPO_BRANCH="${1#*=}"
        shift
        ;;
      --install-dir)
        [[ $# -ge 2 ]] || die "--install-dir requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --install-dir=*)
        INSTALL_DIR="${1#*=}"
        shift
        ;;
      --data-dir)
        [[ $# -ge 2 ]] || die "--data-dir requires a value"
        DATA_DIR="$2"
        shift 2
        ;;
      --data-dir=*)
        DATA_DIR="${1#*=}"
        shift
        ;;
      --service-port)
        [[ $# -ge 2 ]] || die "--service-port requires a value"
        SERVICE_PORT="$2"
        shift 2
        ;;
      --service-port=*)
        SERVICE_PORT="${1#*=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this installer with sudo or as root."
}

resolve_home_dir() {
  local user="$1"
  local entry

  if command_exists getent; then
    entry="$(getent passwd "$user" 2>/dev/null || true)"
    if [[ -n "$entry" ]]; then
      printf '%s' "$entry" | cut -d: -f6
      return 0
    fi
  fi

  eval "printf '%s' ~$user"
}

detect_app_user() {
  if [[ -n "$APP_USER" ]]; then
    return 0
  fi

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    APP_USER="$SUDO_USER"
    return 0
  fi

  for candidate in "ec2""-user" ubuntu admin; do
    if id -u "$candidate" >/dev/null 2>&1; then
      APP_USER="$candidate"
      return 0
    fi
  done

  die "Unable to infer the target Linux user. Re-run with --app-user."
}

prompt_for_domain() {
  if [[ -n "$TARGET_DOMAIN" ]]; then
    return 0
  fi

  if [[ -t 0 ]]; then
    read -r -p "Domain for ${APP_NAME} (e.g. mybox.example.com): " TARGET_DOMAIN
  fi

  [[ -n "$TARGET_DOMAIN" ]] || die "--domain is required."
}

validate_ports() {
  [[ "$SERVICE_PORT" =~ ^[0-9]+$ ]] || die "Invalid --service-port value: ${SERVICE_PORT}"
  [[ "$SERVICE_PORT" -gt 0 ]] || die "Invalid --service-port value: ${SERVICE_PORT}"
}

strip_legacy_caddy_site() {
  local input_path="$1"
  local output_path="$2"
  local target_domain="$3"

  awk -v target_domain="$target_domain" '
    BEGIN {
      depth = 0
      removed = 0
      skipping = 0
      invalid = 0
    }
    {
      scan = $0
      opens = gsub(/\{/, "{", scan)
      closes = gsub(/\}/, "}", scan)

      if (!skipping && depth == 0 && opens > 0 && index($0, target_domain) > 0) {
        skipping = 1
        removed = 1
      }

      if (!skipping) {
        print
      }

      depth += opens - closes
      if (depth < 0) {
        invalid = 1
        exit
      }
      if (skipping && depth == 0) {
        skipping = 0
      }
    }
    END {
      if (invalid || depth != 0 || skipping) {
        exit 4
      }
      if (!removed) {
        exit 3
      }
    }
  ' "$input_path" > "$output_path"
}

retire_legacy_caddy_site() {
  [[ -f "$CADDYFILE_PATH" ]] || return 0

  local candidate
  candidate="$(mktemp "${TMPDIR:-/tmp}/herd-caddyfile.XXXXXX")"
  local strip_status=0
  if strip_legacy_caddy_site "$CADDYFILE_PATH" "$candidate" "$TARGET_DOMAIN"; then
    :
  else
    strip_status=$?
    rm -f "$candidate"
    if [[ "$strip_status" -eq 3 ]]; then
      return 0
    fi
    die "Unable to safely remove the legacy ${TARGET_DOMAIN} Caddy site from ${CADDYFILE_PATH}."
  fi

  log "Removing the legacy ${TARGET_DOMAIN} Caddy site before direct-port handoff"
  local has_remaining_sites=0
  if grep -Eq '^[[:space:]]*[^#[:space:]]' "$candidate"; then
    has_remaining_sites=1
    command_exists caddy \
      || die "Caddy is required to validate the remaining sites in ${CADDYFILE_PATH}."
    caddy validate --config "$candidate" --adapter caddyfile >/dev/null \
      || die "Refusing to install an invalid Caddy configuration after removing ${TARGET_DOMAIN}."
  fi

  local backup
  backup="$(mktemp "${CADDYFILE_PATH}.pre-herd-direct.XXXXXX")"
  cp -p "$CADDYFILE_PATH" "$backup"
  install -m 0644 "$candidate" "$CADDYFILE_PATH"
  rm -f "$candidate"

  if [[ "$has_remaining_sites" -eq 0 ]]; then
    if systemctl cat caddy.service >/dev/null 2>&1; then
      if ! systemctl disable --now caddy.service; then
        cp -p "$backup" "$CADDYFILE_PATH"
        systemctl restart caddy.service || true
        die "Failed to stop Caddy after removing its final site; restored ${backup}."
      fi
    fi
    return 0
  fi

  if systemctl is-active --quiet caddy.service; then
    if ! systemctl reload caddy.service && ! systemctl restart caddy.service; then
      cp -p "$backup" "$CADDYFILE_PATH"
      systemctl restart caddy.service || true
      die "Failed to reload Caddy without the legacy Herd site; restored ${backup}."
    fi
  fi
}

node_meets_required_version() {
  local node_cmd="${1:-node}"

  "$node_cmd" - "$REQUIRED_NODE_VERSION" >/dev/null 2>&1 <<'NODE'
const current = process.versions.node.split('.').map((part) => Number.parseInt(part, 10))
const required = process.argv[2].split('.').map((part) => Number.parseInt(part, 10))

for (let index = 0; index < required.length; index += 1) {
  const currentPart = current[index] ?? 0
  const requiredPart = required[index] ?? 0
  if (!Number.isFinite(currentPart) || !Number.isFinite(requiredPart)) process.exit(1)
  if (currentPart > requiredPart) process.exit(0)
  if (currentPart < requiredPart) process.exit(1)
}

process.exit(0)
NODE
}

install_base_packages() {
  if command_exists apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https build-essential python3 lsof
    return 0
  fi

  if command_exists dnf; then
    dnf install -y curl git ca-certificates gnupg2 gcc-c++ make python3 dnf-plugins-core lsof
    return 0
  fi

  die "Unsupported EC2 base image. Use Ubuntu 22+ or Amazon Linux 2023."
}

install_node() {
  if command_exists node; then
    if node_meets_required_version node; then
      NODE_BIN="$(command -v node)"
      return 0
    fi
    warn "Existing Node $(node --version 2>/dev/null || printf 'unknown') is below required v${REQUIRED_NODE_VERSION}; upgrading."
  fi

  if command_exists apt-get; then
    curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  elif command_exists dnf; then
    curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  else
    die "Unable to install Node ${REQUIRED_NODE_VERSION}."
  fi

  NODE_BIN="$(command -v node)"
  [[ -n "$NODE_BIN" ]] || die "Node installation finished but node was not found on PATH."
  node_meets_required_version "$NODE_BIN" || die "Node ${REQUIRED_NODE_VERSION} or newer is required; found $("$NODE_BIN" --version 2>/dev/null || printf 'unknown')."
}

install_pnpm() {
  command_exists corepack || die "corepack was not found after Node.js installation."
  corepack enable
  corepack prepare "pnpm@${REQUIRED_PNPM_VERSION}" --activate >/dev/null
  PNPM_BIN="$(command -v pnpm || true)"
  [[ -n "$PNPM_BIN" ]] || die "pnpm activation failed."
  SYSTEM_PATH="$(dirname "$PNPM_BIN"):$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
}

run_as_app_user() {
  if command_exists sudo; then
    sudo -u "$APP_USER" env HOME="$APP_HOME" PATH="$SYSTEM_PATH" "$@"
    return 0
  fi

  if command_exists runuser; then
    runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$SYSTEM_PATH" "$@"
    return 0
  fi

  die "Need sudo or runuser to execute commands as ${APP_USER}."
}

clone_or_update_repo() {
  local repo_url="https://github.com/${REPO_SLUG}.git"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  chown "$APP_USER:$APP_GROUP" "$(dirname "$INSTALL_DIR")"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Updating existing checkout at ${INSTALL_DIR}"
    run_as_app_user git -C "$INSTALL_DIR" fetch origin "$REPO_BRANCH"
    run_as_app_user git -C "$INSTALL_DIR" switch "$REPO_BRANCH"
    run_as_app_user git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
    return 0
  fi

  if [[ -e "$INSTALL_DIR" ]]; then
    die "${INSTALL_DIR} exists and is not a git checkout."
  fi

  log "Cloning ${REPO_SLUG} into ${INSTALL_DIR}"
  run_as_app_user git clone --depth 1 --branch "$REPO_BRANCH" "$repo_url" "$INSTALL_DIR"
}

resolve_repo_layout() {
  local candidate

  for candidate in "$INSTALL_DIR/apps/herd"; do
    if [[ -f "$candidate/package.json" ]]; then
      APP_DIR="$candidate"
      break
    fi
  done

  [[ -n "$APP_DIR" ]] || die "Unable to locate the Herd app directory inside ${INSTALL_DIR}."

  for candidate in \
    "$INSTALL_DIR/packages/herd-cli/bin/herd.mjs"
  do
    if [[ -f "$candidate" ]]; then
      CLI_ENTRYPOINT="$candidate"
      break
    fi
  done

  [[ -n "$CLI_ENTRYPOINT" ]] || die "Unable to locate the Herd CLI entrypoint inside ${INSTALL_DIR}."
  [[ -f "$SERVICE_TEMPLATE_PATH" ]] || die "Missing systemd template at ${SERVICE_TEMPLATE_PATH}."

  APP_PACKAGE_NAME="$(
    node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).name" \
      "$APP_DIR/package.json"
  )"
}

ensure_env_file() {
  if [[ -f "$APP_DIR/.env" ]]; then
    return 0
  fi

  if [[ -f "$APP_DIR/.env.example" ]]; then
    log "Creating ${APP_DIR}/.env from .env.example"
    run_as_app_user cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  fi
}

align_env_service_port() {
  if [[ ! -f "$APP_DIR/.env" ]]; then
    return 0
  fi

  local tmp_env
  tmp_env="$(mktemp "${APP_DIR}/.env.XXXXXX")"
  awk -v service_port="$SERVICE_PORT" '
    BEGIN { wrote = 0 }
    /^PORT=/ {
      if (!wrote) {
        print "PORT=" service_port
        wrote = 1
      }
      next
    }
    { print }
    END {
      if (!wrote) {
        print "PORT=" service_port
      }
    }
  ' "$APP_DIR/.env" > "$tmp_env"
  chown "$APP_USER:$APP_GROUP" "$tmp_env"
  mv "$tmp_env" "$APP_DIR/.env"
  chown "$APP_USER:$APP_GROUP" "$APP_DIR/.env"
}

write_app_path_file() {
  mkdir -p "$DATA_DIR"
  printf '%s\n' "$APP_DIR" > "$DATA_DIR/app-path"
  chown "$APP_USER:$APP_GROUP" "$DATA_DIR/app-path"
}

install_cli_shim() {
  local shim_dir="$APP_HOME/.local/bin"
  local shim_path="$shim_dir/herd"

  mkdir -p "$shim_dir"
  cat > "$shim_path" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$CLI_ENTRYPOINT" "\$@"
EOF
  chmod +x "$shim_path"
  chown "$APP_USER:$APP_GROUP" "$shim_path"
}

build_app() {
  log "Installing workspace dependencies"
  run_as_app_user "$PNPM_BIN" --dir "$INSTALL_DIR" install --frozen-lockfile

  log "Building ${APP_PACKAGE_NAME}"
  run_as_app_user "$PNPM_BIN" --dir "$INSTALL_DIR" --filter "$APP_PACKAGE_NAME" run build
}

ensure_json_stores_control_plane() {
  log "Checking JSON data stores"
  mkdir -p "$DATA_DIR"
  chown "$APP_USER:$APP_GROUP" "$DATA_DIR"
  run_as_app_user env \
    HERD_DATA_DIR="$DATA_DIR" \
    "$PNPM_BIN" --dir "$INSTALL_DIR" --filter "$APP_PACKAGE_NAME" run store:ready -- --source-root "$DATA_DIR" \
    || die "JSON data stores are not ready. Resolve the store:ready error above, then rerun this installer."
}

ensure_sqlite_control_plane() {
  log "Checking SQLite runtime-session store"
  mkdir -p "$DATA_DIR"
  chown "$APP_USER:$APP_GROUP" "$DATA_DIR"
  run_as_app_user env \
    HERD_DATA_DIR="$DATA_DIR" \
    HERD_DB_PATH="$DATA_DIR/herd.sqlite" \
    "$PNPM_BIN" --dir "$INSTALL_DIR" --filter "$APP_PACKAGE_NAME" run db:ready -- --source-root "$DATA_DIR" --db "$DATA_DIR/herd.sqlite" \
    || die "SQLite runtime-session store is not ready. Resolve the db:ready error above, then rerun this installer."
}

escape_sed_replacement() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  printf '%s' "$value"
}

legacy_hervald_service_exists() {
  [[ -f /etc/systemd/system/hervald.service ]] && return 0
  systemctl list-unit-files hervald.service --no-legend 2>/dev/null | grep -q '^hervald\.service' && return 0
  systemctl list-units --all hervald.service --no-legend 2>/dev/null | grep -q '^hervald\.service' && return 0
  systemctl cat hervald.service >/dev/null 2>&1
}

migrate_legacy_hervald_service() {
  if ! legacy_hervald_service_exists; then
    return 0
  fi

  log "Disabling legacy hervald.service before installing ${SERVICE_NAME}.service"
  systemctl disable --now hervald.service || true
  rm -f /etc/systemd/system/hervald.service
  systemctl daemon-reload
}

install_systemd_unit() {
  log "Installing ${SERVICE_NAME}.service"

  sed \
    -e "s|__APP_USER__|$(escape_sed_replacement "$APP_USER")|g" \
    -e "s|__APP_GROUP__|$(escape_sed_replacement "$APP_GROUP")|g" \
    -e "s|__APP_DIR__|$(escape_sed_replacement "$APP_DIR")|g" \
    -e "s|__HOME_DIR__|$(escape_sed_replacement "$APP_HOME")|g" \
    -e "s|__DATA_DIR__|$(escape_sed_replacement "$DATA_DIR")|g" \
    -e "s|__PNPM_BIN__|$(escape_sed_replacement "$PNPM_BIN")|g" \
    -e "s|__SERVICE_PORT__|$(escape_sed_replacement "$SERVICE_PORT")|g" \
    "$SERVICE_TEMPLATE_PATH" > "/etc/systemd/system/${SERVICE_NAME}.service"

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}

restart_systemd_unit() {
  log "Restarting ${SERVICE_NAME}.service on direct port ${SERVICE_PORT}"
  systemctl restart "$SERVICE_NAME"
}

port_listener_pids() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

verify_local_health_service_owner() {
  systemctl is-active --quiet "${SERVICE_NAME}.service" \
    || die "${SERVICE_NAME}.service is not active while port ${SERVICE_PORT} answers /api/health."
  if systemctl is-active --quiet hervald.service; then
    die "Legacy hervald.service is still active while port ${SERVICE_PORT} answers /api/health."
  fi

  local main_pid
  main_pid="$(systemctl show "${SERVICE_NAME}.service" --property=MainPID --value)"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] \
    || die "${SERVICE_NAME}.service has no live MainPID while port ${SERVICE_PORT} answers /api/health."

  local listener_pids
  listener_pids="$(port_listener_pids "$SERVICE_PORT")"
  grep -Fxq "$main_pid" <<< "$listener_pids" \
    || die "Port ${SERVICE_PORT} is not owned by ${SERVICE_NAME}.service MainPID ${main_pid}; listeners: ${listener_pids:-none}."
}

wait_for_local_health() {
  log "Waiting for local health check"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${SERVICE_PORT}/api/health" >/dev/null 2>&1; then
      verify_local_health_service_owner
      return 0
    fi
    sleep 2
  done

  systemctl --no-pager status "$SERVICE_NAME" || true
  die "Local health check never became ready on port ${SERVICE_PORT}."
}

verify_direct_listener() {
  log "Verifying direct application listener"
  curl -fsS --max-time 3 "http://127.0.0.1:${SERVICE_PORT}/api/health" >/dev/null \
    || die "Direct API health check failed on port ${SERVICE_PORT}."
  curl -fsS --max-time 3 "http://127.0.0.1:${SERVICE_PORT}/org" | grep -Eiq '<!doctype html|<html' \
    || die "Direct document route check failed on port ${SERVICE_PORT}."
}

print_summary() {
  cat <<EOF

${APP_NAME} install complete.

Local health:
  http://127.0.0.1:${SERVICE_PORT}/api/health

Expected public URL:
  https://${TARGET_DOMAIN}

Verification:
  curl -fsS http://127.0.0.1:${SERVICE_PORT}/api/health
  curl -fsS https://${TARGET_DOMAIN}/api/health

Services:
  systemctl status ${SERVICE_NAME}

Logs:
  journalctl -u ${SERVICE_NAME} -f

Reminder:
  - Point ${TARGET_DOMAIN} at the ALB and route its host rule to port ${SERVICE_PORT}.
  - Allow port ${SERVICE_PORT} from the ALB security group only.
  - Use /api/health for the target-group health check.
EOF
}

main() {
  parse_args "$@"
  ensure_root
  detect_app_user
  prompt_for_domain
  validate_ports

  APP_HOME="$(resolve_home_dir "$APP_USER")"
  [[ -n "$APP_HOME" ]] || die "Unable to resolve HOME for ${APP_USER}."
  APP_GROUP="$(id -gn "$APP_USER")"

  INSTALL_DIR="${INSTALL_DIR:-${APP_HOME}/.herd}"
  DATA_DIR="${DATA_DIR:-${APP_HOME}/.herd}"

  install_base_packages
  install_node
  install_pnpm
  clone_or_update_repo
  resolve_repo_layout
  ensure_env_file
  align_env_service_port
  build_app
  write_app_path_file
  ensure_json_stores_control_plane
  ensure_sqlite_control_plane
  install_cli_shim
  migrate_legacy_hervald_service
  install_systemd_unit
  retire_legacy_caddy_site
  restart_systemd_unit
  wait_for_local_health
  verify_direct_listener
  print_summary
}

if [[ "${HERD_EC2_INSTALL_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
