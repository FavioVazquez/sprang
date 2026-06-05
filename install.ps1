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

function Clone-Or-Update {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "→ Updating existing checkout at $RepoDir"
        git -C $RepoDir pull --ff-only
    } else {
        Write-Host "→ Cloning $RepoUrl → $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone $RepoUrl $RepoDir
    }
    Write-Host '→ Installing dependencies and building...'
    Push-Location $RepoDir
    try {
        pnpm install --frozen-lockfile
        pnpm build
    } finally {
        Pop-Location
    }
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
                    cmd /c mklink /D `"$dest`" `"$src`" | Out-Null
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
                cmd /c mklink /D `"$dest`" `"$root`" | Out-Null
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
    Write-Host '  Claude Code uses a project-local .mcp.json file.'
    Write-Host '  No global install is needed — Sprang is already configured per-project.'
    Write-Host ''
    Write-Host '  To enable Sprang in a project:'
    Write-Host "  1. Copy .mcp.json and CLAUDE.md from $RepoDir into your project root:"
    Write-Host "       Copy-Item $RepoDir\.mcp.json <your-project>\"
    Write-Host "       Copy-Item $RepoDir\CLAUDE.md <your-project>\"
    Write-Host '  2. In .mcp.json, set SPRANG_ROOT to the project root (default: ".")'
    Write-Host '  3. Build the knowledge graph: run /sprang inside Claude Code'
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
    Write-Host "`n✓ Sprang installed for $Platform."
    Write-Host "  Run /sprang inside $Platform to build the knowledge graph."
}
