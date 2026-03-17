#
# install-jdk.ps1 - Download and extract Adoptium Temurin JDK 17 for Android builds.
#
# Installs to .jdk/temurin-17 in the repo root and sets JAVA_HOME for the
# current process. Skips download if already present.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/install-jdk.ps1
#

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$JdkDir = Join-Path $RepoRoot ".jdk"
$MarkerFile = Join-Path $JdkDir "temurin-17"
$ZipFile = Join-Path $JdkDir "temurin-17.zip"
$DownloadUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"

# ── Skip if already installed ────────────────────────────────────────────────

if (Test-Path $MarkerFile) {
    $JdkHome = Get-ChildItem $MarkerFile -Directory | Select-Object -First 1 -ExpandProperty FullName
    if ($JdkHome -and (Test-Path (Join-Path $JdkHome "bin\java.exe"))) {
        Write-Host "JDK 17 already installed at $JdkHome" -ForegroundColor Green
        $env:JAVA_HOME = $JdkHome
        Write-Host "JAVA_HOME=$env:JAVA_HOME"
        exit 0
    }
}

# ── Download ─────────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $JdkDir -Force | Out-Null

Write-Host "==> Downloading Adoptium Temurin JDK 17..." -ForegroundColor Cyan
curl.exe -Lo $ZipFile $DownloadUrl --fail
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to download JDK." -ForegroundColor Red
    exit 1
}

# ── Extract ──────────────────────────────────────────────────────────────────

Write-Host "==> Extracting JDK..." -ForegroundColor Cyan

if (Test-Path $MarkerFile) {
    Remove-Item $MarkerFile -Recurse -Force
}

Expand-Archive -Path $ZipFile -DestinationPath $MarkerFile -Force
Remove-Item $ZipFile -Force

# ── Set JAVA_HOME ────────────────────────────────────────────────────────────

$JdkHome = Get-ChildItem $MarkerFile -Directory | Select-Object -First 1 -ExpandProperty FullName
if (-not $JdkHome -or -not (Test-Path (Join-Path $JdkHome "bin\java.exe"))) {
    Write-Host "ERROR: JDK extraction failed - java.exe not found." -ForegroundColor Red
    exit 1
}

$env:JAVA_HOME = $JdkHome
Write-Host "==> JDK 17 installed at $JdkHome" -ForegroundColor Green
Write-Host "    JAVA_HOME=$env:JAVA_HOME"
Write-Host ""
Write-Host "NOTE: JAVA_HOME is set for this session only." -ForegroundColor Yellow
Write-Host "      To persist, run:" -ForegroundColor Yellow
$PersistCmd = "[Environment]::SetEnvironmentVariable('JAVA_HOME', '" + $JdkHome + "', 'User')"
Write-Host "      $PersistCmd" -ForegroundColor Yellow
