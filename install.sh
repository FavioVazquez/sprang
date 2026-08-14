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
#   devin     Devin CLI / Devin Desktop
#   claude    Claude Code
#   copilot   GitHub Copilot CLI
#
# Each platform has a native plugin path (preferred) and a project-local path
# (always works). This script sets up the project-local path and prints the
# plugin command, because plugin availability differs per platform:
#   - Claude  : `/plugin marketplace add` works today
#   - Copilot : `copilot plugin install` works today
#   - Devin   : plugins are in closed beta and require `devin auth login`,
#               so the project-local `.devin/` layout is the primary route.
#
# Curl-pipe usage:
#   curl -fsSL https://raw.githubusercontent.com/faviovazquez/sprang/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/faviovazquez/sprang/main/install.sh | bash -s devin
#
# Environment:
#   SPRANG_REPO_URL  Override clone URL (default: official GitHub repo)
#   SPRANG_DIR       Override clone/install destination

set -euo pipefail

# WARNING: Setting SPRANG_REPO_URL redirects the clone to an arbitrary URL with
# no integrity check. Only use this to point to a trusted fork.
REPO_URL="${SPRANG_REPO_URL:-https://github.com/faviovazquez/sprang.git}"
REPO_DIR="${SPRANG_DIR:-$HOME/.sprang/repo}"

PLATFORM_IDS=(devin claude copilot)

platform_label() {
  case "$1" in
    devin)   printf 'Devin CLI / Devin Desktop' ;;
    claude)  printf 'Claude Code' ;;
    copilot) printf 'GitHub Copilot CLI' ;;
  esac
}

resolve_platform() {
  local id="$1" p
  for p in "${PLATFORM_IDS[@]}"; do
    [[ "$p" == "$id" ]] && { printf '%s\n' "$id"; return; }
  done
  printf 'Unknown platform: %s\n' "$id" >&2
  printf 'Supported: %s\n' "${PLATFORM_IDS[*]}" >&2
  exit 1
}

prompt_platform() {
  printf 'Which platform are you installing for?\n' >&2
  local i=1 id
  for id in "${PLATFORM_IDS[@]}"; do
    printf '  %d) %-8s — %s\n' "$i" "$id" "$(platform_label "$id")" >&2
    i=$((i + 1))
  done
  printf 'Choose [1-%d]: ' "${#PLATFORM_IDS[@]}" >&2

  local choice=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r choice <&3 || true
    exec 3<&-
  else
    read -r choice || true
  fi
  if [[ -z "$choice" ]]; then
    printf '\nNo input received. Pass the platform as an argument instead:\n' >&2
    printf '  install.sh devin\n' >&2
    exit 1
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#PLATFORM_IDS[@]} )); then
    printf 'Invalid choice: %s\n' "$choice" >&2
    exit 1
  fi
  printf '%s\n' "${PLATFORM_IDS[$((choice - 1))]}"
}

install_cli_bin() {
  local cli_bin="$REPO_DIR/packages/cli/dist/index.js"
  if [[ ! -f "$cli_bin" ]]; then
    printf '  ⚠ CLI binary not found at %s — skipping PATH link\n' "$cli_bin"
    return
  fi
  local bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  printf '#!/usr/bin/env sh\nexec node "%s" "$@"\n' "$cli_bin" > "$bin_dir/sprang"
  chmod +x "$bin_dir/sprang"
  printf '  ✓ sprang CLI linked → %s/sprang\n' "$bin_dir"
  if ! echo "$PATH" | grep -qF "$bin_dir"; then
    printf '  ℹ Add %s to your PATH if not already present:\n' "$bin_dir"
    printf '      echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.zshrc  # or ~/.bashrc\n'
  fi
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
  install_cli_bin
}

# Global skill directories. Project-level assets are installed per project with
# `sprang init --platform <p>`; only Copilot reads a global skills dir today.
global_skills_dir() {
  case "$1" in
    devin)   printf '%s/.config/devin/skills' "$HOME" ;;
    copilot) printf '%s/.copilot/skills' "$HOME" ;;
    claude)  printf '%s/.claude/skills' "$HOME" ;;
  esac
}

