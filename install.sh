#!/usr/bin/env bash
# Sprang installer (macOS / Linux)
#
# Usage:
#   ./install.sh                       Prompt for platform
#   ./install.sh <platform>            Install for <platform>
#   ./install.sh --update              Pull latest changes + rebuild
#   ./install.sh --uninstall <plat>    Remove links for <plat>
#   ./install.sh --help
#
# Supported platforms:
#   windsurf   Devin Desktop / Windsurf (skills in ~/.windsurf/skills/)
#   copilot    GitHub Copilot VS Code extension (skills in ~/.copilot/skills/)
#   claude     Claude Code (project-local via .mcp.json — no global install needed)
#
# Curl-pipe usage:
#   curl -fsSL https://raw.githubusercontent.com/faviovazquez/sprang/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/faviovazquez/sprang/main/install.sh | bash -s windsurf
#
# Environment:
#   SPRANG_REPO_URL  Override clone URL (default: official GitHub repo)
#   SPRANG_DIR       Override clone/install destination

set -euo pipefail

REPO_URL="${SPRANG_REPO_URL:-https://github.com/faviovazquez/sprang.git}"
REPO_DIR="${SPRANG_DIR:-$HOME/.sprang/repo}"

# Platform table — id|skills-target-dir|style
# style "per-skill": one symlink per skill dir into the target
# style "folder":    one symlink for the whole skills/ dir named "sprang"
platforms_table() {
  cat <<EOF
windsurf|$HOME/.windsurf/skills|per-skill
copilot|$HOME/.copilot/skills|per-skill
claude|__claude__|claude
EOF
}

platform_ids() { platforms_table | cut -d'|' -f1; }

resolve_platform() {
  local id="$1"
  local row
  row="$(platforms_table | awk -F'|' -v id="$id" '$1==id {print; exit}')"
  if [[ -z "$row" ]]; then
    printf 'Unknown platform: %s\n' "$id" >&2
    printf 'Supported: %s\n' "$(platform_ids | tr '\n' ' ')" >&2
    exit 1
  fi
  printf '%s\n' "$row"
}

prompt_platform() {
  local ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(platform_ids)

  printf 'Which platform are you installing for?\n' >&2
  local i=1
  for id in "${ids[@]}"; do
    case "$id" in
      windsurf) printf '  %d) %s   — Devin Desktop / Windsurf\n' "$i" "$id" >&2 ;;
      copilot)  printf '  %d) %s     — GitHub Copilot (VS Code)\n' "$i" "$id" >&2 ;;
      claude)   printf '  %d) %s      — Claude Code (project-local)\n' "$i" "$id" >&2 ;;
    esac
    i=$((i+1))
  done
  printf 'Choose [1-%d]: ' "${#ids[@]}" >&2

  local choice=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r choice <&3 || true
    exec 3<&-
  else
    read -r choice || true
  fi
  if [[ -z "$choice" ]]; then
    printf '\nNo input received. Pass the platform as an argument instead:\n' >&2
    printf '  install.sh windsurf\n' >&2
    exit 1
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#ids[@]} )); then
    printf 'Invalid choice: %s\n' "$choice" >&2
    exit 1
  fi
  printf '%s\n' "${ids[$((choice-1))]}"
}

clone_or_update() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    printf -- '→ Updating existing checkout at %s\n' "$REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only
  else
    printf -- '→ Cloning %s → %s\n' "$REPO_URL" "$REPO_DIR"
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
  printf -- '→ Installing dependencies and building...\n'
  (cd "$REPO_DIR" && pnpm install --frozen-lockfile && pnpm build)
}

skills_root() {
  # Skills live in .windsurf/skills/ (Windsurf/Devin format); also check .agents/skills/ fallback
  if [[ -d "$REPO_DIR/.windsurf/skills" ]]; then
    printf '%s\n' "$REPO_DIR/.windsurf/skills"
  elif [[ -d "$REPO_DIR/.agents/skills" ]]; then
    printf '%s\n' "$REPO_DIR/.agents/skills"
  else
    printf '%s\n' "$REPO_DIR/.windsurf/skills"
  fi
}

