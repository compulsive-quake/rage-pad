// android-run.js - Sign the release APK with a debug key and install/launch on emulator or device.
// Usage: node scripts/android-run.js [install|launch|run]
//   install - sign & install APK
//   launch  - launch already-installed app
//   run     - sign, install, and launch (default)

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const sdk = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const adb = path.join(sdk, 'platform-tools', 'adb');
const apksigner = path.join(sdk, 'build-tools', '35.0.0', 'apksigner.bat');
const unsignedApk = path.join('src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'release', 'app-universal-release-unsigned.apk');
const signedApk = path.join('src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'release', 'app-debug-signed.apk');
const keystore = path.join(process.env.USERPROFILE, '.android', 'debug.keystore');
const appId = 'com.ragepads.ragepad/.MainActivity';

// Resolve JAVA_HOME from local .jdk if present
const jdkDir = path.join(__dirname, '..', '.jdk', 'temurin-17');
if (fs.existsSync(jdkDir)) {
  const sub = fs.readdirSync(jdkDir).find(f => fs.statSync(path.join(jdkDir, f)).isDirectory());
  if (sub) process.env.JAVA_HOME = path.resolve(jdkDir, sub);
}

const action = process.argv[2] || 'run';

function sign() {
  if (!fs.existsSync(unsignedApk)) {
    console.error(`APK not found: ${unsignedApk}\nRun "npm run build:android" first.`);
    process.exit(1);
  }
  fs.copyFileSync(unsignedApk, signedApk);
  console.log('Signing APK with debug keystore...');
  execSync(`"${apksigner}" sign --ks "${keystore}" --ks-pass pass:android --key-pass pass:android "${signedApk}"`, { stdio: 'inherit' });
}

function install() {
  sign();
  console.log('Installing APK...');
  execSync(`"${adb}" install -r "${signedApk}"`, { stdio: 'inherit' });
}

function setupPortForwarding() {
  console.log('Setting up adb reverse port forwarding...');
  execSync(`"${adb}" reverse tcp:9090 tcp:9090`, { stdio: 'inherit' });
  execSync(`"${adb}" reverse tcp:8088 tcp:8088`, { stdio: 'inherit' });
}

function launch() {
  setupPortForwarding();
  console.log('Launching app...');
  execSync(`"${adb}" shell am start -n ${appId}`, { stdio: 'inherit' });
}

if (action === 'install') install();
else if (action === 'launch') launch();
else if (action === 'run') { install(); launch(); }
else { console.error(`Unknown action: ${action}`); process.exit(1); }
