#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_NAME=".gehirn-manifest"

PLATFORM="claude"
TARGET_ROOT=""
INSTALL_ALL=false
PLATFORM_SELECTED=false

usage() {
  cat <<'EOF'
Usage: install.sh [--platform claude|codex|openclaw] [--target-root <path>]

Platform shortcuts:
  --claude      Install into ~/.claude
  --codex       Install into ~/.codex
  --openclaw    Install into ~/.openclaw

Compatibility flags:
  --global      Install into ~/.claude, ~/.codex, and ~/.openclaw
  --project P   Install Claude assets into P/.claude
EOF
}

resolve_target_root() {
  local platform="$1"
  local explicit_root="$2"
  if [[ -n "$explicit_root" ]]; then
    printf '%s\n' "$explicit_root"
    return
  fi

  case "$platform" in
    claude) printf '%s\n' "$HOME/.claude" ;;
    codex) printf '%s\n' "$HOME/.codex" ;;
    openclaw) printf '%s\n' "$HOME/.openclaw" ;;
    *)
      echo "Error: unknown platform: $platform" >&2
      exit 1
      ;;
  esac
}

discover_skills_in_source() {
  local source_dir="$1"
  local scan_dir="$source_dir"
  local skill_dir=""

  if [[ -d "$source_dir/skills" ]]; then
    scan_dir="$source_dir/skills"
  fi

  for skill_dir in "$scan_dir"/*; do
    [[ -d "$skill_dir" ]] || continue
    [[ -f "$skill_dir/SKILL.md" ]] || continue
    printf '%s\n' "$skill_dir"
  done
}

discover_source_dirs() {
  local source_dir=""

  for source_dir in "$REPO_ROOT"/*; do
    [[ -d "$source_dir" ]] || continue

    if compgen -G "$source_dir/*/SKILL.md" > /dev/null || \
       compgen -G "$source_dir/skills/*/SKILL.md" > /dev/null || \
       [[ -d "$source_dir/templates" ]] || \
       [[ -d "$source_dir/agents" ]]; then
      printf '%s\n' "$source_dir"
    fi
  done
}

manifest_contains() {
  local needle="$1"
  shift
  local item=""

  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

is_safe_manifest_skill_name() {
  local skill_name="$1"

  [[ -n "$skill_name" ]] && [[ "$skill_name" != .* ]] && [[ "$skill_name" != */* ]]
}

prune_retired_skills() {
  local skills_dest="$1"
  shift
  local manifest_path="$skills_dest/$MANIFEST_NAME"
  local skill_name=""
  local skill_path=""

  [[ -f "$manifest_path" ]] || return 0

  while IFS= read -r skill_name || [[ -n "$skill_name" ]]; do
    [[ -n "$skill_name" ]] || continue

    if manifest_contains "$skill_name" "$@"; then
      continue
    fi

    if ! is_safe_manifest_skill_name "$skill_name"; then
      echo "Skipping unsafe manifest entry: $skill_name" >&2
      continue
    fi

    skill_path="$skills_dest/$skill_name"
    if [[ -e "$skill_path" || -L "$skill_path" ]]; then
      rm -rf -- "$skill_path"
      printf '%s\n' "$skill_name"
    fi
  done < "$manifest_path"
}

write_skill_manifest() {
  local skills_dest="$1"
  shift
  local manifest_path="$skills_dest/$MANIFEST_NAME"
  local tmp_path="$manifest_path.tmp"
  local skill_name=""

  {
    for skill_name in "$@"; do
      printf '%s\n' "$skill_name"
    done
  } | LC_ALL=C sort -u > "$tmp_path"
  mv "$tmp_path" "$manifest_path"
}