list_skills() {
  local root
  root="$(skills_root)"
  if [[ ! -d "$root" ]]; then
    printf 'Skills directory not found: %s\n' "$root" >&2
    exit 1
  fi
  local d
  for d in "$root"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

link_skills() {
  local target="$1" style="$2"
  local root
  root="$(skills_root)"
  mkdir -p "$target"
  case "$style" in
    per-skill)
      local skill
      while IFS= read -r skill; do
        ln -sfn "$root/$skill" "$target/$skill"
        printf '  ✓ linked %s\n' "$skill"
      done < <(list_skills)
      ;;
    folder)
      ln -sfn "$root" "$target/sprang"
      printf '  ✓ linked skills folder → %s/sprang\n' "$target"
      ;;
    *)
      printf 'Unknown style: %s\n' "$style" >&2
      exit 1
      ;;
  esac
}

unlink_skills() {
  local target="$1" style="$2"
  [[ -d "$target" ]] || return 0
  case "$style" in
    per-skill)
      if [[ -d "$(skills_root)" ]]; then
        local skill
        while IFS= read -r skill; do
          if [[ -L "$target/$skill" ]]; then
            rm -f "$target/$skill"
            printf '  ✗ removed %s\n' "$skill"
          fi
        done < <(list_skills)
      fi
      ;;
    folder)
      if [[ -L "$target/sprang" ]]; then
        rm -f "$target/sprang"
        printf '  ✗ removed %s/sprang\n' "$target"
      fi
      ;;
  esac
}

install_claude() {
  printf '\n→ Claude Code installation\n'
  printf '  Claude Code uses a project-local .mcp.json file.\n'
  printf '  No global install is needed — Sprang is already configured per-project.\n\n'
  printf '  To enable Sprang in a project:\n'
  printf '  1. Copy .mcp.json and CLAUDE.md from the Sprang repo into your project root:\n'
  printf '       cp %s/.mcp.json <your-project>/\n' "$REPO_DIR"
  printf '       cp %s/CLAUDE.md <your-project>/\n' "$REPO_DIR"
  printf '  2. In .mcp.json, set SPRANG_ROOT to the project root (default: ".")\n'
  printf '  3. Build the knowledge graph: run /sprang inside Claude Code\n\n'
  printf '  For full details: %s/CLAUDE.md\n' "$REPO_DIR"
}

show_usage() {
  cat <<EOF
Sprang installer (macOS / Linux)

Usage:
  install.sh [<platform>]             Install for <platform> (or prompt if omitted)
  install.sh --update                 Pull latest changes + rebuild
  install.sh --uninstall <platform>   Remove links for <platform>
  install.sh --help

Supported platforms:
  windsurf   Devin Desktop / Windsurf
  copilot    GitHub Copilot (VS Code)
  claude     Claude Code (project-local setup guide)

Environment:
  SPRANG_REPO_URL  Override clone URL
  SPRANG_DIR       Override install destination (default: ~/.sprang/repo)
EOF
}

# --- Main ---

ACTION="install"
PLATFORM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)        show_usage; exit 0 ;;
    --update)         ACTION="update"; shift ;;
    --uninstall)      ACTION="uninstall"; PLATFORM="${2:-}"; shift 2 ;;
    --*)              printf 'Unknown flag: %s\n' "$1" >&2; exit 1 ;;
    *)                PLATFORM="$1"; shift ;;
  esac
done

if [[ "$ACTION" == "update" ]]; then
  clone_or_update
  printf '\n✓ Sprang updated.\n'
  exit 0
fi

if [[ -z "$PLATFORM" ]]; then
  PLATFORM="$(prompt_platform)"
fi

row="$(resolve_platform "$PLATFORM")"
target="$(echo "$row" | cut -d'|' -f2)"
style="$(echo "$row" | cut -d'|' -f3)"

if [[ "$ACTION" == "uninstall" ]]; then
  printf '\n→ Uninstalling Sprang for %s...\n' "$PLATFORM"
  if [[ "$style" == "claude" ]]; then
    printf '  Claude Code is project-local — nothing to unlink globally.\n'
  else
    unlink_skills "$target" "$style"
  fi
  printf '\n✓ Uninstalled.\n'
  exit 0
fi

# Install
printf '\n→ Installing Sprang for %s...\n' "$PLATFORM"
clone_or_update

if [[ "$style" == "claude" ]]; then
  install_claude
else
  printf '→ Linking skills into %s\n' "$target"
  link_skills "$target" "$style"
  printf '\n✓ Sprang installed for %s.\n' "$PLATFORM"
  printf '  Run /sprang inside %s to build the knowledge graph.\n' "$PLATFORM"
fi
