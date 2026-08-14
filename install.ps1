<#
.SYNOPSIS
  Sprang installer for Windows (PowerShell).

.DESCRIPTION
  Clones the repo, builds it, and links the canonical skills/ directory into the
  chosen platform's global skills folder.

  Supported platforms:
    devin     Devin CLI / Devin Desktop
    claude    Claude Code
    copilot   GitHub Copilot CLI

  Each platform has a native plugin path (preferred) and a project-local path
  (always works). This script sets up the global skills link and prints the
  plugin command, because plugin availability differs per platform:
    - Claude  : `/plugin marketplace add` works today
    - Copilot : `copilot plugin install` works today
    - Devin   : plugins are in closed beta and require `devin auth login`,
                so the project-local `.devin/` layout is the primary route.

.EXAMPLE
  .\install.ps1                     # prompt for platform
  .\install.ps1 devin               # install for Devin CLI / Devin Desktop
  .\install.ps1 claude              # install for Claude Code
  .\install.ps1 copilot             # install for GitHub Copilot CLI
  .\install.ps1 -Update             # pull latest changes + rebuild
  .\install.ps1 -Uninstall devin    # remove global skill links for devin
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

# WARNING: Setting SPRANG_REPO_URL redirects the clone to an arbitrary URL with
# no integrity check. Only use this to point to a trusted fork.
$RepoUrl = if ($env:SPRANG_REPO_URL) { $env:SPRANG_REPO_URL } else { 'https://github.com/faviovazquez/sprang.git' }
$RepoDir = if ($env:SPRANG_DIR)      { $env:SPRANG_DIR }      else { Join-Path $HOME '.sprang\repo' }

# Global skill directories. Project-level assets are installed per project with
# `sprang init --platform <p>`.
$Platforms = [ordered]@{
    devin   = @{ Label = 'Devin CLI / Devin Desktop'; Target = (Join-Path $HOME 'AppData\Roaming\devin\skills') }
    claude  = @{ Label = 'Claude Code';               Target = (Join-Path $HOME '.claude\skills') }
    copilot = @{ Label = 'GitHub Copilot CLI';        Target = (Join-Path $HOME '.copilot\skills') }
}

function Show-Usage {
    @"
Sprang installer (Windows)

Usage:
  install.ps1 [<platform>]               Install for <platform> (or prompt if omitted)
  install.ps1 -Update                    Pull latest changes + rebuild
  install.ps1 -Uninstall <platform>      Remove global skill links for <platform>
  install.ps1 -Help

Supported platforms:
  devin     Devin CLI / Devin Desktop
  claude    Claude Code
  copilot   GitHub Copilot CLI

Environment:
  SPRANG_REPO_URL   Override clone URL
  SPRANG_DIR        Override install destination (default: %USERPROFILE%\.sprang\repo)
"@
}

function Resolve-Platform([string]$Id) {
    if (-not $Platforms.Contains($Id)) {
        Write-Error "Unknown platform: $Id. Supported: $($Platforms.Keys -join ', ')"
    }
    return $Id
}

function Get-PlatformChoice {
    $ids = @($Platforms.Keys)
    Write-Host 'Which platform are you installing for?'
    for ($i = 0; $i -lt $ids.Count; $i++) {
        Write-Host ("  {0}) {1,-8} - {2}" -f ($i + 1), $ids[$i], $Platforms[$ids[$i]].Label)
    }
    $choice = Read-Host ("Choose [1-{0}]" -f $ids.Count)
    if (-not $choice) {
        Write-Host ''
        Write-Host 'No input received. Pass the platform as an argument instead:'
        Write-Host '  .\install.ps1 devin'
        exit 1
    }
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 1 -or $n -gt $ids.Count) {
        Write-Error "Invalid choice: $choice"
    }
    return $ids[$n - 1]
}

function Get-SkillsRoot {
    # The canonical skills live in skills/ at the repo root.
    return (Join-Path $RepoDir 'skills')
}