install_platform() {
  local platform="$1"
  local target_root="$2"
  local skills_dest="$target_root/skills"
  local templates_dest="$target_root/templates"
  local agents_dest="$target_root/agents"

  local source_dir=""
  local skill_dir=""
  local skill_name=""
  local template_path=""
  local agent_file=""

  local -a source_dirs=()
  local -a installed_skills=()
  local -a installed_templates=()
  local -a installed_agents=()
  local -a duplicate_skills=()
  local -a pruned_skills=()

  # bash 3 compatible seen-skills tracking (no associative arrays)
  local -a seen_skill_names=()
  local -a seen_skill_dirs=()

  mkdir -p "$skills_dest"
  mkdir -p "$templates_dest"
  if [[ "$platform" == "claude" ]]; then
    mkdir -p "$agents_dest"
  fi

  while IFS= read -r source_dir; do
    source_dirs+=("$source_dir")
  done < <(discover_source_dirs)

  for source_dir in "${source_dirs[@]}"; do
    [[ -d "$source_dir" ]] || continue

    while IFS= read -r skill_dir; do
      skill_name="$(basename "$skill_dir")"
      local _found_idx=-1 _i
      for _i in "${!seen_skill_names[@]}"; do
        if [[ "${seen_skill_names[$_i]}" == "$skill_name" ]]; then
          _found_idx="$_i"
          break
        fi
      done
      if [[ $_found_idx -ge 0 ]]; then
        duplicate_skills+=("$skill_name (kept ${seen_skill_dirs[$_found_idx]}, skipped $skill_dir)")
        continue
      fi
      seen_skill_names+=("$skill_name")
      seen_skill_dirs+=("$skill_dir")
      # Copy skill files, preserving any existing user-edited config files (*.conf, *.env, *.json)
      mkdir -p "$skills_dest/$skill_name"
      while IFS= read -r -d '' src_file; do
        rel="${src_file#$skill_dir/}"
        dst_file="$skills_dest/$skill_name/$rel"
        # Skip user-editable config files that already exist in the destination
        if [[ "$rel" == *.conf || "$rel" == *.env || "$rel" == *.json ]] && [[ ! "$rel" == *.template ]] && [[ -f "$dst_file" ]]; then
          continue
        fi
        mkdir -p "$(dirname "$dst_file")"
        cp "$src_file" "$dst_file"
      done < <(find "$skill_dir" -type f -print0)
      installed_skills+=("$skill_name")
    done < <(discover_skills_in_source "$source_dir")

    if [[ -d "$source_dir/templates" ]]; then
      for template_path in "$source_dir/templates"/*; do
        [[ -e "$template_path" ]] || continue
        cp -R "$template_path" "$templates_dest/"
        installed_templates+=("$(basename "$template_path")")
      done
    fi

    if [[ "$platform" == "claude" && -d "$source_dir/agents" ]]; then
      for agent_file in "$source_dir/agents"/*.md; do
        [[ -f "$agent_file" ]] || continue
        cp "$agent_file" "$agents_dest/"
        installed_agents+=("$(basename "$agent_file")")
      done
    fi
  done

  while IFS= read -r skill_name; do
    pruned_skills+=("$skill_name")
  done < <(prune_retired_skills "$skills_dest" "${installed_skills[@]}")
  write_skill_manifest "$skills_dest" "${installed_skills[@]}"

  find "$skills_dest" -type f -name "*.sh" -exec chmod +x {} +

  echo "Platform: $platform"
  echo "Target root: $target_root"
  echo "Skills destination: $skills_dest"
  echo "Installed ${#installed_skills[@]} skills:"
  for skill_name in "${installed_skills[@]}"; do
    echo "  - $skill_name"
  done
  echo "Skill manifest: $skills_dest/$MANIFEST_NAME"

  if [[ ${#pruned_skills[@]} -gt 0 ]]; then
    echo "Pruned ${#pruned_skills[@]} retired repo-managed skill(s):"
    for skill_name in "${pruned_skills[@]}"; do
      echo "  - $skill_name"
    done
  fi

  if [[ ${#installed_templates[@]} -gt 0 ]]; then
    echo "Installed templates to: $templates_dest"
  fi

  if [[ "$platform" == "claude" ]]; then
    echo "Installed ${#installed_agents[@]} agent file(s) to: $agents_dest"
  fi

  if [[ ${#duplicate_skills[@]} -gt 0 ]]; then
    echo ""
    echo "Duplicate skill names detected (first source wins):"
    for skill_name in "${duplicate_skills[@]}"; do
      echo "  - $skill_name"
    done
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "Error: --platform requires a value" >&2
        usage >&2
        exit 1
      fi
      PLATFORM="${2:-}"
      PLATFORM_SELECTED=true
      shift 2
      ;;
    --claude)
      PLATFORM="claude"
      PLATFORM_SELECTED=true
      shift
      ;;
    --global)
      INSTALL_ALL=true
      shift
      ;;
    --codex)
      PLATFORM="codex"
      PLATFORM_SELECTED=true
      shift
      ;;
    --openclaw)
      PLATFORM="openclaw"
      PLATFORM_SELECTED=true
      shift
      ;;
    --target-root)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "Error: --target-root requires a path" >&2
        usage >&2
        exit 1
      fi
      TARGET_ROOT="${2:-}"
      shift 2
      ;;
    --project)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "Error: --project requires a path" >&2
        usage >&2
        exit 1
      fi
      TARGET_ROOT="${2:-}/.claude"
      PLATFORM="claude"
      PLATFORM_SELECTED=true
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$INSTALL_ALL" == "true" ]]; then
  if [[ "$PLATFORM_SELECTED" == "true" || -n "$TARGET_ROOT" ]]; then
    echo "Error: --global cannot be combined with --platform, platform shortcuts, --target-root, or --project" >&2
    usage >&2
    exit 1
  fi

  for platform in claude codex openclaw; do
    target_root="$(resolve_target_root "$platform" "")"
    mkdir -p "$target_root"
    install_platform "$platform" "$target_root"
  done
  exit 0
fi

case "$PLATFORM" in
  claude|codex|openclaw) ;;
  *)
    echo "Error: unsupported platform '$PLATFORM'" >&2
    usage >&2
    exit 1
    ;;
esac

TARGET_ROOT="$(resolve_target_root "$PLATFORM" "$TARGET_ROOT")"
mkdir -p "$TARGET_ROOT"

install_platform "$PLATFORM" "$TARGET_ROOT"
