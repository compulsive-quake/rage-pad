/**
 * Scans the esbuild server bundle for packages that couldn't be inlined
 * (e.g. browserified code with dynamic requires marked as `"pkg": void 0`),
 * then copies those packages and their transitive dependencies into the
 * bundle directory so they're available at runtime in the Tauri build.
 */
const fs = require('fs');
const path = require('path');

const BUNDLE = path.join(__dirname, '..', 'src-tauri', 'binaries', 'server-bundle.js');
const TARGET_NM = path.join(__dirname, '..', 'src-tauri', 'binaries', 'node_modules');
const SOURCE_NM = path.join(__dirname, '..', 'node_modules');

// Node.js built-in modules to skip
const BUILTINS = new Set(require('module').builtinModules);

// Clean previous copy
if (fs.existsSync(TARGET_NM)) {
  fs.rmSync(TARGET_NM, { recursive: true, force: true });
}

// Scan the bundle for the browserify pattern: "package-name": void 0
// This pattern indicates packages that were externalized by a pre-bundled
// dependency and need to be available via require() at runtime.
console.log('Scanning bundle for unresolved runtime dependencies...');

const bundleContent = fs.readFileSync(BUNDLE, 'utf8');
const pattern = /"([^"]+)":\s*void\s*0/g;
const externalPackages = new Set();
let match;

while ((match = pattern.exec(bundleContent)) !== null) {
  const pkg = match[1];
  // Skip relative paths, absolute paths, and Node builtins
  if (pkg.startsWith('.') || pkg.startsWith('/')) continue;
  if (BUILTINS.has(pkg)) continue;
  externalPackages.add(pkg);
}

if (externalPackages.size === 0) {
  console.log('No unresolved runtime dependencies found.');
  process.exit(0);
}

console.log('Found external packages: ' + [...externalPackages].join(', '));

// Recursively collect all production dependencies of a package
function collectDeps(pkgName, collected) {
  if (collected.has(pkgName)) return;
  collected.add(pkgName);

  const pkgJsonPath = path.join(SOURCE_NM, pkgName, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = pkgJson.dependencies || {};
      for (const dep of Object.keys(deps)) {
        collectDeps(dep, collected);
      }
    } catch {}
  }
}

// Collect all packages that need to be copied (including transitive deps)
const allPackages = new Set();
for (const pkg of externalPackages) {
  collectDeps(pkg, allPackages);
}

// Filter out builtins and packages that don't exist in node_modules
const toCopy = [...allPackages].filter(pkg => {
  if (BUILTINS.has(pkg)) return false;
  if (!fs.existsSync(path.join(SOURCE_NM, pkg))) {
    console.warn('  Warning: ' + pkg + ' not found in node_modules, skipping');
    return false;
  }
  return true;
});

if (toCopy.length === 0) {
  console.log('All external packages are builtins, nothing to copy.');
  process.exit(0);
}

console.log('Copying ' + toCopy.length + ' package(s) to bundle directory...');
fs.mkdirSync(TARGET_NM, { recursive: true });

for (const pkg of toCopy) {
  const src = path.join(SOURCE_NM, pkg);
  const dest = path.join(TARGET_NM, pkg);
  // Handle scoped packages (@scope/name)
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('  Copied: ' + pkg);
}

console.log('Done. Copied ' + toCopy.length + ' package(s).');