function Install-CliBin {
    $cliBin = Join-Path $RepoDir 'packages\cli\dist\index.js'
    if (-not (Test-Path $cliBin)) {
        Write-Host "  ! CLI binary not found at $cliBin - skipping PATH link"
        return
    }
    # Write a .cmd wrapper to %LOCALAPPDATA%\Microsoft\WindowsApps (on PATH by default on Windows 10+)
    $binDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
    if (-not (Test-Path $binDir)) {
        $binDir = Join-Path $env:USERPROFILE '.local\bin'
        if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
        Write-Host "  i Add $binDir to your PATH if not already present"
    }
    $wrapper = "@echo off`r`nnode `"$cliBin`" %*`r`n"
    [System.IO.File]::WriteAllText((Join-Path $binDir 'sprang.cmd'), $wrapper)
    Write-Host "  + sprang CLI linked -> $binDir\sprang.cmd"
}

function Update-Checkout {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "-> Updating existing checkout at $RepoDir"
        git -C "$RepoDir" pull --ff-only
    } else {
        Write-Host "-> Cloning $RepoUrl -> $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone "$RepoUrl" "$RepoDir"
    }
    Write-Host '-> Installing dependencies and building...'
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
    return (Get-ChildItem -Path $root -Directory | Select-Object -ExpandProperty Name)
}

function Install-GlobalSkills([string]$Target) {
    $root = Get-SkillsRoot
    if (-not (Test-Path $root)) { Write-Error "Skills directory not found: $root" }
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
    foreach ($skill in (Get-SkillNames)) {
        $src  = Join-Path $root $skill
        $dest = Join-Path $Target $skill
        if (Test-Path $dest) { Remove-Item -Force -Recurse $dest }
        # Junction works without admin; symlink needs elevation or Developer Mode
        try {
            New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
            Write-Host "  + linked $skill (junction)"
        } catch {
            New-Item -ItemType SymbolicLink -Path "$dest" -Target "$src" | Out-Null
            Write-Host "  + linked $skill (symlink)"
        }
    }
}

function Uninstall-GlobalSkills([string]$Target) {
    if (-not (Test-Path $Target)) { return }
    foreach ($skill in (Get-SkillNames)) {
        $dest = Join-Path $Target $skill
        if (Test-Path $dest) {
            Remove-Item -Force -Recurse $dest
            Write-Host "  - removed $skill"
        }
    }
}

function Show-NextSteps([string]$Id) {
    Write-Host ''
    Write-Host 'Project setup - run this inside each project you want indexed:'
    Write-Host ''
    Write-Host "  sprang init --platform $Id"
    Write-Host '  sprang scan .'
    Write-Host ''

    switch ($Id) {
        'devin' {
            Write-Host 'What `sprang init --platform devin` writes:'
            Write-Host '  .devin\skills\      11 skills (/sprang, /sprang-analyze, ...)'
            Write-Host '  .devin\rules\       glob-triggered graph-context rules'
            Write-Host '  .devin\hooks.v1.json + .devin\hooks\  stale-graph warning, post-commit refresh'
            Write-Host '  .devin\mcp_config.json                MCP server (${workspaceFolder})'
            Write-Host ''
            Write-Host 'Plugin install (closed beta - needs `devin auth login`):'
            Write-Host '  devin plugins install faviovazquez/sprang'
        }
        'claude' {
            Write-Host 'What `sprang init --platform claude` writes:'
            Write-Host '  .claude\skills\     11 skills (slash commands are skills now)'
            Write-Host '  .claude\rules\      graph-context rules'
            Write-Host '  .claude\settings.json  hooks + pre-approved permissions'
            Write-Host '  .mcp.json           MCP server'
            Write-Host ''
            Write-Host 'Plugin install (works today), inside a Claude Code session:'
            Write-Host '  /plugin marketplace add FavioVazquez/sprang'
            Write-Host '  /plugin install sprang'
        }
        'copilot' {
            Write-Host 'What `sprang init --platform copilot` writes:'
            Write-Host '  skills\             11 skills'
            Write-Host '  .github\copilot-instructions.md'
            Write-Host '  .mcp.json           MCP server (Copilot CLI)'
            Write-Host '  .vscode\mcp.json    MCP server (VS Code extension)'
            Write-Host ''
            Write-Host 'Plugin install (works today):'
            Write-Host '  copilot plugin install faviovazquez/sprang'
        }
    }

    Write-Host ''
    Write-Host 'Dashboard:'
    Write-Host '  sprang open .'
    Write-Host ''
    Write-Host "Full docs: $RepoDir\README.md"
}

# --- Main ---

if ($Help) { Show-Usage; exit 0 }

if ($Update) {
    Update-Checkout
    Write-Host ''
    Write-Host 'Sprang updated.'
    exit 0
}

if ($Uninstall) {
    $id = Resolve-Platform $Uninstall
    $target = $Platforms[$id].Target
    Write-Host ''
    Write-Host "-> Uninstalling Sprang for $id..."
    Uninstall-GlobalSkills $target
    Write-Host ''
    Write-Host 'Uninstalled. Project-level files (.devin\, .claude\, .github\) are left in place.'
    exit 0
}

if (-not $Platform) { $Platform = Get-PlatformChoice }
$Platform = Resolve-Platform $Platform
$Target = $Platforms[$Platform].Target

Write-Host ''
Write-Host "-> Installing Sprang for $($Platforms[$Platform].Label)..."
Update-Checkout

Write-Host "-> Linking skills into $Target"
Install-GlobalSkills $Target
Write-Host ''
Write-Host "Skills linked globally for $Platform."

Show-NextSteps $Platform
