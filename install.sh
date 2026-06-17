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

# WARNING: Setting SPRANG_REPO_URL redirects the clone to an arbitrary URL with
# no integrity check. Only use this to point to a trusted fork.
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

install_cli_bin() {
  local cli_bin="$REPO_DIR/packages/cli/dist/index.js"
  if [[ ! -f "$cli_bin" ]]; then
    printf '  ⚠ CLI binary not found at %s — skipping PATH link\n' "$cli_bin"
    return
  fi
  # Try ~/.local/bin first (XDG standard, no sudo needed)
  local bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  # Write a wrapper script so it works without 'node' prefix
  printf '#!/usr/bin/env sh\nexec node "%s" "$@"\n' "$cli_bin" > "$bin_dir/sprang"
  chmod +x "$bin_dir/sprang"
  printf '  ✓ sprang CLI linked → %s/sprang\n' "$bin_dir"
  # Remind user to add ~/.local/bin to PATH if not already there
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
  printf '  Claude Code uses project-local config files.\n'
  printf '  No global install is needed — all config ships with Sprang.\n\n'

  printf '  Option A — Plugin marketplace (recommended, gives namespaced commands /sprang:sprang-*):\n'
  printf '    Inside a Claude Code session run:\n'
  printf '      /plugin marketplace add FavioVazquez/sprang\n'
  printf '      /plugin install sprang\n'
  printf '    Then build the MCP server binary:\n'
  printf '      cd "$(ls -d ~/.claude/plugins/cache/sprang/sprang/*/ | tail -1)"\n'
  printf '      pnpm install && pnpm build\n'
  printf '    Then run /reload-plugins inside Claude Code.\n\n'

  printf '  Option B — Manual copy (gives unnamespaced /sprang, /sprang-onboard, etc.):\n'
  printf '    Copy these into your project root:\n'
  printf '      cp %s/.mcp.json          <your-project>/\n' "$REPO_DIR"
  printf '      cp %s/CLAUDE.md          <your-project>/\n' "$REPO_DIR"
  printf '      cp %s/AGENTS.md          <your-project>/\n' "$REPO_DIR"
  printf '      cp -r %s/.claude/        <your-project>/.claude/\n' "$REPO_DIR"
  printf '    Then in <your-project>/.mcp.json update args to the absolute server path:\n'
  printf '      "args": ["%s/packages/mcp/dist/server.js"]\n' "$REPO_DIR"
  printf '    Finally, open the project in Claude Code and run /sprang.\n\n'

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
  printf '\n✓ Skills linked for %s.\n\n' "$PLATFORM"
  case "$PLATFORM" in
    windsurf)
      printf 'Next steps to complete the Windsurf / Devin Desktop setup:\n\n'
      printf '  1. Add the MCP server to ~/.codeium/windsurf/mcp_config.json:\n'
      printf '     {\n'
      printf '       "mcpServers": { "sprang": {\n'
      printf '         "command": "node",\n'
      printf '         "args": ["%s/packages/mcp/dist/server.js"],\n' "$REPO_DIR"
      printf '         "env": { "SPRANG_ROOT": "/path/to/your/project" }\n'
      printf '       }}\n'
      printf '     }\n\n'
      printf '  2. Copy rules + hooks into your project root:\n'
      printf '     mkdir -p .windsurf/rules .devin/rules .windsurf/hooks .windsurf/workflows .windsurf/skills\n'
      printf '     cp %s/.windsurf/rules/*.md .windsurf/rules/\n' "$REPO_DIR"
      printf '     cp %s/.devin/rules/*.md .devin/rules/\n' "$REPO_DIR"
      printf '     cp %s/.windsurf/hooks.json .windsurf/hooks.json\n' "$REPO_DIR"
      printf '     cp %s/.windsurf/hooks/save-conversation.py .windsurf/hooks/save-conversation.py\n' "$REPO_DIR"
      printf '     cp %s/.windsurf/workflows/*.md .windsurf/workflows/\n' "$REPO_DIR"
      printf '     cp -r %s/.windsurf/skills/sprang* .windsurf/skills/\n\n' "$REPO_DIR"
      printf '  3. Reload the Windsurf window (Cmd/Ctrl+Shift+P → Reload Window)\n'
      printf '  4. Run: sprang scan /path/to/your/project --phase1-only\n\n'
      printf '  Tip: instead of steps 1-4, paste the agentic install prompt from the README\n'
      printf '  into Cascade or Devin — it handles everything automatically.\n'
      printf '  Full docs: https://github.com/faviovazquez/sprang#windsurf--devin-desktop--agentic-install\n'
      ;;
    copilot)
      printf 'Next steps to complete the GitHub Copilot setup:\n\n'
      printf '  1. Copy .vscode/mcp.json into your project root:\n'
      printf '     mkdir -p .vscode\n'
      printf '     cp %s/.vscode/mcp.json .vscode/mcp.json\n' "$REPO_DIR"
      printf '     Then edit .vscode/mcp.json → update args to: ["%s/packages/mcp/dist/server.js"]\n\n' "$REPO_DIR"
      printf '  2. Copy copilot-instructions.md into your project:\n'
      printf '     mkdir -p .github\n'
      printf '     cp %s/.github/copilot-instructions.md .github/copilot-instructions.md\n\n' "$REPO_DIR"
      printf '  3. Open VS Code, switch Copilot to Agent mode (model selector in chat panel)\n'
      printf '  4. Run: sprang scan /path/to/your/project --phase1-only\n\n'
      printf '  Note: MCP tools only work in Copilot Agent mode (not default ask/edit modes).\n'
      printf '  Full docs: https://github.com/faviovazquez/sprang#github-copilot\n'
      ;;
  esac
fi
