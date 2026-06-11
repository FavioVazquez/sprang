<#
.SYNOPSIS
  Sprang installer for Windows (PowerShell).

.DESCRIPTION
  Clones the repo, builds it, and creates skill symlinks/junctions for the chosen platform.

.EXAMPLE
  .\install.ps1                        # prompt for platform
  .\install.ps1 windsurf               # install for Devin Desktop / Windsurf
  .\install.ps1 copilot                # install for GitHub Copilot (VS Code)
  .\install.ps1 claude                 # Claude Code setup guide
  .\install.ps1 -Update                # pull latest changes + rebuild
  .\install.ps1 -Uninstall windsurf    # remove links for windsurf
  .\install.ps1 -Help
#>

param(
    [Parameter(Position = 0)]
    [string]$Platform,
    [switch]$Update,
    [string]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:SPRANG_REPO_URL) { $env:SPRANG_REPO_URL } else { 'https://github.com/faviovazquez/sprang.git' }
$RepoDir = if ($env:SPRANG_DIR)      { $env:SPRANG_DIR }      else { Join-Path $HOME '.sprang\repo' }

# Platform table: Target = skills directory; Style = "per-skill" | "folder" | "claude"
$Platforms = [ordered]@{
    windsurf = @{ Target = (Join-Path $HOME '.windsurf\skills'); Style = 'per-skill'; Desc = 'Devin Desktop / Windsurf' }
    copilot  = @{ Target = (Join-Path $HOME '.copilot\skills');  Style = 'per-skill'; Desc = 'GitHub Copilot (VS Code)' }
    claude   = @{ Target = $null;                                Style = 'claude';    Desc = 'Claude Code (project-local)' }
}

function Show-Usage {
    @"
Sprang installer (Windows)

Usage:
  install.ps1 [<platform>]               Install for <platform> (or prompt if omitted)
  install.ps1 -Update                    Pull latest changes + rebuild
  install.ps1 -Uninstall <platform>      Remove links for <platform>
  install.ps1 -Help

Supported platforms:
  windsurf   Devin Desktop / Windsurf
  copilot    GitHub Copilot (VS Code)
  claude     Claude Code (project-local setup guide)

Environment:
  SPRANG_REPO_URL   Override clone URL
  SPRANG_DIR        Override install destination (default: %USERPROFILE%\.sprang\repo)
"@
}

function Resolve-Platform([string]$Id) {
    if (-not $Platforms.Contains($Id)) {
        Write-Error "Unknown platform: $Id. Supported: $($Platforms.Keys -join ', ')"
    }
    return $Platforms[$Id]
}

function Prompt-Platform {
    $ids = @($Platforms.Keys)
    Write-Host 'Which platform are you installing for?'
    for ($i = 0; $i -lt $ids.Count; $i++) {
        $desc = $Platforms[$ids[$i]].Desc
        Write-Host ("  {0}) {1,-12} — {2}" -f ($i + 1), $ids[$i], $desc)
    }
    $choice = Read-Host ("Choose [1-{0}]" -f $ids.Count)
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 1 -or $n -gt $ids.Count) {
        Write-Error "Invalid choice: $choice"
    }
    return $ids[$n - 1]
}

function Get-SkillsRoot {
    # Skills live in .windsurf\skills\; fall back to .agents\skills\ if present
    $windsurf = Join-Path $RepoDir '.windsurf\skills'
    $agents   = Join-Path $RepoDir '.agents\skills'
    if (Test-Path $windsurf) { return $windsurf }
    if (Test-Path $agents)   { return $agents }
    return $windsurf
}

