#
# release.ps1 — Build, tag, and publish a GitHub release for Rage Pad.
#
# Prerequisites:
#   - GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
#   - Node.js, npm, and Rust/Cargo toolchain available
#   - Run from the repository root
#
# Usage:
#   .\scripts\release.ps1            # uses version from package.json
#   .\scripts\release.ps1 -Version 1.2.3   # override version
#
# No secrets are embedded — authentication is handled entirely by `gh`.

param(
    [string]$Version
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot

# ── Resolve version ────────────────────────────────────────────────────────

if (-not $Version) {
    $Version = (node -p "require('./package.json').version").Trim()
}

$Tag = "v$Version"
$InstallerName = "Rage.Pad_${Version}_x64-setup.exe"
$InstallerPath = Join-Path "builds" $InstallerName

Write-Host "==> Preparing release $Tag" -ForegroundColor Cyan

# ── Pre-flight checks ─────────────────────────────────────────────────────

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: GitHub CLI (gh) is not installed. Install it from https://cli.github.com" -ForegroundColor Red
    exit 1
}

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not authenticated with GitHub CLI. Run: gh auth login" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm is not installed." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Rust/Cargo is not installed. Install from https://rustup.rs" -ForegroundColor Red
    exit 1
}

# ── Check for uncommitted changes ──────────────────────────────────────────

$ErrorActionPreference = "Continue"
git diff --quiet HEAD 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: You have uncommitted changes. Commit or stash them before releasing." -ForegroundColor Red
    exit 1
}

# ── Check that the tag doesn't already exist ───────────────────────────────

$ErrorActionPreference = "Continue"
git rev-parse $Tag 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -eq 0) {
    Write-Host "ERROR: Tag $Tag already exists. Bump the version or delete the tag first." -ForegroundColor Red
    exit 1
}

# ── Sync versions across config files ──────────────────────────────────────

Write-Host "==> Syncing version $Version to tauri.conf.json" -ForegroundColor Cyan
node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.version='$Version';fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')"
if ($LASTEXITCODE -ne 0) { exit 1 }

# ── Build ──────────────────────────────────────────────────────────────────

Write-Host "==> Building Windows release (npm run build:windows)" -ForegroundColor Cyan
npm run build:windows
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    exit 1
}

# ── Verify installer exists ────────────────────────────────────────────────

if (-not (Test-Path $InstallerPath)) {
    Write-Host "ERROR: Expected installer not found at: $InstallerPath" -ForegroundColor Red
    Write-Host "       Contents of builds directory:" -ForegroundColor Red
    if (Test-Path "builds") {
        Get-ChildItem "builds" | Format-Table Name, Length
    } else {
        Write-Host "       (directory does not exist)" -ForegroundColor Red
    }
    exit 1
}

$InstallerSize = [math]::Round((Get-Item $InstallerPath).Length / 1MB, 1)
Write-Host "==> Installer built: $InstallerName (${InstallerSize} MB)" -ForegroundColor Green

# ── Tag ────────────────────────────────────────────────────────────────────

Write-Host "==> Creating git tag $Tag" -ForegroundColor Cyan
git tag -a $Tag -m "Release $Tag"
if ($LASTEXITCODE -ne 0) { exit 1 }

git push origin $Tag
if ($LASTEXITCODE -ne 0) { exit 1 }

# ── Create GitHub release & upload installer ───────────────────────────────

Write-Host "==> Creating GitHub release $Tag and uploading installer" -ForegroundColor Cyan
gh release create $Tag $InstallerPath --title $Tag --generate-notes
if ($LASTEXITCODE -ne 0) { exit 1 }

$ReleaseUrl = (gh release view $Tag --json url -q ".url").Trim()
Write-Host ""
Write-Host "==> Release published: $ReleaseUrl" -ForegroundColor Green
