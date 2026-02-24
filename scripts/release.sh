#!/usr/bin/env bash
#
# release.sh — Build, tag, and publish a GitHub release for Rage Pad.
#
# Prerequisites:
#   - GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
#   - Node.js, npm, and Rust/Cargo toolchain available
#   - Run from the repository root
#
# Usage:
#   ./scripts/release.sh          # uses version from package.json
#   ./scripts/release.sh 1.2.3    # override version
#
# No secrets are embedded — authentication is handled entirely by `gh`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Resolve version ────────────────────────────────────────────────────────

VERSION="${1:-$(node -p "require('./package.json').version")}"
TAG="v${VERSION}"
INSTALLER_NAME="Rage.Pad_${VERSION}_x64-setup.exe"
INSTALLER_PATH="builds/${INSTALLER_NAME}"

echo "==> Preparing release ${TAG}"

# ── Pre-flight checks ─────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  echo "ERROR: GitHub CLI (gh) is not installed. Install it from https://cli.github.com"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "ERROR: Not authenticated with GitHub CLI. Run: gh auth login"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "ERROR: npm is not installed."
  exit 1
fi

if ! command -v cargo &>/dev/null; then
  echo "ERROR: Rust/Cargo is not installed. Install from https://rustup.rs"
  exit 1
fi

# ── Check for uncommitted changes ──────────────────────────────────────────

if ! git diff --quiet HEAD; then
  echo "ERROR: You have uncommitted changes. Commit or stash them before releasing."
  exit 1
fi

# ── Check that the tag doesn't already exist ───────────────────────────────

if git rev-parse "$TAG" &>/dev/null; then
  echo "ERROR: Tag ${TAG} already exists. Bump the version or delete the tag first."
  exit 1
fi

# ── Sync versions across config files ──────────────────────────────────────

echo "==> Syncing version ${VERSION} to tauri.conf.json"
node -e "
  const fs = require('fs');
  const p = 'src-tauri/tauri.conf.json';
  const conf = JSON.parse(fs.readFileSync(p, 'utf8'));
  conf.version = '${VERSION}';
  fs.writeFileSync(p, JSON.stringify(conf, null, 2) + '\n');
"

# ── Build ──────────────────────────────────────────────────────────────────

echo "==> Building Windows release (npm run build:windows)"
npm run build:windows

# ── Verify installer exists ────────────────────────────────────────────────

if [ ! -f "$INSTALLER_PATH" ]; then
  echo "ERROR: Expected installer not found at: ${INSTALLER_PATH}"
  echo "       Contents of builds directory:"
  ls -la builds/ 2>/dev/null || echo "       (directory does not exist)"
  exit 1
fi

INSTALLER_SIZE=$(du -h "$INSTALLER_PATH" | cut -f1)
echo "==> Installer built: ${INSTALLER_NAME} (${INSTALLER_SIZE})"

# ── Tag ────────────────────────────────────────────────────────────────────

echo "==> Creating git tag ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"
git push origin "$TAG"

# ── Create GitHub release & upload installer ───────────────────────────────

echo "==> Creating GitHub release ${TAG} and uploading installer"
gh release create "$TAG" \
  "$INSTALLER_PATH" \
  --title "${TAG}" \
  --generate-notes

RELEASE_URL=$(gh release view "$TAG" --json url -q .url)
echo ""
echo "==> Release published: ${RELEASE_URL}"