function Install-CliBin {
    $cliBin = Join-Path $RepoDir 'packages\cli\dist\index.js'
    if (-not (Test-Path $cliBin)) {
        Write-Host "  ⚠ CLI binary not found at $cliBin — skipping PATH link"
        return
    }
    # Write a .cmd wrapper to %LOCALAPPDATA%\Microsoft\WindowsApps (on PATH by default on Windows 10+)
    $binDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
    if (-not (Test-Path $binDir)) {
        $binDir = Join-Path $env:USERPROFILE '.local\bin'
        if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
        Write-Host "  ℹ Add $binDir to your PATH if not already present"
    }
    $wrapper = "@echo off`r`nnode `"$cliBin`" %*`r`n"
    [System.IO.File]::WriteAllText((Join-Path $binDir 'sprang.cmd'), $wrapper)
    Write-Host "  ✓ sprang CLI linked → $binDir\sprang.cmd"
}

function Clone-Or-Update {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "→ Updating existing checkout at $RepoDir"
        git -C "$RepoDir" pull --ff-only
    } else {
        Write-Host "→ Cloning $RepoUrl → $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone "$RepoUrl" "$RepoDir"
    }
    Write-Host '→ Installing dependencies and building...'
    Push-Location $RepoDir
    try {
        pnpm install --frozen-lockfile
        pnpm build
    } finally {
        Pop-Location
    }
    Install-CliBin
}

function Get-SkillNames {
    $root = Get-SkillsRoot
    if (-not (Test-Path $root)) { Write-Error "Skills directory not found: $root" }
    Get-ChildItem -Path $root -Directory | Select-Object -ExpandProperty Name
}

function Link-Skills([string]$Target, [string]$Style) {
    $root = Get-SkillsRoot
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }
    switch ($Style) {
        'per-skill' {
            foreach ($skill in (Get-SkillNames)) {
                $src  = Join-Path $root $skill
                $dest = Join-Path $Target $skill
                if (Test-Path $dest) { Remove-Item -Force -Recurse $dest }
                # Junction works without admin; symlink needs elevated prompt or Developer Mode
                try {
                    New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
                    Write-Host "  ✓ linked $skill (junction)"
                } catch {
                    New-Item -ItemType SymbolicLink -Path "$dest" -Target "$src" | Out-Null
                    Write-Host "  ✓ linked $skill (symlink)"
                }
            }
        }
        'folder' {
            $dest = Join-Path $Target 'sprang'
            if (Test-Path $dest) { Remove-Item -Force -Recurse $dest }
            try {
                New-Item -ItemType Junction -Path $dest -Target $root | Out-Null
                Write-Host "  ✓ linked skills folder → $dest (junction)"
            } catch {
                New-Item -ItemType SymbolicLink -Path "$dest" -Target "$root" | Out-Null
                Write-Host "  ✓ linked skills folder → $dest (symlink)"
            }
        }
    }
}

function Unlink-Skills([string]$Target, [string]$Style) {
    if (-not (Test-Path $Target)) { return }
    switch ($Style) {
        'per-skill' {
            foreach ($skill in (Get-SkillNames)) {
                $dest = Join-Path $Target $skill
                if (Test-Path $dest) {
                    Remove-Item -Force -Recurse $dest
                    Write-Host "  ✗ removed $skill"
                }
            }
        }
        'folder' {
            $dest = Join-Path $Target 'sprang'
            if (Test-Path $dest) {
                Remove-Item -Force -Recurse $dest
                Write-Host "  ✗ removed $dest"
            }
        }
    }
}

function Install-Claude {
    Write-Host ''
    Write-Host '→ Claude Code installation'
    Write-Host '  Claude Code uses project-local config files.'
    Write-Host '  No global install is needed — all config ships with Sprang.'
    Write-Host ''
    Write-Host '  Option A — Plugin marketplace (recommended, gives namespaced commands /sprang:sprang-*):'
    Write-Host '    Inside a Claude Code session run:'
    Write-Host '      /plugin marketplace add FavioVazquez/sprang'
    Write-Host '      /plugin install sprang'
    Write-Host '    Then build the MCP server binary (find the versioned cache folder):'
    Write-Host '      cd "$env:USERPROFILE\.claude\plugins\cache\sprang\sprang\<version>"'
    Write-Host '      pnpm install; pnpm build'
    Write-Host '    Then run /reload-plugins inside Claude Code.'
    Write-Host ''
    Write-Host '  Option B — Manual copy (gives unnamespaced /sprang, /sprang-onboard, etc.):'
    Write-Host '    Copy these into your project root:'
    Write-Host "      Copy-Item '$RepoDir\.mcp.json'  <your-project>\"
    Write-Host "      Copy-Item '$RepoDir\CLAUDE.md'  <your-project>\"
    Write-Host "      Copy-Item '$RepoDir\AGENTS.md'  <your-project>\"
    Write-Host "      Copy-Item -Recurse '$RepoDir\.claude'  <your-project>\.claude"
    Write-Host "    Then in <your-project>\.mcp.json update args to the absolute server path:"
    Write-Host "      `"args`": [`"$RepoDir\packages\mcp\dist\server.js`"]"
    Write-Host '    Open the project in Claude Code and run /sprang.'
    Write-Host ''
    Write-Host "  For full details: $RepoDir\CLAUDE.md"
}

# --- Main ---

if ($Help) { Show-Usage; exit 0 }

if ($Update) {
    Clone-Or-Update
    Write-Host "`n✓ Sprang updated."
    exit 0
}

if ($Uninstall) {
    $plat = Resolve-Platform $Uninstall
    Write-Host "`n→ Uninstalling Sprang for $Uninstall..."
    if ($plat.Style -eq 'claude') {
        Write-Host '  Claude Code is project-local — nothing to unlink globally.'
    } else {
        Unlink-Skills $plat.Target $plat.Style
    }
    Write-Host "`n✓ Uninstalled."
    exit 0
}

if (-not $Platform) { $Platform = Prompt-Platform }
$plat = Resolve-Platform $Platform

Write-Host "`n→ Installing Sprang for $Platform..."
Clone-Or-Update

if ($plat.Style -eq 'claude') {
    Install-Claude
} else {
    Write-Host "→ Linking skills into $($plat.Target)"
    Link-Skills $plat.Target $plat.Style
    Write-Host "`n✓ Skills linked for $Platform.`n"
    switch ($Platform) {
        'windsurf' {
            Write-Host 'Next steps to complete the Windsurf / Devin Desktop setup:'
            Write-Host ''
            Write-Host '  1. Add the MCP server to %USERPROFILE%\.codeium\windsurf\mcp_config.json:'
            Write-Host '     {'
            Write-Host '       "mcpServers": { "sprang": {'
            Write-Host "         `"command`": `"node`","
            Write-Host "         `"args`": [`"$RepoDir\packages\mcp\dist\server.js`"],"
            Write-Host '         "env": { "SPRANG_ROOT": "C:\path\to\your\project" }'
            Write-Host '       }}'
            Write-Host '     }'
            Write-Host ''
            Write-Host '  2. Copy rules + hooks into your project root:'
            Write-Host "     Copy-Item -Recurse '$RepoDir\.windsurf\rules\*' .windsurf\rules\"
            Write-Host "     Copy-Item -Recurse '$RepoDir\.devin\rules\*' .devin\rules\"
            Write-Host "     Copy-Item '$RepoDir\.windsurf\hooks.json' .windsurf\"
            Write-Host "     Copy-Item '$RepoDir\.windsurf\hooks\save-conversation.py' .windsurf\hooks\"
            Write-Host "     Copy-Item -Recurse '$RepoDir\.windsurf\workflows\*' .windsurf\workflows\"
            Write-Host "     Copy-Item -Recurse '$RepoDir\.windsurf\skills\sprang*' .windsurf\skills\"
            Write-Host ''
            Write-Host '  3. Reload the Windsurf window (Ctrl+Shift+P → Reload Window)'
            Write-Host '  4. Run: sprang scan C:\path\to\your\project --phase1-only'
            Write-Host ''
            Write-Host '  Full docs: https://github.com/faviovazquez/sprang#windsurf--devin-desktop--agentic-install'
        }
        'copilot' {
            Write-Host 'Next steps to complete the GitHub Copilot setup:'
            Write-Host ''
            Write-Host '  1. Copy .vscode\mcp.json into your project root:'
            Write-Host "     Copy-Item '$RepoDir\.vscode\mcp.json' .vscode\mcp.json"
            Write-Host "     Then edit .vscode\mcp.json → update args to: [`"$RepoDir\packages\mcp\dist\server.js`"]"
            Write-Host ''
            Write-Host '  2. Copy copilot-instructions.md into your project:'
            Write-Host "     Copy-Item '$RepoDir\.github\copilot-instructions.md' .github\"
            Write-Host ''
            Write-Host '  3. Open VS Code, switch Copilot to Agent mode (model selector in chat panel)'
            Write-Host '  4. Run: sprang scan C:\path\to\your\project --phase1-only'
            Write-Host ''
            Write-Host '  Note: MCP tools only work in Copilot Agent mode (not default ask/edit modes).'
            Write-Host '  Full docs: https://github.com/faviovazquez/sprang#github-copilot'
        }
    }
}
