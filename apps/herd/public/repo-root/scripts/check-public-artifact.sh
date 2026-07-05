#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEAK_COUNT=0

# Token splits below keep the release rename/sanitize passes from rewriting
# this scanner's own pattern strings (HERD_->HERD_, commander-name map,
# Herd->Herd would otherwise invert these gates in the shipped artifact).

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

required_paths=(
  "README.md"
  "CHANGELOG.md"
  "install.sh"
  "docs"
  "docs/llms.txt"
  "docs/getting-started/quickstart.md"
  "apps/herd"
  "apps/herd/.env.example"
  "packages"
  "operations/deploy/ec2/Caddyfile"
  "operations/deploy/ec2/install-ec2.sh"
  "operations/deploy/ec2/herd.service"
  "operations/deploy/ec2/check-herd-split-shell.sh"
  "operations/deploy/ec2/smoke-test.sh"
)

for path in "${required_paths[@]}"; do
  if [ ! -e "$ROOT/$path" ]; then
    red "missing required public artifact path: $path"
    LEAK_COUNT=$((LEAK_COUNT + 1))
  fi
done

for path in \
  "apps/herd/CLAUDE.md" \
  "apps/herd/.claude" \
  "apps/herd/agents" \
  "apps/herd/data/policies" \
  "apps/herd/ios" \
  "apps/herd/modules/commanders/README.md" \
  "apps/herd/modules/policies/README.md" \
  "apps/herd/docs" \
  "apps/herd/assets" \
  "benchmarks/herd"; do
  if [ -e "$ROOT/$path" ]; then
    red "internal-only path present in public artifact: $path"
    LEAK_COUNT=$((LEAK_COUNT + 1))
  fi
done

old_upper="Ham""murabi"
old_lower="ham""murabi"
old_env="HAM""MURABI"
old_header="X-${old_upper}"
old_product_hits="$(
  grep -rEI "${old_upper}|${old_lower}|${old_env}|${old_header}" \
    --include='*.md' \
    --include='*.txt' \
    --include='*.example' \
    --include='.env.example' \
    "$ROOT/README.md" "$ROOT/CHANGELOG.md" "$ROOT/docs" "$ROOT/apps/herd" "$ROOT/packages" 2>/dev/null \
    | grep -v '/node_modules/' \
    | grep -v '/dist/' \
    | grep -v '/dist-server/' \
    || true
)"
if [ -n "$old_product_hits" ]; then
  red "old internal product names present in public artifact:"
  printf '%s\n' "$old_product_hits" | head -20 | sed "s|^$ROOT/|  |"
  LEAK_COUNT=$((LEAK_COUNT + 1))
fi

herd_env_residue_files=()
if [ -f "$ROOT/apps/herd/.env.example" ]; then
  herd_env_residue_files+=("$ROOT/apps/herd/.env.example")
fi
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  while IFS= read -r -d '' path; do
    example_path="$ROOT/$path"
    if [ "$example_path" != "$ROOT/apps/herd/.env.example" ]; then
      herd_env_residue_files+=("$example_path")
    fi
  done < <(git -C "$ROOT" ls-files -z -- 'apps/herd/*.example' 'apps/herd/**/*.example' 2>/dev/null || true)
fi

if [ "${#herd_env_residue_files[@]}" -gt 0 ]; then
  herd_env_residue_hits="$(
    grep -nH -F 'HAMMU''RABI_' "${herd_env_residue_files[@]}" 2>/dev/null \
      || true
  )"
else
  herd_env_residue_hits=""
fi
if [ -n "$herd_env_residue_hits" ]; then
  red "HAMMU""RABI_ residue present in public env/example templates:"
  printf '%s\n' "$herd_env_residue_hits" | head -20 | sed "s|^$ROOT/|  |"
  LEAK_COUNT=$((LEAK_COUNT + 1))
fi

identity_hits="$(
  grep -rEI '\b(Ath''ena|Jar''vis|Alb''ert|War''ren|Zen''dude|gehirn-''main-ec2)\b|mono''repo-g' \
    --include='*.md' \
    --include='*.txt' \
    --include='*.ts' \
    --include='*.tsx' \
    --include='*.js' \
    --include='*.jsx' \
    --include='*.mjs' \
    --include='*.cjs' \
    --include='*.json' \
    --include='*.yaml' \
    --include='*.yml' \
    --include='*.sh' \
    --include='*.example' \
    --include='.env.example' \
    "$ROOT" 2>/dev/null \
    | grep -v "^$ROOT/.git/" \
    | grep -v '/node_modules/' \
    | grep -v '/dist/' \
    | grep -v '/dist-server/' \
    | grep -v "^$ROOT/scripts/check-public-artifact.sh:" \
    | grep -v "^$ROOT/LICENSE" \
    | grep -v "^$ROOT/NOTICE" \
    || true
)"
if [ -n "$identity_hits" ]; then
  red "commander identity or internal infra strings present:"
  printf '%s\n' "$identity_hits" | head -20 | sed "s|^$ROOT/|  |"
  LEAK_COUNT=$((LEAK_COUNT + 1))
fi

secret_hits="$(
  grep -rIlE '(vcp_[A-Za-z0-9]{30,}|team_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[po]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|PRIVATE KEY)' \
    --include='*.md' \
    --include='*.txt' \
    --include='*.ts' \
    --include='*.tsx' \
    --include='*.js' \
    --include='*.jsx' \
    --include='*.mjs' \
    --include='*.cjs' \
    --include='*.json' \
    --include='*.yaml' \
    --include='*.yml' \
    --include='*.sh' \
    --include='*.example' \
    --include='.env.example' \
    --include='*.env' \
    "$ROOT" 2>/dev/null \
    | grep -v "^$ROOT/.git/" \
    | grep -v '/node_modules/' \
    | grep -v '/dist/' \
    | grep -v '/dist-server/' \
    | grep -v "^$ROOT/scripts/check-public-artifact.sh$" \
    | grep -v "^$ROOT/apps/herd/public/repo-root/scripts/check-public-artifact.sh$" \
    || true
)"
if [ -n "$secret_hits" ]; then
  red "secret-shaped strings present:"
  printf '%s\n' "$secret_hits" | head -20 | sed "s|^$ROOT/|  |"
  LEAK_COUNT=$((LEAK_COUNT + 1))
fi

if [ "$LEAK_COUNT" -gt 0 ]; then
  red "$LEAK_COUNT public artifact cleanliness check(s) failed."
  exit 1
fi

green "public artifact cleanliness checks passed."