link_global_skills() {
  local target="$1"
  local root="$REPO_DIR/skills"
  [[ -d "$root" ]] || { printf 'Skills directory not found: %s\n' "$root" >&2; exit 1; }
  mkdir -p "$target"
  local d
  for d in "$root"/*/; do
    [[ -d "$d" ]] || continue
    local name; name="$(basename "$d")"
    ln -sfn "$root/$name" "$target/$name"
    printf '  ✓ linked %s\n' "$name"
  done
}

unlink_global_skills() {
  local target="$1"
  [[ -d "$target" ]] || return 0
  local d
  for d in "$REPO_DIR"/skills/*/; do
    [[ -d "$d" ]] || continue
    local name; name="$(basename "$d")"
    if [[ -L "$target/$name" ]]; then
      rm -f "$target/$name"
      printf '  ✗ removed %s\n' "$name"
    fi
  done
}

print_next_steps() {
  local platform="$1"
  printf '\nProject setup — run this inside each project you want indexed:\n\n'
  printf '  sprang init --platform %s\n' "$platform"
  printf '  sprang scan .\n\n'

  case "$platform" in
    devin)
      printf 'What `sprang init --platform devin` writes:\n'
      printf '  .devin/skills/      11 skills (/sprang, /sprang-analyze, …)\n'
      printf '  .devin/rules/       glob-triggered graph-context rules\n'
      printf '  .devin/hooks.v1.json + .devin/hooks/  stale-graph warning, post-commit refresh\n'
      printf '  .devin/mcp_config.json                MCP server (${workspaceFolder})\n\n'
      printf 'Plugin install (closed beta — needs `devin auth login`):\n'
      printf '  devin plugins install faviovazquez/sprang\n'
      ;;
    claude)
      printf 'What `sprang init --platform claude` writes:\n'
      printf '  .claude/skills/     11 skills (slash commands are skills now)\n'
      printf '  .claude/rules/      graph-context rules\n'
      printf '  .claude/settings.json  hooks + pre-approved permissions\n'
      printf '  .mcp.json           MCP server\n\n'
      printf 'Plugin install (works today), inside a Claude Code session:\n'
      printf '  /plugin marketplace add FavioVazquez/sprang\n'
      printf '  /plugin install sprang\n'
      ;;
    copilot)
      printf 'What `sprang init --platform copilot` writes:\n'
      printf '  skills/             11 skills\n'
      printf '  .github/copilot-instructions.md\n'
      printf '  .mcp.json           MCP server (Copilot CLI)\n'
      printf '  .vscode/mcp.json    MCP server (VS Code extension)\n\n'
      printf 'Plugin install (works today):\n'
      printf '  copilot plugin install faviovazquez/sprang\n'
      ;;
  esac
  printf '\nDashboard:\n'
  printf '  sprang open .\n\n'
  printf 'Full docs: %s/README.md\n' "$REPO_DIR"
}

show_usage() {
  cat <<EOF
Sprang installer (macOS / Linux)

Usage:
  install.sh [<platform>]             Install for <platform> (or prompt if omitted)
  install.sh --update                 Pull latest changes + rebuild
  install.sh --uninstall <platform>   Remove global skill links for <platform>
  install.sh --help

Supported platforms:
  devin     Devin CLI / Devin Desktop
  claude    Claude Code
  copilot   GitHub Copilot CLI

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
    --help|-h)   show_usage; exit 0 ;;
    --update)    ACTION="update"; shift ;;
    --uninstall) ACTION="uninstall"; PLATFORM="${2:-}"; shift 2 ;;
    --*)         printf 'Unknown flag: %s\n' "$1" >&2; exit 1 ;;
    *)           PLATFORM="$1"; shift ;;
  esac
done

if [[ "$ACTION" == "update" ]]; then
  clone_or_update
  printf '\n✓ Sprang updated.\n'
  exit 0
fi

[[ -n "$PLATFORM" ]] || PLATFORM="$(prompt_platform)"
PLATFORM="$(resolve_platform "$PLATFORM")"
TARGET="$(global_skills_dir "$PLATFORM")"

if [[ "$ACTION" == "uninstall" ]]; then
  printf '\n→ Uninstalling Sprang for %s...\n' "$PLATFORM"
  unlink_global_skills "$TARGET"
  printf '\n✓ Uninstalled. Project-level files (.devin/, .claude/, .github/) are left in place.\n'
  exit 0
fi

printf '\n→ Installing Sprang for %s...\n' "$(platform_label "$PLATFORM")"
clone_or_update

printf '→ Linking skills into %s\n' "$TARGET"
link_global_skills "$TARGET"
printf '\n✓ Skills linked globally for %s.\n' "$PLATFORM"

print_next_steps "$PLATFORM"
