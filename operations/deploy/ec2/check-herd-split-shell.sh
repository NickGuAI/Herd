#!/usr/bin/env bash

set -euo pipefail

TARGET_DOMAIN=""
CADDYFILE_PATH="/etc/caddy/Caddyfile"
PUBLIC_SHELL_PORT="20001"
SERVICE_HOST="127.0.0.1"
SERVICE_PORT="20009"

log() {
  printf '[split-shell-check] %s\n' "$*"
}

die() {
  printf '[split-shell-check] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: bash check-herd-split-shell.sh --domain <fqdn> [options]

Options:
  --domain <fqdn>       Domain that must appear in the Caddy site block (required)
  --caddyfile <path>    Caddyfile to validate (default: ${CADDYFILE_PATH})
  --shell-port <port>   Public shell port served by Caddy (default: ${PUBLIC_SHELL_PORT})
  --service-host <host> Private Herd API host (default: ${SERVICE_HOST})
  --service-port <port> Private Herd API port (default: ${SERVICE_PORT})
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
      --caddyfile)
        [[ $# -ge 2 ]] || die "--caddyfile requires a value"
        CADDYFILE_PATH="$2"
        shift 2
        ;;
      --caddyfile=*)
        CADDYFILE_PATH="${1#*=}"
        shift
        ;;
      --shell-port)
        [[ $# -ge 2 ]] || die "--shell-port requires a value"
        PUBLIC_SHELL_PORT="$2"
        shift 2
        ;;
      --shell-port=*)
        PUBLIC_SHELL_PORT="${1#*=}"
        shift
        ;;
      --service-host)
        [[ $# -ge 2 ]] || die "--service-host requires a value"
        SERVICE_HOST="$2"
        shift 2
        ;;
      --service-host=*)
        SERVICE_HOST="${1#*=}"
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

validate_args() {
  [[ -n "$TARGET_DOMAIN" ]] || die "--domain is required."
  [[ -f "$CADDYFILE_PATH" ]] || die "Caddyfile not found at ${CADDYFILE_PATH}."
  [[ "$PUBLIC_SHELL_PORT" =~ ^[0-9]+$ ]] || die "Invalid --shell-port value: ${PUBLIC_SHELL_PORT}"
  [[ "$SERVICE_PORT" =~ ^[0-9]+$ ]] || die "Invalid --service-port value: ${SERVICE_PORT}"
}

has_inline_healthz_response() {
  awk '
    $1 == "respond" && $2 == "/healthz" && ($3 == "200" || ($3 == "\"\"" && $4 == "200")) {
      found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$CADDYFILE_PATH"
}

has_matcher_healthz_response() {
  local matcher
  while IFS= read -r matcher; do
    if awk -v matcher="$matcher" '
      $1 == "respond" && $2 == matcher && ($3 == "200" || ($3 == "\"\"" && $4 == "200")) {
        found = 1
      }
      END { exit found ? 0 : 1 }
    ' "$CADDYFILE_PATH"; then
      return 0
    fi
  done < <(awk '$1 ~ /^@[A-Za-z0-9_-]+$/ && $2 == "path" && $3 == "/healthz" { print $1 }' "$CADDYFILE_PATH")

  return 1
}

require_caddy_block() {
  grep -Fq "$TARGET_DOMAIN" "$CADDYFILE_PATH" \
    || die "Caddyfile ${CADDYFILE_PATH} does not contain a site block for ${TARGET_DOMAIN}."
  has_inline_healthz_response || has_matcher_healthz_response \
    || die "Caddyfile ${CADDYFILE_PATH} does not serve /healthz from the shell layer."
  grep -Eq '^[[:space:]]*@api[[:space:]]+path[[:space:]]+/api/\*[[:space:]]+/v1/\*[[:space:]]+/install[.]sh([[:space:]]|$)' "$CADDYFILE_PATH" \
    || die "Caddyfile ${CADDYFILE_PATH} does not keep /api/* /v1/* /install.sh in the API proxy matcher."
  grep -Fq "reverse_proxy ${SERVICE_HOST}:${SERVICE_PORT}" "$CADDYFILE_PATH" \
    || die "Caddyfile ${CADDYFILE_PATH} does not proxy to ${SERVICE_HOST}:${SERVICE_PORT}."
}

require_private_api_listener() {
  local api_health_url="http://${SERVICE_HOST}:${SERVICE_PORT}/api/health"
  curl -fsS --max-time 3 "$api_health_url" >/dev/null \
    || die "Private API listener is missing or unhealthy at ${api_health_url}."
}

require_shell_owned_health() {
  local health_url="http://127.0.0.1:${PUBLIC_SHELL_PORT}/healthz"
  local headers
  local body
  headers="$(mktemp)"
  body="$(mktemp)"

  if ! curl -fsS --max-time 3 -D "$headers" -o "$body" "$health_url" >/dev/null; then
    rm -f "$headers" "$body"
    die "Shell health endpoint is unavailable at ${health_url}."
  fi

  if grep -Eiq '^x-powered-by:\s*express' "$headers"; then
    rm -f "$headers" "$body"
    die "/healthz at ${health_url} is still being served by Express."
  fi

  if grep -Eiq '<!doctype html|<html' "$body"; then
    rm -f "$headers" "$body"
    die "/healthz at ${health_url} returned HTML instead of the shell-owned health response."
  fi

  rm -f "$headers" "$body"
}

require_shell_api_proxy_health() {
  local api_health_url="http://127.0.0.1:${PUBLIC_SHELL_PORT}/api/health"
  curl -fsS --max-time 3 "$api_health_url" >/dev/null \
    || die "Shell API proxy is missing or unhealthy at ${api_health_url}."
}

main() {
  parse_args "$@"
  validate_args

  log "Checking Caddy block for ${TARGET_DOMAIN}"
  require_caddy_block

  log "Checking private API listener on ${SERVICE_HOST}:${SERVICE_PORT}"
  require_private_api_listener

  log "Checking shell-owned /healthz on port ${PUBLIC_SHELL_PORT}"
  require_shell_owned_health

  log "Checking shell proxy /api/health on port ${PUBLIC_SHELL_PORT}"
  require_shell_api_proxy_health

  log "Split-shell topology looks healthy"
}

main "$@"
